import { appendRunEvent, type WorkflowRun } from './runtime';
import { classifyExecutionError, completeNode, failNode, focusedTaskForRun, nativeNodeResult, nextRunnableNode, resolveNodeInput, startNextNode, waitForRuntime,
  type NodeTaskExecutor, type RunStateStore } from './runtime-engine';
import { assertNodeAttempt, RunStateConflictError } from './run-transition-service';
import { isRuntimeUnavailable } from './runtime-unavailable';

export function requestMissingNodeInput(source: WorkflowRun): WorkflowRun | undefined {
  const node = nextRunnableNode(source);
  if (!node) return;
  const values = resolveNodeInput(source, node.id);
  const missing = node.inputKeys.filter((key) => !Object.hasOwn(values, key) || typeof values[key] === 'string' && !(values[key] as string).trim());
  if (!missing.length) return;
  const run = structuredClone(source);
  run.pendingInput = { nodeId: node.id, keys: missing };
  run.updatedAt = new Date().toISOString();
  appendRunEvent(run, { type: 'node.input-requested', timestamp: run.updatedAt, nodeId: node.id,
    message: `${node.name} needs user input before execution.`, data: { keys: missing } });
  return run;
}

/** Concurrent executors never merge snapshots. Each pure transition rebases on the committed state. */
export async function runActiveBranches(userId: string, runId: string, store: RunStateStore, executor: NodeTaskExecutor): Promise<WorkflowRun> {
  const active = new Map<string, Promise<void>>();
  const read = async () => {
    const run = await store.read(userId, runId);
    if (!run) throw new Error('Run was not found.');
    return run;
  };
  const commit = async (change: (run: WorkflowRun) => WorkflowRun | undefined) => {
    for (let retry = 0; retry < 20; retry++) {
      const latest = await read();
      const next = change(latest);
      if (!next) return latest;
      try { return await store.upsert(userId, next); }
      catch (error) { if (!(error instanceof RunStateConflictError)) throw error; }
    }
    throw new RunStateConflictError('Concurrent transitions could not settle. Work remains durable for reconciliation.');
  };
  const cancelStopped = async (run: WorkflowRun) => {
    if (process.env.CODEX_RUNTIME_MODE === 'paired' || process.env.NODE_ENV === 'production') {
      const { cancelObsoleteBranchJobs } = await import('@/src/storage/run-branch-cancellation');
      await cancelObsoleteBranchJobs(run);
    }
  };
  const launch = (run: WorkflowRun) => {
    for (const state of run.nodeRuns.filter((node) => node.status === 'running')) {
      if (active.has(state.nodeId)) continue;
      const fence = structuredClone(state);
      const task = focusedTaskForRun(run, state.nodeId);
      const work = (async () => {
        try {
          const result = nativeNodeResult(run, state.nodeId) ?? await executor.execute(task);
          await commit((latest) => {
            const current = latest.nodeRuns.find((node) => node.nodeId === state.nodeId)!;
            if (['completed', 'failed', 'cancelled'].includes(latest.status) || current.status === 'skipped') return;
            if (result.runtimeJobId && current.runtimeJobId === result.runtimeJobId && current.status === 'completed') return;
            assertNodeAttempt(latest, fence);
            return completeNode(latest, state.nodeId, result.output, result.selectedCondition, undefined, result).run;
          });
        } catch (error) {
          if (error instanceof RunStateConflictError) throw error;
          await commit((latest) => {
            const current = latest.nodeRuns.find((node) => node.nodeId === state.nodeId)!;
            if (['completed', 'failed', 'cancelled'].includes(latest.status) || current.status === 'skipped') return;
            const jobId = error && typeof error === 'object' && 'jobId' in error ? error.jobId : undefined;
            if (jobId && current.runtimeJobId === jobId && current.status !== 'running') return;
            assertNodeAttempt(latest, fence);
            return isRuntimeUnavailable(error) ? waitForRuntime(latest, state.nodeId, (error as Error).message).run
              : failNode(latest, state.nodeId, error instanceof Error ? error.message : 'Execution failed.', undefined, classifyExecutionError(error)).run;
          });
        }
        await cancelStopped(await read());
      })();
      // Attach rejection handling immediately; all outcomes remain awaited below.
      active.set(state.nodeId, work);
      void work.catch(() => undefined);
    }
  };
  let run = await read();
  launch(run);
  try {
    while (active.size) {
      const id = await Promise.race([...active].map(([id, work]) => work.then(() => id)));
      active.delete(id);
      run = await read();
      if (run.status !== 'running' || run.runtimeWaiting || run.pendingInput) continue;
      // Refill capacity while siblings execute, allowing an early quorum join.
      while (active.size && nextRunnableNode(run)) {
        const missing = requestMissingNodeInput(run);
        if (missing) { run = await store.upsert(userId, missing); break; }
        const next = nextRunnableNode(run)!;
        if (next.type === 'approval' || next.requiresApproval || ['loop', 'success', 'failure'].includes(next.type)) break;
        run = await store.upsert(userId, startNextNode(run).run);
        await cancelStopped(run);
        launch(run);
      }
    }
  } finally {
    // Never detach still-running branch promises on failure or cancellation.
    await Promise.allSettled(active.values());
  }
  return read();
}
