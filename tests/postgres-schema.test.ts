import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
const { postgresSql } = createRequire(import.meta.url)('../scripts/postgres-sql.cjs');

it('initializes PostgreSQL twice and enforces ownership, unique emails, and immutable audits', async () => {
  const db = new PGlite();
  try {
    const schema = readFileSync('scripts/postgres-schema.sql', 'utf8');
    await db.exec(postgresSql(schema)); await db.exec(postgresSql(schema));
    const query = (sql: string, args: unknown[] = []) => db.query(postgresSql(sql), args);
    await query('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['u1', 'Test', 'test@example.com', 'hash', 'builder', 'now']);
    await expect(query('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['u2', 'Test', 'TEST@example.com', 'hash', 'builder', 'now'])).rejects.toThrow();
    expect((await query('SELECT id AS userId FROM users WHERE LOWER(email) = LOWER(?)', ['TEST@EXAMPLE.COM'])).rows).toEqual([{ userId: 'u1' }]);
    await query('INSERT INTO project_owners (project_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', ['p1', 'u1', 'now']);
    await query('INSERT INTO project_owners (project_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', ['p1', 'u1', 'now']);
    await expect(query('INSERT INTO project_owners (project_id, user_id, created_at) VALUES (?, ?, ?)', ['p2', 'missing', 'now'])).rejects.toThrow();
    await query('INSERT INTO workspace_records(kind, id, payload) VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET payload = excluded.payload', ['projects', 'p1', '{"id":"p1"}']);
    expect((await query('SELECT payload FROM workspace_records WHERE kind = ?', ['projects'])).rows).toHaveLength(1);
    await query('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['u2', 'Second', 'second@example.com', 'hash', 'builder', 'now']);
    await query('INSERT INTO tenant_workspace_records(user_id, kind, id, payload) VALUES (?, ?, ?, ?), (?, ?, ?, ?)', ['u1', 'skills', 'same', '{"owner":"u1"}', 'u2', 'skills', 'same', '{"owner":"u2"}']);
    expect((await query('SELECT payload FROM tenant_workspace_records WHERE user_id = ? AND kind = ?', ['u1', 'skills'])).rows).toEqual([{ payload: '{"owner":"u1"}' }]);
    await query("INSERT INTO audit_events(actor, action, resource_type, resource_id, decision, policy_version, correlation_id, details, created_at) VALUES ('test', 'test', 'test', 'test', 'allow', 1, 'test', '{}', 'now')");
    await expect(query('DELETE FROM audit_events')).rejects.toThrow('immutable');
    const migrations = (await query('SELECT version, checksum FROM schema_migrations')).rows as Array<{ version: number; checksum: string }>;
    expect(migrations).toHaveLength(15);
    expect(migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.checksum))).toBe(true);
  } finally { await db.close(); }
}, 60000);
