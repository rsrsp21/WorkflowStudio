import { getDatabase } from './async-database';

async function count(sql: string, values: Array<string | number> = []) {
  return Number((await (await getDatabase()).get<{ count: number | string }>(sql, values))?.count ?? 0);
}

export async function operationsSnapshot(now = new Date()) {
  const started = performance.now();
  const staleHeartbeat = new Date(now.getTime() - 90_000).toISOString();
  const db = await getDatabase();
  const [accounts, activeSessions, organizations, organizationMembers, runTotal, runActive, runFailed, connected, staleOrRevoked, queued, leased, failed, quarantinedRecords, auditEvents, reviewerAssignments, expiredRunLocks, pendingToolApprovals, oldestQueued] = await Promise.all([
    count('SELECT COUNT(*) AS count FROM users'),
    count('SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?', [now.toISOString()]),
    count('SELECT COUNT(*) AS count FROM organizations'),
    count('SELECT COUNT(*) AS count FROM organization_memberships'),
    count('SELECT COUNT(*) AS count FROM runs'),
    count("SELECT COUNT(*) AS count FROM runs WHERE status IN ('running', 'paused')"),
    count("SELECT COUNT(*) AS count FROM runs WHERE status = 'failed'"),
    count("SELECT COUNT(*) AS count FROM runtime_connections WHERE status = 'online' AND last_seen_at > ?", [staleHeartbeat]),
    count("SELECT COUNT(*) AS count FROM runtime_connections WHERE status <> 'online' OR last_seen_at IS NULL OR last_seen_at <= ?", [staleHeartbeat]),
    count("SELECT COUNT(*) AS count FROM runtime_jobs WHERE status = 'queued'"),
    count("SELECT COUNT(*) AS count FROM runtime_jobs WHERE status = 'leased'"),
    count("SELECT COUNT(*) AS count FROM runtime_jobs WHERE status = 'failed'"),
    count('SELECT COUNT(*) AS count FROM corrupt_records'),
    count('SELECT COUNT(*) AS count FROM audit_events'),
    count('SELECT COUNT(*) AS count FROM reviewer_assignments'),
    count('SELECT COUNT(*) AS count FROM run_execution_locks WHERE expires_at <= ?', [now.toISOString()]),
    count("SELECT COUNT(*) AS count FROM runtime_tool_approvals WHERE status = 'pending' AND expires_at > ?", [now.toISOString()]),
    db.get<{ created_at: string }>("SELECT MIN(created_at) AS created_at FROM runtime_jobs WHERE status = 'queued'")
  ]);
  const oldestQueuedSeconds = oldestQueued?.created_at ? Math.max(0, Math.floor((now.getTime() - Date.parse(oldestQueued.created_at)) / 1000)) : 0;
  return { capturedAt: now.toISOString(), databaseProbeMs: Math.round(performance.now() - started), accounts, activeSessions, organizations, organizationMembers, reviewerAssignments, runs: { total: runTotal, active: runActive, failed: runFailed, expiredLocks: expiredRunLocks }, companions: { connected, staleOrRevoked }, jobs: { queued, leased, failed, oldestQueuedSeconds }, pendingToolApprovals, quarantinedRecords, auditEvents };
}
