'use client';

import { useState } from 'react';
import type { RuntimeToolApproval, RuntimeToolApprovalDecision } from '@/src/domain/runtime-connection';
import UiIcon from './ui-icon';

const kindLabel: Record<RuntimeToolApproval['kind'], string> = {
  command: 'Command',
  'file-change': 'File change',
  permissions: 'Permission',
  'user-input': 'User input',
  other: 'Local action'
};

export default function RuntimeToolApprovalControl({ runId, approval, onDecided }: { runId: string; approval: RuntimeToolApproval; onDecided: (approval: RuntimeToolApproval) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [responseText, setResponseText] = useState('{}');

  async function decide(decision: RuntimeToolApprovalDecision) {
    setBusy(true);
    setError('');
    try {
      let elicitationResponse: Record<string, unknown> | undefined;
      if (approval.kind === 'user-input' && decision === 'accept') {
        const parsed: unknown = JSON.parse(responseText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Tool response must be a JSON object.');
        elicitationResponse = parsed as Record<string, unknown>;
      }
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/tool-approvals`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approvalId: approval.id, decision, ...(elicitationResponse ? { response: elicitationResponse } : {}) })
      });
      const result = await response.json() as { approval?: RuntimeToolApproval; errors?: string[]; error?: string };
      if (!response.ok || !result.approval) throw new Error(result.errors?.join(' ') || result.error || 'The local action could not be decided.');
      onDecided(result.approval);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The local action could not be decided.'); }
    finally { setBusy(false); }
  }

  return <section className="runtime-tool-approval" aria-labelledby={`tool-approval-${approval.id}`}>
    <header><span><UiIcon name={approval.kind === 'file-change' ? 'file' : approval.kind === 'command' ? 'code' : 'lock'} /></span><div><small>{kindLabel[approval.kind]} approval</small><strong id={`tool-approval-${approval.id}`}>{approval.title}</strong></div></header>
    {approval.reason && <p>{approval.reason}</p>}
    {approval.command && <div className="tool-approval-preview"><small>Command</small><code>{approval.command}</code></div>}
    {approval.cwd && <div className="tool-approval-preview"><small>Project location</small><code>{approval.cwd}</code></div>}
    {approval.kind === 'user-input' && <label className="tool-response-field">Tool response (JSON object)<textarea rows={4} value={responseText} onChange={(event) => setResponseText(event.target.value)} aria-describedby={`tool-response-help-${approval.id}`} /><small id={`tool-response-help-${approval.id}`}>Enter only the fields requested by the connected tool. Secrets are redacted before persistence.</small></label>}
    <p className="tool-approval-scope"><UiIcon name="lock" />This decision applies only to this pending action in the current workflow task.</p>
    <div className="tool-approval-actions"><button className="dash-button secondary" type="button" disabled={busy} onClick={() => void decide('cancel')}>Cancel task</button><button className="dash-button danger" type="button" disabled={busy} onClick={() => void decide('decline')}>Decline</button><button className="dash-button primary" type="button" disabled={busy} onClick={() => void decide('accept')}>Allow once</button></div>
    {error && <p className="run-execution-error" role="alert">{error}</p>}
  </section>;
}
