import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let directory = '';
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-metrics-')); vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory); vi.resetModules(); });
afterEach(async () => { const { resetDatabaseForTests } = await import('@/src/storage/async-database'); await resetDatabaseForTests(); vi.unstubAllEnvs(); vi.resetModules(); await rm(directory, { recursive: true, force: true }); });

describe('administrator operations metrics', () => {
  it('denies builders and exposes only aggregate health to administrators', async () => {
    const { createSession, createUser } = await import('@/src/auth/auth');
    const builder = await createUser({ name: 'Metrics builder', email: 'metrics-builder@example.com', password: 'password-123', role: 'builder' });
    const admin = await createUser({ name: 'Metrics admin', email: 'metrics-admin@example.com', password: 'password-123', role: 'administrator' });
    if (!builder || !admin) throw new Error('User setup failed.');
    const headerFor = async (userId: string) => { const session = await createSession(userId); return { cookie: `workflow_studio_session=${session.token}` }; };
    const route = await import('@/src/app/api/admin/metrics/route');
    expect((await route.GET(new Request('http://localhost/api/admin/metrics', { headers: await headerFor(builder.id) }))).status).toBe(403);
    const response = await route.GET(new Request('http://localhost/api/admin/metrics', { headers: await headerFor(admin.id) }));
    expect(response.status).toBe(200);
    expect((await response.json()).metrics).toMatchObject({ accounts: 2, activeSessions: 2, runs: { total: 0 }, jobs: { queued: 0 }, quarantinedRecords: 0 });
  });
});
