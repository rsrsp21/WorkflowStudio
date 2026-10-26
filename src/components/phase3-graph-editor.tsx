'use client';

import { type DragEvent, useMemo, useRef, useState } from 'react';
import { draftWorkflowPlan, validateWorkflowGraph, type NodeType, type WorkflowEdge, type WorkflowNode, type WorkflowPlan } from '@/src/domain/models';
import { graphEdgePath, layoutWorkflowGraph } from '@/src/domain/graph-layout';
import type { ProjectWorkflow, Skill } from '@/src/domain/workspace';
import BackButton from './back-button';
import UiIcon from './ui-icon';
import WorkflowNodeSummary from './workflow-node-summary';
import { WorkflowNodeIcon, WorkflowNodeVisual, workflowNodeTypeLabel } from './workflow-node-visual';
import ExecutionModelSettings from './execution-model-settings';

const NODE_WIDTH = 210;
const NODE_HEIGHT = 116;
const NODE_TYPES: NodeType[] = ['agent', 'codex', 'tool', 'validation', 'approval', 'loop', 'fork', 'join', 'success', 'failure'];

function ParallelNodeSettings({ node, onUpdate }: { node: WorkflowNode; onUpdate: (patch: Partial<WorkflowNode>) => void }) {
  return <section><h3>Parallel execution</h3><label className="approval-check"><input type="checkbox" checked={Boolean(node.readOnly)} onChange={(event) => onUpdate({ readOnly: event.target.checked })} />Read-only step (safe to overlap other read-only steps)</label>
    {node.type === 'join' && <><label>Join policy<select value={node.joinMode ?? 'all'} onChange={(event) => onUpdate({ joinMode: event.target.value as 'all' | 'quorum' })}><option value="all">Collect all selected branches</option><option value="quorum">Successful branch quorum</option></select></label>
      {node.joinMode === 'quorum' && <label>Required successful branches<input type="number" min="1" max="100" value={node.joinQuorum ?? 1} onChange={(event) => onUpdate({ joinQuorum: Number(event.target.value) })} /></label>}</>}
    <p>Forks use unconditional connections. Joins emit one object containing branch results. Project-wide write steps execute exclusively.</p></section>;
}

function values(value: string) {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function NodeContractEditor({ node, onUpdate }: { node: WorkflowNode; onUpdate: (patch: Partial<WorkflowNode>) => void }) {
  const schemas = Object.entries(node.outputSchemas ?? {}).map(([key, type]) => `${key}=${type}`).join('\n');
  return <section><h3>Output contract</h3><label htmlFor="graph-node-schemas">Output types</label><textarea id="graph-node-schemas" rows={3} value={schemas} placeholder="report=object" onChange={(event) => onUpdate({ outputSchemas: Object.fromEntries(event.target.value.split('\n').map((line) => line.split('=')).filter(([key, type]) => key?.trim() && ['string', 'number', 'boolean', 'object', 'array', 'null'].includes(type?.trim())).map(([key, type]) => [key.trim(), type.trim()])) as WorkflowNode['outputSchemas'] })} /><p className="field-help">One declared output per line: key=string, number, boolean, object, array, or null.</p><label htmlFor="graph-node-artifacts">Required artifact labels</label><textarea id="graph-node-artifacts" rows={3} value={(node.requiredArtifacts ?? []).join('\n')} placeholder="Validated report" onChange={(event) => onUpdate({ requiredArtifacts: values(event.target.value) })} /></section>;
}

function ApprovalOutcomeEditor({ node, onUpdate }: { node: WorkflowNode; onUpdate: (patch: Partial<WorkflowNode>) => void }) {
  if (node.type !== 'approval') return null;
  const options = node.approvalOptions ?? [];
  const updateOption = (id: string, patch: Partial<(typeof options)[number]>) => onUpdate({ approvalOptions: options.map((option) => option.id === id ? { ...option, ...patch } : option) });
  const addOption = () => onUpdate({ approvalOptions: [...options, { id: `outcome_${crypto.randomUUID()}`, label: 'Continue', keyword: `continue-${options.length + 1}`, action: 'continue' }] });
  return <section className="approval-outcome-editor"><div className="inspector-section-heading"><div><h3>Gate outcomes</h3><p>Each button uses a custom keyword that must match an outgoing route condition.</p></div><button className="dash-button secondary compact" type="button" onClick={addOption}><UiIcon name="plus" />Add outcome</button></div>
    {options.length ? <div className="approval-outcome-list">{options.map((option) => <article key={option.id}><label>Button label<input value={option.label} onChange={(event) => updateOption(option.id, { label: event.target.value })} placeholder="Continue to design" /></label><label>Route keyword<input value={option.keyword} onChange={(event) => updateOption(option.id, { keyword: event.target.value })} placeholder="continue" /></label><label>Behavior<select value={option.action} onChange={(event) => updateOption(option.id, { action: event.target.value as typeof option.action })}><option value="continue">Continue</option><option value="revise">Revise and loop</option><option value="stop">Stop workflow</option></select></label><button className="dash-icon-button destructive-icon-button" type="button" aria-label={`Remove ${option.label} outcome`} onClick={() => onUpdate({ approvalOptions: options.filter((candidate) => candidate.id !== option.id) })}><UiIcon name="remove" /></button></article>)}</div> : <p className="field-help">Add outcomes such as Continue, Revise, Regenerate, Escalate, or Stop. You choose the words.</p>}
  </section>;
}

function HarnessContractEditor({ plan, onChange, availableModels }: { plan: WorkflowPlan; onChange: (plan: WorkflowPlan) => void; availableModels?: readonly string[] }) {
  const update = (patch: Partial<WorkflowPlan>) => onChange({ ...draftWorkflowPlan(plan), ...patch, status: 'draft' });
  const updateHarness = (patch: Partial<WorkflowPlan['harness']>) => update({ harness: { ...plan.harness, ...patch } });
  return <section><h3>Execution model and harness</h3><p className="field-help">These settings govern workflow execution, including steps after approval gates. Planning settings only govern creation of the graph.</p><ExecutionModelSettings id="workflow" availableModels={availableModels} settings={plan.modelSettings ?? {}} onChange={(modelSettings) => update({ modelSettings })} inheritLabel="Organization or system default" /><label htmlFor="graph-concurrency">Concurrency</label><input id="graph-concurrency" type="number" min="1" max="10" value={plan.harness.maxConcurrentNodes} onChange={(event) => updateHarness({ maxConcurrentNodes: Number(event.target.value) })} /><label>Parallel failure policy<select value={plan.harness.parallelFailureMode ?? 'fail-fast'} onChange={(event) => updateHarness({ parallelFailureMode: event.target.value as 'fail-fast' | 'collect-all' })}><option value="fail-fast">Fail fast</option><option value="collect-all">Collect errors at a join</option></select></label><label htmlFor="graph-tools">Allowed tools</label><textarea id="graph-tools" rows={3} value={plan.harness.allowedTools.join('\n')} placeholder="One tool per line" onChange={(event) => updateHarness({ allowedTools: values(event.target.value) })} /><label className="approval-check"><input type="checkbox" checked={plan.harness.requireApprovalForDestructiveActions} onChange={(event) => updateHarness({ requireApprovalForDestructiveActions: event.target.checked })} />Require destructive-action approval</label><label className="approval-check"><input type="checkbox" checked={Boolean(plan.harness.adaptationEnabled)} onChange={(event) => updateHarness({ adaptationEnabled: event.target.checked })} />Capture improvement candidates from failures and revision feedback</label>{plan.harness.adaptationEnabled && <><label htmlFor="graph-adaptation-scope">Improvement scope</label><select id="graph-adaptation-scope" value={plan.harness.adaptationScope ?? 'run'} onChange={(event) => updateHarness({ adaptationScope: event.target.value as NonNullable<WorkflowPlan['harness']['adaptationScope']> })}><option value="run">This run</option><option value="project">This project</option><option value="user">My workflows</option></select><p className="field-help">Candidates require a separate human decision and never rewrite a workflow or skill automatically.</p></>}<label htmlFor="graph-completion-criteria">Completion criteria</label><textarea id="graph-completion-criteria" rows={3} value={plan.completionCriteria.join('\n')} onChange={(event) => update({ completionCriteria: values(event.target.value) })} /><label htmlFor="graph-required-outputs">Required completion outputs</label><textarea id="graph-required-outputs" rows={2} value={(plan.completionContract?.requiredOutputKeys ?? []).join('\n')} onChange={(event) => update({ completionContract: { requiredOutputKeys: values(event.target.value), requiredArtifacts: plan.completionContract?.requiredArtifacts ?? [] } })} /><label htmlFor="graph-required-artifacts">Required completion artifacts</label><textarea id="graph-required-artifacts" rows={2} value={(plan.completionContract?.requiredArtifacts ?? []).join('\n')} onChange={(event) => update({ completionContract: { requiredOutputKeys: plan.completionContract?.requiredOutputKeys ?? [], requiredArtifacts: values(event.target.value) } })} /></section>;
}

function NodeInspector({ node, skills, assignment, onUpdate, onRemove, onOpenSkill, onCreateSkill, onAddSkill, availableModels }: {
  node: WorkflowNode;
  skills: Skill[];
  assignment?: ProjectWorkflow;
  availableModels?: readonly string[];
  onUpdate: (patch: Partial<WorkflowNode>) => void;
  onRemove: () => void;
  onOpenSkill: (id: string) => void;
  onCreateSkill: (id: string) => void;
  onAddSkill: (id: string) => Promise<void>;
}) {
  const [skillActionError, setSkillActionError] = useState('');
  const assignedIds = new Set(assignment?.selectedSkills.map((reference) => reference.skillId) ?? skills.filter((skill) => skill.status === 'published').map((skill) => skill.id));
  const availableSkills = skills.filter((skill) => assignedIds.has(skill.id));
  async function addSkill(id: string) {
    setSkillActionError('');
    try { await onAddSkill(id); }
    catch (caught) { setSkillActionError(caught instanceof Error ? caught.message : 'Skill could not be added.'); }
  }
  return <section><h3>Selected node</h3><code>{node.id}</code><label htmlFor="graph-node-name">Name</label><input id="graph-node-name" value={node.name} onChange={(event) => onUpdate({ name: event.target.value })} /><label htmlFor="graph-node-type">Type</label><select id="graph-node-type" value={node.type} onChange={(event) => { const type = event.target.value as NodeType; onUpdate({ type, ...(type === 'fork' ? { outputKeys: [], outputSchemas: {}, skillIds: [], requiresApproval: false, readOnly: true } : type === 'join' ? { inputKeys: [], outputKeys: ['branchResults'], outputSchemas: { branchResults: 'object' as const }, skillIds: [], requiresApproval: false, readOnly: true, joinMode: 'all' as const, joinQuorum: 1 } : {}), ...(type === 'approval' && !node.approvalOptions?.length ? { approvalOptions: [{ id: `outcome_${crypto.randomUUID()}`, label: 'Continue', keyword: 'continue', action: 'continue' }, { id: `outcome_${crypto.randomUUID()}`, label: 'Request revision', keyword: 'revise', action: 'revise' }] } : {}) }); }}>{NODE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>{node.type === 'approval' ? <p className="field-help">This is a human decision gate. No model is called here. Configure the following agent steps, or update execution settings when the run pauses at this gate.</p> : <ExecutionModelSettings id="graph-node" availableModels={availableModels} settings={node.modelSettings ?? {}} onChange={(modelSettings) => onUpdate({ modelSettings })} inheritLabel="Use workflow default" />}<label htmlFor="graph-node-prompt">Instructions</label><textarea id="graph-node-prompt" rows={5} value={node.prompt} onChange={(event) => onUpdate({ prompt: event.target.value })} /><label htmlFor="graph-node-inputs">Inputs</label><input id="graph-node-inputs" value={node.inputKeys.join(', ')} onChange={(event) => onUpdate({ inputKeys: values(event.target.value) })} /><label htmlFor="graph-node-outputs">Outputs</label><input id="graph-node-outputs" value={node.outputKeys.join(', ')} onChange={(event) => onUpdate({ outputKeys: values(event.target.value) })} /><div className="two-fields"><div><label htmlFor="graph-node-retry">Retries</label><input id="graph-node-retry" type="number" min="0" value={node.retryLimit} onChange={(event) => onUpdate({ retryLimit: Number(event.target.value) })} /></div><label className="approval-check"><input type="checkbox" checked={node.requiresApproval} onChange={(event) => onUpdate({ requiresApproval: event.target.checked })} />Human approval</label></div><ApprovalOutcomeEditor node={node} onUpdate={onUpdate} /><div className="node-skills"><label>Focused specialist skills</label>{skillActionError && <p className="dash-field-error">{skillActionError}</p>}{availableSkills.map((skill) => <label className="skill-check" key={skill.id}><input type="checkbox" checked={node.skillIds.includes(skill.id)} onChange={(event) => onUpdate({ skillIds: event.target.checked ? [...node.skillIds, skill.id] : node.skillIds.filter((id) => id !== skill.id) })} /><span><strong>{skill.name}</strong><small>Version {skill.version} · available</small></span></label>)}{node.skillIds.filter((id) => !availableSkills.some((skill) => skill.id === id)).map((id) => { const skill = skills.find((candidate) => candidate.id === id); const canAdd = Boolean(assignment && skill?.status === 'published'); return <div className="unavailable-skill" key={id}><strong>{skill?.name ?? 'Missing skill'}</strong><span>{!skill ? 'The skill record is missing.' : skill.status === 'draft' ? 'This generated skill needs review and publishing before it can be assigned.' : skill.status === 'archived' ? 'This skill is archived and cannot be assigned.' : 'This published version is not selected for this project assignment.'}</span><div><button type="button" onClick={() => onUpdate({ skillIds: node.skillIds.filter((skillId) => skillId !== id) })}>Remove from node</button>{skill ? <button type="button" onClick={() => onOpenSkill(id)}>{skill.status === 'draft' ? 'Review and publish' : 'Review skill'}</button> : <button type="button" onClick={() => onCreateSkill(id)}>Create skill</button>}{canAdd && <button type="button" onClick={() => void addSkill(id)}>Add to assignment</button>}</div></div>; })}</div><button className="danger-text" type="button" onClick={onRemove}>Remove node</button></section>;
}

function GraphValidationSummary({ issues, warnings, assignment, onReviewNode }: {
  issues: Array<{ error: string; node?: WorkflowNode }>;
  warnings: string[];
  assignment?: ProjectWorkflow;
  availableModels?: readonly string[];
  onReviewNode: (id: string) => void;
}) {
  const visibleWarnings = warnings.filter((warning) => !warning.includes('project') && !warning.includes('assignment'));
  const loopWarnings = visibleWarnings.filter((warning) => warning.includes('only after a loop'));
  const otherWarnings = visibleWarnings.filter((warning) => !warning.includes('only after a loop'));
  const advisoryCount = loopWarnings.length + otherWarnings.length;
  return <section className={issues.length ? 'validation-summary error' : 'validation-summary clear'}>
    <h3>{issues.length ? (assignment ? 'Assignment approval blocked' : 'Definition needs changes') : (assignment ? 'Assignment ready' : 'Definition ready')}</h3>
    <p className="validation-guidance">{issues.length ? `${issues.length} blocking ${issues.length === 1 ? 'item must' : 'items must'} be resolved before approval.` : 'The graph structure and required data flow are valid.'}</p>
    {issues.length > 0 && <div className="validation-blockers">{issues.map(({ error, node }) => <div className="validation-issue-row" key={error}><p className="validation-issue">{error}</p>{node && <button type="button" onClick={() => onReviewNode(node.id)}>Review node</button>}</div>)}</div>}
    {advisoryCount > 0 && <details className="validation-advisories"><summary>{advisoryCount} non-blocking {advisoryCount === 1 ? 'advisory' : 'advisories'}</summary><div>{loopWarnings.length > 0 && <article><strong>Revision-cycle context</strong><p>{loopWarnings.length} optional {loopWarnings.length === 1 ? 'value is' : 'values are'} available only during a revision pass. This is allowed and does not block approval.</p></article>}{otherWarnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}</div></details>}
  </section>;
}

export default function Phase3GraphEditor({ workflow, skills, assignment, onBack, onSave, onApprove, onOpenSkill, onCreateSkill, onAddSkill, availableModels }: {
  workflow: WorkflowPlan;
  skills: Skill[];
  assignment?: ProjectWorkflow;
  availableModels?: readonly string[];
  onBack: () => void;
  onSave: (workflow: WorkflowPlan) => Promise<WorkflowPlan | void>;
  onApprove: (workflow: WorkflowPlan) => Promise<void>;
  onOpenSkill: (id: string) => void;
  onCreateSkill: (name: string) => void;
  onAddSkill: (id: string) => Promise<void>;
}) {
  const [plan, setPlan] = useState(workflow);
  const [selectedId, setSelectedId] = useState(workflow.nodes[0]?.id ?? '');
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => layoutWorkflowGraph(workflow).positions);
  const [from, setFrom] = useState(workflow.nodes[0]?.id ?? '');
  const [to, setTo] = useState(workflow.nodes[1]?.id ?? workflow.nodes[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [message, setMessage] = useState('');
  const [view, setView] = useState<'canvas' | 'steps'>('canvas');
  const [zoom, setZoom] = useState(1);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const graphScrollRef = useRef<HTMLDivElement>(null);
  const selected = plan.nodes.find((node) => node.id === selectedId);
  const validation = useMemo(() => validateWorkflowGraph(plan, skills, assignment), [assignment, plan, skills]);
  const validationIssues = validation.errors.map((error) => ({ error, node: plan.nodes.find((node) => error.startsWith(`Node ${node.name} `) || error.endsWith(`: ${node.name}.`)) }));
  const canvasSize = useMemo(() => ({ width: Math.max(920, ...Object.values(positions).map((position) => position.x + NODE_WIDTH + 42)), height: Math.max(520, ...Object.values(positions).map((position) => position.y + NODE_HEIGHT + 70)) }), [positions]);
  const connectionGroups = useMemo(() => plan.nodes.flatMap((node) => {
    const edges = plan.edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => edge.from === node.id);
    return edges.length ? [{ node, edges }] : [];
  }), [plan.edges, plan.nodes]);
  const selectedOutgoingCount = plan.edges.filter((edge) => edge.from === selectedId).length;
  const canApprove = validation.errors.length === 0;

  function updateNode(patch: Partial<WorkflowNode>) {
    setPlan((current) => ({ ...draftWorkflowPlan(current), nodes: current.nodes.map((node) => node.id === selectedId ? { ...node, ...patch } : node), status: 'draft', updatedAt: new Date().toISOString() }));
  }

  function addNode() {
    const id = `node_${crypto.randomUUID().slice(0, 8)}`;
    const node: WorkflowNode = { id, name: 'New workflow step', type: 'agent', prompt: '', skillIds: [], inputKeys: [], outputKeys: [], retryLimit: plan.harness.maxRetries, requiresApproval: false };
    setPlan((current) => ({ ...draftWorkflowPlan(current), nodes: [...current.nodes, node], status: 'draft', updatedAt: new Date().toISOString() }));
    setPositions((current) => ({ ...current, [id]: { x: 36, y: 48 + plan.nodes.length * 28 } })); setSelectedId(id); setFrom(id);
  }

  function removeNode() {
    if (!selected) return;
    const remaining = plan.nodes.filter((node) => node.id !== selected.id);
    setPlan((current) => ({ ...draftWorkflowPlan(current), nodes: remaining, edges: current.edges.filter((edge) => edge.from !== selected.id && edge.to !== selected.id), status: 'draft', updatedAt: new Date().toISOString() }));
    setSelectedId(remaining[0]?.id ?? '');
  }

  function dropNode(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); const id = event.dataTransfer.getData('application/workflow-node'); if (!id) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / zoom;
    const y = (event.clientY - rect.top) / zoom;
    setPositions((current) => ({ ...current, [id]: { x: Math.max(8, Math.min(x - NODE_WIDTH / 2, canvasSize.width - NODE_WIDTH - 8)), y: Math.max(8, Math.min(y - NODE_HEIGHT / 2, canvasSize.height - NODE_HEIGHT - 8)) } }));
  }

  function addConnection() {
    if (!from || !to || from === to || plan.edges.some((edge) => edge.from === from && edge.to === to)) return;
    setPlan((current) => ({ ...draftWorkflowPlan(current), edges: [...current.edges, { from, to, condition: '' }], status: 'draft', updatedAt: new Date().toISOString() }));
  }

  function autoLayout() { setPositions(layoutWorkflowGraph(plan).positions); }

  function changeZoom(nextZoom: number) {
    const next = Math.max(.5, Math.min(1.6, Math.round(nextZoom * 10) / 10));
    const scroll = graphScrollRef.current;
    if (!scroll || next === zoom) { setZoom(next); return; }
    const centerX = (scroll.scrollLeft + scroll.clientWidth / 2) / zoom;
    const centerY = (scroll.scrollTop + scroll.clientHeight / 2) / zoom;
    setZoom(next);
    window.requestAnimationFrame(() => scroll.scrollTo({ left: Math.max(0, centerX * next - scroll.clientWidth / 2), top: Math.max(0, centerY * next - scroll.clientHeight / 2), behavior: 'smooth' }));
  }

  function fitGraph() {
    const scroll = graphScrollRef.current;
    if (!scroll) return;
    const fitted = Math.max(.5, Math.min(1, Math.min((scroll.clientWidth - 28) / canvasSize.width, (scroll.clientHeight - 28) / canvasSize.height)));
    setZoom(Math.round(fitted * 10) / 10);
    window.requestAnimationFrame(() => scroll.scrollTo({ left: 0, top: 0, behavior: 'smooth' }));
  }

  async function save() {
    setSaving(true); setMessage('');
    try { const saved = await onSave(plan); if (saved) setPlan((current) => current === plan ? saved : current); setMessage('Draft saved.'); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Workflow could not be saved.'); }
    finally { setSaving(false); }
  }

  async function approve() {
    if (!canApprove) return;
    setApproving(true); setMessage('');
    try { await onApprove(plan); setPlan((current) => ({ ...current, status: 'approved' })); setMessage(assignment ? 'Graph approved for this project assignment.' : 'Reusable workflow graph approved.'); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Graph could not be approved.'); }
    finally { setApproving(false); }
  }

  return <section className="graph-editor phase3-graph-editor">
    <header><div><BackButton onClick={onBack}>Workflow library</BackButton><h2>{plan.name}</h2><p>{assignment ? `Assignment ${assignment.id} · pinned workflow v${assignment.workflowVersion}` : 'Reusable graph editing. Approve the definition before assigning it to a project.'}</p></div><div className="graph-header-actions"><span className={validation.errors.length ? 'review-state blocked' : 'review-state clear'}>{validation.errors.length ? `${validation.errors.length} issues` : 'Graph valid'}</span><a className="dash-button secondary" href={`/api/workflows/${encodeURIComponent(plan.id)}/export`}><UiIcon name="file" />Export</a><button className="dash-button secondary" type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</button><button className="dash-button primary" type="button" disabled={!canApprove || approving || saving} aria-describedby={!canApprove ? "graph-approval-blockers" : undefined} title={validation.errors[0]} onClick={() => void approve()}>{approving ? 'Approving…' : assignment?.status === 'ready' && plan.status !== 'draft' || (!assignment && plan.status === 'approved') ? 'Approved' : 'Approve graph'}</button></div></header>
    {message && <p className="route-banner" role="status">{message}</p>}
    {!canApprove && <details id="graph-approval-blockers" className="route-banner error" open><summary>Approval blocked: {validation.errors.length} issues must be resolved</summary><ul>{validation.errors.map((error, index) => <li key={index}>{error}</li>)}</ul><p>Changing the model does not resolve missing skills, permissions, or graph connections. Review these issues before approving.</p></details>}
    <div className="graph-editor-layout"><div className="graph-main"><div className="graph-toolbar"><span>{plan.nodes.length} nodes · {plan.edges.length} connections</span><div className="graph-toolbar-actions"><div className="segmented-control"><button type="button" className={view === 'canvas' ? 'active' : ''} onClick={() => setView('canvas')}>Canvas</button><button type="button" className={view === 'steps' ? 'active' : ''} onClick={() => setView('steps')}>Step list</button></div>{view === 'canvas' && <button className="dash-button secondary compact" type="button" onClick={autoLayout}>Auto layout</button>}<button className="dash-button secondary" type="button" onClick={addNode}><UiIcon name="plus" />Add node</button></div></div>
      {view === 'canvas' ? <div className="graph-viewport"><div className="graph-zoom-controls" aria-label="Graph zoom controls"><button type="button" aria-label="Zoom out" disabled={zoom <= .5} onClick={() => changeZoom(zoom - .1)}><UiIcon name="zoom-out" /></button><button className="zoom-value" type="button" aria-label="Reset zoom to 100 percent" onClick={() => changeZoom(1)}>{Math.round(zoom * 100)}%</button><button type="button" aria-label="Zoom in" disabled={zoom >= 1.6} onClick={() => changeZoom(zoom + .1)}><UiIcon name="zoom-in" /></button><button type="button" aria-label="Fit graph" onClick={fitGraph}><UiIcon name="fit" /><span>Fit</span></button></div><div className="graph-scroll" ref={graphScrollRef}><div className="graph-zoom-stage" style={{ width: canvasSize.width * zoom, height: canvasSize.height * zoom }}><div className="graph-canvas" style={{ width: canvasSize.width, height: canvasSize.height, transform: `scale(${zoom})` }} onDragOver={(event) => event.preventDefault()} onDrop={dropNode}><svg className="graph-edge-layer" aria-hidden="true"><defs><marker id="workflow-edge-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>{plan.edges.map((edge, index) => { const start = positions[edge.from]; const end = positions[edge.to]; const related = edge.from === selectedId || edge.to === selectedId; return start && end ? <path key={`${edge.from}-${edge.to}-${index}`} className={`${end.x <= start.x ? 'graph-edge back-edge' : 'graph-edge'}${related ? ' related' : ''}`} d={graphEdgePath(start, end, index, canvasSize.height)} markerEnd="url(#workflow-edge-arrow)" /> : null; })}</svg>{plan.nodes.map((node) => <button key={node.id} draggable type="button" aria-label={`${workflowNodeTypeLabel(node.type)} node: ${node.name}`} title={`${workflowNodeTypeLabel(node.type)} · ${node.name}`} className={node.id === selectedId ? `canvas-node selected type-${node.type}` : `canvas-node type-${node.type}`} style={{ left: positions[node.id]?.x ?? 20, top: positions[node.id]?.y ?? 20 }} onDragStart={(event) => event.dataTransfer.setData('application/workflow-node', node.id)} onClick={() => setSelectedId(node.id)}><WorkflowNodeVisual node={node} detail={`${node.inputKeys.length} in · ${node.outputKeys.length} out`} /></button>)}</div></div></div></div> : <ol className="readable-step-list">{plan.nodes.map((node, index) => <li key={node.id} role="button" tabIndex={0} className={selectedId === node.id ? 'selected' : ''} onClick={() => setSelectedId(node.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(node.id); } }}><WorkflowNodeSummary node={node} index={index} skills={skills} variant="step" /></li>)}</ol>}
      <section className={connectionsOpen ? 'connections open' : 'connections'}><header className="connections-header"><div><h3>Routes and conditions</h3><p>{selected ? `${selected.name} has ${selectedOutgoingCount} outgoing ${selectedOutgoingCount === 1 ? 'route' : 'routes'}.` : `${plan.edges.length} workflow routes.`}</p></div><button className="dash-button secondary compact" type="button" aria-expanded={connectionsOpen} onClick={() => setConnectionsOpen((current) => !current)}>{connectionsOpen ? 'Close manager' : 'Manage connections'}</button></header>{connectionsOpen && <div className="connections-body"><div className="connection-builder"><label>From<select aria-label="Connection source" value={from} onChange={(event) => setFrom(event.target.value)}>{plan.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label><span className="route-connector" aria-hidden="true"><UiIcon name="arrow-right" /></span><label>To<select aria-label="Connection target" value={to} onChange={(event) => setTo(event.target.value)}>{plan.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label><button className="dash-button primary" type="button" onClick={addConnection}><UiIcon name="plus" />Add route</button></div><div className="connection-groups">{connectionGroups.map(({ node, edges }) => <section className="connection-group" key={node.id}><header><span className={`step-node-icon type-${node.type}`}><WorkflowNodeIcon type={node.type} /></span><div><strong>{node.name}</strong><small>{edges.length} outgoing {edges.length === 1 ? 'route' : 'routes'}</small></div></header><div>{edges.map(({ edge, index }) => { const target = plan.nodes.find((node) => node.id === edge.to); return <article key={`${edge.from}-${edge.to}-${index}`}><button className="route-target" type="button" onClick={() => setSelectedId(edge.to)}><span aria-hidden="true"><UiIcon name="arrow-right" /></span><span><small>Goes to</small><strong>{target?.name ?? edge.to}</strong></span></button><label>Runs when<input aria-label={`Condition from ${node.name} to ${target?.name ?? edge.to}`} value={edge.condition ?? ''} placeholder="Always" onChange={(event) => setPlan((current) => ({ ...draftWorkflowPlan(current), edges: current.edges.map((candidate, candidateIndex): WorkflowEdge => candidateIndex === index ? { ...candidate, condition: event.target.value } : candidate), status: 'draft' }))} /></label><button className="dash-icon-button destructive-icon-button" type="button" aria-label={`Remove route to ${target?.name ?? edge.to}`} onClick={() => setPlan((current) => ({ ...draftWorkflowPlan(current), edges: current.edges.filter((_, candidateIndex) => candidateIndex !== index), status: 'draft' }))}><UiIcon name="remove" /></button></article>; })}</div></section>)}</div></div>}</section>
    </div><aside className="graph-rail"><GraphValidationSummary issues={validationIssues} warnings={validation.warnings} assignment={assignment} onReviewNode={setSelectedId} />
      {!assignment && <section className="execution-readiness"><h3>Execution setup</h3><p>Approve this reusable definition first. Choose a project and create its assignment only when you are ready to run it.</p></section>}
      <section><h3>Harness</h3><p className="field-help">Project access is selected and confirmed when this workflow is assigned to a specific project.</p><div className="two-fields"><div><label htmlFor="graph-retries">Retries</label><input id="graph-retries" type="number" min="0" value={plan.harness.maxRetries} onChange={(event) => setPlan((current) => ({ ...draftWorkflowPlan(current), harness: { ...current.harness, maxRetries: Number(event.target.value) }, status: 'draft' }))} /></div><div><label htmlFor="graph-loops">Loop limit</label><input id="graph-loops" type="number" min="1" value={plan.harness.maxLoopIterations} onChange={(event) => setPlan((current) => ({ ...draftWorkflowPlan(current), harness: { ...current.harness, maxLoopIterations: Number(event.target.value) }, status: 'draft' }))} /></div></div></section>
      <HarnessContractEditor availableModels={availableModels} plan={plan} onChange={setPlan} />
      {selected && <><ParallelNodeSettings node={selected} onUpdate={updateNode} /><NodeContractEditor node={selected} onUpdate={updateNode} /><NodeInspector availableModels={availableModels} node={selected} skills={skills} assignment={assignment} onUpdate={updateNode} onRemove={removeNode} onOpenSkill={onOpenSkill} onCreateSkill={onCreateSkill} onAddSkill={onAddSkill} /></>}
    </aside></div>
  </section>;
}
