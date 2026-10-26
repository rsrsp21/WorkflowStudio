'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BackButton from './back-button';
import { graphEdgePath, layoutWorkflowGraph } from '@/src/domain/graph-layout';
import type { NodeRunStatus, RunEvent, WorkflowRun } from '@/src/domain/runtime';
import type { RuntimeToolApproval } from '@/src/domain/runtime-connection';
import { failedStepForRetry } from '@/src/domain/failed-step-retry';
import { rejectedValidationForRecheck } from '@/src/domain/rejected-validation';
import { isTerminalRunStatus, runElapsedEndTime } from '@/src/domain/run-timing';
import RunExecutionControl from './run-execution-control';
import RunExecutionSettingsControl from './run-execution-settings-control';
import { executionHarness, executionModelSettings } from '@/src/domain/execution-settings-view';
import RuntimeApprovalControl from './runtime-approval-control';
import RuntimeToolApprovalControl from './runtime-tool-approval-control';
import StudioPageShell from './studio-page-shell';

type DisplayStatus = 'active' | 'pending' | 'completed' | 'failed' | 'blocked' | 'approval-waiting';

function displayStatus(status: NodeRunStatus): DisplayStatus {
  if (status === 'running') return 'active';
  if (status === 'waiting-approval') return 'approval-waiting';
  if (status === 'skipped') return 'blocked';
  return status;
}
function title(value: string) {
  return value.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function elapsed(from: string | undefined, to: number) {
  if (!from) return 'Not started';
  const seconds = Math.max(0, Math.floor((to - Date.parse(from)) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours) return `${hours}h ${minutes % 60}m`;
  if (minutes) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function LifecycleTimeline({ run }: { run: WorkflowRun }) {
  const planning = run.lifecycleContext.planning;
  const runtimeEvents = run.events.filter((event) => ['run.settings-updated', 'node.started', 'node.waiting-approval', 'approval.approved', 'approval.rejected', 'approval.revision-requested', 'approval.resumed', 'node.recovered', 'run.completed', 'run.failed'].includes(event.type));
  const items: Array<{ id: string; label: string; detail: string; timestamp: string; state: 'complete' | 'context' | 'current' | 'failed' }> = [
    { id: 'planning', label: 'Workflow planned', detail: `${planning.answeredQuestionCount} planning answer${planning.answeredQuestionCount === 1 ? '' : 's'} recorded`, timestamp: planning.createdAt, state: 'complete' },
    ...(planning.unresolvedQuestions.length ? [{ id: 'questions', label: 'Unresolved context retained', detail: `${planning.unresolvedQuestions.length} open question${planning.unresolvedQuestions.length === 1 ? '' : 's'} carried as context—not a graph failure`, timestamp: planning.createdAt, state: 'context' as const }] : []),
    ...(run.lifecycleContext.definitionApproval ? [{ id: 'definition', label: 'Reusable graph approved', detail: `${run.lifecycleContext.definitionApproval.approvedBy.name} · workflow v${run.lifecycleContext.definitionApproval.workflowVersion}`, timestamp: run.lifecycleContext.definitionApproval.approvedAt, state: 'complete' as const }] : []),
    ...(run.lifecycleContext.assignmentApproval ? [{ id: 'assignment', label: 'Project assignment approved', detail: `${run.lifecycleContext.assignmentApproval.approvedBy.name} · configuration v${run.lifecycleContext.assignmentApproval.configurationVersion}`, timestamp: run.lifecycleContext.assignmentApproval.approvedAt, state: 'complete' as const }] : []),
    { id: 'compiled', label: 'Execution manifest compiled', detail: `Workflow v${run.workflowVersion} locked to ${run.projectId}`, timestamp: run.createdAt, state: 'complete' }
  ];
  for (const event of runtimeEvents) items.push({ id: event.id, label: title(event.type.split('.').join(' ')), detail: event.message, timestamp: event.timestamp, state: event.type === 'run.failed' || event.type === 'approval.rejected' ? 'failed' : event.type === 'node.started' || event.type === 'node.waiting-approval' ? 'current' : 'complete' });
  return <section className="run-panel lifecycle-panel"><div className="run-panel-heading"><div><h2>Lifecycle timeline</h2><p>Planning, approvals, compilation, execution, and recovery remain separate audit events.</p></div><span>{items.length} milestones</span></div><ol className="lifecycle-timeline">{items.map((item) => <li key={item.id} className={item.state}><span className="timeline-marker" /><div><strong>{item.label}</strong><p>{item.detail}</p><time>{new Date(item.timestamp).toISOString()}</time></div></li>)}</ol></section>;
}

function NodeInspector({ run, nodeId }: { run: WorkflowRun; nodeId: string }) {
  const node = run.compiledWorkflow.nodes.find((candidate) => candidate.id === nodeId);
  const state = run.nodeRuns.find((candidate) => candidate.nodeId === nodeId);
  if (!node || !state) return null;
  const suppliedInputs = { ...run.compiledWorkflow.assignmentInputs, ...(run.runtimeInputs ?? {}) };
  const assignedInputs = Object.fromEntries(node.inputKeys.filter((key) => Object.hasOwn(suppliedInputs, key)).map((key) => [key, suppliedInputs[key]]));
  const awaitingInputs = node.inputKeys.filter((key) => !Object.hasOwn(suppliedInputs, key));
  const history = run.events.filter((event) => event.nodeId === nodeId);
  const artifacts = run.artifacts.filter((artifact) => artifact.nodeId === nodeId);
  const settings = ['completed', 'running', 'failed'].includes(state.status) && state.executionSettings ? state.executionSettings.modelSettings : executionModelSettings(run, node);
  const approvals = run.approvalRecords.filter((approval) => approval.nodeId === nodeId);
  return <section className="run-panel node-inspector"><div className="run-panel-heading"><div><h2>{node.name}</h2><p>{title(node.type)} node · {title(displayStatus(state.status))}</p></div><span>Attempt {state.attempt}</span></div>
    <p>{node.type === 'approval' ? 'Human approval gate; no model call.' : `Execution model: ${settings.model} · reasoning ${settings.reasoningEffort} · output verbosity ${settings.verbosity ?? 'model default'} · settings revision ${state.executionSettings?.revision ?? run.executionConfiguration?.revision ?? 0}`}</p>
    <div className="inspection-grid"><article><h3>Instructions</h3><p>{node.focusedPrompt || 'No focused instructions.'}</p></article><article><h3>{state.input ? 'Resolved inputs' : 'Assignment inputs before execution'}</h3><pre>{JSON.stringify(state.input ?? assignedInputs, null, 2)}</pre>{!state.input && awaitingInputs.length > 0 && <p>Awaiting earlier node outputs: {awaitingInputs.join(', ')}</p>}</article><article><h3>Structured output</h3><pre>{JSON.stringify(state.output ?? {}, null, 2)}</pre></article><article><h3>Decision and errors</h3><p>{state.selectedCondition ? `Selected route: ${state.selectedCondition}` : 'No route decision recorded.'}</p>{state.error && <p className="node-run-error">{state.error}</p>}</article></div>
    <div className="inspection-history"><h3>Node history</h3>{history.length ? <ol>{history.map((event) => <li key={event.id}><span>{event.message}</span><time>{new Date(event.timestamp).toISOString()}</time></li>)}</ol> : <p>No runtime events yet.</p>}</div>
    <div className="inspection-footer">{state.deliveryStage && <span>Delivery: {state.deliveryStage}</span>}<span>{artifacts.length} artifact{artifacts.length === 1 ? '' : 's'}</span><span>{approvals.length} approval request{approvals.length === 1 ? '' : 's'}</span><span>{state.runtimeJobId ? `Companion job ${state.runtimeJobId}` : 'No companion job yet'}</span><span>{state.providerThreadId ? `Codex thread ${state.providerThreadId}` : 'No Codex thread yet'}</span></div>
  </section>;
}

function LiveRunGraph({ run, selectedNodeId, onSelect }: { run: WorkflowRun; selectedNodeId: string; onSelect: (nodeId: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => layoutWorkflowGraph({
    nodes: run.compiledWorkflow.nodes.map((node) => ({ ...node, prompt: node.focusedPrompt, skillIds: node.skillVersions.map((skill) => skill.skillId), retryLimit: node.retryLimit, requiresApproval: node.requiresApproval })),
    edges: run.compiledWorkflow.edges
  }), [run.compiledWorkflow]);
  useEffect(() => {
    const position = layout.positions[selectedNodeId];
    if (position && scrollRef.current) scrollRef.current.scrollTo({ left: Math.max(0, position.x - 80), top: Math.max(0, position.y - 80), behavior: 'smooth' });
  }, [layout, selectedNodeId]);
  return <section className="run-panel run-graph-panel"><div className="run-panel-heading"><div><h2>Live workflow graph</h2><p>Select a step to inspect its inputs, output, and history. The current step is highlighted as the run progresses.</p></div><span>{run.compiledWorkflow.nodes.length} steps</span></div><div className="run-graph-scroll" ref={scrollRef}><div className="run-graph-canvas" style={{ width: layout.width, height: layout.height }}><svg className="run-graph-edges" width={layout.width} height={layout.height} aria-hidden="true"><defs><marker id="run-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>{run.compiledWorkflow.edges.map((edge, index) => { const start = layout.positions[edge.from]; const end = layout.positions[edge.to]; const state = run.edgeRuns[index]?.status ?? 'pending'; return start && end ? <path key={`${edge.from}-${edge.to}-${index}`} className={`run-graph-edge ${state}`} d={graphEdgePath(start, end, index, layout.height)} markerEnd="url(#run-graph-arrow)" /> : null; })}</svg>{run.compiledWorkflow.nodes.map((node) => { const state = run.nodeRuns.find((item) => item.nodeId === node.id); const status = run.pendingInput?.nodeId === node.id ? 'input-required' : state?.status ?? 'pending'; const position = layout.positions[node.id]; return <button key={node.id} type="button" className={`run-graph-node ${status}${selectedNodeId === node.id ? ' selected' : ''}`} style={{ left: position?.x ?? 0, top: position?.y ?? 0 }} onClick={() => onSelect(node.id)} aria-pressed={selectedNodeId === node.id}><span>{status.replaceAll('-', ' ')}</span><strong>{node.name}</strong><small>{node.type}</small></button>; })}</div></div></section>;
}

function RuntimeInputControl({ run, onRunUpdated }: { run: WorkflowRun; onRunUpdated: (run: WorkflowRun) => void }) {
  const pending = run.pendingInput;
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!pending) return null;
  const node = run.compiledWorkflow.nodes.find((candidate) => candidate.id === pending.nodeId);
  async function submit() {
    if (!pending) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}/inputs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId: pending.nodeId, values }) });
      const result = await response.json() as { run?: WorkflowRun; errors?: string[]; error?: string };
      if (!response.ok || !result.run) throw new Error(result.errors?.join(' ') || result.error || 'Input could not be submitted.');
      onRunUpdated(result.run);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Input could not be submitted.'); }
    finally { setBusy(false); }
  }
  return <section className="runtime-input-card" aria-label="User input required"><h2>Input needed: {node?.name ?? pending.nodeId}</h2><p>This step will start after you provide the requested information.</p>{pending.keys.map((key) => <label key={key} htmlFor={`run-input-${key}`}>{key.replaceAll('_', ' ')}<textarea id={`run-input-${key}`} rows={key === 'rough_product_idea' || key === 'project_context' ? 5 : 3} maxLength={10_000} value={values[key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} placeholder={key === 'rough_product_idea' ? 'Describe the product idea, users, and desired outcome' : key === 'project_context' ? 'Provide relevant background, constraints, and source material' : `Enter ${key.replaceAll('_', ' ')}`} /></label>)}{error && <p className="run-execution-error" role="alert">{error}</p>}<button className="dash-button primary" type="button" disabled={busy || pending.keys.some((key) => !values[key]?.trim())} onClick={() => void submit()}>{busy ? 'Submitting…' : 'Continue workflow'}</button></section>;
}

function ActivityFeed({ events }: { events: RunEvent[] }) {
  const activity = [...events].reverse().slice(0, 8);
  return <section className="run-panel activity-panel"><div className="run-panel-heading"><div><h2>Codex activity</h2><p>Latest persisted runtime transitions and provider-facing work.</p></div><span>{events.length} events</span></div>{activity.length ? <ol>{activity.map((event) => <li key={event.id}><span className={`activity-dot ${event.type.includes('failed') ? 'failed' : event.type.includes('waiting') ? 'waiting' : ''}`} /><div><strong>{event.message}</strong><small>{title(event.type)} · {new Date(event.timestamp).toISOString()}</small></div></li>)}</ol> : <p className="run-empty-state">No activity recorded yet.</p>}</section>;
}

function HarnessLayers({ run }: { run: WorkflowRun }) {
  const harness = run.compiledWorkflow.harnessV2;
  const layers = [
    { name: 'Identity and behavior', detail: `${harness.identityAndBehavior.skills.length} exact skill versions · ${harness.identityAndBehavior.contextManifest.length} approved context inputs` },
    { name: 'Runtime', detail: `${title(harness.runtime.sandboxMode)} sandbox · ${harness.runtime.maxRetries} retries · ${harness.runtime.maxLoopIterations} loop limit` },
    { name: 'Observability', detail: `${run.events.length} correlated events · ${harness.observability.capturedMetrics.length} measurable signals` },
    { name: 'Verification', detail: `${run.verificationResults.filter((result) => result.status === 'passed').length} passed · ${run.verificationResults.filter((result) => result.status === 'failed').length} failed checks` },
    { name: 'Adaptation', detail: harness.adaptation.enabled ? `${run.compiledWorkflow.approvedAdaptations?.length ?? 0} approved improvements applied · ${run.adaptationCandidates.length} candidates in this run` : 'Off by default · no silent self-modification' },
    { name: 'Governance and security', detail: `Policy v${harness.governanceAndSecurity.policyVersion} · least privilege · ${harness.governanceAndSecurity.auditJournal} audit` }
  ];
  return <section className="run-panel harness-layers"><div className="run-panel-heading"><div><h2>Six-layer harness</h2><p>The immutable execution contract compiled with this run.</p></div><span>Contract v{harness.schemaVersion}</span></div><ol>{layers.map((layer, index) => <li key={layer.name}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{layer.name}</strong><p>{layer.detail}</p></div></li>)}</ol></section>;
}

function AdaptationPanel({ run, onRunUpdated }: { run: WorkflowRun; onRunUpdated: (run: WorkflowRun) => void }) {
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  if (!run.compiledWorkflow.harnessV2.adaptation.enabled) return null;
  async function decide(candidateId: string, decision: 'approved' | 'rejected') {
    setBusyId(candidateId); setError('');
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}/adaptation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId, decision, note: decision === 'approved' ? 'Approved for a future version review; no active workflow was changed.' : 'Not suitable for promotion.' }) });
      const result = await response.json() as { run?: WorkflowRun; errors?: string[] };
      if (!response.ok || !result.run) throw new Error(result.errors?.join(' ') || 'Improvement candidate could not be decided.');
      onRunUpdated(result.run);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Improvement candidate could not be decided.'); }
    finally { setBusyId(''); }
  }
  return <section className="run-panel adaptation-panel"><div className="run-panel-heading"><div><h2>Improvement candidates</h2><p>Opt-in lessons from this run. Approved project or user improvements are added to future compiled runs; active runs remain immutable.</p></div><span>{run.adaptationCandidates.length} candidates</span></div>{run.adaptationCandidates.length ? <ol>{run.adaptationCandidates.map((candidate) => <li key={candidate.id}><div><strong>{run.compiledWorkflow.nodes.find((node) => node.id === candidate.nodeId)?.name ?? candidate.nodeId}</strong><p>{candidate.summary}</p><small>{title(candidate.scope)} scope · {title(candidate.status)}</small></div>{candidate.status === 'proposed' && <span><button className="dash-button secondary" type="button" disabled={busyId === candidate.id} onClick={() => void decide(candidate.id, 'rejected')}>Reject</button><button className="dash-button primary" type="button" disabled={busyId === candidate.id} onClick={() => void decide(candidate.id, 'approved')}>Approve candidate</button></span>}</li>)}</ol> : <p className="run-empty-state">No failure or revision feedback has produced a candidate.</p>}{error && <p className="run-execution-error" role="alert">{error}</p>}</section>;
}

export default function RunSummaryPage({ run: initialRun }: { run: WorkflowRun }) {
  const [run, setRun] = useState(initialRun);
  const [selectedNodeId, setSelectedNodeId] = useState(initialRun.pendingInput?.nodeId ?? initialRun.nodeRuns.find((node) => node.status === 'running' || node.status === 'waiting-approval')?.nodeId ?? initialRun.nodeRuns[0]?.nodeId ?? '');
  const [clock, setClock] = useState(() => Date.parse(initialRun.updatedAt));
  const [connectionState, setConnectionState] = useState<'live' | 'reconnecting'>('live');
  const [toolApprovals, setToolApprovals] = useState<RuntimeToolApproval[]>([]);
  const [autoRunKey, setAutoRunKey] = useState(0);
  const [settingsEditing, setSettingsEditing] = useState(false);
  const updateRun = useCallback((nextRun: WorkflowRun) => {
    setRun(nextRun);
    const activeNode = nextRun.nodeRuns.find((node) => node.status === 'running' || node.status === 'waiting-approval');
    if (nextRun.pendingInput) setSelectedNodeId(nextRun.pendingInput.nodeId);
    else if (activeNode) setSelectedNodeId(activeNode.nodeId);
  }, []);

  useEffect(() => {
    const events = new EventSource(`/api/runs/${encodeURIComponent(run.id)}/events`);
    events.addEventListener('update', (event) => {
      const result = JSON.parse((event as MessageEvent).data) as { run?: WorkflowRun; approvals?: RuntimeToolApproval[] };
      if (result.run) updateRun(result.run);
      setToolApprovals(result.approvals ?? []);
      setConnectionState('live');
    });
    events.onerror = () => setConnectionState('reconnecting');
    return () => events.close();
  }, [run.id, updateRun]);

  useEffect(() => {
    if (isTerminalRunStatus(run.status)) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run.status]);

  const compiled = run.compiledWorkflow;
  const currentHarness = executionHarness(run);
  const active = run.nodeRuns.some((node) => node.status === 'running' || node.status === 'waiting-approval');
  const interrupted = run.nodeRuns.some((node) => node.status === 'running');
  const pending = run.nodeRuns.filter((node) => node.status === 'pending').length;
  const rejectedValidation = rejectedValidationForRecheck(run);
  const latestError = [...run.nodeRuns].reverse().find((node) => node.error)?.error ?? rejectedValidation?.summary;
  const activeApproval = [...run.approvalRecords].reverse().find((approval) => !approval.resumedAt && run.nodeRuns.find((node) => node.nodeId === approval.nodeId)?.status === 'waiting-approval');
  const pendingToolApprovals = toolApprovals.filter((approval) => approval.status === 'pending');
  const counts = useMemo(() => run.nodeRuns.reduce<Record<DisplayStatus, number>>((summary, node) => { summary[displayStatus(node.status)] += 1; return summary; }, { active: 0, pending: 0, completed: 0, failed: 0, blocked: 0, 'approval-waiting': 0 }), [run.nodeRuns]);
  const retries = run.events.filter((event) => event.type === 'node.retry-scheduled').length;
  const findings = run.nodeRuns.filter((node) => node.summary || node.error || node.output).length;

  return <StudioPageShell>
    <section className="route-heading run-heading"><div><BackButton href={`/workflows/${encodeURIComponent(run.workflowId)}/graph?assignmentId=${encodeURIComponent(run.assignmentId)}`}>Approved graph</BackButton><h1>{run.status === 'compiled' ? 'Compiled run' : 'Live workflow run'}</h1><p>Inspect every transition, decision, artifact, and approval while the frozen workflow executes.</p></div><div className="run-heading-state"><span className={`live-connection ${connectionState}`}>{connectionState === 'live' ? 'Live' : 'Reconnecting'}</span><span className={`run-status ${run.status}`}>{title(run.status)}</span></div></section>
    <LifecycleTimeline run={run} />
    <HarnessLayers run={run} />
    <section className="run-live-metrics" aria-label="Run status summary">
      {(['active', 'approval-waiting', 'pending', 'completed', 'failed', 'blocked'] as DisplayStatus[]).map((status) => <article key={status} className={status}><span>{title(status)}</span><strong>{counts[status]}</strong></article>)}
      <article><span>Elapsed</span><strong>{elapsed(run.createdAt, runElapsedEndTime(run, clock))}</strong></article><article><span>Retries</span><strong>{retries}</strong></article>
    </section>
    {run.pendingInput && <RuntimeInputControl key={`${run.pendingInput.nodeId}:${run.pendingInput.keys.join(',')}`} run={run} onRunUpdated={(updated) => { updateRun(updated); setAutoRunKey((current) => current + 1); }} />}
    <section className="run-summary">
      <div className="run-overview">
        <LiveRunGraph run={run} selectedNodeId={selectedNodeId} onSelect={setSelectedNodeId} />
        <section className="run-panel"><div className="run-panel-heading"><div><h2>Compiled node tasks</h2><p>Live execution graph—select a node to inspect its resolved contracts and complete history.</p></div><span>{pending} pending</span></div><ol className="compiled-node-list">{compiled.nodes.map((node, index) => { const nodeRun = run.nodeRuns.find((candidate) => candidate.nodeId === node.id); const status = displayStatus(nodeRun?.status ?? 'pending'); return <li key={node.id} className={`node-run-${nodeRun?.status ?? 'pending'} ${selectedNodeId === node.id ? 'selected' : ''}`}><button type="button" onClick={() => setSelectedNodeId(node.id)} aria-pressed={selectedNodeId === node.id}><span>{String(index + 1).padStart(2, '0')}</span><div><header><strong>{node.name}</strong><small className={`node-status ${status}`}>{title(status)}</small></header><p>{node.focusedPrompt || 'No focused instructions.'}</p><dl><div><dt>Inputs</dt><dd>{node.inputKeys.join(', ') || 'None'}</dd></div><div><dt>Outputs</dt><dd>{node.outputKeys.join(', ') || 'None'}</dd></div><div><dt>Model</dt><dd>{node.type === 'approval' ? 'Human decision' : `${((['completed', 'running', 'failed'].includes(nodeRun?.status ?? '') ? nodeRun?.executionSettings?.modelSettings : undefined) ?? executionModelSettings(run, node)).model} · ${((['completed', 'running', 'failed'].includes(nodeRun?.status ?? '') ? nodeRun?.executionSettings?.modelSettings : undefined) ?? executionModelSettings(run, node)).reasoningEffort}`}</dd></div><div><dt>Attempt / loop</dt><dd>{nodeRun?.attempt ?? 0} / {nodeRun?.iteration ?? 0}</dd></div><div><dt>Artifacts</dt><dd>{nodeRun?.artifactIds.length ?? 0}</dd></div></dl></div></button></li>; })}</ol></section>
        <NodeInspector run={run} nodeId={selectedNodeId} />
        <section className="run-panel"><div className="run-panel-heading"><div><h2>Route decisions and loops</h2><p>Branch selections and bounded loop traversal are persisted with the run.</p></div><span>{run.edgeRuns.filter((edge) => edge.status === 'selected').length} selected</span></div><ol className="route-decision-list">{run.edgeRuns.map((edge) => <li key={edge.edgeIndex} className={`edge-run-${edge.status}`}><span>{compiled.nodes.find((node) => node.id === edge.from)?.name ?? edge.from}</span><b>→</b><span>{compiled.nodes.find((node) => node.id === edge.to)?.name ?? edge.to}</span><small>{edge.condition || 'Always'} · {edge.status}{edge.traversalCount ? ` · ${edge.traversalCount}×` : ''}</small></li>)}</ol>{Object.keys(run.loopIterations).length > 0 && <div className="loop-summary">{Object.entries(run.loopIterations).map(([id, count]) => <span key={id}>{compiled.nodes.find((node) => node.id === id)?.name ?? id}: {count}/{currentHarness.maxLoopIterations}</span>)}</div>}</section>
        <section className="run-panel"><div className="run-panel-heading"><div><h2>Artifacts and findings</h2><p>Open generated documents and images for review before choosing a gate outcome. Use the gate’s revision option to send feedback back to the producing stage.</p></div><span>{run.artifacts.length} artifacts · {findings} findings</span></div>{run.artifacts.length ? <ol className="run-artifact-list">{run.artifacts.slice(-250).map((artifact) => <li key={artifact.id}><div><strong>{artifact.description}</strong><code>{artifact.path}</code><a className="dash-button secondary" href={`/api/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(artifact.id)}`} target="_blank" rel="noreferrer">Review output</a></div><small>{compiled.nodes.find((node) => node.id === artifact.nodeId)?.name ?? artifact.nodeId} · {artifact.sandboxMode} · {artifact.writeAllowed ? 'write allowed' : 'read-only'}</small></li>)}</ol> : <p className="run-empty-state">No artifacts recorded yet. Node summaries and structured outputs remain available in the inspector.</p>}</section>
        <section className="run-panel"><div className="run-panel-heading"><div><h2>Verification results</h2><p>Schema, artifact, gate, and completion checks remain independent from an agent success message.</p></div><span>{run.verificationResults.length} results</span></div>{run.verificationResults.length ? <ol className="verification-result-list">{[...run.verificationResults].reverse().map((result) => <li key={result.id} className={result.status}><span>{result.status === 'passed' ? '✓' : '!'}</span><div><strong>{compiled.nodes.find((node) => node.id === result.nodeId)?.name ?? result.nodeId}</strong><p>{result.message}</p><small>{result.checks.join(' · ')} · {new Date(result.verifiedAt).toISOString()}</small></div></li>)}</ol> : <p className="run-empty-state">Verification starts when the first stage returns a result.</p>}</section>
        {toolApprovals.length > 0 && <section className="run-panel"><div className="run-panel-heading"><div><h2>Governed local actions</h2><p>Commands, file changes, and temporary permissions remain tied to the task that requested them.</p></div><span>{toolApprovals.length} actions</span></div><ol className="runtime-tool-history">{toolApprovals.map((approval) => <li key={approval.id}><span className={`tool-action-status ${approval.status}`} /> <div><strong>{approval.title}</strong><p>{approval.command || approval.reason || approval.cwd || 'Local runtime action'}</p><small>{title(approval.kind)} · {title(approval.status)} · {new Date(approval.requestedAt).toISOString()}</small></div></li>)}</ol></section>}
        <AdaptationPanel run={run} onRunUpdated={updateRun} />
        <ActivityFeed events={run.events} />
        <section className="run-panel"><div className="run-panel-heading"><div><h2>Execution history</h2><p>The append-only journal supports audit and recovery. The latest 500 events are rendered for performance; exports retain the complete journal.</p></div><span>{run.events.length} events</span></div><ol className="run-event-list">{run.events.slice(-500).reverse().map((event) => <li key={event.id}><span>{String(event.sequence).padStart(2, '0')}</span><div><strong>{event.message}</strong><small>{title(event.type)}{event.nodeId ? ` · ${compiled.nodes.find((node) => node.id === event.nodeId)?.name ?? event.nodeId}` : ''} · {new Date(event.timestamp).toISOString()}</small></div></li>)}</ol></section>
      </div>
      <aside className="run-sidebar">
        {run.status === 'compiled' && <RunExecutionSettingsControl key={run.executionConfiguration?.revision ?? 0} run={run} onRunUpdated={updateRun} onEditingChange={setSettingsEditing} />}
        {pendingToolApprovals.map((approval) => <RuntimeToolApprovalControl key={approval.id} runId={run.id} approval={approval} onDecided={(updated) => setToolApprovals((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate))} />)}
        {activeApproval && <RuntimeApprovalControl key={`${activeApproval.id}:${activeApproval.decision ?? 'pending'}`} run={run} approval={activeApproval} onRunUpdated={(updated) => { updateRun(updated); if (updated.status === 'running') setAutoRunKey((current) => current + 1); }} />}
        <RunExecutionControl serverOwned={Boolean(run.executionRequested)} retryable={Boolean(failedStepForRetry(run))} recheckable={Boolean(rejectedValidation)} runId={run.id} status={run.status} active={active || settingsEditing} interrupted={interrupted} pending={pending} runtimeWaiting={Boolean(run.runtimeWaiting)} inputRequired={Boolean(run.pendingInput)} latestError={latestError} autoStartKey={autoRunKey} onRunUpdated={updateRun} />
        <section><h2>Execution identity</h2><dl><div><dt>Run</dt><dd>{run.id}</dd></div><div><dt>Assignment</dt><dd>{run.assignmentId}</dd></div><div><dt>Project</dt><dd>{run.projectId}</dd></div><div><dt>Workflow</dt><dd>{run.workflowId} · v{run.workflowVersion}</dd></div><div><dt>Project root</dt><dd>{run.rootPath}</dd></div></dl></section>
        <section><h2>Current execution harness</h2><dl><div><dt>Sandbox</dt><dd>{currentHarness.sandboxMode}</dd></div><div><dt>Allowed paths</dt><dd>{currentHarness.allowedWorkspacePaths.length}</dd></div><div><dt>Allowed tools</dt><dd>{currentHarness.allowedTools.length}</dd></div><div><dt>Loop usage</dt><dd>{Object.values(run.loopIterations).reduce((total, count) => total + count, 0)} / {currentHarness.maxLoopIterations}</dd></div><div><dt>Destructive approval</dt><dd>{currentHarness.requireApprovalForDestructiveActions ? 'Required' : 'Not required'}</dd></div></dl></section>
      </aside>
    </section>
  </StudioPageShell>;
}
