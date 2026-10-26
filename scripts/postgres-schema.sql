BEGIN;
SELECT pg_advisory_xact_lock(1849537401);
CREATE SCHEMA IF NOT EXISTS workflow_studio;
SET search_path TO workflow_studio, public;



    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT,
      applied_at TEXT NOT NULL
    );
    ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT;
    CREATE TABLE IF NOT EXISTS corrupt_records (
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      user_id TEXT,
      payload TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      PRIMARY KEY(table_name, record_id)
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT,
      policy_version INTEGER NOT NULL,
      correlation_id TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_events_user_idx ON audit_events(user_id, created_at DESC);


    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      position TEXT NOT NULL DEFAULT 'Developer',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS reviewer_assignments (
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(owner_user_id, reviewer_user_id),
      CHECK(owner_user_id <> reviewer_user_id)
    );
    CREATE INDEX IF NOT EXISTS reviewer_assignments_reviewer_idx ON reviewer_assignments(reviewer_user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS organization_memberships (
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('owner', 'administrator', 'reviewer', 'member')),
      added_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      joined_at TEXT NOT NULL,
      PRIMARY KEY(organization_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS organization_memberships_user_idx ON organization_memberships(user_id, joined_at DESC);
    CREATE TABLE IF NOT EXISTS organization_invitations (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('administrator', 'reviewer', 'member')),
      invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'revoked', 'expired')),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS organization_pending_invitation_idx ON organization_invitations(organization_id, LOWER(email)) WHERE status = 'pending';
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workflows_user_id_idx ON workflows(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS organization_workflows (
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      shared_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      shared_at TEXT NOT NULL,
      PRIMARY KEY(organization_id, workflow_id)
    );
    CREATE INDEX IF NOT EXISTS organization_workflows_shared_idx ON organization_workflows(organization_id, shared_at DESC);
    CREATE TABLE IF NOT EXISTS project_owners (
      project_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS project_owners_user_idx ON project_owners(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assignment_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runs_user_id_idx ON runs(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS runs_assignment_id_idx ON runs(assignment_id);
    CREATE TABLE IF NOT EXISTS run_execution_locks (
      run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lock_token TEXT NOT NULL UNIQUE,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS run_execution_locks_expiry_idx ON run_execution_locks(expires_at);
    CREATE TABLE IF NOT EXISTS runtime_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      pairing_code_hash TEXT UNIQUE,
      pairing_expires_at TEXT,
      token_hash TEXT UNIQUE,
      status TEXT NOT NULL,
      auth_mode TEXT,
      codex_account_label TEXT,
      platform TEXT,
      hostname TEXT,
      allowed_roots TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      claimed_at TEXT,
      last_seen_at TEXT,
      protocol_version INTEGER,
      companion_version TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS runtime_connections_user_idx ON runtime_connections(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS runtime_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      connection_id TEXT NOT NULL REFERENCES runtime_connections(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      run_id TEXT,
      task_id TEXT,
      node_id TEXT,
      execution_key TEXT,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      lease_id TEXT,
      leased_at TEXT,
      result TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS runtime_jobs_dispatch_idx ON runtime_jobs(connection_id, status, created_at ASC);
    CREATE INDEX IF NOT EXISTS runtime_jobs_user_idx ON runtime_jobs(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS runtime_job_events (
      id BIGSERIAL PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES runtime_jobs(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(job_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS runtime_job_events_job_idx ON runtime_job_events(job_id, sequence ASC);
    CREATE TABLE IF NOT EXISTS runtime_tool_approvals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      connection_id TEXT NOT NULL REFERENCES runtime_connections(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL REFERENCES runtime_jobs(id) ON DELETE CASCADE,
      run_id TEXT,
      task_id TEXT,
      node_id TEXT,
      server_request_id TEXT NOT NULL,
      request_method TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      reason TEXT,
      command_preview TEXT,
      cwd TEXT,
      details TEXT NOT NULL,
      status TEXT NOT NULL,
      decision TEXT,
      requested_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT,
      response_json TEXT
    );
    CREATE INDEX IF NOT EXISTS runtime_tool_approvals_job_idx ON runtime_tool_approvals(job_id, requested_at ASC);
    CREATE INDEX IF NOT EXISTS runtime_tool_approvals_run_idx ON runtime_tool_approvals(user_id, run_id, status, requested_at DESC);
    CREATE TABLE IF NOT EXISTS approved_adaptations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK(scope IN ('project', 'user')),
      project_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      approved_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS approved_adaptations_lookup_idx ON approved_adaptations(user_id, workflow_id, project_id, node_id, approved_at DESC);
    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      bucket_key TEXT PRIMARY KEY,
      window_start BIGINT NOT NULL,
      request_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tenant_workspace_records (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY(user_id, kind, id)
    );

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users(LOWER(email));
ALTER TABLE runtime_connections ADD COLUMN IF NOT EXISTS protocol_version INTEGER;
ALTER TABLE runtime_connections ADD COLUMN IF NOT EXISTS companion_version TEXT;
ALTER TABLE runtime_connections ADD COLUMN IF NOT EXISTS supported_models TEXT NOT NULL DEFAULT '[]';
ALTER TABLE runtime_connections ADD COLUMN IF NOT EXISTS supported_reasoning_efforts TEXT NOT NULL DEFAULT '[]';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS default_model TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS default_reasoning_effort TEXT;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS status TEXT;
CREATE OR REPLACE FUNCTION safe_jsonb(value TEXT) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RETURN value::jsonb; EXCEPTION WHEN others THEN RETURN NULL; END; $$;
UPDATE workflows SET status = safe_jsonb(payload)->>'status' WHERE status IS NULL;
UPDATE runs SET status = safe_jsonb(payload)->>'status' WHERE status IS NULL;
CREATE INDEX IF NOT EXISTS workflows_review_idx ON workflows(status, updated_at ASC);
CREATE INDEX IF NOT EXISTS runs_status_idx ON runs(status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS runtime_tool_approvals_request_idx ON runtime_tool_approvals(job_id, server_request_id);
CREATE INDEX IF NOT EXISTS runtime_jobs_run_idx ON runtime_jobs(user_id, run_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS runtime_jobs_execution_idx ON runtime_jobs(user_id, execution_key) WHERE execution_key IS NOT NULL;
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit events are immutable'; END; $$;
DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES
(1, 'initial-owned-workspaces-and-runs', 'e8e6941bf89ad44577f8cf43e1e73b7af234a9fadad14c38646c8e3bf8593bc7', CURRENT_TIMESTAMP::text),
(2, 'paired-runtime-jobs-and-approvals', '3756eb16195823daa70c6e1b13d985cdb762f757f02967c00176a76ef18e3869', CURRENT_TIMESTAMP::text),
(3, 'runtime-cancellation-and-elicitation', 'b0de37dc7315724c780bf4b12c4db25bdf7b5e6969bb1f1815628bb597aad758', CURRENT_TIMESTAMP::text),
(4, 'corruption-quarantine-and-logical-backup', 'c7fb22bbbc0389f2bc2454a22a19d94b12a7e1f531c1dfc773aa7c369232ba67', CURRENT_TIMESTAMP::text),
(5, 'immutable-governance-audit', '3ea23e9f29c62d3ea24ec5b6746392b30f659c1f3e3f99a68a73a37f7ce3cdf6', CURRENT_TIMESTAMP::text),
(6, 'runtime-job-lease-fencing-and-idempotency', '36c82fc94e21aea1143621de1a1fe4efdfcc1b1044a4fabe45507ec60604d6d6', CURRENT_TIMESTAMP::text),
(7, 'human-approved-adaptation-library', '4270f296feec74e35300b7ad8eb6c262f5df45d398d6d450854f0f259a309a58', CURRENT_TIMESTAMP::text),
(8, 'shared-request-rate-limits', '40cad8d730beac2ea88be76ff1733fb661fa54363f665f6bcd6c3693f61655b5', CURRENT_TIMESTAMP::text),
(9, 'tenant-scoped-workspace-records', '5a1f542ce90f1ccb1b1bda7bba683c93c152a0e9c86b4b7d01dfaf8d2856a59b', CURRENT_TIMESTAMP::text),
(10, 'distributed-run-execution-locks', '88aeb8c05b3ecf1e7f59eef82f14ffc898f56a4efbe5f152296db5ecaa6596b3', CURRENT_TIMESTAMP::text),
(11, 'indexed-workflow-and-run-status', 'fc87d201a2949b930a9291e53c060afbe9b7991dd9480c1825ef5257cf745f53', CURRENT_TIMESTAMP::text),
(12, 'companion-protocol-version-negotiation', '25d35724306d28e273b61ef5aa31f02397ba9a69b6689a9ff2ec8462e242bc19', CURRENT_TIMESTAMP::text),
(13, 'delegated-reviewer-assignments', '2cffb6069bb73c24db1090470fc4ae133ffc5a65088472a56f436bc9d310b364', CURRENT_TIMESTAMP::text),
(14, 'organizations-memberships-invitations-and-shared-workflows', '6b4ac3f41502de95ef389847e4b70946b5c695cfeb3522bf419559848d9e80e9', CURRENT_TIMESTAMP::text)
ON CONFLICT(version) DO UPDATE SET checksum = COALESCE(schema_migrations.checksum, excluded.checksum);

CREATE TABLE IF NOT EXISTS workspace_records (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind, id));
CREATE TABLE IF NOT EXISTS run_reconciliation (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_revision BIGINT NOT NULL,
  acknowledged_revision BIGINT NOT NULL DEFAULT 0,
  execution_requested BOOLEAN NOT NULL DEFAULT FALSE,
  available_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS run_reconciliation_ready_idx ON run_reconciliation(execution_requested, available_at);
ALTER TABLE runtime_jobs ADD COLUMN IF NOT EXISTS result_digest TEXT;
ALTER TABLE runtime_jobs ADD COLUMN IF NOT EXISTS applied_revision BIGINT;
ALTER TABLE runtime_jobs ADD COLUMN IF NOT EXISTS first_leased_at TEXT;
INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES
(15, 'durable-run-reconciliation-and-completion-receipts', 'a15f70427cdefd48f37b34c6539a9f45b585d53dc144ea65d215801b9cfe905b', CURRENT_TIMESTAMP::text)
ON CONFLICT(version) DO NOTHING;
COMMIT;
