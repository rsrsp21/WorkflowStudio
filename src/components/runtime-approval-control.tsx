'use client';

import { useRef, useState } from 'react';
import type { RuntimeApprovalDecision, RuntimeApprovalRecord, WorkflowRun } from '@/src/domain/runtime';
import RunExecutionSettingsControl from './run-execution-settings-control';
import { revisionBudgetBlocker } from '@/src/domain/approval-revision-budget';

export default function RuntimeApprovalControl({ run, approval, onRunUpdated }: { run: WorkflowRun; approval: RuntimeApprovalRecord; onRunUpdated: (run: WorkflowRun) => void }) {
  const [feedback, setFeedback] = useState(approval.feedback ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settingsEditing, setSettingsEditing] = useState(false);
  const actionKeys = useRef<Record<string, string>>({});
  const node = run.compiledWorkflow.nodes.find((candidate) => candidate.id === approval.nodeId);
  const options = node?.approvalOptions ?? [];
  const revisionBlocker = options.filter((option) => option.action === 'revise').map((option) => revisionBudgetBlocker(run, approval.nodeId, option.keyword)).find(Boolean)
    ?? (!options.length ? revisionBudgetBlocker(run, approval.nodeId) : undefined);

  async function submit(action: RuntimeApprovalDecision | 'resume' | 'choose', keyword = '') {
    setBusy(true);
    setError('');
    try {
      const actionId = `${run.id}:${approval.id}:${action}:${keyword}`;
      const idempotencyKey = actionKeys.current[actionId] || crypto.randomUUID();
      actionKeys.current[actionId] = idempotencyKey;
      const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}/approval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeId: approval.nodeId, approvalId: approval.id, action, keyword, feedback, idempotencyKey })
      });
      const result = await response.json() as { run?: WorkflowRun; error?: string; errors?: string[] };
      if (!response.ok || !result.run) throw new Error(result.errors?.join(' ') || result.error || 'The approval action could not be completed.');
      delete actionKeys.current[actionId];
      onRunUpdated(result.run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The approval action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  const decided = Boolean(approval.decision);
  return <section className="runtime-approval-card" aria-labelledby="runtime-approval-title">
    <div><span className="approval-pulse" /><strong id="runtime-approval-title">Human decision required</strong></div>
    <p>Review the selected node&apos;s inputs, artifacts, and history, then choose the exact route the workflow should take.</p>
    {!decided && <RunExecutionSettingsControl key={run.executionConfiguration?.revision ?? 0} run={run} onRunUpdated={onRunUpdated} onEditingChange={setSettingsEditing} />}
    {settingsEditing && <p>Save or discard execution settings before choosing a gate outcome.</p>}
    {!decided && revisionBlocker && <p role="status">{revisionBlocker}</p>}
    {decided ? <div className={`approval-decision ${approval.decision}`}><strong>{approval.keyword || (approval.decision === 'approved' ? 'Approved' : approval.decision === 'rejected' ? 'Rejected' : 'Revision requested')}</strong><span>{approval.decidedBy?.name} · {approval.decidedBy?.role}</span>{approval.feedback && <p>{approval.feedback}</p>}</div> : <>
      <label htmlFor={`approval-feedback-${approval.id}`}>Decision feedback</label>
      <textarea id={`approval-feedback-${approval.id}`} rows={4} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Add context for the decision. Feedback is required for revision or stop outcomes." />
      {options.length ? <div className="approval-actions configured-outcomes">{options.map((option) => <button className={`dash-button ${option.action === 'continue' ? 'primary' : option.action === 'stop' ? 'danger' : 'secondary'}`} type="button" key={option.id} disabled={busy || settingsEditing || (option.action === 'revise' && Boolean(revisionBudgetBlocker(run, approval.nodeId, option.keyword)))} onClick={() => void submit('choose', option.keyword)}><span>{option.label}</span><small>{option.keyword}</small></button>)}</div> : <div className="approval-actions">
        <button className="dash-button secondary" type="button" disabled={busy || settingsEditing || Boolean(revisionBlocker)} onClick={() => void submit('revision-requested')}>Request revision</button>
        <button className="dash-button danger" type="button" disabled={busy || settingsEditing} onClick={() => void submit('rejected')}>Reject</button>
        <button className="dash-button primary" type="button" disabled={busy || settingsEditing} onClick={() => void submit('approved')}>Approve</button>
      </div>}
    </>}
    {decided && !approval.resumedAt && <button className="dash-button primary approval-resume" type="button" disabled={busy || settingsEditing} onClick={() => void submit('resume')}>Resume workflow</button>}
    {error && <p className="run-execution-error" role="alert">{error}</p>}
  </section>;
}
