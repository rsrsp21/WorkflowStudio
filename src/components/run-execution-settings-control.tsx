'use client';

import { useEffect, useState } from 'react';
import type { ModelSettings } from '@/src/domain/model-settings';
import type { WorkflowRun } from '@/src/domain/runtime';
import { executionHarness, executionModelSettings } from '@/src/domain/execution-settings-view';
import ExecutionModelSettings from './execution-model-settings';

export default function RunExecutionSettingsControl({ run, onRunUpdated, onEditingChange }: { run: WorkflowRun; onRunUpdated: (run: WorkflowRun) => void; onEditingChange?: (editing: boolean) => void }) {
  const activeHarness = executionHarness(run);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingRevision, setEditingRevision] = useState(run.executionConfiguration?.revision ?? 0);
  const [modelSettings, setModelSettings] = useState<ModelSettings>(run.executionConfiguration?.modelSettings ?? {});
  const [sandboxMode, setSandboxMode] = useState(activeHarness.sandboxMode);
  const [allowedTools, setAllowedTools] = useState(activeHarness.allowedTools.join('\n'));
  const [maxRetries, setMaxRetries] = useState(activeHarness.maxRetries);
  const [maxConcurrentNodes, setMaxConcurrentNodes] = useState(activeHarness.maxConcurrentNodes);
  const [parallelFailureMode, setParallelFailureMode] = useState(activeHarness.parallelFailureMode ?? 'fail-fast');
  const [maxLoopIterations, setMaxLoopIterations] = useState(activeHarness.maxLoopIterations);
  const [requireApproval, setRequireApproval] = useState(activeHarness.requireApprovalForDestructiveActions);
  const [confirmWorkspaceWrite, setConfirmWorkspaceWrite] = useState(false);
  const [confirmDestructiveBypass, setConfirmDestructiveBypass] = useState(false);
  const canEdit = run.status === 'compiled' || run.status === 'paused' && run.approvalRecords.some((approval) => !approval.decision && !approval.resumedAt);
  useEffect(() => () => onEditingChange?.(false), [onEditingChange]);
  function changeEditing(value: boolean) {
    if (value) {
      setModelSettings(run.executionConfiguration?.modelSettings ?? {});
      setSandboxMode(activeHarness.sandboxMode); setAllowedTools(activeHarness.allowedTools.join('\n'));
      setMaxRetries(activeHarness.maxRetries); setMaxLoopIterations(activeHarness.maxLoopIterations);
      setMaxConcurrentNodes(activeHarness.maxConcurrentNodes); setParallelFailureMode(activeHarness.parallelFailureMode ?? 'fail-fast');
      setRequireApproval(activeHarness.requireApprovalForDestructiveActions);
      setEditingRevision(run.executionConfiguration?.revision ?? 0);
      setConfirmWorkspaceWrite(false); setConfirmDestructiveBypass(false); setError('');
    }
    setEditing(value); onEditingChange?.(value);
  }
  async function save() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: editingRevision, approvalId: run.approvalRecords.findLast((approval) => !approval.decision && !approval.resumedAt)?.id, modelSettings, harness: { sandboxMode, allowedTools: allowedTools.split(/[,\n]/).map((tool) => tool.trim()).filter(Boolean), maxRetries, maxLoopIterations, maxConcurrentNodes, parallelFailureMode, requireApprovalForDestructiveActions: requireApproval }, confirmWorkspaceWrite, confirmDestructiveBypass }) });
      const result = await response.json() as { run?: WorkflowRun; errors?: string[]; error?: string };
      if (!response.ok || !result.run) throw new Error(result.errors?.join(' ') || result.error || 'Execution settings could not be saved.');
      changeEditing(false);
      onRunUpdated(result.run);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Execution settings could not be saved.'); }
    finally { setBusy(false); }
  }
  return <section className="run-execution-settings" aria-label="Execution settings"><h3>Execution settings · revision {run.executionConfiguration?.revision ?? 0}</h3>
    <p>{run.status === 'paused' ? 'Changes saved here apply after this gate, including later revision attempts. Earlier results keep their original settings.' : 'Configure this run before starting. Node-specific settings are preserved unless you override them here.'}</p>
    <dl><div><dt>Sandbox</dt><dd>{activeHarness.sandboxMode}</dd></div><div><dt>Project root</dt><dd>{run.rootPath}</dd></div><div><dt>Tools</dt><dd>{activeHarness.allowedTools.join(', ') || 'None'}</dd></div><div><dt>Retries / loop limit</dt><dd>{activeHarness.maxRetries} / {activeHarness.maxLoopIterations}</dd></div><div><dt>Destructive-action approval</dt><dd>{activeHarness.requireApprovalForDestructiveActions ? 'Required' : 'Not required'}</dd></div></dl>
    <details><summary>Models by step</summary><ul>{run.compiledWorkflow.nodes.map((node) => { const state = run.nodeRuns.find((item) => item.nodeId === node.id); const settings = state?.status === 'completed' && state.executionSettings ? state.executionSettings.modelSettings : executionModelSettings(run, node); return <li key={node.id}><strong>{node.name}</strong><span>{node.type === 'approval' ? 'Human decision; no model call' : `${settings.model} · ${settings.reasoningEffort} · verbosity ${settings.verbosity ?? 'model default'}`}</span></li>; })}</ul></details>
    {canEdit && !editing && <button className="dash-button secondary" type="button" onClick={() => changeEditing(true)}>Edit execution settings</button>}
    {editing && <div className="execution-settings-editor"><ExecutionModelSettings id={`run-settings-${run.id}`} settings={modelSettings} onChange={setModelSettings} inheritLabel="Keep each step’s approved setting" />
      <p className="field-help">Values selected here override the model settings of all future steps in this run.</p>
      <label>Sandbox<select value={sandboxMode} onChange={(event) => { setSandboxMode(event.target.value as typeof sandboxMode); setConfirmWorkspaceWrite(false); }}><option value="read-only">Read-only</option><option value="workspace">Workspace write</option><option value="isolated">Isolated</option></select></label>
      <label>Allowed tools<textarea rows={3} value={allowedTools} onChange={(event) => setAllowedTools(event.target.value)} /></label>
      <label>Retries per future step<input type="number" min="0" max="10" value={maxRetries} onChange={(event) => setMaxRetries(Number(event.target.value))} /></label>
      <label>Loop limit<input type="number" min="1" max="100" value={maxLoopIterations} onChange={(event) => setMaxLoopIterations(Number(event.target.value))} /></label>
      <label>Parallel steps<input type="number" min="1" max="10" value={maxConcurrentNodes} onChange={(event) => setMaxConcurrentNodes(Number(event.target.value))} /></label>
      <label>Parallel failure policy<select value={parallelFailureMode} onChange={(event) => setParallelFailureMode(event.target.value as 'fail-fast' | 'collect-all')}><option value="fail-fast">Stop on exhausted branch failure</option><option value="collect-all">Collect branch failures at a join</option></select></label>
      <label className="approval-check"><input type="checkbox" checked={requireApproval} onChange={(event) => { setRequireApproval(event.target.checked); setConfirmDestructiveBypass(false); }} />Require destructive-action approval</label>
      {sandboxMode === 'workspace' && activeHarness.sandboxMode !== 'workspace' && <label className="approval-check"><input type="checkbox" checked={confirmWorkspaceWrite} onChange={(event) => setConfirmWorkspaceWrite(event.target.checked)} />I confirm write access within this project root.</label>}
      {!requireApproval && activeHarness.requireApprovalForDestructiveActions && <label className="approval-check"><input type="checkbox" checked={confirmDestructiveBypass} onChange={(event) => setConfirmDestructiveBypass(event.target.checked)} />I confirm disabling destructive-action approval.</label>}
      <button className="dash-button primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving settings…' : 'Save execution settings'}</button><button className="dash-button secondary" type="button" disabled={busy} onClick={() => changeEditing(false)}>Discard changes</button>
    </div>}
    {error && <p className="run-execution-error" role="alert">{error}</p>}
  </section>;
}
