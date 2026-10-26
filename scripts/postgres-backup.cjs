const { loadEnvConfig } = require('@next/env');
const { mkdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { connectionArgs, postgresExecutable, postgresProcessEnvironment } = require('./postgres-process.cjs');

loadEnvConfig(process.cwd());
const directory = path.resolve(process.env.WORKFLOW_STUDIO_BACKUP_DIR || 'backups');
mkdirSync(directory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(directory, `workflow-studio-${stamp}.dump`);
const result = spawnSync(postgresExecutable('pg_dump'), [...connectionArgs(), '--format=custom', '--no-owner', '--no-acl', '--file', target], { stdio: 'inherit', env: postgresProcessEnvironment() });
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status || 1;
else process.stdout.write(`PostgreSQL backup created: ${target}\n`);
