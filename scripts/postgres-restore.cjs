const { loadEnvConfig } = require('@next/env');
const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { connectionArgs, postgresExecutable, postgresProcessEnvironment } = require('./postgres-process.cjs');

loadEnvConfig(process.cwd());
const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const source = fileIndex >= 0 ? path.resolve(args[fileIndex + 1] || '') : '';
if (!source || !existsSync(source) || !args.includes('--confirm')) {
  console.error('Usage: npm run db:restore -- --file <backup.dump> --confirm');
  process.exitCode = 2;
} else {
  const result = spawnSync(postgresExecutable('pg_restore'), [...connectionArgs(), '--clean', '--if-exists', '--no-owner', '--no-acl', '--exit-on-error', source], { stdio: 'inherit', env: postgresProcessEnvironment() });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
  else process.stdout.write('PostgreSQL restore completed. Run npm run db:verify before starting traffic.\n');
}
