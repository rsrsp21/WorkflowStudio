import { describe, expect, it } from 'vitest';
import { runtimeRolloutConfiguration } from '@/src/domain/runtime-rollout';

describe('runtime rollout configuration', () => {
  it('defaults all new runs to the versioned Mastra boundary', () => {
    expect(runtimeRolloutConfiguration({})).toEqual({
      engineForNewRuns: 'mastra', version: 1, legacyRollbackEnabled: false
    });
  });

  it('requires an explicit emergency switch before creating legacy runs', () => {
    expect(() => runtimeRolloutConfiguration({ WORKFLOW_STUDIO_RUNTIME_ENGINE: 'legacy' })).toThrow(/requires WORKFLOW_STUDIO_ENABLE_LEGACY_ROLLBACK=true/);
    expect(runtimeRolloutConfiguration({ WORKFLOW_STUDIO_RUNTIME_ENGINE: 'legacy', WORKFLOW_STUDIO_ENABLE_LEGACY_ROLLBACK: 'true' })).toMatchObject({ engineForNewRuns: 'legacy', legacyRollbackEnabled: true });
  });

  it('rejects unknown engines instead of silently falling back', () => {
    expect(() => runtimeRolloutConfiguration({ WORKFLOW_STUDIO_RUNTIME_ENGINE: 'custom' })).toThrow(/must be mastra or legacy/);
  });
});
