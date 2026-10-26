import { metricsRequestAuthorized } from '@/src/server/metrics-auth';
import { operationsSnapshot } from '@/src/storage/operations-metrics';

export const dynamic = 'force-dynamic';

function metric(name: string, value: number, labels = '') { return `workflow_studio_${name}${labels} ${Number.isFinite(value) ? value : 0}`; }

export async function GET(request: Request) {
  if (!metricsRequestAuthorized(request)) return new Response('Unauthorized\n', { status: 401, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' } });
  try {
    const snapshot = await operationsSnapshot();
    const lines = [
      '# TYPE workflow_studio_accounts gauge', metric('accounts', snapshot.accounts),
      '# TYPE workflow_studio_active_sessions gauge', metric('active_sessions', snapshot.activeSessions),
      '# TYPE workflow_studio_organizations gauge', metric('organizations', snapshot.organizations),
      '# TYPE workflow_studio_organization_memberships gauge', metric('organization_memberships', snapshot.organizationMembers),
      '# TYPE workflow_studio_reviewer_assignments gauge', metric('reviewer_assignments', snapshot.reviewerAssignments),
      '# TYPE workflow_studio_runs gauge', metric('runs', snapshot.runs.total, '{state="total"}'), metric('runs', snapshot.runs.active, '{state="active"}'), metric('runs', snapshot.runs.failed, '{state="failed"}'),
      '# TYPE workflow_studio_expired_run_locks gauge', metric('expired_run_locks', snapshot.runs.expiredLocks),
      '# TYPE workflow_studio_companions gauge', metric('companions', snapshot.companions.connected, '{state="connected"}'), metric('companions', snapshot.companions.staleOrRevoked, '{state="stale_or_revoked"}'),
      '# TYPE workflow_studio_runtime_jobs gauge', metric('runtime_jobs', snapshot.jobs.queued, '{state="queued"}'), metric('runtime_jobs', snapshot.jobs.leased, '{state="leased"}'), metric('runtime_jobs', snapshot.jobs.failed, '{state="failed"}'),
      '# TYPE workflow_studio_oldest_queued_job_seconds gauge', metric('oldest_queued_job_seconds', snapshot.jobs.oldestQueuedSeconds),
      '# TYPE workflow_studio_pending_tool_approvals gauge', metric('pending_tool_approvals', snapshot.pendingToolApprovals),
      '# TYPE workflow_studio_quarantined_records gauge', metric('quarantined_records', snapshot.quarantinedRecords),
      '# TYPE workflow_studio_audit_events counter', metric('audit_events', snapshot.auditEvents),
      '# TYPE workflow_studio_database_probe_milliseconds gauge', metric('database_probe_milliseconds', snapshot.databaseProbeMs), ''
    ];
    return new Response(lines.join('\n'), { headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'x-content-type-options': 'nosniff' } });
  } catch {
    return new Response('Metrics unavailable\n', { status: 503, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' } });
  }
}
