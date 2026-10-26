import { randomUUID } from 'node:crypto';
import { getDatabase } from '@/src/storage/async-database';
import { RunRepository } from '@/src/storage/run-repository';
import { acquireRunExecutionLock, releaseRunExecutionLock, renewRunExecutionLock } from '@/src/storage/run-execution-lock';
import { LocalMastraAdapter } from '@/src/adapters/mastra-adapter';
import { CodexNodeExecutor } from '@/src/adapters/codex-node-executor';
import { createCodexPlanningAdapter } from '@/src/adapters/codex-app-server-adapter';
import { nextRunnableNode, resolveNodeInput, SequentialRuntime } from '@/src/domain/runtime-engine';
import { appendRunEvent } from '@/src/domain/runtime';
import { getOnlineRuntimeConnection } from '@/src/storage/runtime-connection-repository';
import { shouldUsePairedRuntime } from '@/src/adapters/paired-runtime-adapter';
import { companionSupportsDurableResults } from '@/src/domain/runtime-connection';

type Work = { run_id: string; user_id: string; state_revision: number };

/** Durable claims, not the browser connection, own continuation after authorization. */
export async function coordinateNextRun(): Promise<boolean> {
  const db = await getDatabase();
  const token = randomUUID();
  const now = new Date();
  const work = await db.get<Work>(`UPDATE run_reconciliation SET lease_token = ?, lease_until = ?
    WHERE run_id = (SELECT run_id FROM run_reconciliation WHERE execution_requested = TRUE
      AND state_revision > acknowledged_revision AND available_at <= ? AND (lease_until IS NULL OR lease_until < ?)
      ORDER BY available_at ASC FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING run_id, user_id, state_revision`,
  [token, new Date(now.getTime() + 45_000).toISOString(), now.toISOString(), now.toISOString()]);
  if (!work) return false;
  let repository = new RunRepository();
  let lock: string | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let retry = false;
  let acknowledgedRevision = work.state_revision;
  let error: string | null = null;
  try {
    lock = await acquireRunExecutionLock(work.user_id, work.run_id);
    if (!lock) { retry = true; return true; }
    repository = new RunRepository({ userId: work.user_id, runId: work.run_id, token: lock });
    timer = setInterval(() => {
      void Promise.all([
        renewRunExecutionLock(work.user_id, work.run_id, lock!),
        db.run('UPDATE run_reconciliation SET lease_until = ? WHERE run_id = ? AND lease_token = ?',
          [new Date(Date.now() + 45_000).toISOString(), work.run_id, token])
      ]).catch(() => undefined);
    }, 15_000);
    timer.unref?.();
    const run = await repository.read(work.user_id, work.run_id);
    acknowledgedRevision = run?.stateRevision ?? acknowledgedRevision;
    if (!run || !run.executionRequested || ['completed', 'failed', 'cancelled', 'paused'].includes(run.status) || run.pendingInput) return true;
    if (shouldUsePairedRuntime()) {
      const connection = await getOnlineRuntimeConnection(work.user_id);
      if (!connection || !companionSupportsDurableResults(connection.companionVersion)) { retry = true; return true; }
    }
    const next = nextRunnableNode(run);
    if (next) {
      const inputs = resolveNodeInput(run, next.id);
      const missing = next.inputKeys.filter((key) => !Object.hasOwn(inputs, key));
      if (missing.length) {
        run.pendingInput = { nodeId: next.id, keys: missing };
        run.updatedAt = new Date().toISOString();
        appendRunEvent(run, { type: 'node.input-requested', nodeId: next.id, timestamp: run.updatedAt,
          message: `${next.name} needs user input before execution.`, data: { keys: missing } });
        acknowledgedRevision = (await repository.upsert(work.user_id, run)).stateRevision!;
        return true;
      }
    }
    const codexExecutor = new CodexNodeExecutor(createCodexPlanningAdapter({ userId: work.user_id }), []);
    const executor = { execute: async (task: Parameters<typeof codexExecutor.execute>[0]) => {
      await repository.assertExecutionOwnership();
      return codexExecutor.execute(task);
    } };
    if (run.mastra) {
      const adapter = new LocalMastraAdapter({ store: repository, executor });
      try { await adapter.start(run.mastra.workflowId, run.id, { userId: work.user_id, run }); }
      finally { await adapter.close(); }
    } else {
      await new SequentialRuntime(repository).executeNext(work.user_id, run.id, executor);
    }
    const latest = await repository.read(work.user_id, work.run_id);
    acknowledgedRevision = latest?.stateRevision ?? acknowledgedRevision;
    retry = latest?.status === 'running' && !latest.pendingInput;
  } catch (cause) {
    // Bounded retry of coordination, not a new task attempt. Executor/receipt
    // identities decide whether existing work is resumed or actually retried.
    retry = true;
    error = cause instanceof Error ? cause.name : 'CoordinatorError';
  } finally {
    if (timer) clearInterval(timer);
    if (lock) await releaseRunExecutionLock(work.user_id, work.run_id, lock);
    await db.run(`UPDATE run_reconciliation SET acknowledged_revision = CASE WHEN ? THEN acknowledged_revision ELSE GREATEST(acknowledged_revision, ?) END,
      available_at = ?, lease_token = NULL, lease_until = NULL, last_error = ? WHERE run_id = ? AND lease_token = ?`,
    [retry, acknowledgedRevision, new Date(Date.now() + 5000).toISOString(), error, work.run_id, token]);
  }
  return true;
}

const holder = globalThis as typeof globalThis & { __workflowStudioCoordinator?: ReturnType<typeof setInterval> };
export function startRunCoordinator() {
  if (holder.__workflowStudioCoordinator || process.env.NODE_ENV === 'test' || process.env.WORKFLOW_STUDIO_COORDINATOR === 'off') return;
  let busy = 0;
  holder.__workflowStudioCoordinator = setInterval(() => {
    if (busy >= 4) return;
    busy++;
    void coordinateNextRun().catch(() => undefined).finally(() => { busy--; });
  }, 2000);
  holder.__workflowStudioCoordinator.unref?.();
}
