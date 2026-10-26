export const WORKFLOW_RUNTIME_VERSION = 1 as const;
export type WorkflowRuntimeEngine = 'mastra' | 'legacy';

export interface RuntimeRolloutConfiguration {
  engineForNewRuns: WorkflowRuntimeEngine;
  version: typeof WORKFLOW_RUNTIME_VERSION;
  legacyRollbackEnabled: boolean;
}

export function runtimeRolloutConfiguration(environment: Record<string, string | undefined> = process.env): RuntimeRolloutConfiguration {
  const requested = environment.WORKFLOW_STUDIO_RUNTIME_ENGINE?.trim().toLowerCase() || 'mastra';
  if (requested !== 'mastra' && requested !== 'legacy') throw new Error('WORKFLOW_STUDIO_RUNTIME_ENGINE must be mastra or legacy.');
  const legacyRollbackEnabled = environment.WORKFLOW_STUDIO_ENABLE_LEGACY_ROLLBACK === 'true';
  if (requested === 'legacy' && !legacyRollbackEnabled) throw new Error('Legacy runtime rollback requires WORKFLOW_STUDIO_ENABLE_LEGACY_ROLLBACK=true.');
  return { engineForNewRuns: requested, version: WORKFLOW_RUNTIME_VERSION, legacyRollbackEnabled };
}
