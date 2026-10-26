import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
const { postgresConfig, sslConfig } = createRequire(import.meta.url)('../scripts/postgres-config.cjs');
const { postgresSql } = createRequire(import.meta.url)('../scripts/postgres-sql.cjs');
it('supports local PostgreSQL without TLS and rejects unknown TLS modes', () => {
  expect(sslConfig({ PGSSL_MODE: 'disable' })).toBe(false);
  expect(() => sslConfig({ PGSSL_MODE: 'typo' })).toThrow('PGSSL_MODE');
});
it('requires credentials and verifies TLS using the supplied CA', () => {
  expect(() => postgresConfig({})).toThrow('PGHOST');
  const config = postgresConfig({ PGHOST: 'example.com', PGUSER: 'test', PGPASSWORD: 'test', PGDATABASE: 'test', PGSSL_MODE: 'verify-ca', PGSSL_CA_FILE: './certs/aiven-ca.pem' });
  expect(config.ssl.rejectUnauthorized).toBe(true); expect(config.ssl.ca).toContain('BEGIN CERTIFICATE');
});
it('preserves values and quoted literals while adapting repository SQL', () => {
  expect(postgresSql("SELECT '?' AS marker, user_id AS userId FROM users WHERE LOWER(email) = LOWER(?)")).toBe("SELECT '?' AS \"marker\", user_id AS \"userId\" FROM users WHERE LOWER(email) = LOWER($1)");
  expect(postgresSql('INSERT INTO users (id) VALUES (?) ON CONFLICT DO NOTHING')).toBe('INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING');
});
