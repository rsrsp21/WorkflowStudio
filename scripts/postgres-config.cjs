const { readFileSync } = require('node:fs');
const path = require('node:path');

function sslConfig(env = process.env) {
  const mode = (env.PGSSL_MODE || 'disable').toLowerCase();
  if (mode === 'disable') return false;
  if (mode === 'require') return { rejectUnauthorized: false };
  if (mode !== 'verify-ca') throw new Error('PGSSL_MODE must be disable, require, or verify-ca.');
  if (!env.PGSSL_CA_FILE) throw new Error('Set PGSSL_CA_FILE when PGSSL_MODE=verify-ca.');
  return { rejectUnauthorized: true, ca: readFileSync(path.resolve(env.PGSSL_CA_FILE), 'utf8') };
}

function postgresConfig(env = process.env) {
  const port = Number(env.PGPORT || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PGPORT must be a valid TCP port.');
  const ssl = sslConfig(env);
  const common = {
    ssl,
    connectionTimeoutMillis: Number(env.PGCONNECT_TIMEOUT_MS || 10000),
    query_timeout: Number(env.PGQUERY_TIMEOUT_MS || 20000),
    statement_timeout: Number(env.PGSTATEMENT_TIMEOUT_MS || 20000),
    application_name: 'workflow-studio',
    options: '-c search_path=workflow_studio,public'
  };
  if (env.DATABASE_URL) return { ...common, connectionString: env.DATABASE_URL };
  for (const name of ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) {
    if (!env[name] || env[name] === '<redacted>') throw new Error(`Set ${name} in the server environment.`);
  }
  return { ...common, host: env.PGHOST, port, user: env.PGUSER, password: env.PGPASSWORD, database: env.PGDATABASE };
}

module.exports = { postgresConfig, sslConfig };
