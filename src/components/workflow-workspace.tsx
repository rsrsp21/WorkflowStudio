'use client';

import Image from 'next/image';
import { FormEvent, useEffect, useState } from 'react';
import type { WorkflowPlan } from '@/src/domain/models';
import { DEFAULT_PLANNING_EXECUTION_SETTINGS, validatePlanningRequest, type PlanningRequest } from '@/src/domain/planning';
import { canRetryPlanning, isPlanningActive, type PlanningLifecycle } from '@/src/domain/planning-lifecycle';
import type { Project, ProjectFolderInspection, ProjectFolderListing } from '@/src/domain/workspace';

const THEME_STORAGE_KEY = 'workflow-studio-theme';

type ScreenName = 'project' | 'workflow' | 'canvas' | 'harness' | 'monitor' | 'history';
export type ReviewDraft = { plan: WorkflowPlan; warnings: string[]; openQuestions: string[]; planningThreadId: string };

interface ProjectWorkspaceSelectorProps {
  projects: Project[];
  selectedProject: Project | null;
  pathValue: string;
  projectName: string;
  inspection: ProjectFolderInspection | null;
  listing: ProjectFolderListing | null;
  busy: boolean;
  error: string;
  nativePickerAvailable: boolean;
  onPathChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onAutofill: () => void;
  onInspect: () => void;
  onNativeSelect: () => void;
  onBrowse: (path?: string) => void;
  onCreateFolder: (name: string) => void;
  onConfirm: () => void;
  onSelectSaved: (project: Project) => void;
}

export function ProjectWorkspaceSelector(props: ProjectWorkspaceSelectorProps) {
  const [newFolderName, setNewFolderName] = useState('');
  const kindLabel = props.inspection?.workspaceKind === 'repository' ? 'Existing repository' : props.inspection?.workspaceKind === 'workspace' ? 'Existing workspace' : 'Empty folder';
  return <section className="panel project-panel" aria-labelledby="project-workspace-title"><div className="panel-heading"><div><span className="eyebrow">Project workspace</span><h2 id="project-workspace-title">Select and confirm a project root</h2></div><div className="heading-actions"><button className="secondary-button" type="button" onClick={props.onAutofill} disabled={props.busy}>Autofill fields</button><span className={props.selectedProject ? 'scope-status confirmed' : 'scope-status'}>{props.selectedProject ? 'CONFIRMED' : 'REQUIRED'}</span></div></div><p className="project-intro">Planning may inspect directory metadata and existing content in read-only mode. The confirmed root becomes the maximum workspace scope for later phases.</p><div className="project-selector-grid"><div><label htmlFor="project-name">Project name</label><input id="project-name" value={props.projectName} onChange={(event) => props.onNameChange(event.target.value)} placeholder="Policy review workspace" disabled={Boolean(props.selectedProject)} /><label htmlFor="project-root-path">Absolute project folder path</label><div className="path-action-row"><input id="project-root-path" value={props.pathValue} onChange={(event) => props.onPathChange(event.target.value)} placeholder="C:\projects\policy-docs" aria-describedby="project-path-help" /><button className="secondary-button" type="button" onClick={props.onInspect} disabled={props.busy || !props.pathValue.trim()}>Inspect</button></div><p className="helper" id="project-path-help">Inspection reads names and directory metadata only; it never opens file contents.</p><div className="folder-actions">{props.nativePickerAvailable && <button className="secondary-button" type="button" onClick={props.onNativeSelect} disabled={props.busy}>Choose folder…</button>}<button className="secondary-button" type="button" onClick={() => props.onBrowse()} disabled={props.busy}>Browse folders</button></div>{props.error && <p className="project-error" role="alert">{props.error}</p>}</div><div className="scope-preview">{props.selectedProject ? <><span className="summary-label">Confirmed access scope</span><strong>{props.selectedProject.name}</strong><code>{props.selectedProject.rootPath}</code><dl><div><dt>Folder type</dt><dd>{props.selectedProject.workspaceKind}</dd></div><div><dt>Planning access</dt><dd>Read-only</dd></div></dl></> : props.inspection ? <><span className="summary-label">Inspection result</span><strong>{kindLabel}</strong><code>{props.inspection.rootPath}</code><dl><div><dt>Entries</dt><dd>{props.inspection.entryCount}</dd></div><div><dt>Planning access</dt><dd>Read-only</dd></div></dl><button className="confirm-root-button" type="button" onClick={props.onConfirm} disabled={props.busy || !props.projectName.trim()}>Confirm project root</button></> : <><span className="summary-label">Access scope</span><strong>No project confirmed</strong><p>Select or inspect a folder to see its type and read-only planning boundary.</p></>}</div></div>{props.listing && <div className="folder-browser" aria-label="Controlled folder browser"><div className="folder-browser-heading"><div><span className="summary-label">Directory-only browser</span><code>{props.listing.rootPath}</code></div>{props.listing.parentPath && <button className="secondary-button" type="button" onClick={() => props.onBrowse(props.listing?.parentPath ?? undefined)}>Up one level</button>}</div><div className="folder-list">{props.listing.directories.length ? props.listing.directories.map((directory) => <button type="button" key={directory.path} onClick={() => props.onBrowse(directory.path)}><span aria-hidden="true">▣</span>{directory.name}</button>) : <p className="empty-state">This folder has no child directories.</p>}</div><div className="create-folder-row"><input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="New empty project folder" aria-label="New empty project folder name" /><button className="secondary-button" type="button" disabled={props.busy || !newFolderName.trim()} onClick={() => { props.onCreateFolder(newFolderName); setNewFolderName(''); }}>Create empty folder</button><button className="secondary-button" type="button" onClick={props.onInspect}>Use this folder</button></div></div>}{props.projects.length > 0 && <div className="saved-projects"><span className="summary-label">Saved projects</span><div>{props.projects.map((project) => <button type="button" key={project.id} onClick={() => props.onSelectSaved(project)}><strong>{project.name}</strong><small>{project.rootPath}</small><span>{project.workspaceKind}</span></button>)}</div></div>}</section>;
}

function activityText(event: { type?: string; message?: string; raw?: string }) {
  if (event.message) return event.message;
  const raw = event.raw ?? '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed.type === 'thread.started') return `Codex thread started · ${parsed.thread_id ?? parsed.threadId ?? 'connected'}`;
    if (parsed.type === 'turn.started') return 'Codex turn started';
    if (parsed.type === 'turn.completed') return 'Codex turn completed';
    if (parsed.type === 'item.started' || parsed.type === 'item.completed') return '';
    if (parsed.type === 'turn.failed' || parsed.type === 'error') return `Codex reported an error · ${parsed.error?.message ?? parsed.message ?? 'request failed'}`;
    if (parsed.type) return `Codex event · ${parsed.type.replaceAll('_', ' ')}`;
  } catch {
    // Keep non-JSON stderr/stdout lines readable below.
  }
  return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
}

export function PlanSummary({ draft, onQuestionsChange, onBack, onSave }: { draft: ReviewDraft; onQuestionsChange: (questions: string[]) => void; onBack: () => void; onSave: () => void }) {
  const { plan } = draft;
  return <section className="review-overlay" aria-label="Planning review"><div className="review-card summary-card"><div className="panel-heading"><div><span className="eyebrow">Review before save</span><h2>{plan.name}</h2></div><span className="workflow-status">{plan.status}</span></div><p className="review-intro">Confirm what Codex interpreted before this draft moves to graph review.</p><div className="summary-stats"><div><strong>{plan.nodes.length}</strong><span>Stages</span></div><div><strong>{plan.edges.length}</strong><span>Connections</span></div><div><strong>{plan.completionCriteria.length}</strong><span>Completion checks</span></div></div><div className="summary-grid"><section className="summary-section summary-wide"><span className="summary-label">Interpreted intent</span><p>{plan.description || 'No interpreted summary was provided.'}</p></section><section className="summary-section summary-wide"><span className="summary-label">Original planning prompt</span><p className="prompt-copy">{plan.planningPrompt}</p></section><section className="summary-section"><span className="summary-label">Constraints</span>{plan.constraints.length ? <ul>{plan.constraints.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="summary-empty">No constraints.</p>}</section><section className="summary-section"><span className="summary-label">Completion criteria</span>{plan.completionCriteria.length ? <ul>{plan.completionCriteria.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="summary-empty">No completion criteria.</p>}</section><section className="summary-section summary-wide"><span className="summary-label">Proposed stages</span><div className="stage-list">{plan.nodes.map((node, index) => <article className="stage-row" key={node.id}><span className="stage-index">{String(index + 1).padStart(2, '0')}</span><div><div className="stage-title"><strong>{node.name}</strong><span>{node.type}</span></div><p>{node.prompt || 'No stage instructions.'}</p><dl><div><dt>Inputs</dt><dd>{node.inputKeys.join(', ') || 'None'}</dd></div><div><dt>Outputs</dt><dd>{node.outputKeys.join(', ') || 'None'}</dd></div><div><dt>Skills</dt><dd>{node.skillIds.join(', ') || 'None assigned'}</dd></div></dl></div></article>)}</div></section><section className="summary-section"><span className="summary-label">Generated assumptions & warnings</span>{draft.warnings.length ? <ul className="warning-list">{draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p className="summary-empty">No warnings returned.</p>}</section><section className="summary-section"><label className="summary-label" htmlFor="review-open-questions">Open questions</label><textarea id="review-open-questions" rows={5} value={draft.openQuestions.join('\n')} onChange={(event) => onQuestionsChange(event.target.value.split('\n').map((line) => line.trim()).filter(Boolean))} placeholder="No open questions." /></section><section className="summary-section summary-wide trace-section"><span className="summary-label">Traceability</span><dl><div><dt>Planning thread</dt><dd>{draft.planningThreadId}</dd></div><div><dt>Plan ID</dt><dd>{plan.id}</dd></div><div><dt>Workspace</dt><dd>{plan.workspacePath}</dd></div></dl></section></div><div className="review-actions"><button className="secondary-button" type="button" onClick={onBack}>Refine request</button><button className="primary-review-button" type="button" onClick={onSave}>Save reviewed plan</button></div></div></section>;
}

export function GraphReviewHandoff({ draft, onRefine, onStartOver, embedded = false }: { draft: ReviewDraft; onRefine: () => void; onStartOver: () => void; embedded?: boolean }) {
  const [showGraph, setShowGraph] = useState(false);
  const { plan } = draft;
  return <section className={embedded ? 'graph-review-embedded' : 'review-overlay'} aria-label="Graph review handoff"><div className="review-card graph-review-card"><div className="panel-heading"><div><h2>Draft ready for graph review</h2></div><span className="workflow-status">draft only</span></div><p className="review-intro">The validated plan is saved locally. Nothing has been compiled or executed.</p><div className="handoff-summary"><div><span>Plan</span><strong>{plan.name}</strong></div><div><span>Stages</span><strong>{plan.nodes.length}</strong></div><div><span>Connections</span><strong>{plan.edges.length}</strong></div></div>{showGraph && <div className="graph-preview"><div className="graph-nodes">{plan.nodes.map((node, index) => <article key={node.id}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{node.name}</strong><small>{node.type} · {node.id}</small></div></article>)}</div><div className="edge-list"><span className="summary-label">Connections</span>{plan.edges.length ? plan.edges.map((edge, index) => <p key={`${edge.from}-${edge.to}-${index}`}><code>{edge.from}</code><span aria-hidden="true">→</span><code>{edge.to}</code>{edge.condition && <small>{edge.condition}</small>}</p>) : <p className="summary-empty">No connections proposed.</p>}</div></div>}<div className="handoff-actions"><button className="secondary-button" type="button" onClick={onStartOver}>Start over</button><button className="secondary-button" type="button" onClick={onRefine}>Refine plan</button><button className="primary-review-button" type="button" onClick={() => setShowGraph(true)} disabled={showGraph}>Review graph</button><button className="compile-button" type="button" disabled title="Compilation becomes available after graph review is implemented.">Approve and compile</button></div><p className="compile-note">Approval and compilation remain locked until the graph-review phase.</p></div></section>;
}

export function WorkflowHistory({ workflows, pendingDeleteId, deleting, onRequestDelete, onCancelDelete, onConfirmDelete }: { workflows: WorkflowPlan[]; pendingDeleteId: string | null; deleting: boolean; onRequestDelete: (id: string) => void; onCancelDelete: () => void; onConfirmDelete: (id: string) => void }) {
  if (workflows.length === 0) return <p className="empty-state">No saved workflows yet.</p>;
  return <div className="workflow-list">{workflows.slice().reverse().map((workflow) => <article className="workflow-row" key={workflow.id}><div className="workflow-row-copy"><strong>{workflow.name}</strong><small>{workflow.workspacePath} · Schema v{workflow.schemaVersion}</small></div><div className="workflow-row-actions"><span className="workflow-status">{workflow.status}</span>{pendingDeleteId === workflow.id ? <div className="delete-confirmation" role="group" aria-label={`Confirm deletion of ${workflow.name}`}><span>This cannot be undone.</span><button className="secondary-button" type="button" onClick={onCancelDelete} disabled={deleting}>Cancel</button><button className="delete-confirm-button" type="button" onClick={() => onConfirmDelete(workflow.id)} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button></div> : <button className="delete-workflow-button" type="button" onClick={() => onRequestDelete(workflow.id)} aria-label={`Delete ${workflow.name}`}>Delete</button>}</div></article>)}</div>;
}

export default function WorkflowWorkspace() {
  const [activeScreen, setActiveScreen] = useState<ScreenName>('project');
  const [workflows, setWorkflows] = useState<WorkflowPlan[]>([]);
  const [pendingWorkflowDelete, setPendingWorkflowDelete] = useState<string | null>(null);
  const [deletingWorkflow, setDeletingWorkflow] = useState(false);
  const [historyMessage, setHistoryMessage] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectPath, setProjectPath] = useState('');
  const [projectName, setProjectName] = useState('');
  const [folderInspection, setFolderInspection] = useState<ProjectFolderInspection | null>(null);
  const [folderListing, setFolderListing] = useState<ProjectFolderListing | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [nativePickerAvailable, setNativePickerAvailable] = useState(false);
  const [message, setMessage] = useState('');
  const [serviceOnline, setServiceOnline] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean | null>(null);
  const [formValues, setFormValues] = useState({
    workflowName: 'Requirements review', planningPrompt: '', workspacePath: '', constraints: '', outputRequirements: '',
    executionSettings: DEFAULT_PLANNING_EXECUTION_SETTINGS
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [liveEvents, setLiveEvents] = useState<string[]>([]);
  const [lifecycle, setLifecycle] = useState<PlanningLifecycle>('idle');
  const [lastRequest, setLastRequest] = useState<PlanningRequest | null>(null);
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft | null>(null);
  const [handoffDraft, setHandoffDraft] = useState<ReviewDraft | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      setDarkMode(storedTheme ? storedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
      setNativePickerAvailable(Boolean(window.workflowStudio?.selectFolder));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { if (darkMode !== null) document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'; }, [darkMode]);
  function toggleTheme() { setDarkMode((current) => { const next = !(current ?? false); window.localStorage.setItem(THEME_STORAGE_KEY, next ? 'dark' : 'light'); document.cookie = `${THEME_STORAGE_KEY}=${next ? 'dark' : 'light'}; Path=/; Max-Age=31536000; SameSite=Lax`; return next; }); }
  async function refresh() {
    const [workflowResponse, projectResponse] = await Promise.all([fetch('/api/workflows'), fetch('/api/projects')]);
    if (workflowResponse.ok) setWorkflows((await workflowResponse.json()).workflows);
    if (projectResponse.ok) setProjects((await projectResponse.json()).projects);
  }
  useEffect(() => {
    void fetch('/api/health').then((response) => setServiceOnline(response.ok)).catch(() => setServiceOnline(false));
    void Promise.all([fetch('/api/workflows'), fetch('/api/projects')])
      .then(async ([workflowResponse, projectResponse]) => {
        if (workflowResponse.ok) setWorkflows((await workflowResponse.json()).workflows);
        if (projectResponse.ok) setProjects((await projectResponse.json()).projects);
      })
      .catch(() => setMessage('Local service is unavailable.'));
  }, []);

  function updateField(field: 'workflowName' | 'planningPrompt' | 'workspacePath' | 'constraints' | 'outputRequirements', value: string) {
    setFormValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => { const next = { ...current }; delete next[field]; return next; });
  }
  function lines(value: string) { return value.split('\n').map((line) => line.trim()).filter(Boolean); }
  function error(id: string) { return fieldErrors[id]?.[0]; }

  function suggestedProjectName(rootPath: string) {
    return rootPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'Untitled project';
  }

  function changeProjectPath(value: string) {
    setProjectPath(value); setFolderInspection(null); setSelectedProject(null); setProjectError('');
    updateField('workspacePath', '');
  }

  async function autofillProject() {
    setProjectBusy(true); setProjectError(''); setSelectedProject(null); updateField('workspacePath', '');
    try {
      const response = await fetch('/api/projects/inspect');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Project fields could not be autofilled.');
      const inspection = result.inspection as ProjectFolderInspection;
      setProjectPath(inspection.rootPath); setProjectName(result.projectName || suggestedProjectName(inspection.rootPath)); setFolderInspection(inspection); setFolderListing(null);
    } catch (error) { setFolderInspection(null); setProjectError(error instanceof Error ? error.message : 'Project fields could not be autofilled.'); }
    finally { setProjectBusy(false); }
  }

  async function inspectFolder(rootPath = projectPath) {
    if (!rootPath.trim()) return;
    setProjectBusy(true); setProjectError(''); setSelectedProject(null); updateField('workspacePath', '');
    try {
      const response = await fetch('/api/projects/inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rootPath }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Project folder inspection failed.');
      const inspection = result.inspection as ProjectFolderInspection;
      setProjectPath(inspection.rootPath); setFolderInspection(inspection); setFolderListing(null);
      if (!projectName.trim()) setProjectName(suggestedProjectName(inspection.rootPath));
    } catch (error) { setFolderInspection(null); setProjectError(error instanceof Error ? error.message : 'Project folder inspection failed.'); }
    finally { setProjectBusy(false); }
  }

  async function selectNativeFolder() {
    try {
      const rootPath = await window.workflowStudio?.selectFolder();
      if (!rootPath) return;
      setProjectPath(rootPath); setProjectName(suggestedProjectName(rootPath));
      await inspectFolder(rootPath);
    } catch (error) { setProjectError(error instanceof Error ? error.message : 'Native folder picker is unavailable.'); }
  }

  async function browseFolders(rootPath = projectPath) {
    setProjectBusy(true); setProjectError('');
    try {
      const response = await fetch(rootPath.trim() ? `/api/projects/folders?path=${encodeURIComponent(rootPath)}` : '/api/projects/folders');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Folder browser is unavailable.');
      const listing = result.listing as ProjectFolderListing;
      setFolderListing(listing); setProjectPath(listing.rootPath); setFolderInspection(null); setSelectedProject(null); updateField('workspacePath', '');
    } catch (error) { setProjectError(error instanceof Error ? error.message : 'Folder browser is unavailable.'); }
    finally { setProjectBusy(false); }
  }

  async function createEmptyFolder(folderName: string) {
    if (!folderListing) return;
    setProjectBusy(true); setProjectError('');
    try {
      const response = await fetch('/api/projects/folders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parentPath: folderListing.rootPath, folderName }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Empty project folder could not be created.');
      const inspection = result.inspection as ProjectFolderInspection;
      setProjectPath(inspection.rootPath); setProjectName(folderName.trim()); setFolderInspection(inspection); setFolderListing(null); setSelectedProject(null); updateField('workspacePath', '');
    } catch (error) { setProjectError(error instanceof Error ? error.message : 'Empty project folder could not be created.'); }
    finally { setProjectBusy(false); }
  }

  async function confirmProjectRoot() {
    if (!folderInspection || !projectName.trim()) return;
    setProjectBusy(true); setProjectError('');
    try {
      const response = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: projectName, rootPath: folderInspection.rootPath }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || result.errors?.[0] || 'Project root could not be confirmed.');
      const project = result.project as Project;
      setSelectedProject(project); setProjectPath(project.rootPath); updateField('workspacePath', project.rootPath); setActiveScreen('workflow'); setMessage(`Project root confirmed with read-only planning access: ${project.rootPath}`);
      await refresh();
    } catch (error) { setProjectError(error instanceof Error ? error.message : 'Project root could not be confirmed.'); }
    finally { setProjectBusy(false); }
  }

  async function selectSavedProject(project: Project) {
    setProjectPath(project.rootPath); setProjectName(project.name); setProjectBusy(true); setProjectError('');
    try {
      const response = await fetch('/api/projects/inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rootPath: project.rootPath }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Saved project folder is unavailable.');
      setFolderInspection(result.inspection); setFolderListing(null); setSelectedProject(project); updateField('workspacePath', project.rootPath); setActiveScreen('workflow'); setMessage(`Project root confirmed with read-only planning access: ${project.rootPath}`);
    } catch (error) { setSelectedProject(null); updateField('workspacePath', ''); setProjectError(error instanceof Error ? error.message : 'Saved project folder is unavailable.'); }
    finally { setProjectBusy(false); }
  }

  function autofillExample() {
    setFormValues({
      workflowName: 'Workflow Studio MVP review',
      planningPrompt: 'Review this project against its requirements and phase planning documents. Identify the current implementation status, missing features, risks, and recommended next development tasks. Do not modify files. Return a structured workflow plan with stages for inspection, gap analysis, recommendations, and validation.',
      workspacePath: selectedProject?.rootPath ?? '',
      constraints: 'Do not modify files.\nDo not execute destructive commands.\nAsk questions instead of inventing missing requirements.',
      outputRequirements: 'Current implementation summary\nMissing features and gaps\nRisk list\nRecommended next tasks\nValidation criteria\nOpen questions',
      executionSettings: DEFAULT_PLANNING_EXECUTION_SETTINGS
    });
    setFieldErrors({}); setMessage('Workflow fields autofilled. Review them before generating a plan.'); setLiveEvents([]);
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lifecycle === 'submitting' || lifecycle === 'receiving') return;
    if (!selectedProject || formValues.workspacePath !== selectedProject.rootPath) { setFieldErrors((current) => ({ ...current, workspacePath: ['Select and confirm a project root before planning.'] })); setMessage('Confirm the project root before generating a plan.'); return; }
    const request: PlanningRequest = { workflowName: formValues.workflowName, planningPrompt: formValues.planningPrompt, workspacePath: formValues.workspacePath, constraints: lines(formValues.constraints), outputRequirements: lines(formValues.outputRequirements), executionSettings: formValues.executionSettings };
    const errors = validatePlanningRequest(request);
    if (Object.keys(errors).length) { setFieldErrors(errors); setMessage('Please correct the highlighted fields.'); return; }
    setFieldErrors({}); setLastRequest(request); setLifecycle('submitting'); setLiveEvents(['Starting Codex App Server planning...']); setMessage('Submitting request...');
    try {
      const response = await fetch('/api/planning/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      if (!response.ok) { const result = await response.json().catch(() => ({})); setLifecycle(result.error?.code === 'TIMEOUT' ? 'timeout' : 'failure'); setMessage(result.error?.message || 'Could not generate a plan. Your entries are still here.'); return; }
      if (!response.body) throw new Error('Planning stream is unavailable.');
      setLifecycle('receiving'); setMessage('Codex is planning...'); const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      let planResult: { plan: WorkflowPlan; warnings?: string[]; openQuestions?: string[]; trace: { planningThreadId: string } } | undefined;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true });
        const messages = buffer.split('\n\n'); buffer = messages.pop() ?? '';
        for (const message of messages) {
          if (!message.startsWith('data: ')) continue;
          const event = JSON.parse(message.slice(6));
          if (event.message || event.raw) {
            const activity = activityText(event);
            if (activity) setLiveEvents((current) => [...current, activity]);
          }
          if (event.type === 'planning.completed') planResult = event.result;
          if (event.type === 'planning.failed') { setLifecycle(event.error?.code === 'TIMEOUT' ? 'timeout' : 'failure'); throw new Error(event.error?.message || 'Codex planning failed.'); }
        }
      }
      if (!planResult) throw new Error('Codex App Server ended without a planning result.');
      setReviewDraft({ plan: planResult.plan, warnings: planResult.warnings ?? [], openQuestions: planResult.openQuestions ?? planResult.plan.openQuestions, planningThreadId: planResult.trace.planningThreadId });
      setMessage('Plan generated. Review warnings and open questions before saving.');
    } catch (error) { setLifecycle((current) => current === 'timeout' ? current : 'failure'); setMessage(error instanceof Error ? `${error.message} Your entries are still here.` : 'Planning failed. Your entries are still here.'); }
  }

  const planningActive = isPlanningActive(lifecycle);
  const lifecycleLabel: Record<PlanningLifecycle, string> = { idle: 'Ready', submitting: 'Submitting', receiving: 'Receiving', success: 'Success', failure: 'Failed', timeout: 'Timed out' };
  function retryPlanning() { if (lastRequest) void saveDraft({ preventDefault: () => undefined } as FormEvent<HTMLFormElement>); }
  async function saveReviewedPlan() {
    if (!reviewDraft) return;
    const plan = { ...reviewDraft.plan, openQuestions: reviewDraft.openQuestions.filter(Boolean) };
    const saved = await fetch('/api/workflows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(plan) });
    if (!saved.ok) { setMessage('The reviewed plan could not be saved. Your review is still open.'); return; }
    setHandoffDraft({ ...reviewDraft, plan }); setReviewDraft(null); setActiveScreen('canvas'); setLifecycle('success'); setLiveEvents((current) => [...current, 'Validated reviewed plan saved locally.']); setMessage(`Plan saved locally. Thread: ${reviewDraft.planningThreadId}`);
    await refresh();
  }

  async function deleteWorkflow(id: string) {
    setDeletingWorkflow(true); setHistoryMessage('');
    try {
      const response = await fetch(`/api/workflows?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Workflow could not be deleted.');
      setWorkflows((current) => current.filter((workflow) => workflow.id !== id));
      setPendingWorkflowDelete(null); setHistoryMessage('Workflow deleted.');
    } catch (error) { setHistoryMessage(error instanceof Error ? error.message : 'Workflow could not be deleted.'); }
    finally { setDeletingWorkflow(false); }
  }

  function refinePlan() { if (handoffDraft) { setActiveScreen('workflow'); setReviewDraft(handoffDraft); setHandoffDraft(null); } }
  function startOver() {
    setReviewDraft(null); setHandoffDraft(null); setActiveScreen(selectedProject ? 'workflow' : 'project'); setLastRequest(null); setLifecycle('idle'); setLiveEvents([]); setMessage('Ready for a new planning request.');
    setFormValues({ workflowName: 'Requirements review', planningPrompt: '', workspacePath: selectedProject?.rootPath ?? '', constraints: '', outputRequirements: '', executionSettings: DEFAULT_PLANNING_EXECUTION_SETTINGS });
  }

  return (
    <>
      {reviewDraft && <PlanSummary draft={reviewDraft} onQuestionsChange={(openQuestions) => setReviewDraft({ ...reviewDraft, openQuestions })} onBack={() => setReviewDraft(null)} onSave={() => void saveReviewedPlan()} />}
      {canRetryPlanning(lifecycle) && lastRequest && <button className="retry-button" type="button" onClick={retryPlanning}>Retry planning</button>}
      <header className="topbar">
        <button className="brand brand-button" type="button" onClick={() => setActiveScreen('project')}><Image className="brand-logo" src="/workflow-studio-logo.png" alt="" width={48} height={24} priority /><span>Workflow Studio</span></button>
        <div className="top-actions"><span className="connection"><span className="status-dot" />{serviceOnline ? 'Local mode' : 'Service offline'}</span><button className="icon-button" type="button" aria-label="Toggle dark mode" onClick={toggleTheme}>{darkMode ? '☀' : '☾'}</button><span className="avatar">SC</span></div>
      </header>
      <main id="main-content" tabIndex={-1} className="shell">
        <section className="content" aria-label={`${activeScreen} screen`}>
          {activeScreen === 'project' && <div className="screen-view" id="project-screen">
            <div className="page-heading"><div><div className="breadcrumb">Project</div><h1>Choose a project folder</h1><p>Select the local folder that will define the workflow’s workspace boundary.</p></div></div>
            <ProjectWorkspaceSelector projects={projects} selectedProject={selectedProject} pathValue={projectPath} projectName={projectName} inspection={folderInspection} listing={folderListing} busy={projectBusy} error={projectError} nativePickerAvailable={nativePickerAvailable} onPathChange={changeProjectPath} onNameChange={setProjectName} onAutofill={() => void autofillProject()} onInspect={() => void inspectFolder()} onNativeSelect={() => void selectNativeFolder()} onBrowse={(rootPath) => void browseFolders(rootPath)} onCreateFolder={(name) => void createEmptyFolder(name)} onConfirm={() => void confirmProjectRoot()} onSelectSaved={(project) => void selectSavedProject(project)} />
          </div>}
          {activeScreen === 'workflow' && <div className="screen-view" id="workflow-screen">
            <div className="page-heading"><div><div className="breadcrumb">Workflow</div><h1>Describe the workflow plan</h1><p>Define the work Codex should plan inside the confirmed project root.</p></div></div>
            {selectedProject && <div className="workflow-project-context"><div><span>Project</span><strong>{selectedProject.name}</strong><code>{selectedProject.rootPath}</code></div><button className="secondary-button" type="button" onClick={() => setActiveScreen('project')}>Change project</button></div>}
            <form className="panel form-panel workspace-form" onSubmit={saveDraft} noValidate><div className="panel-heading"><div><h2>Workflow details</h2></div><button className="secondary-button" type="button" onClick={autofillExample} aria-label="Autofill workflow fields with an editable example">Autofill fields</button></div>
              <label htmlFor="workflow-name">Workflow name</label><input id="workflow-name" value={formValues.workflowName} onChange={(event) => updateField('workflowName', event.target.value)} aria-invalid={Boolean(error('workflowName'))} aria-describedby={error('workflowName') ? 'workflow-name-error' : undefined} required />{error('workflowName') && <p className="field-error" id="workflow-name-error">{error('workflowName')}</p>}
              <label htmlFor="planning-prompt">Natural-language workflow description</label><textarea id="planning-prompt" rows={7} value={formValues.planningPrompt} onChange={(event) => updateField('planningPrompt', event.target.value)} aria-invalid={Boolean(error('planningPrompt'))} aria-describedby={error('planningPrompt') ? 'planning-prompt-error' : undefined} required placeholder="Review a product idea, generate requirements, ask for approval, and validate the result." />{error('planningPrompt') && <p className="field-error" id="planning-prompt-error">{error('planningPrompt')}</p>}
              <label htmlFor="workspace-path">Confirmed project root</label><input id="workspace-path" value={formValues.workspacePath} readOnly aria-invalid={Boolean(error('workspacePath'))} aria-describedby={error('workspacePath') ? 'workspace-path-error' : 'workspace-path-confirmation-help'} placeholder="Confirm a project folder above" required /><p className="helper" id="workspace-path-confirmation-help">Planning access is read-only and scoped to this exact root.</p>{error('workspacePath') && <p className="field-error" id="workspace-path-error">{error('workspacePath')}</p>}
              <label htmlFor="constraints">Constraints <span className="optional">Optional - one per line</span></label><textarea id="constraints" rows={3} value={formValues.constraints} onChange={(event) => updateField('constraints', event.target.value)} placeholder="Do not modify files before approval" />
              <label htmlFor="output-requirements">Desired outputs <span className="optional">Optional - one per line</span></label><textarea id="output-requirements" rows={3} value={formValues.outputRequirements} onChange={(event) => updateField('outputRequirements', event.target.value)} placeholder={'Requirements document\nValidation summary'} />
              <div className="form-footer"><span className="helper">The complete request will be saved locally for review.</span><button type="submit" disabled={!selectedProject || planningActive}>Generate plan <span aria-hidden="true">→</span></button></div><p className="form-message" role="status" aria-live="polite">{message}</p>
            </form>
          </div>}
          {activeScreen === 'canvas' && <div className="screen-view" id="canvas-screen"><div className="page-heading"><div><div className="breadcrumb">Canvas</div><h1>Review the workflow graph</h1><p>Inspect the validated plan before compilation or execution.</p></div></div>{handoffDraft ? <GraphReviewHandoff draft={handoffDraft} onRefine={refinePlan} onStartOver={startOver} embedded /> : <section className="panel empty-screen-panel"><h2>No graph ready for review</h2><p>Generate and save a workflow plan from the Workflow screen first.</p><button className="secondary-button" type="button" onClick={() => setActiveScreen(selectedProject ? 'workflow' : 'project')}>{selectedProject ? 'Go to Workflow' : 'Choose a project'}</button></section>}</div>}
          {activeScreen === 'harness' && <div className="screen-view" id="harness-screen"><div className="page-heading"><div><div className="breadcrumb">Harness</div><h1>Execution guardrails</h1><p>Review the safety settings applied to the current workflow draft.</p></div></div><aside className="panel harness-panel"><div className="panel-heading"><div><h2>Guardrails</h2></div></div><div className="guardrail"><span>Sandbox mode</span><strong>{formValues.executionSettings.sandboxMode}</strong></div><div className="guardrail"><span>Maximum retries</span><strong>{formValues.executionSettings.maxRetries}</strong></div><div className="guardrail"><span>Concurrency</span><strong>{formValues.executionSettings.maxConcurrentNodes}</strong></div><div className="guardrail"><span>Destructive actions</span><strong>{formValues.executionSettings.approvalPolicy === 'always' ? 'Approval required' : formValues.executionSettings.approvalPolicy === 'never' ? 'No approval' : 'Approval required for destructive actions'}</strong></div><div className="notice"><strong>Local-first foundation</strong><p>Codex and Mastra adapters remain isolated behind runtime boundaries.</p></div></aside></div>}
          {activeScreen === 'monitor' && <div className="screen-view" id="monitor-screen"><div className="page-heading"><div><div className="breadcrumb">Monitor</div><h1>Codex activity</h1><p>Follow planning events and provider output for the current request.</p></div><span className="live-indicator">{planningActive ? 'Receiving updates' : lifecycleLabel[lifecycle]}</span></div><section className="panel live-panel" aria-live="polite" aria-label="Codex activity"><div className="panel-heading"><div><h2>Planning events</h2></div></div><div className="live-events">{liveEvents.length ? liveEvents.map((event, index) => <p key={`${event}-${index}`}>{event}</p>) : <p className="empty-state">Codex activity will appear here when planning starts.</p>}</div></section></div>}
          {activeScreen === 'history' && <div className="screen-view" id="history-screen"><div className="page-heading"><div><div className="breadcrumb">History</div><h1>Saved workflows</h1><p>Review or remove locally saved workflow plans.</p></div><span className="count">{workflows.length}</span></div>{historyMessage && <p className="history-message" role="status">{historyMessage}</p>}<section className="panel saved-panel"><WorkflowHistory workflows={workflows} pendingDeleteId={pendingWorkflowDelete} deleting={deletingWorkflow} onRequestDelete={(id) => { setPendingWorkflowDelete(id); setHistoryMessage(''); }} onCancelDelete={() => setPendingWorkflowDelete(null)} onConfirmDelete={(id) => void deleteWorkflow(id)} /></section></div>}
        </section>
      </main>
    </>
  );
}
