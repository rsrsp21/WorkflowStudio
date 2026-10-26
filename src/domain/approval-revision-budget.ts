import type { WorkflowRun } from './runtime';

/** Only the revision route is restricted; accepting existing work stays available. */
export function revisionBudgetBlocker(run: WorkflowRun, nodeId: string, keyword?: string): string | undefined {
  const edges = (run.compiledWorkflow.edges ?? []).filter((edge) => edge.from === nodeId);
  const edge = keyword
    ? edges.find((candidate) => (candidate.condition ?? '').trim().toLowerCase() === keyword.trim().toLowerCase())
    : edges.find((candidate) => /revis|change|feedback|rework|retry|loop/i.test(candidate.condition ?? '')
      || run.compiledWorkflow.nodes.some((node) => node.id === candidate.to && node.type === 'loop'));
  const loop = run.compiledWorkflow.nodes.find((node) => node.id === edge?.to && node.type === 'loop');
  const limit = run.executionConfiguration?.harness.maxLoopIterations ?? run.compiledWorkflow.maxLoopIterations;
  if (loop && (run.loopIterations[loop.id] ?? 0) >= limit) {
    return 'The revision limit has been reached. Continue with the current results, stop, or explicitly increase the loop limit in execution settings before requesting another revision.';
  }
}
