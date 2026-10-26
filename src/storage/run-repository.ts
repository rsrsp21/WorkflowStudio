import { hydrateWorkflowRun, type WorkflowRun } from '@/src/domain/runtime';
import { prepareRunTransition, RunStateConflictError } from '@/src/domain/run-transition-service';
import { getDatabase, type AsyncDatabaseSession } from './async-database';
import { assertRunExecutionLease, type RunExecutionLease } from './run-execution-lock';

type RunRow = { id: string; payload: string };

export async function persistRunTransition(db: AsyncDatabaseSession, userId: string, proposed: WorkflowRun): Promise<WorkflowRun> {
  const row = await db.get<{ user_id: string; payload: string }>('SELECT user_id, payload FROM runs WHERE id = ? FOR UPDATE', [proposed.id]);
  if (row && row.user_id !== userId) throw new Error('Run owner does not match the authenticated user.');
  const existing = row ? hydrateWorkflowRun(JSON.parse(row.payload) as WorkflowRun) : undefined;
  const next = prepareRunTransition(userId, proposed, existing);
  if (row) {
    const write = await db.run('UPDATE runs SET assignment_id = ?, payload = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ? AND payload = ?',
      [next.assignmentId, JSON.stringify(next), next.status, next.updatedAt, next.id, userId, row.payload]);
    if (!write.changes) throw new RunStateConflictError();
  } else {
    await db.run('INSERT INTO runs (id, user_id, assignment_id, payload, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [next.id, userId, next.assignmentId, JSON.stringify(next), next.status, next.createdAt, next.updatedAt]);
  }
  await db.run(`INSERT INTO run_reconciliation (run_id, user_id, state_revision, execution_requested, available_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET state_revision = excluded.state_revision,
    execution_requested = excluded.execution_requested, available_at = excluded.available_at`,
  [next.id, userId, next.stateRevision!, Boolean(next.executionRequested), new Date().toISOString()]);
  await db.run("SELECT pg_notify('workflow_studio_user_events', ?)", [`run:${userId}:${next.id}`]);
  return next;
}

export class RunRepository {
  constructor(private readonly executionLease?: RunExecutionLease) {}

  async assertExecutionOwnership(): Promise<void> {
    if (this.executionLease) await assertRunExecutionLease(this.executionLease);
  }
  async readAll(userId: string): Promise<WorkflowRun[]> {
    return await this.hydrateRows(userId, await (await getDatabase()).all<RunRow>('SELECT id, payload FROM runs WHERE user_id = ? ORDER BY updated_at DESC', [userId]));
  }

  async readPage(userId: string, limit = 50, offset = 0): Promise<WorkflowRun[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const safeOffset = Math.max(0, Math.trunc(offset));
    return await this.hydrateRows(userId, await (await getDatabase()).all<RunRow>('SELECT id, payload FROM runs WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?', [userId, safeLimit, safeOffset]));
  }

  async count(userId: string): Promise<number> {
    return Number((await (await getDatabase()).get<{ count: number | string }>('SELECT COUNT(*) AS count FROM runs WHERE user_id = ?', [userId]))?.count ?? 0);
  }

  async read(userId: string, id: string): Promise<WorkflowRun | null> {
    const row = await (await getDatabase()).get<{ payload: string }>('SELECT payload FROM runs WHERE id = ? AND user_id = ?', [id, userId]);
    if (!row) return null;
    try { return hydrateWorkflowRun(JSON.parse(row.payload) as WorkflowRun); }
    catch { await this.quarantine(userId, id, row.payload); return null; }
  }

  async upsert(userId: string, run: WorkflowRun): Promise<WorkflowRun> {
    if (run.userId !== userId) throw new Error('Run owner does not match the authenticated user.');
    // Capture the caller's expected revision before any asynchronous work.
    const proposed = structuredClone(run);
    const saved = await (await getDatabase()).transaction(async (db) => {
      if (this.executionLease) {
        if (this.executionLease.userId !== userId || this.executionLease.runId !== proposed.id) throw new RunStateConflictError('Execution lease belongs to another run.');
        await assertRunExecutionLease(this.executionLease, db);
      }
      return persistRunTransition(db, userId, proposed);
    });
    // Existing callers continue using this object after a successful write.
    run.stateRevision = saved.stateRevision;
    await (await getDatabase()).run("SELECT pg_notify('workflow_studio_user_events', ?)", [`run:${userId}:${run.id}`]).catch(() => undefined);
    return saved;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const db = await getDatabase();
    return await db.transaction(async (tx) => {
      await tx.run('DELETE FROM runtime_tool_approvals WHERE user_id = ? AND run_id = ?', [userId, id]);
      const deleted = Boolean((await tx.run('DELETE FROM runs WHERE id = ? AND user_id = ?', [id, userId])).changes);
      if (deleted) await tx.run("SELECT pg_notify('workflow_studio_user_events', ?)", [`run:${userId}:${id}`]);
      return deleted;
    });
  }

  async pruneTerminalHistory(userId: string, olderThan: Date): Promise<string[]> {
    const removable = (await this.readAll(userId)).filter((run) => ['completed', 'failed', 'cancelled'].includes(run.status) && Date.parse(run.updatedAt) < olderThan.getTime());
    for (const run of removable) await this.delete(userId, run.id);
    return removable.map((run) => run.id);
  }

  private async hydrateRows(userId: string, rows: RunRow[]) {
    const runs: WorkflowRun[] = [];
    for (const row of rows) {
      try { runs.push(hydrateWorkflowRun(JSON.parse(row.payload) as WorkflowRun)); }
      catch { await this.quarantine(userId, row.id, row.payload); }
    }
    return runs;
  }

  private async quarantine(userId: string, id: string, payload: string) {
    await (await getDatabase()).run(`INSERT INTO corrupt_records (table_name, record_id, user_id, payload, detected_at) VALUES ('runs', ?, ?, ?, ?)
      ON CONFLICT(table_name, record_id) DO UPDATE SET payload = excluded.payload, detected_at = excluded.detected_at`, [id, userId, payload, new Date().toISOString()]);
  }
}
