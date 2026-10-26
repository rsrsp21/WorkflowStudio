'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { workflowExternalInputKeys, type WorkflowPlan } from '@/src/domain/models';
import type { Project, ProjectFolderInspection, ProjectWorkflow, Skill } from '@/src/domain/workspace';
import UiIcon from './ui-icon';

function splitValues(value: string) {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

export async function verifyProjectRoot(rootPath: string) {
  const response = await fetch('/api/projects/inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rootPath }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.errors?.[0] || 'The connected companion cannot access this project folder.');
}

export default function AssignmentModal({ workflow, projects, skills, onClose, onReady }: {
  workflow: WorkflowPlan;
  projects: Project[];
  skills: Skill[];
  onClose: () => void;
  onReady: (assignment: ProjectWorkflow, project: Project) => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [rootPath, setRootPath] = useState('');
  const [name, setName] = useState('');
  const [inspection, setInspection] = useState<ProjectFolderInspection | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => Array.from(new Set(workflow.nodes.flatMap((node) => node.skillIds))).filter((id) => skills.some((skill) => skill.id === id && skill.status === 'published')));
  const [sandboxMode, setSandboxMode] = useState<ProjectWorkflow['permissions']['sandboxMode']>(workflow.harness.sandboxMode);
  const [tools, setTools] = useState(workflow.harness.allowedTools.join(', '));
  const [approvalRequired, setApprovalRequired] = useState(workflow.harness.requireApprovalForDestructiveActions);
  const [workspaceWriteConfirmed, setWorkspaceWriteConfirmed] = useState(false);
  const [destructiveBypassConfirmed, setDestructiveBypassConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [referenceTime, setReferenceTime] = useState(0);
  const creationOperation = useRef<{ fingerprint: string; key: string } | null>(null);
  const externalInputs = useMemo(() => workflowExternalInputKeys(workflow), [workflow]);

  useEffect(() => { const timer = window.setTimeout(() => setReferenceTime(Date.now()), 0); return () => window.clearTimeout(timer); }, []);

  function selectProject(nextProject: Project) {
    setProject(nextProject);
  }

  async function selectSavedProject(nextProject: Project) {
    setBusy(true); setError('');
    try {
      await verifyProjectRoot(nextProject.rootPath);
      selectProject(nextProject);
    } catch (caught) {
      setError(`Saved project is not accessible: ${caught instanceof Error ? caught.message : 'Folder inspection failed.'} Select a project allowed by the current companion, or reconnect the companion configured for this saved folder.`);
    } finally { setBusy(false); }
  }

  const eligibleSkills = useMemo(() => skills.filter((skill) => skill.status === 'published' && (
    skill.scope.kind === 'global' || skill.scope.kind === 'workflow' && skill.scope.workflowId === workflow.id || skill.scope.kind === 'project' && skill.scope.projectId === project?.id
  )), [project?.id, skills, workflow.id]);
  const selected = selectedIds.flatMap((id) => eligibleSkills.find((skill) => skill.id === id) ?? []);
  const requiredPermissions = Array.from(new Set(selected.flatMap((skill) => skill.requiredPermissions)));
  const allowedTools = splitValues(tools);
  const missingPermissions = requiredPermissions.filter((permission) => !allowedTools.includes(permission));
  const contextTokens = selected.reduce((total, skill) => total + skill.estimatedContextTokens, 0);
  const stale = selected.filter((skill) => referenceTime > 0 && referenceTime - Date.parse(skill.updatedAt) > 180 * 24 * 60 * 60 * 1000);
  const triggerCounts = selected.flatMap((skill) => skill.triggers.map((trigger) => trigger.toLowerCase())).reduce<Record<string, number>>((counts, trigger) => ({ ...counts, [trigger]: (counts[trigger] ?? 0) + 1 }), {});
  const overlappingTriggers = Object.entries(triggerCounts).filter(([, count]) => count > 1).map(([trigger]) => trigger);

  async function inspect(pathValue = rootPath) {
    if (!pathValue.trim()) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/projects/inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rootPath: pathValue }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Folder inspection failed.');
      setInspection(result.inspection); setRootPath(result.inspection.rootPath);
      if (!name) setName(result.inspection.rootPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'Project');
    } catch (caught) { setInspection(null); setError(caught instanceof Error ? caught.message : 'Folder inspection failed.'); }
    finally { setBusy(false); }
  }

  async function autofillAppFolder() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/projects/inspect'); const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'App folder could not be inspected.');
      setRootPath(result.inspection.rootPath); setName(result.projectName); setInspection(result.inspection);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'App folder could not be inspected.'); }
    finally { setBusy(false); }
  }

  async function confirmProject() {
    if (!inspection || !name.trim()) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, rootPath: inspection.rootPath }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || result.errors?.[0]);
      selectProject(result.project);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Project could not be selected.'); }
    finally { setBusy(false); }
  }

  function move(id: string, direction: -1 | 1) {
    setSelectedIds((current) => {
      const index = current.indexOf(id); const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next;
    });
  }

  async function createAssignment() {
    if (!project || missingPermissions.length) return;
    setBusy(true); setError('');
    try {
      // Recheck in case the companion or its permitted folders changed during configuration.
      await verifyProjectRoot(project.rootPath);
      const payload = {
        projectId: project.id,
        workflowId: workflow.id,
        selectedSkillIds: selectedIds,
        inputOverrides: {},
        permissions: { sandboxMode, allowedTools, allowedWorkspacePaths: [project.rootPath], requireApprovalForDestructiveActions: approvalRequired },
        confirmWorkspaceWrite: workspaceWriteConfirmed,
        confirmDestructiveBypass: destructiveBypassConfirmed
      };
      const fingerprint = JSON.stringify(payload);
      if (creationOperation.current?.fingerprint !== fingerprint) creationOperation.current = { fingerprint, key: crypto.randomUUID() };
      const response = await fetch('/api/assignments', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, idempotencyKey: creationOperation.current.key })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.[0] || 'Assignment could not be created.');
      onReady(result.assignment, project);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Assignment could not be created.'); }
    finally { setBusy(false); }
  }

  return <div className="dash-modal-backdrop"><section className="dash-modal assignment-modal" aria-label="Configure workflow assignment">
    <header><div><h2>Use {workflow.name}</h2><p>{project ? 'Configure this project assignment. The reusable workflow remains unchanged.' : 'Choose the project root for this use of the workflow.'}</p></div><button className="dash-icon-button" type="button" aria-label="Close" onClick={onClose}><UiIcon name="close" /></button></header>
    {error && <p className="route-banner error" role="alert">{error}</p>}
    {!project ? <div className="assignment-project-step"><div>
      <label htmlFor="assignment-project-name">Project name</label><input id="assignment-project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Policy workspace" />
      <label htmlFor="assignment-project-root">Project root</label><div className="inline-control"><input id="assignment-project-root" value={rootPath} onChange={(event) => { setRootPath(event.target.value); setInspection(null); }} placeholder="C:\\projects\\policy-docs" /><button className="dash-button secondary" type="button" disabled={busy || !rootPath.trim()} onClick={() => void inspect()}>Inspect</button></div>
      <button className="text-button" type="button" onClick={() => void autofillAppFolder()}>Use companion projects folder</button>
      {projects.length > 0 && <div className="assignment-recent"><strong>Saved projects</strong>{projects.filter((item) => item.status === 'active').map((item) => <button type="button" key={item.id} disabled={busy} onClick={() => void selectSavedProject(item)}><span>{item.name}</span><small>{item.rootPath}</small></button>)}</div>}
    </div><aside>{inspection ? <><strong>{inspection.workspaceKind === 'repository' ? 'Repository detected' : inspection.workspaceKind === 'empty' ? 'Empty project folder' : 'Existing workspace'}</strong><code>{inspection.rootPath}</code><p>{inspection.entryCount} entries · inspection was read-only</p><button className="dash-button primary" type="button" disabled={busy || !name.trim()} onClick={() => void confirmProject()}>Continue to configuration</button></> : <><strong>No project selected</strong><p>The root path is stored on the assignment, not on the reusable workflow.</p></>}</aside></div> : <div className="assignment-config">
      <section><div className="assignment-project-summary"><div><strong>{project.name}</strong><code>{project.rootPath}</code></div><button className="text-button" type="button" onClick={() => setProject(null)}>Change project</button></div>
        {externalInputs.length > 0 && <p className="field-help">The run will ask for missing information when a step needs it: {externalInputs.map((key) => key.replaceAll('_', ' ')).join(', ')}.</p>}
        <h3>Skills and pinned versions</h3><p className="field-help">Only active published versions can be selected. Order is preserved on this assignment.</p>
        <div className="assignment-skills">{eligibleSkills.map((skill) => { const index = selectedIds.indexOf(skill.id); return <div key={skill.id} className={index >= 0 ? 'selected' : ''}><label><input type="checkbox" checked={index >= 0} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, skill.id] : current.filter((id) => id !== skill.id))} /><span><strong>{skill.name}</strong><small>v{skill.version} · {skill.estimatedContextTokens.toLocaleString()} tokens · {skill.compatibility.join(', ')}</small></span></label>{index >= 0 && <span><button type="button" aria-label={`Move ${skill.name} up`} disabled={index === 0} onClick={() => move(skill.id, -1)}>↑</button><button type="button" aria-label={`Move ${skill.name} down`} disabled={index === selectedIds.length - 1} onClick={() => move(skill.id, 1)}>↓</button></span>}</div>; })}</div>
      </section><aside><h3>Assignment controls</h3><label htmlFor="assignment-sandbox">Sandbox</label><select id="assignment-sandbox" value={sandboxMode} onChange={(event) => { setSandboxMode(event.target.value as typeof sandboxMode); setWorkspaceWriteConfirmed(false); }}><option value="read-only">Read-only</option><option value="workspace">Workspace write</option><option value="isolated">Isolated</option></select><label htmlFor="assignment-tools">Allowed tools / permissions</label><textarea id="assignment-tools" rows={3} value={tools} onChange={(event) => setTools(event.target.value)} placeholder="One tool or permission per line" /><label className="approval-check"><input type="checkbox" checked={approvalRequired} onChange={(event) => { setApprovalRequired(event.target.checked); setDestructiveBypassConfirmed(false); }} />Require approval for destructive actions</label>{sandboxMode === 'workspace' && <label className="approval-check elevated-confirmation"><input type="checkbox" checked={workspaceWriteConfirmed} onChange={(event) => setWorkspaceWriteConfirmed(event.target.checked)} />I confirm this assignment may write inside the selected project root.</label>}{!approvalRequired && <label className="approval-check elevated-confirmation"><input type="checkbox" checked={destructiveBypassConfirmed} onChange={(event) => setDestructiveBypassConfirmed(event.target.checked)} />I understand destructive actions will not pause for approval.</label>}
        <div className="assignment-cost"><strong>{contextTokens.toLocaleString()} estimated tokens</strong><span>{selected.length} selected skill{selected.length === 1 ? '' : 's'}</span></div>
        {(missingPermissions.length > 0 || stale.length > 0 || overlappingTriggers.length > 0 || contextTokens > 8000) && <div className="validation-summary warning"><strong>Review configuration</strong>{missingPermissions.length > 0 && <p>Missing permissions: {missingPermissions.join(', ')}</p>}{stale.length > 0 && <p>Stale skills: {stale.map((skill) => skill.name).join(', ')}</p>}{overlappingTriggers.length > 0 && <p>Overlapping triggers: {overlappingTriggers.join(', ')}</p>}{contextTokens > 8000 && <p>Combined context cost is high.</p>}</div>}
        <button className="dash-button primary assignment-submit" type="button" disabled={busy || missingPermissions.length > 0 || sandboxMode === 'workspace' && !workspaceWriteConfirmed || !approvalRequired && !destructiveBypassConfirmed} onClick={() => void createAssignment()}>{busy ? 'Creating assignment…' : 'Create assignment and review graph'}</button>
      </aside>
    </div>}
  </section></div>;
}
