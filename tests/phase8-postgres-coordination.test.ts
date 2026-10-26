import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(async () => {
  const { resetDatabaseForTests } = await import('@/src/storage/async-database');
  await resetDatabaseForTests();
  vi.unstubAllEnvs();
});

async function owner() {
  const { createUser } = await import('@/src/auth/auth');
  const user = await createUser({ name: 'Coordinator owner', email: `coordinator-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'builder' });
  if (!user) throw new Error('Could not create coordinator owner.');
  return user;
}

describe('Phase 8 PostgreSQL coordination', () => {
  it('rejects a stale workflow writer while preserving the accepted revision', async () => {
    const user = await owner();
    const { WorkflowRepository } = await import('@/src/storage/workflow-repository');
    const repository = new WorkflowRepository();
    const original = structuredClone(STARTER_WORKFLOWS[0]);
    original.id = `workflow_${crypto.randomUUID()}`;
    await repository.upsert(user.id, original);

    const accepted = { ...structuredClone(original), name: 'Accepted revision', updatedAt: new Date(Date.parse(original.updatedAt) + 1_000).toISOString() };
    const stale = { ...structuredClone(original), name: 'Stale revision', updatedAt: new Date(Date.parse(original.updatedAt) + 2_000).toISOString() };
    await repository.upsert(user.id, accepted, original.updatedAt);
    await expect(repository.upsert(user.id, stale, original.updatedAt)).rejects.toThrow('changed after this editor loaded');
    expect((await repository.readAll(user.id)).find((workflow) => workflow.id === original.id)?.name).toBe('Accepted revision');
  });

  it('atomically leases each queued companion job to at most one worker', async () => {
    const user = await owner();
    const runtime = await import('@/src/storage/runtime-connection-repository');
    const pairing = await runtime.createRuntimePairing(user.id);
    const claimed = await runtime.claimRuntimePairing({ code: pairing.pairingCode, allowedRoots: ['C:\\projects'] });
    if (!claimed) throw new Error('Could not claim runtime pairing.');
    await runtime.enqueueRuntimeJob(user.id, claimed.connection.id, 'workspace-inspection', { path: 'C:\\projects' });

    const attempts = await Promise.all([
      runtime.leaseNextRuntimeJob(claimed.connection.id),
      runtime.leaseNextRuntimeJob(claimed.connection.id)
    ]);
    const leases = attempts.filter((job): job is NonNullable<typeof job> => Boolean(job));
    expect(leases).toHaveLength(1);
    expect(leases[0].leaseId).toBeTruthy();
  });

  it('fences concurrent run advancement and permits takeover only after expiry', async () => {
    const user = await owner();
    const runId = `run_${crypto.randomUUID()}`;
    const { getDatabase } = await import('@/src/storage/async-database');
    await (await getDatabase()).run('INSERT INTO runs (id, user_id, assignment_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [runId, user.id, 'assignment-test', '{}', '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z']);
    const locks = await import('@/src/storage/run-execution-lock');
    const first = await locks.acquireRunExecutionLock(user.id, runId, new Date('2026-09-09T00:00:00.000Z'));
    expect(first).toBeTruthy();
    expect(await locks.acquireRunExecutionLock(user.id, runId, new Date('2026-09-09T00:01:00.000Z'))).toBeNull();
    const takeover = await locks.acquireRunExecutionLock(user.id, runId, new Date('2026-09-09T00:17:00.000Z'));
    expect(takeover).toBeTruthy();
    expect(takeover).not.toBe(first);
    expect(await locks.releaseRunExecutionLock(user.id, runId, first!)).toBe(false);
    expect(await locks.releaseRunExecutionLock(user.id, runId, takeover!)).toBe(true);
  });
});
