import type { WorkflowRun } from './runtime';

/** Ignore persistence timestamps and request receipts: those aren't execution. */
export function executionProgressToken(run: WorkflowRun): string {
  return JSON.stringify({ status: run.status, input: run.pendingInput, waiting: run.runtimeWaiting,
    nodes: run.nodeRuns.map((node) => [node.nodeId, node.status, node.attempt, node.iteration, node.selectedCondition, node.error]),
    edges: run.edgeRuns.map((edge) => [edge.status, edge.traversalCount]),
    approvals: run.approvalRecords.map((approval) => [approval.id, approval.decision, approval.resumedAt]),
    loops: run.loopIterations, events: run.events.length });
}

export const NO_EXECUTION_PROGRESS = 'Execution stopped because no workflow step advanced. Completed work is saved. Review the blocked route or recover the run before continuing.';
