import type { NodeRun, WorkflowRun } from './runtime';

/** Only execution failures are retryable; human stops and exhausted loops stay terminal. */
export function failedStepForRetry(run: WorkflowRun): NodeRun | undefined {
  if (run.status !== 'failed') return undefined;
  const failures = run.nodeRuns.filter((node) => node.status === 'failed');
  if (failures.length !== 1) return undefined;
  const failed = failures[0];
  const definition = run.compiledWorkflow.nodes.find((node) => node.id === failed.nodeId);
  if (!definition || ['failure', 'approval'].includes(definition.type) || failed.failureKind === 'human-rejection') return undefined;
  const terminal = run.events.findLast((event) => event.type === 'run.failed');
  const failure = run.events.findLast((event) => event.type === 'node.failed');
  return terminal && failure && terminal.nodeId === failed.nodeId && failure.nodeId === failed.nodeId
    && terminal.sequence === failure.sequence + 1 && terminal.timestamp === failure.timestamp ? failed : undefined;
}
