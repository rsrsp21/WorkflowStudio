import type { NodeRun, WorkflowRun } from './runtime';

/** Explicit recheck only: never reinterpret a failed validation as successful. */
export function rejectedValidationForRecheck(run: WorkflowRun): NodeRun | undefined {
  if (!['running', 'failed'].includes(run.status) || run.pendingInput || run.runtimeWaiting
    || run.nodeRuns.some((node) => node.status === 'running' || node.status === 'waiting-approval')) return undefined;
  const candidate = [...run.nodeRuns].filter((state) => state.status === 'completed'
    && run.compiledWorkflow.nodes.some((node) => node.id === state.nodeId && node.type === 'validation')
    && run.edgeRuns.some((edge) => edge.from === state.nodeId && edge.status === 'selected'
      && run.compiledWorkflow.nodes.some((node) => node.id === edge.to && node.type === 'failure')))
    .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))[0];
  if (!candidate) return undefined;
  const lastFailure = run.events.findLast((event) => event.type === 'run.failed');
  if (lastFailure && !run.edgeRuns.some((edge) => edge.from === candidate.nodeId && edge.to === lastFailure.nodeId && edge.status === 'selected')) return undefined;
  return candidate;
}
