const path = require('node:path');

function postgresExecutable(name, env = process.env) {
  return env.PG_BIN_DIR ? path.join(env.PG_BIN_DIR, process.platform === 'win32' ? `${name}.exe` : name) : name;
}

function postgresProcessEnvironment(env = process.env) {
  const result = { ...env };
  if (env.DATABASE_URL) result.PGDATABASE = env.DATABASE_URL;
  if (env.PGSSL_MODE) result.PGSSLMODE = env.PGSSL_MODE;
  if (env.PGSSL_CA_FILE) result.PGSSLROOTCERT = path.resolve(env.PGSSL_CA_FILE);
  return result;
}

function connectionArgs(env = process.env) {
  if (env.DATABASE_URL) return [];
  const required = ['PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE'];
  for (const name of required) if (!env[name]) throw new Error(`${name} is required.`);
  return ['--host', env.PGHOST, '--port', env.PGPORT, '--username', env.PGUSER, '--dbname', env.PGDATABASE];
}

module.exports = { postgresExecutable, postgresProcessEnvironment, connectionArgs };
