import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(async () => {
  const { resetDatabaseForTests } = await import('@/src/storage/async-database');
  await resetDatabaseForTests();
  vi.resetModules();
});

describe('PostgreSQL database contract', () => {
  it('supports typed reads and atomic commit and rollback', async () => {
    const { getDatabase } = await import('@/src/storage/async-database');
    const db = await getDatabase();
    await db.run("INSERT INTO users (id, name, email, password_hash, role, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", ['u1', 'User', 'user@example.com', 'hash', 'developer', 'Developer', new Date().toISOString()]);
    expect((await db.get<{ id: string }>('SELECT id FROM users WHERE id = ?', ['u1']))?.id).toBe('u1');
    await expect(db.transaction(async (tx) => { await tx.run("INSERT INTO users (id, name, email, password_hash, role, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", ['u2', 'User 2', 'user2@example.com', 'hash', 'developer', 'Developer', new Date().toISOString()]); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await db.get('SELECT id FROM users WHERE id = ?', ['u2'])).toBeUndefined();
  });
});
