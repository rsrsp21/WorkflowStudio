import { validateWorkflowRun, type WorkflowRun } from './runtime';

export class RunStateConflictError extends Error {
  readonly code = 'RUN_STATE_CONFLICT';
  constructor(message = 'Run state changed. Reload the current run before trying again.') {
    super(message);
    this.name = 'RunStateConflictError';
  }
}

export interface NodeAttemptFence {
  nodeId: string;
  taskId: string;
  attempt: number;
  iteration: number;
}

export function assertNodeAttempt(run: WorkflowRun, fence: NodeAttemptFence): void {
  const node = run.nodeRuns.find((candidate) => candidate.nodeId === fence.nodeId);
  if (run.status !== 'running' || node?.status !== 'running' || node.taskId !== fence.taskId
    || node.attempt !== fence.attempt || node.iteration !== fence.iteration) {
    throw new RunStateConflictError('Execution attempt is stale; its result or error cannot change the current run.');
  }
}

/** Shared commit policy. The caller must hold the authoritative database row lock. */
export function prepareRunTransition(userId: string, proposed: WorkflowRun, existing?: WorkflowRun): WorkflowRun {
  if (proposed.userId !== userId || existing && existing.userId !== userId) throw new Error('Run owner does not match the authenticated user.');
  const expected = proposed.stateRevision ?? 0;
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('Run state revision is invalid.');
  if (expected !== (existing?.stateRevision ?? 0)) throw new RunStateConflictError();
  if (existing) {
    if (proposed.events.length < existing.events.length || existing.events.some((event, index) => JSON.stringify(proposed.events[index]) !== JSON.stringify(event))) {
      throw new Error('Run event journal is append-only and cannot be rewritten.');
    }
    const identity = ['id', 'userId', 'projectId', 'workflowId', 'workflowVersion', 'assignmentId', 'assignmentConfigurationVersion', 'sourcePlanId', 'rootPath', 'createdAt'] as const;
    if (identity.some((key) => proposed[key] !== existing[key])) throw new RunStateConflictError('Persisted run identity cannot be changed.');
    if ((existing.status === 'cancelled' || existing.status === 'completed') && proposed.status !== existing.status) {
      throw new RunStateConflictError(`A ${existing.status} run cannot be reopened.`);
    }
    if (existing.status === 'failed' && proposed.status !== 'failed'
      && !proposed.events.slice(existing.events.length).some((event) => event.type === 'node.recovered')) {
      throw new RunStateConflictError('A failed run requires an explicit recovery transition.');
    }
  }
  const next = structuredClone(proposed);
  next.stateRevision = expected + 1;
  const errors = validateWorkflowRun(next);
  if (errors.length) throw new Error(`Run persistence rejected invalid state: ${errors.join(' ')}`);
  return next;
}
