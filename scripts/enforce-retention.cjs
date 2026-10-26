const { loadEnvConfig } = require('@next/env');
const { Client } = require('pg');
const { postgresConfig } = require('./postgres-config.cjs');

loadEnvConfig(process.cwd());
const confirmed = process.argv.includes('--confirm');
const numberSetting = (name, fallback, minimum, maximum) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  return value;
};

async function main() {
  const runDays = numberSetting('WORKFLOW_STUDIO_RUN_RETENTION_DAYS', 90, 30, 3650);
  const jobDays = numberSetting('WORKFLOW_STUDIO_JOB_RETENTION_DAYS', 30, 7, 3650);
  const connectionDays = numberSetting('WORKFLOW_STUDIO_CONNECTION_RETENTION_DAYS', 30, 7, 3650);
  const now = new Date();
  const runCutoff = new Date(now.getTime() - runDays * 86_400_000).toISOString();
  const jobCutoff = new Date(now.getTime() - jobDays * 86_400_000).toISOString();
  const connectionCutoff = new Date(now.getTime() - connectionDays * 86_400_000).toISOString();
  const rateLimitCutoff = Math.floor(now.getTime() / 1000) - 86_400;
  const client = new Client(postgresConfig());
  await client.connect();
  try {
    await client.query('SET search_path TO workflow_studio, public');
    const candidates = {};
    const candidateQueries = {
      expiredSessions: ['SELECT COUNT(*)::integer AS count FROM sessions WHERE expires_at <= $1', [now.toISOString()]],
      expiredPairings: ["SELECT COUNT(*)::integer AS count FROM runtime_connections WHERE status = 'pairing' AND pairing_expires_at <= $1", [now.toISOString()]],
      retainedConnections: ["SELECT COUNT(*)::integer AS count FROM runtime_connections WHERE status IN ('offline','revoked') AND COALESCE(revoked_at, last_seen_at, created_at) < $1", [connectionCutoff]],
      expiredApprovals: ["SELECT COUNT(*)::integer AS count FROM runtime_tool_approvals WHERE status = 'pending' AND expires_at <= $1", [now.toISOString()]],
      expiredLocks: ['SELECT COUNT(*)::integer AS count FROM run_execution_locks WHERE expires_at <= $1', [now.toISOString()]],
      terminalRuns: ["SELECT COUNT(*)::integer AS count FROM runs WHERE status IN ('completed','failed','cancelled') AND updated_at < $1", [runCutoff]],
      terminalJobs: ["SELECT COUNT(*)::integer AS count FROM runtime_jobs WHERE status IN ('completed','failed','cancelled') AND updated_at < $1", [jobCutoff]],
      oldRateLimits: ['SELECT COUNT(*)::integer AS count FROM rate_limit_buckets WHERE window_start < $1', [rateLimitCutoff]]
    };
    for (const [name, [sql, values]] of Object.entries(candidateQueries)) candidates[name] = (await client.query(sql, values)).rows[0].count;
    if (!confirmed) {
      process.stdout.write(`${JSON.stringify({ mode: 'dry-run', ready: true, policies: { runDays, jobDays, connectionDays }, candidates }, null, 2)}\n`);
      return;
    }
    await client.query('BEGIN');
    await client.query("UPDATE runtime_tool_approvals SET status = 'expired', decision = 'decline', decided_at = $1, response_json = '{\"decision\":\"decline\"}' WHERE status = 'pending' AND expires_at <= $1", [now.toISOString()]);
    await client.query('DELETE FROM run_execution_locks WHERE expires_at <= $1', [now.toISOString()]);
    await client.query('DELETE FROM sessions WHERE expires_at <= $1', [now.toISOString()]);
    await client.query("DELETE FROM runtime_connections WHERE status = 'pairing' AND pairing_expires_at <= $1", [now.toISOString()]);
    await client.query("DELETE FROM runtime_connections WHERE status IN ('offline','revoked') AND COALESCE(revoked_at, last_seen_at, created_at) < $1", [connectionCutoff]);
    await client.query(`INSERT INTO audit_events(user_id, actor, action, resource_type, resource_id, decision, policy_version, correlation_id, details, created_at)
      SELECT user_id, '{"id":"system","name":"Retention service","role":"system"}', 'history.retention', 'run', id, 'deleted', 1, 'retention:' || id || ':' || $1, json_build_object('retentionDays', $2::integer)::text, $1
      FROM runs WHERE status IN ('completed','failed','cancelled') AND updated_at < $3`, [now.toISOString(), runDays, runCutoff]);
    await client.query("DELETE FROM runs WHERE status IN ('completed','failed','cancelled') AND updated_at < $1", [runCutoff]);
    await client.query("DELETE FROM runtime_jobs WHERE status IN ('completed','failed','cancelled') AND updated_at < $1", [jobCutoff]);
    await client.query('DELETE FROM rate_limit_buckets WHERE window_start < $1', [rateLimitCutoff]);
    await client.query('COMMIT');
    process.stdout.write(`${JSON.stringify({ mode: 'enforced', ready: true, policies: { runDays, jobDays, connectionDays }, removedOrExpired: candidates }, null, 2)}\n`);
  } catch (error) {
    if (confirmed) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { await client.end(); }
}

main().catch((error) => {
  const password = process.env.PGPASSWORD;
  const message = password ? String(error.message).split(password).join('[redacted]') : String(error.message);
  console.error(`Retention enforcement failed (${error.code || 'configuration'}).`, message);
  process.exitCode = 1;
});
