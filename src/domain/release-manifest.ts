import { COMPANION_APP_VERSION, COMPANION_MINIMUM_APP_VERSION, COMPANION_PROTOCOL_VERSION } from './runtime-connection';
import { runtimeRolloutConfiguration } from './runtime-rollout';

export const DATABASE_SCHEMA_VERSION = 15;
export const API_SCHEMA_VERSION = 2;

export function releaseManifest(environment: Record<string, string | undefined> = process.env) {
  const rollout = runtimeRolloutConfiguration(environment);
  return {
    service: 'workflow-studio',
    releaseId: environment.WORKFLOW_STUDIO_RELEASE_ID?.trim() || 'development',
    apiSchemaVersion: API_SCHEMA_VERSION,
    databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
    runtimeEngine: rollout.engineForNewRuns,
    runtimeVersion: rollout.version,
    legacyRollbackEnabled: rollout.legacyRollbackEnabled,
    companion: { protocolVersion: COMPANION_PROTOCOL_VERSION, currentVersion: COMPANION_APP_VERSION, minimumVersion: COMPANION_MINIMUM_APP_VERSION }
  };
}
