'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { WorkflowRun } from '@/src/domain/runtime';
import BackButton from './back-button';
import SelectField from './select-field';
import StudioPageShell from './studio-page-shell';
import UiIcon from './ui-icon';

const statusOptions = ['all', 'compiled', 'running', 'paused', 'completed', 'failed', 'cancelled'];

export default function RunHistoryPage({ initialRuns, initialTotal, workflowNames }: { initialRuns: WorkflowRun[]; initialTotal: number; workflowNames: Record<string, string> }) {
  const [runs, setRuns] = useState(initialRuns);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [deleteId, setDeleteId] = useState('');
  const [message, setMessage] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const filtered = useMemo(() => runs.filter((run) => (status === 'all' || run.status === status) && `${workflowNames[run.workflowId] ?? ''} ${run.workflowId} ${run.projectId} ${run.assignmentId}`.toLowerCase().includes(query.trim().toLowerCase())), [query, runs, status, workflowNames]);

  async function remove(id: string) {
    const response = await fetch(`/api/runs?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    const result = await response.json() as { errors?: string[]; error?: string };
    if (!response.ok) { setMessage(result.errors?.join(' ') || result.error || 'Run history could not be deleted.'); return; }
    setRuns((current) => current.filter((run) => run.id !== id));
    setTotal((current) => Math.max(0, current - 1));
    setDeleteId('');
    setMessage('Run history deleted.');
  }

  async function loadMore() {
    setLoadingMore(true); setMessage('');
    try {
      const response = await fetch(`/api/runs?offset=${runs.length}&limit=50`, { cache: 'no-store' });
      const result = await response.json() as { runs?: WorkflowRun[]; total?: number; errors?: string[] };
      if (!response.ok || !result.runs) throw new Error(result.errors?.join(' ') || 'Older runs could not be loaded.');
      setRuns((current) => [...current, ...result.runs!.filter((run) => !current.some((existing) => existing.id === run.id))]);
      if (typeof result.total === 'number') setTotal(result.total);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Older runs could not be loaded.'); }
    finally { setLoadingMore(false); }
  }

  return <StudioPageShell>
    <section className="route-heading"><div><BackButton href="/studio">Studio</BackButton><h1>Runs and monitoring</h1><p>Open active work, inspect retained evidence, export a handoff, or remove finished run history.</p></div><span>{filtered.length} shown · {total} total</span></section>
    <section className="run-history-controls"><label><UiIcon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workflow, project, or assignment" /></label><SelectField ariaLabel="Filter runs by status" value={status} options={statusOptions.map((value) => ({ value, label: value === 'all' ? 'All run states' : value.charAt(0).toUpperCase() + value.slice(1) }))} onChange={setStatus} /></section>
    {message && <p className="history-message" role="status">{message}</p>}
    {filtered.length ? <section className="run-history-grid">{filtered.map((run) => {
      const completed = run.nodeRuns.filter((node) => node.status === 'completed').length;
      const active = run.nodeRuns.find((node) => node.status === 'running' || node.status === 'waiting-approval');
      const workflowName = workflowNames[run.workflowId] ?? run.workflowId;
      return <article key={run.id}><header><span className={`run-status ${run.status}`}>{run.status}</span><button className="dash-icon-button destructive-icon-button" type="button" aria-label={`Delete ${workflowName} run`} disabled={run.status === 'running' || run.status === 'paused'} onClick={() => setDeleteId(run.id)}><UiIcon name="trash" /></button></header><h2>{workflowName}</h2><p>{active ? `${run.compiledWorkflow.nodes.find((node) => node.id === active.nodeId)?.name ?? active.nodeId} is ${active.status}.` : `${completed} of ${run.nodeRuns.length} stages completed.`}</p><dl><div><dt>Project</dt><dd>{run.projectId}</dd></div><div><dt>Updated</dt><dd>{new Date(run.updatedAt).toLocaleString()}</dd></div><div><dt>Artifacts</dt><dd>{run.artifacts.length}</dd></div><div><dt>Events</dt><dd>{run.events.length}</dd></div></dl>{deleteId === run.id ? <div className="delete-panel"><p>Delete this finished run and its retained local-action history?</p><div><button className="text-button" type="button" onClick={() => setDeleteId('')}>Cancel</button><button className="dash-button danger" type="button" onClick={() => void remove(run.id)}>Delete history</button></div></div> : <footer><a className="dash-button secondary" href={`/api/runs/${encodeURIComponent(run.id)}/export?format=markdown`}><UiIcon name="file" />Export</a><Link className="dash-button primary" href={`/runs/${encodeURIComponent(run.id)}`}>{run.status === 'compiled' || run.status === 'running' || run.status === 'paused' ? 'Open run' : 'View history'}<UiIcon name="arrow-right" /></Link></footer>}</article>;
    })}</section> : <section className="library-empty"><h2>No matching runs</h2><p>Run an approved workflow or adjust the filters.</p></section>}
    {runs.length < total && <div className="run-history-more"><button className="dash-button secondary" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading…' : `Load older runs (${total - runs.length})`}</button></div>}
  </StudioPageShell>;
}
