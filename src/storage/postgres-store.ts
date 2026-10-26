import { getDatabase } from './async-database';

export class PostgresStore<T extends { id: string }> {
  constructor(private readonly kind: string, private readonly userId?: string) {}
  async readAll(): Promise<T[]> {
    const db = await getDatabase();
    const rows = this.userId
      ? await db.all<{ payload: string }>('SELECT payload FROM tenant_workspace_records WHERE user_id = ? AND kind = ? ORDER BY id', [this.userId, this.kind])
      : await db.all<{ payload: string }>('SELECT payload FROM workspace_records WHERE kind = ? ORDER BY id', [this.kind]);
    return rows.map((row) => JSON.parse(row.payload) as T);
  }
  async upsert(record: T): Promise<T> {
    const db = await getDatabase();
    if (this.userId) await db.run('INSERT INTO tenant_workspace_records (user_id, kind, id, payload) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, kind, id) DO UPDATE SET payload = excluded.payload', [this.userId, this.kind, record.id, JSON.stringify(record)]);
    else await db.run('INSERT INTO workspace_records (kind, id, payload) VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET payload = excluded.payload', [this.kind, record.id, JSON.stringify(record)]);
    return record;
  }
  async remove(id: string): Promise<T | null> {
    const db = await getDatabase();
    const row = this.userId
      ? await db.get<{ payload: string }>('DELETE FROM tenant_workspace_records WHERE user_id = ? AND kind = ? AND id = ? RETURNING payload', [this.userId, this.kind, id])
      : await db.get<{ payload: string }>('DELETE FROM workspace_records WHERE kind = ? AND id = ? RETURNING payload', [this.kind, id]);
    return row ? JSON.parse(row.payload) as T : null;
  }
  async writeAll(records: T[]): Promise<void> {
    await (await getDatabase()).transaction(async (db) => {
      if (this.userId) await db.run('DELETE FROM tenant_workspace_records WHERE user_id = ? AND kind = ?', [this.userId, this.kind]);
      else await db.run('DELETE FROM workspace_records WHERE kind = ?', [this.kind]);
      for (const record of records) {
        if (this.userId) await db.run('INSERT INTO tenant_workspace_records (user_id, kind, id, payload) VALUES (?, ?, ?, ?)', [this.userId, this.kind, record.id, JSON.stringify(record)]);
        else await db.run('INSERT INTO workspace_records (kind, id, payload) VALUES (?, ?, ?)', [this.kind, record.id, JSON.stringify(record)]);
      }
    });
  }
}
