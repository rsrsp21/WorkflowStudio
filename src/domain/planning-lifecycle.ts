export type PlanningLifecycle = 'idle' | 'submitting' | 'receiving' | 'success' | 'failure' | 'timeout';

export function isPlanningActive(state: PlanningLifecycle) {
  return state === 'submitting' || state === 'receiving';
}

export function canRetryPlanning(state: PlanningLifecycle) {
  return state === 'failure' || state === 'timeout';
}
