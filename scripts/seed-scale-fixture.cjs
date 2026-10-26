const { loadEnvConfig } = require('@next/env');
const { Client } = require('pg');
const { postgresConfig } = require('./postgres-config.cjs');

loadEnvConfig(process.cwd());
const size = Number(process.env.WORKFLOW_STUDIO_FIXTURE_USERS || 1000);
const database = process.env.PGDATABASE || '';
if (process.env.WORKFLOW_STUDIO_ALLOW_FIXTURE_SEED !== 'true') {
  console.error('Set WORKFLOW_STUDIO_ALLOW_FIXTURE_SEED=true to seed a disposable qualification database.');
  process.exitCode = 2;
} else if (!Number.isInteger(size) || size < 10 || size > 10_000) {
  console.error('WORKFLOW_STUDIO_FIXTURE_USERS must be between 10 and 10000.');
  process.exitCode = 2;
} else if (!/(?:test|validation|fixture)/i.test(database) && process.env.WORKFLOW_STUDIO_CONFIRM_FIXTURE_DATABASE !== database) {
  console.error('Fixture seeding is restricted to a test/validation/fixture database unless WORKFLOW_STUDIO_CONFIRM_FIXTURE_DATABASE exactly matches PGDATABASE.');
  process.exitCode = 2;
} else {
  const client = new Client(postgresConfig());
  client.connect().then(async () => {
    try {
      await client.query('BEGIN');
      await client.query(`SET search_path TO workflow_studio, public`);
      await client.query(`
        INSERT INTO users(id, name, email, password_hash, role, position, created_at)
        SELECT 'fixture-user-' || value, 'Fixture User ' || value, 'fixture-' || value || '@example.invalid', 'fixture:00',
          CASE WHEN value = 1 THEN 'administrator' WHEN value % 10 = 0 THEN 'reviewer' ELSE 'builder' END,
          'Scale fixture', CURRENT_TIMESTAMP::text
        FROM generate_series(1, $1) value ON CONFLICT(id) DO NOTHING`, [size]);
      await client.query(`
        INSERT INTO sessions(id_hash, user_id, expires_at, created_at)
        SELECT md5('fixture-session-' || value), 'fixture-user-' || value, (CURRENT_TIMESTAMP + INTERVAL '30 days')::text, CURRENT_TIMESTAMP::text
        FROM generate_series(1, $1) value ON CONFLICT(id_hash) DO NOTHING`, [size]);
      await client.query(`
        INSERT INTO workflows(id, user_id, payload, status, created_at, updated_at)
        SELECT 'fixture-workflow-' || value, 'fixture-user-' || value,
          json_build_object('id', 'fixture-workflow-' || value, 'name', 'Fixture workflow ' || value, 'status', CASE WHEN (value - 1) % 10 = 0 THEN 'approved' ELSE 'draft' END, 'createdAt', CURRENT_TIMESTAMP::text, 'updatedAt', CURRENT_TIMESTAMP::text)::text,
          CASE WHEN (value - 1) % 10 = 0 THEN 'approved' ELSE 'draft' END, CURRENT_TIMESTAMP::text, CURRENT_TIMESTAMP::text
        FROM generate_series(1, $1) value ON CONFLICT(id) DO NOTHING`, [size]);
      await client.query(`
        INSERT INTO organizations(id, name, slug, created_by, created_at)
        SELECT 'fixture-org-' || value, 'Fixture Organization ' || value, 'fixture-organization-' || value,
          'fixture-user-' || ((value - 1) * 10 + 1), CURRENT_TIMESTAMP::text
        FROM generate_series(1, CEIL($1::numeric / 10)::integer) value ON CONFLICT(id) DO NOTHING`, [size]);
      await client.query(`
        INSERT INTO organization_memberships(organization_id, user_id, role, added_by, joined_at)
        SELECT 'fixture-org-' || CEIL(value::numeric / 10)::integer, 'fixture-user-' || value,
          CASE WHEN (value - 1) % 10 = 0 THEN 'owner' WHEN value % 10 = 0 THEN 'reviewer' ELSE 'member' END,
          'fixture-user-' || (((value - 1) / 10) * 10 + 1), CURRENT_TIMESTAMP::text
        FROM generate_series(1, $1) value ON CONFLICT(organization_id, user_id) DO NOTHING`, [size]);
      await client.query(`
        INSERT INTO organization_workflows(organization_id, workflow_id, shared_by, shared_at)
        SELECT 'fixture-org-' || value, 'fixture-workflow-' || ((value - 1) * 10 + 1),
          'fixture-user-' || ((value - 1) * 10 + 1), CURRENT_TIMESTAMP::text
        FROM generate_series(1, CEIL($1::numeric / 10)::integer) value ON CONFLICT(organization_id, workflow_id) DO NOTHING`, [size]);
      await client.query(`
        INSERT INTO project_owners(project_id, user_id, created_at)
        SELECT 'fixture-project-' || value, 'fixture-user-' || value, CURRENT_TIMESTAMP::text
        FROM generate_series(1, $1) value ON CONFLICT(project_id) DO NOTHING`, [size]);
      for (const kind of ['projects', 'skills', 'project-workflows']) {
        await client.query(`
          INSERT INTO tenant_workspace_records(user_id, kind, id, payload)
          SELECT 'fixture-user-' || value, $2, 'fixture-' || $2 || '-' || value,
            json_build_object('id', 'fixture-' || $2 || '-' || value, 'ownerFixture', value)::text
          FROM generate_series(1, $1) value ON CONFLICT(user_id, kind, id) DO NOTHING`, [size, kind]);
      }
      await client.query(`
        INSERT INTO reviewer_assignments(owner_user_id, reviewer_user_id, assigned_by, created_at)
        SELECT 'fixture-user-' || value, 'fixture-user-1', 'fixture-user-1', CURRENT_TIMESTAMP::text
        FROM generate_series(2, $1) value ON CONFLICT(owner_user_id, reviewer_user_id) DO NOTHING`, [size]);
      await client.query(`
        INSERT INTO runtime_connections(id, user_id, name, status, allowed_roots, created_at)
        SELECT 'fixture-runtime-' || value, 'fixture-user-' || value, 'Fixture runtime', 'offline', '[]', CURRENT_TIMESTAMP::text
        FROM generate_series(10, $1, 10) value ON CONFLICT(id) DO NOTHING`, [size]);
      await client.query(`
        INSERT INTO runtime_jobs(id, user_id, connection_id, kind, payload, status, created_at, updated_at)
        SELECT 'fixture-job-' || value, 'fixture-user-' || value, 'fixture-runtime-' || value, 'execute', '{}', 'queued', CURRENT_TIMESTAMP::text, CURRENT_TIMESTAMP::text
        FROM generate_series(10, $1, 10) value ON CONFLICT(id) DO NOTHING`, [size]);
      await client.query(`
        INSERT INTO audit_events(user_id, actor, action, resource_type, resource_id, decision, policy_version, correlation_id, details, created_at)
        SELECT 'fixture-user-' || value, '{"id":"fixture-user-1","role":"administrator"}', 'fixture.seed', 'user', 'fixture-user-' || value, 'approved', 1, 'fixture:' || value, '{}', CURRENT_TIMESTAMP::text
        FROM generate_series(1, $1) value`, [size]);
      await client.query('COMMIT');
      const result = await client.query(`SELECT (SELECT COUNT(*) FROM users WHERE id LIKE 'fixture-user-%')::integer AS users, (SELECT COUNT(*) FROM organizations WHERE id LIKE 'fixture-org-%')::integer AS organizations, (SELECT COUNT(*) FROM organization_memberships WHERE organization_id LIKE 'fixture-org-%')::integer AS organization_memberships, (SELECT COUNT(*) FROM organization_workflows WHERE organization_id LIKE 'fixture-org-%')::integer AS organization_workflows, (SELECT COUNT(*) FROM workflows WHERE id LIKE 'fixture-workflow-%')::integer AS workflows, (SELECT COUNT(*) FROM tenant_workspace_records WHERE id LIKE 'fixture-%')::integer AS workspace_records, (SELECT COUNT(*) FROM reviewer_assignments WHERE owner_user_id LIKE 'fixture-user-%')::integer AS reviewer_assignments, (SELECT COUNT(*) FROM runtime_jobs WHERE id LIKE 'fixture-job-%')::integer AS runtime_jobs`);
      process.stdout.write(`${JSON.stringify({ ready: true, database, requestedUsers: size, ...result.rows[0] }, null, 2)}\n`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { await client.end(); }
  }).catch((error) => {
    const password = process.env.PGPASSWORD;
    const message = password ? String(error.message).split(password).join('[redacted]') : String(error.message);
    console.error(`Scale fixture failed (${error.code || 'database'}).`, message);
    process.exitCode = 1;
  });
}
