const { loadEnvConfig } = require('@next/env');
const { Client } = require('pg');
const { postgresConfig } = require('./postgres-config.cjs');

loadEnvConfig(process.cwd());
const sourceDatabase = process.env.PGSOURCE_DATABASE;
const restoredDatabase = process.env.PGRESTORE_DATABASE;
if (!sourceDatabase || !restoredDatabase || sourceDatabase === restoredDatabase) {
  console.error('Set distinct PGSOURCE_DATABASE and PGRESTORE_DATABASE values.');
  process.exitCode = 2;
} else {
  const tables = [
    'schema_migrations', 'corrupt_records', 'audit_events', 'users', 'sessions', 'reviewer_assignments', 'organizations', 'organization_memberships', 'organization_invitations', 'organization_workflows', 'workflows', 'project_owners',
    'runs', 'run_execution_locks', 'runtime_connections', 'runtime_jobs', 'runtime_job_events', 'runtime_tool_approvals', 'approved_adaptations',
    'rate_limit_buckets', 'tenant_workspace_records', 'workspace_records'
  ];

  async function fingerprints(database) {
    const client = new Client({ ...postgresConfig(), database });
    await client.connect();
    try {
      const values = {};
      for (const table of tables) {
        const result = await client.query(`SELECT COUNT(*)::integer AS count, COALESCE(md5(string_agg(row_data, '|' ORDER BY row_data)), md5('')) AS checksum FROM (SELECT row_to_json(record)::text AS row_data FROM workflow_studio.${table} record) rows`);
        values[table] = result.rows[0];
      }
      return values;
    } finally { await client.end(); }
  }

  Promise.all([fingerprints(sourceDatabase), fingerprints(restoredDatabase)]).then(([source, restored]) => {
    const mismatches = tables.filter((table) => source[table].count !== restored[table].count || source[table].checksum !== restored[table].checksum);
    const report = { ready: mismatches.length === 0, sourceDatabase, restoredDatabase, comparedTables: tables.length, mismatches, tables: Object.fromEntries(tables.map((table) => [table, { rows: source[table].count, checksum: source[table].checksum }])) };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (mismatches.length) process.exitCode = 1;
  }).catch((error) => {
    const password = process.env.PGPASSWORD;
    const message = password ? String(error.message).split(password).join('[redacted]') : String(error.message);
    console.error(`PostgreSQL comparison failed (${error.code || 'configuration'}).`, message);
    process.exitCode = 1;
  });
}
