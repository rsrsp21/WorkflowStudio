'use client';

import { useCallback, useEffect, useState } from 'react';
import UiIcon from './ui-icon';

type Metrics = { capturedAt: string; databaseProbeMs: number; accounts: number; activeSessions: number; organizations: number; organizationMembers: number; reviewerAssignments: number; runs: { total: number; active: number; failed: number; expiredLocks: number }; companions: { connected: number; staleOrRevoked: number }; jobs: { queued: number; leased: number; failed: number; oldestQueuedSeconds: number }; pendingToolApprovals: number; quarantinedRecords: number; auditEvents: number };

async function fetchMetrics() {
  const response = await fetch('/api/admin/metrics', { cache: 'no-store' });
  const result = await response.json() as { metrics?: Metrics; error?: string };
  if (!response.ok || !result.metrics) throw new Error(result.error || 'Operations metrics are unavailable.');
  return result.metrics;
}

export default function OperationsOverview() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    setMessage('');
    try {
      setMetrics(await fetchMetrics());
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Operations metrics are unavailable.'); }
  }, []);
  useEffect(() => {
    let active = true;
    void fetchMetrics().then((result) => { if (active) setMetrics(result); }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : 'Operations metrics are unavailable.'); });
    return () => { active = false; };
  }, []);
  const cells = metrics ? [
    ['Accounts', metrics.accounts], ['Active sessions', metrics.activeSessions], ['Organizations', metrics.organizations], ['Organization members', metrics.organizationMembers], ['Active runs', metrics.runs.active], ['Failed runs', metrics.runs.failed],
    ['Connected companions', metrics.companions.connected], ['Queued jobs', metrics.jobs.queued], ['Queue age (seconds)', metrics.jobs.oldestQueuedSeconds], ['Pending approvals', metrics.pendingToolApprovals],
    ['Reviewer assignments', metrics.reviewerAssignments], ['Expired run locks', metrics.runs.expiredLocks], ['Database probe (ms)', metrics.databaseProbeMs], ['Quarantined', metrics.quarantinedRecords]
  ] : [];
  return <section className="profile-settings-section">
    <div className="profile-section-heading"><UiIcon name="system" /><div><h3>Operations</h3><p>Aggregate readiness signals without user content or credentials.</p></div></div>
    {message && <p className="profile-form-message" role="status">{message}</p>}
    {metrics && <><div className="operations-grid">{cells.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className="profile-form-actions"><small>Captured {new Date(metrics.capturedAt).toLocaleString()} · {metrics.auditEvents} audit events</small><button className="dash-button secondary" type="button" onClick={() => void load()}>Refresh</button></div></>}
  </section>;
}
