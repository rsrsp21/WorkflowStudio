/* eslint-disable @typescript-eslint/no-require-imports -- Node qualification entry point. */
const { loadEnvConfig } = require('@next/env');
const { Client } = require('pg');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { postgresConfig } = require('./postgres-config.cjs');
loadEnvConfig(process.cwd());

async function main() {
  const name = `workflow_studio_test_${randomUUID().replaceAll('-', '')}`;
  if (!/^workflow_studio_test_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe qualification database name.');
  const admin = new Client(postgresConfig());
  await admin.connect();
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    const env = { ...process.env, PGDATABASE: name, WORKFLOW_STUDIO_TEST_REAL_POSTGRES: 'true', WORKFLOW_STUDIO_TEST_MASTRA_POSTGRES: 'true', WORKFLOW_STUDIO_COORDINATOR: 'off' };
    if (env.DATABASE_URL) { const url = new URL(env.DATABASE_URL); url.pathname = `/${name}`; env.DATABASE_URL = url.href; }
    console.log('Qualifying receipt atomicity, reconnects, and Mastra dispatch in an isolated PostgreSQL database.');
    const child = spawn(process.execPath, [path.join(process.cwd(), 'node_modules/vitest/vitest.mjs'), 'run',
      'tests/phase9-durable-completion.test.ts', 'tests/phase7-mastra-companion.test.ts', 'tests/phase4-recovery-and-events.test.ts', '--maxWorkers=1'],
    { env, stdio: 'inherit', windowsHide: true, shell: false });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    if (code !== 0) process.exitCode = 1;
  } finally {
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
    if (created) console.log('Removed the disposable qualification database. Existing application runs were not modified.');
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
