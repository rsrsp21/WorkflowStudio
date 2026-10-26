import type { WorkflowRun } from './runtime';

export function isTerminalRunStatus(status: WorkflowRun['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/** Use the durable terminal event so later metadata updates cannot extend a run. */
export function runElapsedEndTime(run: Pick<WorkflowRun, 'status' | 'updatedAt' | 'events'>, clock: number): number {
  if (!isTerminalRunStatus(run.status)) return clock;
  const terminalEvent = [...run.events].reverse().find((event) => event.type === `run.${run.status}`);
  const terminalTime = Date.parse(terminalEvent?.timestamp ?? '');
  return Number.isFinite(terminalTime) ? terminalTime : Date.parse(run.updatedAt);
}
