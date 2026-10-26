import type { AsyncDatabaseSession } from './async-database';
import { persistRunTransition } from './run-repository';
import { appendRunEvent, hydrateWorkflowRun, type WorkflowRun } from '@/src/domain/runtime';
import { completeNode, failNode, focusedTaskForRun } from '@/src/domain/runtime-engine';
import { buildCodexFocusedTaskRequest } from '@/src/adapters/codex-node-executor';
import { parseFocusedTaskMessage } from '@/src/adapters/focused-task';

export async function recordRuntimeDeliveryStage(db: AsyncDatabaseSession, job: { id: string; user_id: string; connection_id: string; run_id: string | null; node_id: string | null; payload: string }, payload: unknown) {
  if (!job.run_id || !job.node_id || !payload || typeof payload !== 'object') return;
  const event = payload as { type?: string; threadId?: string };
  const stages = { 'thread/started': 'executing', 'turn/completed': 'verifying', 'runtime.result.saved': 'verifying', 'runtime.result.verified': 'uploading', 'runtime.delivery.blocked': 'blocked' } as const;
  const stage = stages[event.type as keyof typeof stages];
  if (!stage) return;
  const row = await db.get<{ payload: string }>('SELECT payload FROM runs WHERE id = ? AND user_id = ? FOR UPDATE', [job.run_id, job.user_id]);
  if (!row) return;
  const run = hydrateWorkflowRun(JSON.parse(row.payload) as WorkflowRun);
  const metadata = JSON.parse(job.payload).metadata;
  const state = run.nodeRuns.find((node) => node.nodeId === job.node_id);
  const waitingForThisAttempt = state && state.status === 'pending' && run.runtimeWaiting?.nodeId === state.nodeId && state.attempt + 1 === Number(metadata?.workflow_studio_attempt);
  if (!state || !(state.status === 'running' && state.attempt === Number(metadata?.workflow_studio_attempt) || waitingForThisAttempt) || state.iteration !== Number(metadata?.workflow_studio_iteration)) return;
  const rank = { executing: 0, verifying: 1, uploading: 2, blocked: 3, applied: 4 };
  if (state.deliveryStage && rank[state.deliveryStage] >= rank[stage] && state.runtimeJobId === job.id) return;
  state.deliveryStage = stage; state.runtimeJobId = job.id; state.runtimeConnectionId = job.connection_id;
  if (typeof event.threadId === 'string') state.providerThreadId = event.threadId;
  run.updatedAt = new Date().toISOString();
  appendRunEvent(run, { type: 'node.delivery-progress', timestamp: run.updatedAt, nodeId: state.nodeId,
    message: `Companion task is ${stage}.`, data: { jobId: job.id, stage } });
  await persistRunTransition(db, job.user_id, run);
}

/** Called inside the receipt transaction, never from an untrusted progress event. */
export async function applyRuntimeResult(db: AsyncDatabaseSession, job: {
  id: string; user_id: string; connection_id: string; run_id: string | null; node_id: string | null; payload: string;
}, outcome: { result?: unknown; error?: string }): Promise<{ revision?: number; error?: string; stale?: boolean }> {
  if (!job.run_id || !job.node_id) return {};
  const row = await db.get<{ payload: string }>('SELECT payload FROM runs WHERE id = ? AND user_id = ? FOR UPDATE', [job.run_id, job.user_id]);
  if (!row) return {};
  let run = hydrateWorkflowRun(JSON.parse(row.payload) as WorkflowRun);
  const task = JSON.parse(job.payload) as { metadata?: Record<string, string> };
  const state = run.nodeRuns.find((node) => node.nodeId === job.node_id);
  const attempt = Number(task.metadata?.workflow_studio_attempt);
  const iteration = Number(task.metadata?.workflow_studio_iteration);
  if (!state || ['completed', 'failed', 'cancelled'].includes(run.status) || state.iteration !== iteration) return { stale: true };
  if (state.status === 'pending' && run.runtimeWaiting?.nodeId === state.nodeId && state.attempt + 1 === attempt) {
    state.status = 'running'; state.attempt = attempt;
    run.runtimeWaiting = undefined;
    appendRunEvent(run, { type: 'node.started', timestamp: new Date().toISOString(), nodeId: state.nodeId,
      message: 'Resuming delivery of the existing execution attempt.', data: { attempt, iteration, jobId: job.id } });
  }
  if (state.status !== 'running' || state.attempt !== attempt || state.taskId !== task.metadata?.workflow_studio_task_id) return { stale: true };
  state.runtimeJobId = job.id;
  state.runtimeConnectionId = job.connection_id;
  state.deliveryStage = 'applied';
  let error = outcome.error;
  try {
    if (error) throw new Error(error);
    const value = outcome.result as { raw?: unknown; providerThreadId?: string } | undefined;
    if (typeof value?.raw !== 'string') throw new Error('The companion returned no structured result.');
    const parsed = parseFocusedTaskMessage(value.raw, buildCodexFocusedTaskRequest(focusedTaskForRun(run, state.nodeId), []), value.providerThreadId);
    run = completeNode(run, state.nodeId, parsed.output, parsed.selectedCondition, undefined,
      { ...parsed, runtimeJobId: job.id, runtimeConnectionId: job.connection_id }).run;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : 'Result verification failed.';
    run = failNode(run, state.nodeId, error, undefined, outcome.error ? 'tool' : 'validation').run;
  }
  if (run.mastra) run.mastra = { ...run.mastra, status: run.status === 'completed' ? 'completed' : run.status === 'failed' ? 'failed' : 'running', updatedAt: run.updatedAt };
  const saved = await persistRunTransition(db, job.user_id, run);
  return { revision: saved.stateRevision, error };
}
