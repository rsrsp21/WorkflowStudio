import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(async () => {
  await (await import('@/src/storage/async-database')).resetDatabaseForTests();
  vi.unstubAllEnvs();
});

describe('Phase 8 release and monitoring contracts', () => {
  it('publishes a stable compatibility manifest', async () => {
    vi.stubEnv('WORKFLOW_STUDIO_RELEASE_ID', 'release-2026.09.09');
    const response = (await import('@/src/app/api/version/route')).GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: 'workflow-studio', releaseId: 'release-2026.09.09', apiSchemaVersion: 2, databaseSchemaVersion: 15, runtimeEngine: 'mastra', runtimeVersion: 1, legacyRollbackEnabled: false, companion: { protocolVersion: 1, currentVersion: '0.2.0', minimumVersion: '0.1.0' } });
  });

  it('protects Prometheus metrics with a dedicated bearer token and exposes no user content', async () => {
    vi.stubEnv('WORKFLOW_STUDIO_METRICS_TOKEN', 'qualification-metrics-token-1234567890');
    const { createUser } = await import('@/src/auth/auth');
    await createUser({ name: 'Private metric user', email: 'private-metric@example.com', password: 'password-123', role: 'builder' });
    const route = await import('@/src/app/api/metrics/route');
    expect((await route.GET(new Request('http://localhost/api/metrics'))).status).toBe(401);
    expect((await route.GET(new Request('http://localhost/api/metrics', { headers: { authorization: 'Bearer wrong-token' } }))).status).toBe(401);
    const response = await route.GET(new Request('http://localhost/api/metrics', { headers: { authorization: 'Bearer qualification-metrics-token-1234567890' } }));
    const output = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('version=0.0.4');
    expect(output).toContain('workflow_studio_accounts 1');
    expect(output).toContain('workflow_studio_database_probe_milliseconds');
    expect(output).not.toContain('private-metric@example.com');
    expect(output).not.toContain('qualification-metrics-token');
  });
});
