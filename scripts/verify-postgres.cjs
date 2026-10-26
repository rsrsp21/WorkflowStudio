const { loadEnvConfig } = require('@next/env');
const { Client } = require('pg');
const { postgresConfig } = require('./postgres-config.cjs');

loadEnvConfig(process.cwd());

const requiredTables = [
  'users', 'sessions', 'reviewer_assignments', 'organizations', 'organization_memberships', 'organization_invitations', 'organization_workflows', 'workflows', 'project_owners', 'runs', 'runtime_connections',
  'run_execution_locks',
  'run_reconciliation',
  'runtime_jobs', 'runtime_job_events', 'runtime_tool_approvals', 'approved_adaptations',
  'rate_limit_buckets', 'tenant_workspace_records', 'audit_events', 'schema_migrations'
];
const requiredIndexes = [
  'users_email_lower_idx', 'runtime_jobs_dispatch_idx', 'runtime_jobs_execution_idx',
  'runtime_tool_approvals_request_idx', 'tenant_workspace_records_pkey', 'reviewer_assignments_reviewer_idx',
  'organization_memberships_user_idx', 'organization_pending_invitation_idx', 'organization_workflows_shared_idx'
];
const expectedMigrations = new Map([
  [1, 'e8e6941bf89ad44577f8cf43e1e73b7af234a9fadad14c38646c8e3bf8593bc7'], [2, '3756eb16195823daa70c6e1b13d985cdb762f757f02967c00176a76ef18e3869'],
  [3, 'b0de37dc7315724c780bf4b12c4db25bdf7b5e6969bb1f1815628bb597aad758'], [4, 'c7fb22bbbc0389f2bc2454a22a19d94b12a7e1f531c1dfc773aa7c369232ba67'],
  [5, '3ea23e9f29c62d3ea24ec5b6746392b30f659c1f3e3f99a68a73a37f7ce3cdf6'], [6, '36c82fc94e21aea1143621de1a1fe4efdfcc1b1044a4fabe45507ec60604d6d6'],
  [7, '4270f296feec74e35300b7ad8eb6c262f5df45d398d6d450854f0f259a309a58'], [8, '40cad8d730beac2ea88be76ff1733fb661fa54363f665f6bcd6c3693f61655b5'],
  [9, '5a1f542ce90f1ccb1b1bda7bba683c93c152a0e9c86b4b7d01dfaf8d2856a59b'], [10, '88aeb8c05b3ecf1e7f59eef82f14ffc898f56a4efbe5f152296db5ecaa6596b3'],
  [11, 'fc87d201a2949b930a9291e53c060afbe9b7991dd9480c1825ef5257cf745f53'],
  [12, '25d35724306d28e273b61ef5aa31f02397ba9a69b6689a9ff2ec8462e242bc19'],
  [13, '2cffb6069bb73c24db1090470fc4ae133ffc5a65088472a56f436bc9d310b364'],
  [14, '6b4ac3f41502de95ef389847e4b70946b5c695cfeb3522bf419559848d9e80e9'],
  [15, 'a15f70427cdefd48f37b34c6539a9f45b585d53dc144ea65d215801b9cfe905b']
]);

async function main() {
  const client = new Client(postgresConfig());
  await client.connect();
  try {
    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'workflow_studio'`);
    const tableNames = new Set(tables.rows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((name) => !tableNames.has(name));
    const indexes = await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'workflow_studio'`);
    const indexNames = new Set(indexes.rows.map((row) => row.indexname));
    const missingIndexes = requiredIndexes.filter((name) => !indexNames.has(name));
    const migrations = await client.query(`SELECT version, checksum FROM workflow_studio.schema_migrations ORDER BY version`);
    const versions = migrations.rows.map((row) => Number(row.version));
    const missingMigrations = Array.from(expectedMigrations.keys()).filter((version) => !versions.includes(version));
    const checksumFailures = migrations.rows.filter((row) => expectedMigrations.get(Number(row.version)) !== row.checksum).map((row) => Number(row.version));
    const trigger = await client.query(`SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'workflow_studio' AND c.relname = 'audit_events' AND t.tgname = 'audit_events_no_update' AND NOT t.tgisinternal`);
    const failures = [
      ...(missingTables.length ? [`missing tables: ${missingTables.join(', ')}`] : []),
      ...(missingIndexes.length ? [`missing indexes: ${missingIndexes.join(', ')}`] : []),
      ...(missingMigrations.length ? [`missing migrations: ${missingMigrations.join(', ')}`] : []),
      ...(checksumFailures.length ? [`migration checksum mismatch: ${checksumFailures.join(', ')}`] : []),
      ...(!trigger.rowCount ? ['immutable audit trigger is missing'] : [])
    ];
    const result = { ready: failures.length === 0, provider: 'postgresql', migrationVersions: versions, tablesVerified: requiredTables.length, indexesVerified: requiredIndexes.length, immutableAudit: Boolean(trigger.rowCount), failures };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (failures.length) process.exitCode = 1;
  } finally { await client.end(); }
}

main().catch((error) => {
  const password = process.env.PGPASSWORD;
  const message = password ? String(error.message).split(password).join('[redacted]') : String(error.message);
  console.error(`PostgreSQL verification failed (${error.code || 'configuration'}).`, message);
  process.exitCode = 1;
});
