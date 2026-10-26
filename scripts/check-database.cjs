const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());
const { postgresConfig } = require('./postgres-config.cjs');
async function main() {
  const { Client } = require('pg');
  const client = new Client(postgresConfig());
  try { await client.connect(); console.log((await client.query('SELECT VERSION()')).rows[0].version); }
  finally { await client.end(); }
}
main().catch((error) => { console.error(`Database check failed (${error.code || 'configuration'}).`, error.message.replace(process.env.PGPASSWORD || /$^/, '[redacted]')); process.exitCode = 1; });
