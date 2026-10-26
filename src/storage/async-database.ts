import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { postgresConfig } from '@/scripts/postgres-config.cjs';

const require = createRequire(import.meta.url);
const { postgresSql } = require('../../scripts/postgres-sql.cjs') as { postgresSql: (sql: string) => string };
types.setTypeParser(20, (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds the supported range.');
  return number;
});

export type DatabaseValue = string | number | bigint | boolean | null | Uint8Array;
export interface MutationResult { changes: number }
export interface AsyncDatabaseSession {
  all<T extends Record<string, unknown>>(sql: string, values?: DatabaseValue[]): Promise<T[]>;
  get<T extends Record<string, unknown>>(sql: string, values?: DatabaseValue[]): Promise<T | undefined>;
  run(sql: string, values?: DatabaseValue[]): Promise<MutationResult>;
}
export interface AsyncDatabase extends AsyncDatabaseSession {
  transaction<T>(operation: (session: AsyncDatabaseSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type QueryClient = Pick<Pool | PoolClient, 'query'>;
function pgSession(client: QueryClient): AsyncDatabaseSession {
  return {
    async all<T extends Record<string, unknown>>(sql: string, values: DatabaseValue[] = []) {
      return (await client.query<T>(postgresSql(sql), values)).rows;
    },
    async get<T extends Record<string, unknown>>(sql: string, values: DatabaseValue[] = []): Promise<T | undefined> {
      return (await client.query<T>(postgresSql(sql), values)).rows[0] as T | undefined;
    },
    async run(sql: string, values: DatabaseValue[] = []) {
      const result = await client.query<QueryResultRow>(postgresSql(sql), values);
      return { changes: result.rowCount ?? 0 };
    }
  };
}

class PooledPostgresDatabase implements AsyncDatabase {
  private readonly pool: Pool;
  private readonly initialized: Promise<void>;
  constructor() {
    this.pool = new Pool({
      ...postgresConfig(),
      max: Number(process.env.PGPOOL_MAX || 20),
      min: Number(process.env.PGPOOL_MIN || 0),
      idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_TIMEOUT_MS || 30000),
      allowExitOnIdle: false
    });
    this.initialized = this.initialize();
  }
  private async initialize() {
    const schema = await readFile(path.join(process.cwd(), 'scripts', 'postgres-schema.sql'), 'utf8');
    await this.pool.query(schema);
  }
  private async ready() { await this.initialized; return pgSession(this.pool); }
  async all<T extends Record<string, unknown>>(sql: string, values: DatabaseValue[] = []) { return (await this.ready()).all<T>(sql, values); }
  async get<T extends Record<string, unknown>>(sql: string, values: DatabaseValue[] = []) { return (await this.ready()).get<T>(sql, values); }
  async run(sql: string, values: DatabaseValue[] = []) { return (await this.ready()).run(sql, values); }
  async transaction<T>(operation: (session: AsyncDatabaseSession) => Promise<T>) {
    await this.initialized;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(pgSession(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async close() { await this.pool.end(); }
}

class TestPostgresDatabase implements AsyncDatabase {
  private constructor(private readonly client: import('@electric-sql/pglite').PGlite) {}
  static async create() {
    const { PGlite } = await import('@electric-sql/pglite');
    const client = new PGlite();
    const schema = await readFile(path.join(process.cwd(), 'scripts', 'postgres-schema.sql'), 'utf8');
    await client.exec(schema);
    return new TestPostgresDatabase(client);
  }
  async all<T extends Record<string, unknown>>(sql: string, values: DatabaseValue[] = []) { return (await this.client.query(postgresSql(sql), values)).rows as T[]; }
  async get<T extends Record<string, unknown>>(sql: string, values: DatabaseValue[] = []): Promise<T | undefined> { return (await this.all<T>(sql, values))[0]; }
  async run(sql: string, values: DatabaseValue[] = []) { const result = await this.client.query(postgresSql(sql), values); return { changes: result.affectedRows ?? result.rows.length }; }
  async transaction<T>(operation: (session: AsyncDatabaseSession) => Promise<T>) {
    return this.client.transaction(async (client) => {
      const session: AsyncDatabaseSession = {
        all: async <R extends Record<string, unknown>>(sql: string, values: DatabaseValue[] = []) => (await client.query<R>(postgresSql(sql), values)).rows,
        get: async <R extends Record<string, unknown>>(sql: string, values: DatabaseValue[] = []): Promise<R | undefined> => (await client.query<R>(postgresSql(sql), values)).rows[0],
        run: async (sql: string, values: DatabaseValue[] = []) => {
          const result = await client.query(postgresSql(sql), values);
          return { changes: result.affectedRows ?? result.rows.length };
        }
      };
      return operation(session);
    });
  }
  async close() { await (this.client as { close?: () => Promise<void> }).close?.(); }
}

const databaseHolder = globalThis as typeof globalThis & { __workflowStudioDatabase?: Promise<AsyncDatabase> };
export function getDatabase(): Promise<AsyncDatabase> {
  const realTest = process.env.NODE_ENV === 'test' && process.env.WORKFLOW_STUDIO_TEST_REAL_POSTGRES === 'true';
  if (realTest) {
    const name = process.env.DATABASE_URL ? decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) : process.env.PGDATABASE;
    if (!name?.startsWith('workflow_studio_test_')) throw new Error('Real PostgreSQL qualification requires a disposable workflow_studio_test_ database, never the application database.');
  }
  if (!databaseHolder.__workflowStudioDatabase) databaseHolder.__workflowStudioDatabase = process.env.NODE_ENV === 'test' && !realTest ? TestPostgresDatabase.create().then((database): AsyncDatabase => database) : Promise.resolve(new PooledPostgresDatabase());
  return databaseHolder.__workflowStudioDatabase;
}

export async function databaseHealth() {
  const db = await getDatabase();
  return {
    provider: 'postgres' as const,
    integrity: await db.all('SELECT 1 AS connection_check'),
    migrations: await db.all('SELECT version, name, applied_at AS appliedAt FROM schema_migrations ORDER BY version'),
    quarantinedRecords: Number((await db.get<{ count: number | string }>('SELECT COUNT(*) AS count FROM corrupt_records'))?.count ?? 0)
  };
}

export async function resetDatabaseForTests() {
  const current = databaseHolder.__workflowStudioDatabase;
  databaseHolder.__workflowStudioDatabase = undefined;
  await (await current)?.close();
}
