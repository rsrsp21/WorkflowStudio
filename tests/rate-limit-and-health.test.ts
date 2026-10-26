import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let directory = '';
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-edge-')); vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory); vi.resetModules(); });
afterEach(async () => { const { resetDatabaseForTests } = await import('@/src/storage/async-database'); await resetDatabaseForTests(); vi.unstubAllEnvs(); vi.resetModules(); await rm(directory, { recursive: true, force: true }); });

describe('public edge controls', () => {
  it('uses a shared database bucket with deterministic retry timing', async () => {
    const { consumeRateLimit } = await import('@/src/server/rate-limit');
    expect(await consumeRateLimit('login:test', 2, 60, 120_000)).toMatchObject({ allowed: true, remaining: 1 });
    expect(await consumeRateLimit('login:test', 2, 60, 120_001)).toMatchObject({ allowed: true, remaining: 0 });
    expect(await consumeRateLimit('login:test', 2, 60, 120_002)).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    expect(await consumeRateLimit('login:test', 2, 60, 180_000)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('reports database-backed readiness without exposing secrets', async () => {
    const route = await import('@/src/app/api/health/route');
    const response = await route.GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ready', service: 'workflow-studio', schemaVersion: 2, release: { databaseSchemaVersion: 15, runtimeEngine: 'mastra', companion: { protocolVersion: 1, currentVersion: '0.2.0' } }, database: { provider: 'postgres', migrationCount: 15, quarantinedRecords: 0 } });
  });
});
