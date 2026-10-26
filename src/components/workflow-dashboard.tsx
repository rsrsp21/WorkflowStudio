'use client';
import CompanionDownload from './companion-download';

import Image from 'next/image';
import Link from 'next/link';
import { type DragEvent, type FormEvent, useEffect, useMemo, useState } from 'react';
import type { NodeType, WorkflowEdge, WorkflowNode, WorkflowPlan, WorkflowQuestionResponse } from '@/src/domain/models';
import { graphEdgePath, layoutWorkflowGraph } from '@/src/domain/graph-layout';
import { DEFAULT_PLANNING_EXECUTION_SETTINGS, validatePlanningRequest, type PlanningExecutionSettings, type PlanningRequest } from '@/src/domain/planning';
import { isPlanningActive, type PlanningLifecycle } from '@/src/domain/planning-lifecycle';
import { WORKFLOW_CREATION_EXAMPLES } from '@/src/domain/creation-examples';
import type { Project, ProjectFolderInspection, ProjectWorkflow, Skill } from '@/src/domain/workspace';
import type { AuthUser } from '@/src/auth/auth';
import AssignmentModal from './assignment-modal';
import ProfileMenu from './profile-menu';
import ProductFooter from './product-footer';
import SelectField from './select-field';
import WorkflowNodeSummary from './workflow-node-summary';
import { WorkflowNodeVisual, workflowNodeTypeLabel } from './workflow-node-visual';
import type { RuntimeConnection } from '@/src/domain/runtime-connection';
import { CODEX_MODELS, REASONING_EFFORTS, supportsModelReasoning, type ReasoningEffort } from '@/src/domain/model-settings';

const NODE_WIDTH = 210;
const NODE_HEIGHT = 116;

type IconName = 'activity' | 'close' | 'graph' | 'moon' | 'plus' | 'search' | 'settings' | 'skill' | 'sun' | 'trash' | 'use';
export type DashboardReviewDraft = { plan: WorkflowPlan; warnings: string[]; openQuestions: string[]; questionResponses: WorkflowQuestionResponse[]; resolvedResponses?: WorkflowQuestionResponse[]; planningThreadId: string };
type ReviewDraft = DashboardReviewDraft;
type SkillForm = { id?: string; name: string; description: string; instructions: string; triggers: string; inputs: string; outputs: string; validationCriteria: string };
type WorkflowCreationForm = { name: string; objective: string; stages: string; decisions: string; approvals: string; constraints: string; outputs: string; settings: PlanningExecutionSettings };

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    activity: <><path d="M4 13h3l2-6 4 12 2-6h5" /><path d="M4 4v16h16" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    graph: <><rect x="3" y="4" width="6" height="6" rx="1.5" /><rect x="15" y="14" width="6" height="6" rx="1.5" /><path d="M9 7h3a3 3 0 0 1 3 3v4" /><path d="m13 12 2 2 2-2" /></>,
    moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 15.5 21 17l-4 4-1.5-2A8 8 0 0 1 13 20v2h-2v-2a8 8 0 0 1-2.5-1L7 21l-4-4 2-1.5A8 8 0 0 1 4 13H2v-2h2a8 8 0 0 1 1-2.5L3 7l4-4 1.5 2A8 8 0 0 1 11 4V2h2v2a8 8 0 0 1 2.5 1L17 3l4 4-2 1.5a8 8 0 0 1 1 2.5h2v2h-2a8 8 0 0 1-1 2.5Z" /></>,
    skill: <><path d="M8 3h8l1 5 4 4-4 4-1 5H8l-1-5-4-4 4-4 1-5Z" /><path d="m9 12 2 2 4-4" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    search: <><circle cx="10.75" cy="10.75" r="6.25" /><path d="m15.5 15.5 4 4" /></>,
    trash: <path d="M5 7h14M9 7V4.75h6V7M7.25 7l.8 12h7.9l.8-12" />,
    use: <><path d="M5 12h14M14 7l5 5-5 5" /><path d="M5 5v14" /></>
  };
  return <svg className="dash-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function splitLines(value: string) {
  return value.split(/[,\n]/).map((line) => line.trim()).filter(Boolean);
}

export function composePlanningPrompt(form: Pick<WorkflowCreationForm, 'objective' | 'stages' | 'decisions' | 'approvals'>): string {
  const section = (heading: string, value: string) => {
    const items = splitLines(value);
    return items.length ? `${heading}:\n${items.map((item) => `- ${item}`).join('\n')}` : '';
  };
  return [
    `Objective:\n${form.objective.trim()}`,
    section('Stages', form.stages),
    section('Decision points', form.decisions),
    section('Human approval points', form.approvals)
  ].filter(Boolean).join('\n\n');
}

function activityText(event: { type?: string; message?: string; raw?: string }) {
  if (event.message) return event.message;
  try {
    const parsed = JSON.parse(event.raw ?? '');
    if (parsed.type === 'thread.started') return `Codex thread started · ${parsed.thread_id ?? 'connected'}`;
    if (parsed.type === 'turn.started') return 'Codex planning turn started';
    if (parsed.type === 'turn.completed') return 'Codex planning turn completed';
    if (parsed.type === 'item.started' || parsed.type === 'item.completed') return '';
    if (parsed.type) return `Codex event · ${parsed.type.replaceAll('_', ' ')}`;
  } catch { /* Provider output can be plain text. */ }
  return (event.raw ?? '').slice(0, 240);
}

function activityLine(message: string) {
  return `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}  ${message}`;
}

function elapsedLabel(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyReviewModal({ draft, onClose, onSave, onQuestionsChange }: { draft: ReviewDraft; onClose: () => void; onSave: () => void; onQuestionsChange: (questions: string[]) => void }) {
  return <div className="dash-modal-backdrop"><section className="dash-modal review-modal" aria-label="Review generated workflow"><header><div><h2>Review generated workflow</h2><p>Confirm the reusable definition before it enters your library.</p></div><button className="dash-icon-button" type="button" aria-label="Close" onClick={onClose}><Icon name="close" /></button></header><div className="review-summary"><div><strong>{draft.plan.name}</strong><span>{draft.plan.nodes.length} nodes · {draft.plan.edges.length} connections</span></div><span className="dash-state"><i />Workflow draft</span></div><div className="review-layout"><section className="wide"><h3>Interpreted intent</h3><p>{draft.plan.description}</p></section><section className="wide"><h3>Original request</h3><p className="code-copy">{draft.plan.planningPrompt}</p></section><section><h3>Constraints</h3>{draft.plan.constraints.length ? <ul>{draft.plan.constraints.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None specified.</p>}</section><section><h3>Completion checks</h3><ul>{draft.plan.completionCriteria.map((item) => <li key={item}>{item}</li>)}</ul></section><section className="wide"><h3>Proposed nodes</h3><div className="review-node-list">{draft.plan.nodes.map((node, index) => <div key={node.id}><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{node.name}</strong><small>{node.type} · {node.skillIds.length} skills</small></span></div>)}</div></section><section><h3>Warnings</h3>{draft.warnings.length ? <ul>{draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p>No warnings.</p>}</section><section><label htmlFor="dash-open-questions">Open questions</label><textarea id="dash-open-questions" rows={4} value={draft.openQuestions.join('\n')} onChange={(event) => onQuestionsChange(splitLines(event.target.value))} /></section></div><footer><button className="dash-button secondary" type="button" onClick={onClose}>Refine request</button><button className="dash-button primary" type="button" onClick={onSave}>Add to workflow library</button></footer></section></div>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyQuestionReviewModal({ draft, busy = false, onClose, onSave, onKeepCurrent, onAnswerChange }: { draft: ReviewDraft; busy?: boolean; onClose: () => void; onSave: () => void; onKeepCurrent?: () => void; onAnswerChange: (index: number, answer: string) => void }) {
  const answered = draft.questionResponses.filter((response) => response.answer.trim()).length;
  const allAnswered = answered === draft.questionResponses.length;
  const hasQuestions = draft.questionResponses.length > 0;
  return <div className="dash-modal-backdrop"><section className="dash-modal review-modal" aria-label="Review generated workflow"><header><div><h2>Review generated workflow</h2><p>{hasQuestions ? 'Answer Codex’s questions, then update the plan or keep the current graph.' : 'The plan has no unresolved questions and is ready for the library.'}</p></div><button className="dash-icon-button" type="button" aria-label="Close" onClick={onClose}><Icon name="close" /></button></header><div className="review-summary"><div><strong>{draft.plan.name}</strong><span>{draft.plan.nodes.length} nodes · {draft.plan.edges.length} connections</span></div><span className="review-progress">{hasQuestions ? `${answered}/${draft.questionResponses.length} questions answered` : 'Plan resolved'}</span></div><div className="review-layout"><section className="wide"><h3>Interpreted intent</h3><p>{draft.plan.description}</p></section><section className="wide"><h3>Structured request</h3><p className="code-copy">{draft.plan.planningPrompt}</p></section><section><h3>Constraints</h3>{draft.plan.constraints.length ? <ul>{draft.plan.constraints.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None specified.</p>}</section><section><h3>Completion checks</h3><ul>{draft.plan.completionCriteria.map((item) => <li key={item}>{item}</li>)}</ul></section><section className="wide"><h3>Proposed nodes</h3><div className="review-node-list">{draft.plan.nodes.map((node, index) => <div key={node.id}><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{node.name}</strong><small>{node.type} · {node.skillIds.length ? node.skillIds.join(', ') : 'No skills'}</small></span></div>)}</div></section><section className="wide question-response-section"><div className="question-response-heading"><div><h3>Questions from Codex</h3><p>{hasQuestions ? 'Use the answers to revise the plan, or record them and keep the current graph.' : 'No unresolved questions remain.'}</p></div><span>{answered}/{draft.questionResponses.length}</span></div>{hasQuestions ? <div className="question-response-list">{draft.questionResponses.map((response, index) => <div key={`${response.question}-${index}`}><label htmlFor={`workflow-question-${index}`}>{response.question}</label><textarea id={`workflow-question-${index}`} rows={3} value={response.answer} onChange={(event) => onAnswerChange(index, event.target.value)} placeholder="Type your answer, decision, or missing context here" aria-required="true" /></div>)}</div> : <p>The latest planning pass is resolved. Review the updated nodes and attached skills, then add it to the library.</p>}</section><section className="wide"><h3>Warnings</h3>{draft.warnings.length ? <ul>{draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p>No warnings.</p>}</section></div><footer><button className="dash-button secondary" type="button" onClick={onClose}>Refine request</button><span className="review-save-status">{busy ? 'Updating plan…' : hasQuestions ? allAnswered ? 'Choose how to continue' : `Answer ${draft.questionResponses.length - answered} remaining question${draft.questionResponses.length - answered === 1 ? '' : 's'}` : 'Ready to add'}</span>{hasQuestions && <button className="dash-button secondary" type="button" onClick={onKeepCurrent} disabled={busy || !allAnswered}>Keep current plan</button>}<button className="dash-button primary" type="button" onClick={onSave} disabled={busy || (hasQuestions && !allAnswered)}>{busy ? 'Updating plan…' : hasQuestions ? 'Re-plan with answers' : 'Add to workflow library'}</button></footer></section></div>;
}

export function ReviewModal({ draft, skills = [], busy = false, onClose, onReplan, onKeepCurrent, onContinueUnresolved, onAnswerChange }: { draft: ReviewDraft; skills?: Skill[]; busy?: boolean; onClose: () => void; onReplan: () => void; onKeepCurrent: () => void; onContinueUnresolved: () => void; onAnswerChange: (index: number, answer: string) => void }) {
  const [confirmingUnresolved, setConfirmingUnresolved] = useState(false);
  const answered = draft.questionResponses.filter((response) => response.answer.trim()).length;
  const remaining = draft.questionResponses.length - answered;
  const hasQuestions = draft.questionResponses.length > 0;
  const allAnswered = remaining === 0;
  return <div className="dash-modal-backdrop"><section className="dash-modal review-modal" aria-label="Review generated workflow">
    <header><div><h2>Review generated workflow</h2><p>{hasQuestions ? 'Answer the questions to revise the plan, or continue with them explicitly unresolved.' : 'The plan has no unresolved questions and is ready for the library.'}</p></div><button className="dash-icon-button" type="button" aria-label="Close" onClick={onClose}><Icon name="close" /></button></header>
    <div className="review-summary"><div><strong>{draft.plan.name}</strong><span>{draft.plan.nodes.length} nodes · {draft.plan.edges.length} connections</span></div><span className="review-progress">{hasQuestions ? `${answered}/${draft.questionResponses.length} questions answered` : 'Plan resolved'}</span></div>
    <div className="review-layout">
      <section className="wide"><h3>Interpreted intent</h3><p>{draft.plan.description}</p></section>
      <section className="wide"><h3>Structured request</h3><p className="code-copy">{draft.plan.planningPrompt}</p></section>
      <section><h3>Constraints</h3>{draft.plan.constraints.length ? <ul>{draft.plan.constraints.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None specified.</p>}</section>
      <section><h3>Completion checks</h3><ul>{draft.plan.completionCriteria.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section className="wide proposed-plan-section"><div className="proposed-plan-heading"><div><h3>Proposed workflow</h3><p>Each card shows what the step receives, what it produces, and which reusable skill powers it.</p></div><span>{draft.plan.nodes.length} steps</span></div><div className="review-node-list">{draft.plan.nodes.map((node, index) => <WorkflowNodeSummary key={node.id} node={node} index={index} skills={skills} />)}</div></section>
      <section className="wide question-response-section"><div className="question-response-heading"><div><h3>Questions from Codex</h3><p>{hasQuestions ? 'Completed answers can update the plan. Unanswered items remain visible if you continue.' : 'No unresolved questions remain.'}</p></div><span>{answered}/{draft.questionResponses.length}</span></div>{hasQuestions ? <div className="question-response-list">{draft.questionResponses.map((response, index) => <div key={`${response.question}-${index}`}><label htmlFor={`workflow-question-${index}`}>{response.question}</label><textarea id={`workflow-question-${index}`} rows={3} value={response.answer} onChange={(event) => onAnswerChange(index, event.target.value)} placeholder="Type your answer, or leave it unresolved" /></div>)}</div> : <p>Review the updated graph and attached skills, then add it to the library.</p>}</section>
      <section className="wide"><h3>Warnings</h3>{draft.warnings.length ? <ul>{draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p>No warnings.</p>}</section>
    </div>
    {confirmingUnresolved && <div className="unresolved-confirm"><div><strong>Continue with {remaining} unresolved question{remaining === 1 ? '' : 's'}?</strong><p>They will remain on the workflow as visible unresolved context. The current graph will not be regenerated.</p></div><button className="dash-button secondary" type="button" onClick={() => setConfirmingUnresolved(false)}>Cancel</button><button className="dash-button danger" type="button" onClick={onContinueUnresolved}>Continue unresolved</button></div>}
    <footer><button className="dash-button secondary" type="button" onClick={onClose}>Refine request</button><span className="review-save-status">{busy ? 'Updating plan…' : hasQuestions ? allAnswered ? 'Choose how to continue' : `${remaining} question${remaining === 1 ? '' : 's'} unresolved` : 'Ready to add'}</span>{hasQuestions && (allAnswered ? <button className="dash-button secondary" type="button" onClick={onKeepCurrent} disabled={busy}>Keep current plan</button> : <button className="dash-button secondary" type="button" onClick={() => setConfirmingUnresolved(true)} disabled={busy}>Continue with unresolved questions</button>)}<button className="dash-button primary" type="button" onClick={hasQuestions ? onReplan : onKeepCurrent} disabled={busy || (hasQuestions && !allAnswered)}>{busy ? 'Updating plan…' : hasQuestions ? 'Re-plan with answers' : 'Add to workflow library'}</button></footer>
  </section></div>;
}

export function SkillModal({ form, onChange, onClose, onSave }: { form: SkillForm; onChange: (form: SkillForm) => void; onClose: () => void; onSave: () => void }) {
  return <div className="dash-modal-backdrop"><section className="dash-modal skill-modal" aria-label="Skill editor"><header><div><h2>{form.id ? 'Edit skill' : 'Create a skill'}</h2><p>Own the instructions, inputs, outputs, and validation contract.</p></div><button className="dash-icon-button" type="button" aria-label="Close" onClick={onClose}><Icon name="close" /></button></header><div className="skill-form"><div><label htmlFor="dash-skill-name">Name</label><input id="dash-skill-name" value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} /></div><div><label htmlFor="dash-skill-description">Description</label><input id="dash-skill-description" value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} /></div><div className="wide"><label htmlFor="dash-skill-instructions">Instructions</label><textarea id="dash-skill-instructions" rows={7} value={form.instructions} onChange={(event) => onChange({ ...form, instructions: event.target.value })} /></div><div><label htmlFor="dash-skill-triggers">Triggers</label><input id="dash-skill-triggers" value={form.triggers} onChange={(event) => onChange({ ...form, triggers: event.target.value })} placeholder="review, validate" /></div><div><label htmlFor="dash-skill-validation">Validation criteria</label><input id="dash-skill-validation" value={form.validationCriteria} onChange={(event) => onChange({ ...form, validationCriteria: event.target.value })} /></div><div><label htmlFor="dash-skill-inputs">Inputs</label><input id="dash-skill-inputs" value={form.inputs} onChange={(event) => onChange({ ...form, inputs: event.target.value })} /></div><div><label htmlFor="dash-skill-outputs">Outputs</label><input id="dash-skill-outputs" value={form.outputs} onChange={(event) => onChange({ ...form, outputs: event.target.value })} /></div></div><footer><button className="dash-button secondary" type="button" onClick={onClose}>Cancel</button><button className="dash-button primary" type="button" disabled={!form.name.trim() || !form.instructions.trim()} onClick={onSave}>Save skill</button></footer></section></div>;
}

// Kept temporarily for persisted pre-assignment sessions; new uses open AssignmentModal.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ProjectModal({ workflow, projects, onClose, onReady, onLog }: { workflow: WorkflowPlan; projects: Project[]; onClose: () => void; onReady: (project: Project) => void; onLog: (message: string) => void }) {
  const [rootPath, setRootPath] = useState('');
  const [name, setName] = useState('');
  const [inspection, setInspection] = useState<ProjectFolderInspection | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function inspect(pathValue = rootPath) {
    if (!pathValue.trim()) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/projects/inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rootPath: pathValue }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Folder inspection failed.');
      setInspection(result.inspection); setRootPath(result.inspection.rootPath); if (!name) setName(result.inspection.rootPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'Project');
    } catch (caught) { setInspection(null); setError(caught instanceof Error ? caught.message : 'Folder inspection failed.'); }
    finally { setBusy(false); }
  }
  async function confirmWorkspace() {
    if (!inspection || !name.trim()) return;
    setBusy(true);
    try {
      const response = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, rootPath: inspection.rootPath }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || result.errors?.[0]);
      onLog(`Execution workspace selected · ${result.project.rootPath}`); onReady(result.project);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Workspace could not be selected.'); }
    finally { setBusy(false); }
  }
  async function chooseDefaultRoot() {
    setBusy(true);
    try { const response = await fetch('/api/projects/inspect'); const result = await response.json(); setRootPath(result.inspection.rootPath); setName(result.projectName); setInspection(result.inspection); } finally { setBusy(false); }
  }

  return <div className="dash-modal-backdrop"><section className="dash-modal project-modal" aria-label="Choose execution project"><header><div><h2>Use {workflow.name}</h2><p>Choose a project now. This root applies to this use only and does not change the reusable workflow.</p></div><button className="dash-icon-button" type="button" aria-label="Close" onClick={onClose}><Icon name="close" /></button></header><div className="project-modal-grid"><div><label htmlFor="dash-project-name">Workspace name</label><input id="dash-project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Policy workspace" /><label htmlFor="dash-project-root">Project root</label><div className="inline-control"><input id="dash-project-root" value={rootPath} onChange={(event) => { setRootPath(event.target.value); setInspection(null); }} placeholder="C:\\projects\\policy-docs" /><button className="dash-button secondary" type="button" disabled={busy || !rootPath.trim()} onClick={() => void inspect()}>Inspect</button></div><button className="text-button" type="button" onClick={() => void chooseDefaultRoot()}>Use this app folder for testing</button>{error && <p className="dash-field-error">{error}</p>}</div><aside>{inspection ? <><span>Inspection complete</span><strong>{inspection.workspaceKind === 'repository' ? 'Existing repository' : inspection.workspaceKind === 'empty' ? 'Empty folder' : 'Existing workspace'}</strong><code>{inspection.rootPath}</code><p>{inspection.entryCount} entries · read-only until execution approval</p><button className="dash-button primary" type="button" disabled={busy || !name.trim()} onClick={() => void confirmWorkspace()}>Use this workspace</button></> : <><span>Execution boundary</span><strong>No project selected</strong><p>Workflow creation stays project-independent. Select a root only when using it.</p></>}</aside></div>{projects.length > 0 && <div className="recent-projects"><span>Recent workspaces</span><div>{projects.map((project) => <button key={project.id} type="button" onClick={() => { setName(project.name); setRootPath(project.rootPath); void inspect(project.rootPath); }}><strong>{project.name}</strong><small>{project.rootPath}</small></button>)}</div></div>}</section></div>;
}

export function GraphEditor({ workflow, skills, onBack, onSave, onCreateSkill }: { workflow: WorkflowPlan; skills: Skill[]; onBack: () => void; onSave: (workflow: WorkflowPlan) => Promise<void>; onCreateSkill: (name: string) => void }) {
  const [plan, setPlan] = useState(workflow);
  const [selectedId, setSelectedId] = useState(workflow.nodes[0]?.id ?? '');
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => layoutWorkflowGraph(workflow).positions);
  const [from, setFrom] = useState(workflow.nodes[0]?.id ?? '');
  const [to, setTo] = useState(workflow.nodes[1]?.id ?? workflow.nodes[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const selected = plan.nodes.find((node) => node.id === selectedId);
  const canvasSize = useMemo(() => ({ width: Math.max(920, ...Object.values(positions).map((position) => position.x + NODE_WIDTH + 42)), height: Math.max(520, ...Object.values(positions).map((position) => position.y + NODE_HEIGHT + 70)) }), [positions]);

  function updateNode(patch: Partial<WorkflowNode>) { setPlan((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === selectedId ? { ...node, ...patch } : node), updatedAt: new Date().toISOString() })); }
  function addNode() { const id = `node_${crypto.randomUUID().slice(0, 8)}`; const node: WorkflowNode = { id, name: 'New workflow step', type: 'agent', prompt: '', skillIds: [], inputKeys: [], outputKeys: [], retryLimit: plan.harness.maxRetries, requiresApproval: false }; setPlan((current) => ({ ...current, nodes: [...current.nodes, node] })); setPositions((current) => ({ ...current, [id]: { x: 28 + (plan.nodes.length % 3) * 224, y: 34 + Math.floor(plan.nodes.length / 3) * 126 } })); setSelectedId(id); }
  function removeNode() { if (!selected) return; const remaining = plan.nodes.filter((node) => node.id !== selected.id); setPlan((current) => ({ ...current, nodes: remaining, edges: current.edges.filter((edge) => edge.from !== selected.id && edge.to !== selected.id) })); setSelectedId(remaining[0]?.id ?? ''); }
  function dropNode(event: DragEvent<HTMLDivElement>) { event.preventDefault(); const id = event.dataTransfer.getData('application/workflow-node'); if (!id) return; const rect = event.currentTarget.getBoundingClientRect(); setPositions((current) => ({ ...current, [id]: { x: Math.max(14, Math.min(event.clientX - rect.left - NODE_WIDTH / 2, rect.width - NODE_WIDTH - 14)), y: Math.max(14, Math.min(event.clientY - rect.top - NODE_HEIGHT / 2, canvasSize.height - NODE_HEIGHT - 14)) } })); }
  function addConnection() { if (!from || !to || from === to || plan.edges.some((edge) => edge.from === from && edge.to === to)) return; setPlan((current) => ({ ...current, edges: [...current.edges, { from, to, condition: '' }] })); }
  async function save() { setSaving(true); try { await onSave(plan); } finally { setSaving(false); } }

  return <section className="graph-editor"><header><div><button className="text-button" type="button" onClick={onBack}>← Workflow library</button><h2>{plan.name}</h2><p>Drag nodes, edit instructions and skills, then change or remove connections.</p></div><div><span className="dash-state"><i />Editable workflow</span><button className="dash-button primary" type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save workflow'}</button></div></header><div className="graph-editor-layout"><div className="graph-main"><div className="graph-toolbar"><span>{plan.nodes.length} nodes · {plan.edges.length} connections</span><button className="dash-button secondary" type="button" onClick={addNode}><Icon name="plus" />Add node</button></div><div className="graph-scroll"><div className="graph-canvas" style={{ width: canvasSize.width, height: canvasSize.height }} onDragOver={(event) => event.preventDefault()} onDrop={dropNode}><svg className="graph-edge-layer" aria-hidden="true"><defs><marker id="dashboard-workflow-edge-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>{plan.edges.map((edge, index) => { const start = positions[edge.from]; const end = positions[edge.to]; const related = edge.from === selectedId || edge.to === selectedId; return start && end ? <path key={`${edge.from}-${edge.to}-${index}`} className={`${end.x <= start.x ? 'graph-edge back-edge' : 'graph-edge'}${related ? ' related' : ''}`} d={graphEdgePath(start, end, index, canvasSize.height)} markerEnd="url(#dashboard-workflow-edge-arrow)" /> : null; })}</svg>{plan.nodes.map((node) => <button key={node.id} draggable type="button" aria-label={`${workflowNodeTypeLabel(node.type)} node: ${node.name}`} title={`${workflowNodeTypeLabel(node.type)} · ${node.name}`} className={node.id === selectedId ? `canvas-node selected type-${node.type}` : `canvas-node type-${node.type}`} style={{ left: positions[node.id]?.x ?? 20, top: positions[node.id]?.y ?? 20 }} onDragStart={(event) => event.dataTransfer.setData('application/workflow-node', node.id)} onClick={() => setSelectedId(node.id)}><WorkflowNodeVisual node={node} detail={node.skillIds.length ? `${node.skillIds.length} skills` : 'No skills assigned'} /></button>)}</div></div><div className="connections"><div className="connection-builder"><select aria-label="Connection source" value={from} onChange={(event) => setFrom(event.target.value)}>{plan.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select><span>to</span><select aria-label="Connection target" value={to} onChange={(event) => setTo(event.target.value)}>{plan.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select><button className="dash-button secondary" type="button" onClick={addConnection}>Add connection</button></div><div className="connection-list">{plan.edges.map((edge, index) => <div key={`${edge.from}-${edge.to}-${index}`}><span>{plan.nodes.find((node) => node.id === edge.from)?.name ?? edge.from}</span><b>→</b><span>{plan.nodes.find((node) => node.id === edge.to)?.name ?? edge.to}</span><input aria-label="Connection condition" value={edge.condition ?? ''} placeholder="Optional condition" onChange={(event) => setPlan((current) => ({ ...current, edges: current.edges.map((candidate, candidateIndex): WorkflowEdge => candidateIndex === index ? { ...candidate, condition: event.target.value } : candidate) }))} /><button className="dash-icon-button" type="button" aria-label="Remove connection" onClick={() => setPlan((current) => ({ ...current, edges: current.edges.filter((_, candidateIndex) => candidateIndex !== index) }))}><Icon name="close" /></button></div>)}</div></div></div><aside className="graph-rail"><section><div className="rail-heading"><Icon name="settings" /><div><h3>Harness</h3><p>Workflow runtime defaults</p></div></div><p className="field-help">Project access is selected and confirmed when this workflow is assigned to a specific project.</p><div className="two-fields"><div><label htmlFor="graph-retries">Retries</label><input id="graph-retries" type="number" min="0" value={plan.harness.maxRetries} onChange={(event) => setPlan((current) => ({ ...current, harness: { ...current.harness, maxRetries: Number(event.target.value) } }))} /></div><div><label htmlFor="graph-concurrency">Concurrency</label><input id="graph-concurrency" type="number" min="1" value={plan.harness.maxConcurrentNodes} onChange={(event) => setPlan((current) => ({ ...current, harness: { ...current.harness, maxConcurrentNodes: Number(event.target.value) } }))} /></div></div></section>{selected ? <section><div className="rail-heading"><Icon name="graph" /><div><h3>Selected node</h3><p>{selected.id}</p></div></div><label htmlFor="graph-node-name">Name</label><input id="graph-node-name" value={selected.name} onChange={(event) => updateNode({ name: event.target.value })} /><label htmlFor="graph-node-type">Type</label><select id="graph-node-type" value={selected.type} onChange={(event) => updateNode({ type: event.target.value as NodeType })}>{(['agent', 'codex', 'tool', 'validation', 'approval', 'loop', 'success', 'failure'] as NodeType[]).map((type) => <option key={type} value={type}>{type}</option>)}</select><label htmlFor="graph-node-prompt">Instructions</label><textarea id="graph-node-prompt" rows={6} value={selected.prompt} onChange={(event) => updateNode({ prompt: event.target.value })} /><div className="two-fields"><div><label htmlFor="graph-node-retry">Retries</label><input id="graph-node-retry" type="number" min="0" value={selected.retryLimit} onChange={(event) => updateNode({ retryLimit: Number(event.target.value) })} /></div><label className="approval-check"><input type="checkbox" checked={selected.requiresApproval} onChange={(event) => updateNode({ requiresApproval: event.target.checked })} />Human approval</label></div><div className="node-skills"><label>Assigned skills</label>{skills.map((skill) => <label className="skill-check" key={skill.id}><input type="checkbox" checked={selected.skillIds.includes(skill.id)} onChange={(event) => updateNode({ skillIds: event.target.checked ? [...selected.skillIds, skill.id] : selected.skillIds.filter((id) => id !== skill.id) })} /><span><strong>{skill.name}</strong><small>Version {skill.version}</small></span></label>)}{selected.skillIds.filter((id) => !skills.some((skill) => skill.id === id)).map((id) => <button className="suggested-skill" type="button" key={id} onClick={() => onCreateSkill(id)}>Create Codex suggestion “{id}”</button>)}</div><button className="danger-text" type="button" onClick={removeNode}>Remove node</button></section> : null}</aside></div></section>;
}

function WorkflowLibrary({ workflows, assignments, onUse, onDelete }: { workflows: WorkflowPlan[]; assignments: ProjectWorkflow[]; onUse: (workflow: WorkflowPlan) => void; onDelete: (id: string) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('all');
  const [status, setStatus] = useState('all');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const domains = Array.from(new Set(workflows.map((workflow) => workflow.domain ?? 'General'))).sort();
  const filtered = workflows.filter((workflow) => {
    const workflowDomain = workflow.domain ?? 'General';
    const matchesQuery = `${workflow.name} ${workflow.description} ${workflowDomain}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (domain === 'all' || workflowDomain === domain) && (status === 'all' || workflow.status === status);
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return <section className="workflow-library phase3-library"><div className="dash-section-heading"><div><h2>Workflow library</h2><p>Search and reuse governed workflow definitions.</p></div><span>{filtered.length} shown · {workflows.length} total</span></div><div className="library-controls"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workflows" aria-label="Search workflows" /><select value={domain} onChange={(event) => setDomain(event.target.value)} aria-label="Filter workflow domain"><option value="all">All domains</option>{domains.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter workflow status"><option value="all">All states</option><option value="draft">In design</option><option value="approved">Approved</option></select></div>{filtered.length ? <div className="workflow-cards">{filtered.map((workflow) => { const workflowAssignments = assignments.filter((assignment) => assignment.workflowId === workflow.id); const inputs = Array.from(new Set(workflow.nodes.flatMap((node) => node.inputKeys))); const outputs = Array.from(new Set(workflow.nodes.flatMap((node) => node.outputKeys))); return <article className="dash-workflow-card" key={workflow.id}><div className="card-top"><span className="workflow-kind">{workflow.starter ? 'Starter' : workflow.status === 'approved' ? 'Approved definition' : 'In design'}</span>{!workflow.starter && <button className="dash-icon-button" type="button" aria-label={`Delete ${workflow.name}`} onClick={() => setDeleteId(workflow.id)}><Icon name="trash" /></button>}</div><span className="workflow-domain">{workflow.domain} · v{workflow.version}</span><h3>{workflow.name}</h3><p>{workflow.description || 'Reusable workflow definition'}</p><dl><div><dt>Inputs</dt><dd>{inputs.length}</dd></div><div><dt>Outputs</dt><dd>{outputs.length}</dd></div><div><dt>Skills</dt><dd>{new Set(workflow.nodes.flatMap((node) => node.skillIds)).size}</dd></div></dl><div className="card-meta"><span>{workflowAssignments.length} project assignment{workflowAssignments.length === 1 ? '' : 's'}</span><span>Updated {workflow.updatedAt.slice(0, 10)}</span></div>{deleteId === workflow.id ? <div className="delete-panel"><p>Delete this definition and its project assignments?</p><div><button className="text-button" type="button" onClick={() => setDeleteId(null)}>Cancel</button><button className="dash-button danger" type="button" onClick={() => void onDelete(workflow.id).then(() => setDeleteId(null))}>Delete workflow</button></div></div> : <div className="card-actions"><Link className="dash-button secondary" href={`/workflows/${encodeURIComponent(workflow.id)}/graph`}><Icon name="graph" />Open graph</Link><button className="dash-button primary" type="button" onClick={() => onUse(workflow)}>Use workflow<Icon name="use" /></button></div>}{workflowAssignments.length > 0 && <details className="assignment-history"><summary>Assignment history</summary>{workflowAssignments.map((assignment) => <Link key={assignment.id} href={`/workflows/${encodeURIComponent(workflow.id)}/graph?assignmentId=${encodeURIComponent(assignment.id)}`}>{assignment.projectId} · {assignment.status} · v{assignment.workflowVersion}</Link>)}</details>}</article>; })}</div> : <div className="library-empty"><h3>No matching workflows</h3><p>Adjust the filters or create a reusable workflow.</p></div>}</section>;
}

function StructuredWorkflowFields({ form, errors, onChange, onSettingsChange }: { form: WorkflowCreationForm; errors: Record<string, string[]>; onChange: (field: keyof Omit<WorkflowCreationForm, 'settings'>, value: string) => void; onSettingsChange: (settings: Partial<PlanningExecutionSettings>) => void }) {
  const supportedEfforts = REASONING_EFFORTS.filter((effort) => supportsModelReasoning(form.settings.planningModel, effort));
  return <div className="create-fields structured-workflow-fields">
    <div className="wide workflow-part"><span className="part-number">1</span><div><label htmlFor="dash-workflow-name">Workflow name</label><input id="dash-workflow-name" value={form.name} onChange={(event) => onChange('name', event.target.value)} placeholder="Requirements quality review" aria-invalid={Boolean(errors.workflowName)} />{errors.workflowName && <p className="dash-field-error">{errors.workflowName[0]}</p>}</div></div>
    <div className="wide workflow-part"><span className="part-number">2</span><div><label htmlFor="dash-workflow-objective">Objective</label><textarea id="dash-workflow-objective" rows={3} value={form.objective} onChange={(event) => onChange('objective', event.target.value)} placeholder="What outcome should this workflow produce?" aria-invalid={Boolean(errors.objective || errors.planningPrompt)} />{(errors.objective || errors.planningPrompt) && <p className="dash-field-error">{(errors.objective || errors.planningPrompt)[0]}</p>}</div></div>
    <div className="wide workflow-part"><span className="part-number">3</span><div><label htmlFor="dash-workflow-stages">Stages</label><textarea id="dash-workflow-stages" rows={5} value={form.stages} onChange={(event) => onChange('stages', event.target.value)} placeholder={'Inspect source material\nIdentify gaps\nPropose corrections\nValidate the result'} aria-invalid={Boolean(errors.stages)} /><small>One stage per line. You can reorder these later in the graph.</small>{errors.stages && <p className="dash-field-error">{errors.stages[0]}</p>}</div></div>
    <div className="workflow-part"><span className="part-number">4</span><div><label htmlFor="dash-workflow-decisions">Decision points</label><textarea id="dash-workflow-decisions" rows={4} value={form.decisions} onChange={(event) => onChange('decisions', event.target.value)} placeholder={'Is enough context available?\nDid validation pass?'} /><small>Optional · one decision per line</small></div></div>
    <div className="workflow-part"><span className="part-number">5</span><div><label htmlFor="dash-workflow-approvals">Human approvals</label><textarea id="dash-workflow-approvals" rows={4} value={form.approvals} onChange={(event) => onChange('approvals', event.target.value)} placeholder="Approve the final review before completion" /><small>Optional · one approval point per line</small></div></div>
    <div className="workflow-part"><span className="part-number">6</span><div><label htmlFor="dash-constraints">Constraints</label><textarea id="dash-constraints" rows={4} value={form.constraints} onChange={(event) => onChange('constraints', event.target.value)} placeholder="One rule per line" /></div></div>
    <div className="workflow-part"><span className="part-number">7</span><div><label htmlFor="dash-outputs">Expected outputs</label><textarea id="dash-outputs" rows={4} value={form.outputs} onChange={(event) => onChange('outputs', event.target.value)} placeholder="One output per line" aria-invalid={Boolean(errors.outputRequirements)} />{errors.outputRequirements && <p className="dash-field-error">{errors.outputRequirements[0]}</p>}</div></div>
    <div className="wide workflow-part"><span className="part-number">8</span><div><label htmlFor="dash-planning-model">Workflow creation model</label><div className="library-controls"><select id="dash-planning-model" value={form.settings.planningModel} onChange={(event) => { const model = event.target.value; const currentEffort = form.settings.planningReasoningEffort; onSettingsChange({ planningModel: model, planningReasoningEffort: supportsModelReasoning(model, currentEffort) ? currentEffort : 'medium' }); }} aria-invalid={Boolean(errors['executionSettings.planningModel'])}>{CODEX_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}</select><select aria-label="Workflow creation reasoning effort" value={form.settings.planningReasoningEffort} onChange={(event) => onSettingsChange({ planningReasoningEffort: event.target.value as ReasoningEffort })} aria-invalid={Boolean(errors['executionSettings.planningReasoningEffort'])}>{supportedEfforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}</select></div><small>This model generates the workflow graph and repairs it before review. Execution models are configured separately in the graph.</small>{errors['executionSettings.planningModel'] && <p className="dash-field-error">{errors['executionSettings.planningModel'][0]}</p>}{errors['executionSettings.planningReasoningEffort'] && <p className="dash-field-error">{errors['executionSettings.planningReasoningEffort'][0]}</p>}</div></div>
  </div>;
}

export default function WorkflowDashboard({ user, creationPage = false }: { user?: AuthUser; creationPage?: boolean }) {
  const router = { push: (path: string) => window.location.assign(path) };
  const [workflows, setWorkflows] = useState<WorkflowPlan[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignments, setAssignments] = useState<ProjectWorkflow[]>([]);
  const [planningRoot, setPlanningRoot] = useState('');
  const [serviceOnline, setServiceOnline] = useState(false);
  const [runtimeMode, setRuntimeMode] = useState<'local' | 'paired'>('local');
  const [creationOpen, setCreationOpen] = useState(creationPage);
  const [usingWorkflow, setUsingWorkflow] = useState<WorkflowPlan | null>(null);
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [planningStartedAt, setPlanningStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lifecycle, setLifecycle] = useState<PlanningLifecycle>('idle');
  const [lastRequest, setLastRequest] = useState<PlanningRequest | null>(null);
  const [message, setMessage] = useState('Ready to create a reusable workflow.');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [workflowExampleId, setWorkflowExampleId] = useState('');
  const [form, setForm] = useState<WorkflowCreationForm>({ name: '', objective: '', stages: '', decisions: '', approvals: '', constraints: '', outputs: '', settings: DEFAULT_PLANNING_EXECUTION_SETTINGS });

  async function refresh() {
    const rootRequest = fetch('/api/projects/inspect').then((response) => response.json()).catch(() => null);
    const [workflowResponse, skillResponse, projectResponse, assignmentResponse, healthResponse, runtimeResponse] = await Promise.all([fetch('/api/workflows'), fetch('/api/skills'), fetch('/api/projects'), fetch('/api/assignments'), fetch('/api/health'), fetch('/api/runtime/connections', { cache: 'no-store' })]);
    const [workflowData, skillData, projectData, assignmentData, healthData, runtimeData] = await Promise.all([workflowResponse.json(), skillResponse.json(), projectResponse.json(), assignmentResponse.json(), healthResponse.json(), runtimeResponse.json()]);
    const mode = runtimeData.mode === 'paired' ? 'paired' : 'local';
    const activeConnection = (runtimeData.connections ?? []).find((connection: RuntimeConnection) => connection.status === 'online' && connection.authMode === 'chatgpt') as RuntimeConnection | undefined;
    const pairedReady = Boolean(activeConnection);
    setRuntimeMode(mode); setWorkflows(workflowData.workflows ?? []); setSkills(skillData.skills ?? []); setProjects(projectData.projects ?? []); setAssignments(assignmentData.assignments ?? []); setServiceOnline(mode === 'local' ? healthData.status === 'ok' : pairedReady);
    if (mode === 'paired' && activeConnection?.allowedRoots[0]) setPlanningRoot(activeConnection.allowedRoots[0]);
    const rootData = await rootRequest;
    if (rootData?.inspection?.rootPath) setPlanningRoot(rootData.inspection.rootPath);
  }
  useEffect(() => {
    const load = () => void refresh().catch(() => setMessage('Runtime status is unavailable.'));
    const initial = window.setTimeout(load, 0);
    let offlineTimer: number | undefined;
    const events = new EventSource('/api/runtime/connections/events');
    events.addEventListener('update', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { connections?: RuntimeConnection[]; mode?: 'local' | 'paired' };
      const mode = data.mode === 'paired' ? 'paired' : 'local';
      const activeConnection = (data.connections ?? []).find((connection) => connection.status === 'online' && connection.authMode === 'chatgpt');
      setRuntimeMode(mode); setServiceOnline(mode === 'local' || Boolean(activeConnection));
      if (mode === 'paired' && activeConnection?.allowedRoots[0]) setPlanningRoot(activeConnection.allowedRoots[0]);
      if (offlineTimer) window.clearTimeout(offlineTimer);
      if (mode === 'paired' && activeConnection) offlineTimer = window.setTimeout(() => setServiceOnline(false), 46_000);
    });
    events.onerror = () => setServiceOnline(false);
    return () => { window.clearTimeout(initial); if (offlineTimer) window.clearTimeout(offlineTimer); events.close(); };
  }, []);
  // The dashboard remains router-independent for server-rendered component tests; navigation occurs only after a user action opens creation.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  useEffect(() => { if (creationOpen && !creationPage) window.location.assign('/workflows/new'); }, [creationOpen, creationPage]);

  const planningActive = isPlanningActive(lifecycle);
  useEffect(() => {
    if (!planningActive || planningStartedAt === null) return;
    const update = () => setElapsedSeconds(Math.floor((Date.now() - planningStartedAt) / 1000));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [planningActive, planningStartedAt]);
  const skillCount = useMemo(() => new Set(workflows.flatMap((workflow) => workflow.nodes.flatMap((node) => node.skillIds))).size, [workflows]);
  function openAssignment(assignment: ProjectWorkflow, project: Project) {
    if (!usingWorkflow) return;
    const workflowId = usingWorkflow.id;
    setUsingWorkflow(null);
    setLogs((current) => [...current, `Assignment ${assignment.id} created for ${project.name}`]);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/workflows/${encodeURIComponent(workflowId)}/graph?assignmentId=${encodeURIComponent(assignment.id)}`);
  }
  function applyWorkflowExample(exampleId: string) {
    setWorkflowExampleId(exampleId);
    const example = WORKFLOW_CREATION_EXAMPLES.find((candidate) => candidate.id === exampleId);
    if (!example) return;
    setForm((current) => ({ name: example.name, objective: example.objective, stages: example.stages, decisions: example.decisions, approvals: example.approvals, constraints: example.constraints, outputs: example.outputs, settings: current.settings }));
    setErrors({});
    setMessage(`${example.label} example added. Review and adapt it before generating.`);
  }

  async function requestPlan(request: PlanningRequest, revision: boolean) {
    setLastRequest(request); setLifecycle('submitting');
    const startedAt = Date.now();
    setPlanningStartedAt(startedAt); setElapsedSeconds(0);
    setLogs((current) => revision ? [...current, activityLine('Answers submitted for another planning pass')] : [activityLine('Planning request created')]);
    setMessage(revision ? 'Codex is updating the workflow from your answers…' : 'Codex is designing the workflow…');
    try {
      const response = await fetch('/api/planning/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      if (!response.ok || !response.body) throw new Error('Planning stream is unavailable.');
      setLifecycle('receiving');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      let result: { plan: WorkflowPlan; warnings?: string[]; openQuestions?: string[]; skillMatches?: Array<{ nodeId: string; skillId: string }>; trace: { planningThreadId: string } } | undefined;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true }); const events = buffer.split('\n\n'); buffer = events.pop() ?? '';
        for (const item of events) {
          if (!item.startsWith('data: ')) continue;
          const providerEvent = JSON.parse(item.slice(6)); const text = activityText(providerEvent);
          if (text) setLogs((current) => [...current, activityLine(text)]);
          if (providerEvent.type === 'planning.completed') result = providerEvent.result;
          if (providerEvent.type === 'planning.failed') {
            const graphErrors = providerEvent.error?.fieldErrors?.graph;
            if (Array.isArray(graphErrors)) setLogs((current) => [...current, ...graphErrors.map((issue: string) => activityLine(`Graph validation: ${issue}`))]);
            throw new Error(providerEvent.error?.message || 'Planning failed.');
          }
        }
      }
      if (!result) throw new Error('Codex finished without a workflow plan.');
      const openQuestions = result.openQuestions ?? result.plan.openQuestions ?? [];
      const resolvedResponses = (request.questionResponses ?? []).map((response) => ({ question: response.question.trim(), answer: response.answer.trim() }));
      const plan = { ...result.plan, openQuestions, questionResponses: resolvedResponses };
      setReviewDraft({ plan, warnings: result.warnings ?? [], openQuestions, questionResponses: openQuestions.map((question) => ({ question, answer: '' })), resolvedResponses, planningThreadId: result.trace.planningThreadId });
      const skillMatchCount = result.skillMatches?.length ?? 0;
      if (skillMatchCount) setLogs((current) => [...current, activityLine(`Attached ${skillMatchCount} installed skill match${skillMatchCount === 1 ? '' : 'es'}`)]);
      setLogs((current) => [...current, activityLine('Workflow plan completed and is ready for review')]);
      setLifecycle('success');
      setMessage(openQuestions.length ? `Updated plan returned with ${openQuestions.length} open question${openQuestions.length === 1 ? '' : 's'}.` : 'Workflow plan resolved. Review it before adding it to the library.');
    } catch (caught) { const failure = caught instanceof Error ? caught.message : 'Planning failed.'; setLifecycle('failure'); setMessage(failure); setLogs((current) => [...current, activityLine(`Planning failed: ${failure}`)]); }
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request: PlanningRequest = { workflowName: form.name, planningPrompt: composePlanningPrompt(form), workspacePath: planningRoot, constraints: splitLines(form.constraints), outputRequirements: splitLines(form.outputs), executionSettings: form.settings };
    const validation = validatePlanningRequest(request);
    if (!form.objective.trim()) validation.objective = ['Workflow objective is required.'];
    if (!splitLines(form.stages).length) validation.stages = ['Add at least one workflow stage.'];
    if (!splitLines(form.outputs).length) validation.outputRequirements = ['Add at least one expected output.'];
    setErrors(validation);
    if (Object.keys(validation).length) { setMessage('Complete the highlighted fields.'); return; }
    await requestPlan(request, false);
  }

  /* Legacy single-pass planner retained in source history only.
  async function legacyGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request: PlanningRequest = { workflowName: form.name, planningPrompt: composePlanningPrompt(form), workspacePath: planningRoot, constraints: splitLines(form.constraints), outputRequirements: splitLines(form.outputs), executionSettings: form.settings };
    const validation = validatePlanningRequest(request);
    if (!form.objective.trim()) validation.objective = ['Workflow objective is required.'];
    if (!splitLines(form.stages).length) validation.stages = ['Add at least one workflow stage.'];
    if (!splitLines(form.outputs).length) validation.outputRequirements = ['Add at least one expected output.'];
    setErrors(validation);
    if (Object.keys(validation).length) { setMessage('Complete the highlighted fields.'); return; }
    setLastRequest(request); setLifecycle('submitting'); setLogs(['Planning request created']); setMessage('Codex is designing the workflow…');
    try {
      const response = await fetch('/api/planning/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      if (!response.ok || !response.body) throw new Error('Planning stream is unavailable.');
      setLifecycle('receiving'); const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let result: { plan: WorkflowPlan; warnings?: string[]; openQuestions?: string[]; trace: { planningThreadId: string } } | undefined;
      while (true) { const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true }); const events = buffer.split('\n\n'); buffer = events.pop() ?? ''; for (const item of events) { if (!item.startsWith('data: ')) continue; const providerEvent = JSON.parse(item.slice(6)); const text = activityText(providerEvent); if (text) setLogs((current) => [...current, text]); if (providerEvent.type === 'planning.completed') result = providerEvent.result; if (providerEvent.type === 'planning.failed') throw new Error(providerEvent.error?.message || 'Planning failed.'); } }
      if (!result) throw new Error('Codex finished without a workflow plan.');
      const openQuestions = result.openQuestions ?? result.plan.openQuestions ?? [];
      setReviewDraft({ plan: result.plan, warnings: result.warnings ?? [], openQuestions, questionResponses: openQuestions.map((question) => ({ question, answer: '' })), planningThreadId: result.trace.planningThreadId }); setLifecycle('success'); setMessage('Workflow generated. Review it and answer any open questions before saving.');
    } catch (caught) { setLifecycle('failure'); setMessage(caught instanceof Error ? caught.message : 'Planning failed.'); setLogs((current) => [...current, 'Planning failed']); }
  }
  */
  async function persistWorkflow(plan: WorkflowPlan, acknowledgeOpenQuestions = false): Promise<WorkflowPlan> {
    const response = await fetch('/api/workflows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...plan, acknowledgeOpenQuestions }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.errors?.[0] || 'Workflow could not be saved.');
    if (result.createdSkills?.length) setLogs((current) => [...current, `Created ${result.createdSkills.length} workflow skill${result.createdSkills.length === 1 ? '' : 's'} as drafts`]);
    if (result.attachedSkills?.length) setLogs((current) => [...current, `Registered ${result.attachedSkills.length} installed Codex skill${result.attachedSkills.length === 1 ? '' : 's'}`]);
    return result.workflow;
  }
  function completedReviewResponses(): WorkflowQuestionResponse[] {
    if (!reviewDraft) return [];
    return [...(reviewDraft.resolvedResponses ?? []), ...reviewDraft.questionResponses]
      .map((response) => ({ question: response.question.trim(), answer: response.answer.trim() }));
  }
  async function replanReviewed() {
    if (!reviewDraft) return;
    if (!lastRequest) { setMessage('The original planning request is unavailable. Refine the workflow and generate it again.'); return; }
    if (!reviewDraft.questionResponses.length || reviewDraft.questionResponses.some((response) => !response.answer.trim())) { setMessage('Answer every open question before updating the workflow.'); return; }
    await requestPlan({ ...lastRequest, previousPlan: reviewDraft.plan, questionResponses: completedReviewResponses(), previousPlanningThreadId: reviewDraft.planningThreadId }, true);
  }
  async function saveReviewed(allowUnresolved = false) {
    if (!reviewDraft) return;
    const unansweredQuestions = reviewDraft.questionResponses.filter((response) => !response.answer.trim()).map((response) => response.question);
    if (unansweredQuestions.length && !allowUnresolved) { setMessage('Answer every open question or explicitly continue with unresolved questions.'); return; }
    try {
      const planningLogs = [...logs, 'Workflow and skills added to library'];
      const plan = await persistWorkflow({ ...reviewDraft.plan, openQuestions: unansweredQuestions, questionResponses: completedReviewResponses(), planningLogs }, allowUnresolved);
      setReviewDraft(null); setCreationOpen(false); setMessage(`${plan.name} saved. Open its graph when you are ready.`); setLogs(planningLogs); await refresh(); if (creationPage) window.location.replace('/studio');
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Workflow could not be saved.'); }
  }
  async function removeWorkflow(id: string) { const response = await fetch(`/api/workflows?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); if (!response.ok) { setMessage('Workflow could not be deleted.'); return; } setDeleteId(null); setMessage('Workflow deleted.'); await refresh(); }

  return <div className={creationPage ? 'dash-app workflow-creation-page' : 'dash-app'}>
    {reviewDraft && <ReviewModal draft={reviewDraft} skills={skills} busy={planningActive} onClose={() => setReviewDraft(null)} onReplan={() => void replanReviewed()} onKeepCurrent={() => void saveReviewed(false)} onContinueUnresolved={() => void saveReviewed(true)} onAnswerChange={(index, answer) => setReviewDraft({ ...reviewDraft, questionResponses: reviewDraft.questionResponses.map((response, candidateIndex) => candidateIndex === index ? { ...response, answer } : response) })} />}
    {usingWorkflow && <AssignmentModal workflow={usingWorkflow} projects={projects} skills={skills} onClose={() => setUsingWorkflow(null)} onReady={openAssignment} />}
    <header className="dash-header"><Link className="dash-brand" href="/studio" aria-label="Workflow Studio dashboard"><Image src="/workflow-studio-logo.png" alt="" width={48} height={30} priority /><span><strong>Workflow Studio</strong></span></Link><div className="dash-header-actions">{!creationPage && <nav className="studio-quick-nav" aria-label="Studio workspaces"><Link href="/runs" aria-label="Runs and monitoring">Runs</Link><Link href="/skills" aria-label="Skill registry">Skills</Link></nav>}{user && <ProfileMenu user={user} />}</div></header>
    <main id="main-content" tabIndex={-1} className="dash-main"><section className="dash-intro"><div><h1>Build reliable agent workflows</h1><p>A governed workflow studio for Codex agents working on real projects.</p></div><div className="dash-intro-actions"><CompanionDownload /><Link className="dash-button primary create-workflow" href="/workflows/new"><Icon name="plus" />Create workflow</Link></div></section><section className="dash-metrics"><div><span>Workflow library</span><strong>{workflows.length}</strong><small>Reusable definitions</small></div><div><span>Graph nodes</span><strong>{workflows.reduce((total, workflow) => total + workflow.nodes.length, 0)}</strong><small>Across all workflows</small></div><div><span>Skills in use</span><strong>{skillCount}</strong><small>{skills.length} available locally</small></div><div><span>Runtime</span><strong className="runtime-metric">{serviceOnline ? 'Ready' : 'Offline'}</strong><small>{runtimeMode === 'paired' ? 'Your paired Codex' : 'Local App Server'}</small></div></section>
        {creationOpen && <section className="create-panel"><form onSubmit={generate} noValidate><div className="dash-section-heading"><div><h2>Create a reusable workflow</h2><p>Build the workflow from explicit stages, decisions, approvals, rules, and outputs.</p></div><div className="example-select workflow-example-select"><SelectField ariaLabel="Use a workflow creation example" value={workflowExampleId} options={[{ value: '', label: 'Use workflow example' }, ...WORKFLOW_CREATION_EXAMPLES.map((example) => ({ value: example.id, label: example.label }))]} onChange={applyWorkflowExample} /></div></div><StructuredWorkflowFields form={form} errors={errors} onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))} onSettingsChange={(settings) => setForm((current) => ({ ...current, settings: { ...current.settings, ...settings } }))} />{(planningActive || logs.length > 0) && <section className={`creation-activity ${lifecycle}`} aria-live="polite"><header><div><Icon name="activity" /><div><h3>Codex activity</h3><p>{planningActive ? 'Generating your workflow' : lifecycle === 'success' ? 'Generation completed' : lifecycle === 'failure' ? 'Generation failed' : 'Generation activity'}</p></div></div><strong>{elapsedLabel(elapsedSeconds)}</strong></header><ol>{logs.map((entry, index) => <li key={`${index}-${entry}`}><span /> <code>{entry}</code></li>)}</ol></section>}<footer><p className={lifecycle === 'failure' ? 'create-message error' : 'create-message'}>{message}</p><div><button className="text-button" type="button" onClick={() => creationPage ? router.push('/studio') : setCreationOpen(false)}>Close</button><button className="dash-button primary" type="submit" disabled={planningActive || !planningRoot}>{planningActive ? 'Designing workflow…' : 'Generate workflow'}<Icon name="use" /></button></div></footer></form></section>}
        <section className="workflow-library"><div className="dash-section-heading"><div><h2>Your workflows</h2><p>Open a graph to edit it, or choose a project when you are ready to use it.</p></div><div><span>{workflows.length} total</span><button className="dash-button secondary" type="button" onClick={() => setCreationOpen(true)}><Icon name="plus" />New workflow</button></div></div>{workflows.length ? <div className="workflow-cards">{workflows.slice().reverse().map((workflow) => <article className="dash-workflow-card" key={workflow.id}><div className="card-top"><span className="dash-state"><i />{workflow.status === 'draft' ? 'Workflow draft' : workflow.status}</span><button className="dash-icon-button" type="button" aria-label={`Delete ${workflow.name}`} onClick={() => setDeleteId(workflow.id)}><Icon name="trash" /></button></div><h3>{workflow.name}</h3><p>{workflow.description || 'Reusable workflow definition'}</p><dl><div><dt>Nodes</dt><dd>{workflow.nodes.length}</dd></div><div><dt>Connections</dt><dd>{workflow.edges.length}</dd></div><div><dt>Skills</dt><dd>{new Set(workflow.nodes.flatMap((node) => node.skillIds)).size}</dd></div></dl><div className="card-meta"><span>Updated {workflow.updatedAt.slice(0, 10)}</span><span>Schema {workflow.schemaVersion}</span></div>{deleteId === workflow.id ? <div className="delete-panel"><p>Delete this workflow permanently?</p><div><button className="text-button" type="button" onClick={() => setDeleteId(null)}>Cancel</button><button className="dash-button danger" type="button" onClick={() => void removeWorkflow(workflow.id)}>Delete workflow</button></div></div> : <div className="card-actions"><Link className="dash-button secondary" href={`/workflows/${encodeURIComponent(workflow.id)}/graph`}><Icon name="graph" />Open graph</Link><button className="dash-button primary" type="button" onClick={() => setUsingWorkflow(workflow)}>Use workflow<Icon name="use" /></button></div>}</article>)}</div> : <div className="library-empty"><span><Icon name="graph" /></span><h3>No workflows yet</h3><p>Select Create workflow when you are ready. A project is chosen later, when you use it.</p></div>}</section>
        <WorkflowLibrary workflows={workflows} assignments={assignments} onUse={setUsingWorkflow} onDelete={removeWorkflow} />
    </main>
    <ProductFooter />
  </div>;
}
