import { randomUUID } from 'node:crypto';
import { getDatabase } from './async-database';
import type { AsyncDatabaseSession } from './async-database';
import { RunStateConflictError } from '@/src/domain/run-transition-service';

export type RunExecutionLease = { userId: string; runId: string; token: string };

export async function assertRunExecutionLease(lease: RunExecutionLease, db?: AsyncDatabaseSession): Promise<void> {
  const session = db ?? await getDatabase();
  const row = await session.get<{ expires_at: string }>(`SELECT expires_at FROM run_execution_locks
    WHERE run_id = ? AND user_id = ? AND lock_token = ?${db ? ' FOR UPDATE' : ''}`, [lease.runId, lease.userId, lease.token]);
  if (!row || Date.parse(row.expires_at) <= Date.now()) throw new RunStateConflictError('Execution ownership expired. Durable work will be resumed by the current coordinator.');
}

export const RUN_EXECUTION_LOCK_MS = 90_000;

export async function acquireRunExecutionLock(userId: string, runId: string, now = new Date()): Promise<string | null> {
  const token = `run_lock_${randomUUID()}`;
  const expiresAt = new Date(now.getTime() + RUN_EXECUTION_LOCK_MS).toISOString();
  const row = await (await getDatabase()).get<{ lock_token: string }>(`INSERT INTO run_execution_locks (run_id, user_id, lock_token, acquired_at, expires_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET user_id = excluded.user_id, lock_token = excluded.lock_token,
    acquired_at = excluded.acquired_at, expires_at = excluded.expires_at WHERE run_execution_locks.expires_at <= ?
    RETURNING lock_token`, [runId, userId, token, now.toISOString(), expiresAt, now.toISOString()]);
  return row?.lock_token === token ? token : null;
}

export async function renewRunExecutionLock(userId: string, runId: string, token: string, now = new Date()): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + RUN_EXECUTION_LOCK_MS).toISOString();
  return Boolean((await (await getDatabase()).run('UPDATE run_execution_locks SET expires_at = ? WHERE run_id = ? AND user_id = ? AND lock_token = ? AND expires_at > ?', [expiresAt, runId, userId, token, now.toISOString()])).changes);
}

export async function releaseRunExecutionLock(userId: string, runId: string, token: string): Promise<boolean> {
  return Boolean((await (await getDatabase()).run('DELETE FROM run_execution_locks WHERE run_id = ? AND user_id = ? AND lock_token = ?', [runId, userId, token])).changes);
}
