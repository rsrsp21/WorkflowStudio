'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { companionDefaultModel } from '@/src/domain/model-settings';
import type { RuntimeConnection } from '@/src/domain/runtime-connection';
import { draftWorkflowPlan, type WorkflowPlan } from '@/src/domain/models';
import type { WorkflowRun } from '@/src/domain/runtime';
import type { ProjectWorkflow, Skill } from '@/src/domain/workspace';
import Phase3GraphEditor from './phase3-graph-editor';
import BackButton from './back-button';
import StudioPageShell from './studio-page-shell';
import type { OrganizationSummary } from '@/src/storage/organization-repository';

export default function WorkflowGraphPage({ workflowId, assignmentId }: { workflowId: string; assignmentId?: string }) {
  const router = useRouter();
  const [availableModels, setAvailableModels] = useState<string[] | undefined>();
  const [workflow, setWorkflow] = useState<WorkflowPlan | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [assignment, setAssignment] = useState<ProjectWorkflow | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState('');
  const [skillReviewOpen, setSkillReviewOpen] = useState(false);
  const [enablingSkills, setEnablingSkills] = useState(false);
  const [skillEnableError, setSkillEnableError] = useState('');
  const [skillEnableMessage, setSkillEnableMessage] = useState('');
  const [recentRuns, setRecentRuns] = useState<WorkflowRun[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const assignmentRef = useRef<ProjectWorkflow | undefined>(undefined);
  const operationKeys = useRef<Record<string, { fingerprint: string; key: string }>>({});

  function operationKey(action: string, payload: unknown) {
    const fingerprint = JSON.stringify(payload);
    const current = operationKeys.current[action];
    if (current?.fingerprint === fingerprint) return current.key;
    const key = crypto.randomUUID();
    operationKeys.current[action] = { fingerprint, key };
    return key;
  }

  useEffect(() => {
    const assignmentRequest = assignmentId ? fetch(`/api/assignments?id=${encodeURIComponent(assignmentId)}`) : Promise.resolve(null);
    void Promise.all([fetch('/api/workflows'), fetch('/api/skills'), assignmentRequest, fetch('/api/runs?limit=100'), fetch('/api/organizations'), fetch('/api/runtime/connections').catch(() => null)])
      .then(async ([workflowResponse, skillResponse, assignmentResponse, runResponse, organizationResponse, runtimeResponse]) => {
        const [workflowData, skillData, assignmentData, runData, organizationData] = await Promise.all([workflowResponse.json(), skillResponse.json(), assignmentResponse?.json(), runResponse.json(), organizationResponse.json()]);
        const selected = (workflowData.workflows as WorkflowPlan[] | undefined)?.find((candidate) => candidate.id === workflowId);
        if (!selected) throw new Error('Workflow was not found.');
        const selectedAssignment = (assignmentData?.assignments as ProjectWorkflow[] | undefined)?.[0];
        if (assignmentId && (!selectedAssignment || selectedAssignment.workflowId !== workflowId)) throw new Error('Workflow assignment was not found.');
        const runtimeData = await runtimeResponse?.json().catch(() => ({}));
        const connection = (runtimeData?.connections as RuntimeConnection[] | undefined)?.find((item) => item.status === 'online' && item.authMode === 'chatgpt');
        const models = connection?.supportedModels;
        setAvailableModels(models);
        const graph = selectedAssignment?.graphOverride ?? selected;
        const defaultModel = companionDefaultModel(models ?? []);
        // Pin an available default visibly before approval; never rewrite an explicit model choice.
        setWorkflow(selectedAssignment && !graph.modelSettings?.model && defaultModel ? { ...draftWorkflowPlan(graph), modelSettings: { ...graph.modelSettings, model: defaultModel } } : graph);
        setSkills(skillData.skills ?? []);
        setAssignment(selectedAssignment);
        assignmentRef.current = selectedAssignment;
        setRecentRuns(((runData.runs ?? []) as WorkflowRun[]).filter((run) => run.workflowId === workflowId && (!assignmentId || run.assignmentId === assignmentId)).slice(0, 5));
        setOrganizations(organizationData.organizations ?? []);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Workflow could not be loaded.'))
      .finally(() => setLoading(false));
  }, [assignmentId, workflowId]);

  async function save(plan: WorkflowPlan) {
    const currentAssignment = assignmentRef.current;
    if (currentAssignment) {
      const payload = { id: currentAssignment.id, graphOverride: plan, status: 'draft' as const };
      const response = await fetch('/api/assignments', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, expectedConfigurationVersion: currentAssignment.configurationVersion ?? 1, idempotencyKey: operationKey('save-assignment', payload) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.[0] || 'Assignment graph could not be saved.');
      setAssignment(result.assignment);
      assignmentRef.current = result.assignment;
      setWorkflow(result.assignment.graphOverride);
      setCompileError('');
      return result.assignment.graphOverride as WorkflowPlan;
    }
    const payload = { ...plan, lifecycleAction: 'save-draft' as const };
    const response = await fetch('/api/workflows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, expectedUpdatedAt: workflow?.updatedAt, idempotencyKey: operationKey('save-definition', payload) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.errors?.[0] || 'Workflow could not be saved.');
    setWorkflow(result.workflow);
    const skillResponse = await fetch('/api/skills');
    const skillData = await skillResponse.json();
    setSkills(skillData.skills ?? []);
    return result.workflow as WorkflowPlan;
  }

  async function approve(plan: WorkflowPlan) {
    const currentAssignment = assignmentRef.current;
    if (!currentAssignment) {
      const payload = { ...plan, lifecycleAction: 'approve-definition' as const };
      const response = await fetch('/api/workflows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, expectedUpdatedAt: workflow?.updatedAt, idempotencyKey: operationKey('approve-definition', payload) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.[0] || 'Workflow graph could not be approved.');
      setWorkflow(result.workflow);
      return;
    }
    const payload = { id: currentAssignment.id, graphOverride: { ...plan, status: 'approved' as const }, status: 'ready' as const };
    const response = await fetch('/api/assignments', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, expectedConfigurationVersion: currentAssignment.configurationVersion ?? 1, idempotencyKey: operationKey('approve-assignment', payload) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.errors?.[0] || 'Assignment could not be approved.');
    setAssignment(result.assignment);
    assignmentRef.current = result.assignment;
    setWorkflow(result.assignment.graphOverride);
  }

  async function addSkillToAssignment(skillId: string) {
    const currentAssignment = assignmentRef.current;
    if (!currentAssignment) throw new Error('Create a project assignment before selecting assignment skills.');
    const selectedSkillIds = [...currentAssignment.selectedSkills.map((reference) => reference.skillId), skillId].filter((id, index, all) => all.indexOf(id) === index);
    const payload = { id: currentAssignment.id, selectedSkillIds, status: 'draft' as const };
    const response = await fetch('/api/assignments', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, expectedConfigurationVersion: currentAssignment.configurationVersion ?? 1, idempotencyKey: operationKey('add-assignment-skill', payload) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.errors?.[0] || 'Skill could not be added to the assignment.');
    setAssignment(result.assignment);
    assignmentRef.current = result.assignment;
  }

  async function enableWorkflowSkills() {
    if (!workflow) return;
    const referencedIds = Array.from(new Set(workflow.nodes.flatMap((node) => node.skillIds)));
    setEnablingSkills(true);
    setSkillEnableError('');
    setSkillEnableMessage('');
    try {
      const missing = referencedIds.filter((id) => !skills.some((skill) => skill.id === id));
      const archived = skills.filter((skill) => referencedIds.includes(skill.id) && skill.status === 'archived');
      if (missing.length || archived.length) throw new Error(`Resolve unavailable skills before enabling this workflow: ${[...missing, ...archived.map((skill) => skill.name)].join(', ')}.`);
      for (const skill of skills.filter((candidate) => referencedIds.includes(candidate.id) && candidate.status === 'draft')) {
        const response = await fetch('/api/skills', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: skill.id, action: 'publish' }) });
        const result = await response.json() as { errors?: string[] };
        if (!response.ok) throw new Error(`${skill.name}: ${result.errors?.join(' ') || 'Could not publish skill.'}`);
      }
      const skillResponse = await fetch('/api/skills');
      const skillData = await skillResponse.json() as { skills?: Skill[] };
      if (!skillResponse.ok || !skillData.skills) throw new Error('Could not refresh published skills.');
      setSkills(skillData.skills);
      const currentAssignment = assignmentRef.current;
      if (currentAssignment) {
        const selectedSkillIds = Array.from(new Set([...currentAssignment.selectedSkills.map((reference) => reference.skillId), ...referencedIds]));
        const payload = { id: currentAssignment.id, selectedSkillIds, status: 'draft' as const };
        const response = await fetch('/api/assignments', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, expectedConfigurationVersion: currentAssignment.configurationVersion ?? 1, idempotencyKey: operationKey('enable-workflow-skills', payload) }) });
        const result = await response.json() as { assignment?: ProjectWorkflow; errors?: string[] };
        if (!response.ok || !result.assignment) throw new Error(result.errors?.join(' ') || 'Could not select skills for this assignment.');
        setAssignment(result.assignment);
        assignmentRef.current = result.assignment;
      }
      setSkillEnableMessage(currentAssignment ? 'Workflow skills published and selected for this assignment. Review the graph, then approve it.' : 'Workflow skills published. Create an assignment to select them for a project.');
      setSkillReviewOpen(false);
    } catch (caught) {
      setSkillEnableError(caught instanceof Error ? caught.message : 'Workflow skills could not be enabled.');
    } finally {
      setEnablingSkills(false);
    }
  }

  async function compileRun() {
    if (!assignment) return;
    setCompiling(true);
    setCompileError('');
    try {
      const payload = { assignmentId: assignment.id, ...(organizationId ? { organizationId } : {}) };
      const response = await fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, idempotencyKey: operationKey('compile-run', payload) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.join(' ') || result.error || 'Run could not be compiled.');
      router.push(`/runs/${encodeURIComponent(result.run.id)}`);
    } catch (caught) {
      setCompileError(caught instanceof Error ? caught.message : 'Run could not be compiled.');
      setCompiling(false);
    }
  }

  const graphReturnTo = `/workflows/${workflowId}/graph${assignmentId ? `?assignmentId=${assignmentId}` : ''}`;
  if (loading) return <StudioPageShell><div className="route-state"><strong>Loading graph…</strong><p>Preparing the workflow editor.</p></div></StudioPageShell>;
  if (error || !workflow) return <StudioPageShell><div className="route-state error"><strong>Graph unavailable</strong><p>{error}</p><BackButton onClick={() => router.push('/studio')}>Studio</BackButton></div></StudioPageShell>;

  const referencedSkillIds = Array.from(new Set(workflow.nodes.flatMap((node) => node.skillIds)));
  const workflowSkills = referencedSkillIds.map((id) => skills.find((skill) => skill.id === id));
  const unpublishedCount = workflowSkills.filter((skill) => skill?.status === 'draft').length;
  const unselectedCount = assignment ? referencedSkillIds.filter((id) => !assignment.selectedSkills.some((reference) => reference.skillId === id)).length : 0;
  const needsSkillAction = unpublishedCount > 0 || unselectedCount > 0;
  const skillActionLabel = assignment ? unpublishedCount ? `Publish drafts and select all ${referencedSkillIds.length} skills` : `Select all ${referencedSkillIds.length} workflow skills` : `Publish ${unpublishedCount} draft workflow skills`;

  return <StudioPageShell>
    {assignment?.status === 'ready' && <section className="compile-bar"><div><span>Approved assignment</span><strong>Compile the last saved and approved graph into a durable run.</strong><p>Unsaved editor changes are not included. Saving changes returns the assignment to review.</p>{organizations.length > 0 && <label>Organization model policy<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}><option value="">No organization; use workflow or system default</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}{organization.defaultModel ? ` · ${organization.defaultModel}` : ''}</option>)}</select></label>}</div><button className="dash-button primary" type="button" disabled={compiling} onClick={() => void compileRun()}>{compiling ? 'Compiling…' : 'Compile run'}</button></section>}
    {recentRuns.length > 0 && <section className="workflow-run-strip"><div><strong>Recent runs</strong><p>Saved monitoring and evidence for this workflow.</p></div><ol>{recentRuns.map((run) => <li key={run.id}><Link href={`/runs/${encodeURIComponent(run.id)}`}><span className={`run-status ${run.status}`}>{run.status}</span><strong>{new Date(run.updatedAt).toLocaleString()}</strong><small>{run.artifacts.length} artifacts · {run.events.length} events</small></Link></li>)}</ol><Link className="dash-button secondary" href="/runs">All runs</Link></section>}
    {compileError && <p className="route-banner error">{compileError}</p>}
    {referencedSkillIds.length > 0 && <section className="workflow-skill-review"><div><h2>Workflow skills</h2><p>{referencedSkillIds.length} referenced · {unpublishedCount} draft{assignment ? ` · ${unselectedCount} not selected for this assignment` : ''}</p><p>Publishing makes a skill available; selecting pins its exact version to this project. Review the instructions before enabling them together. Save graph changes first.</p></div><button className="dash-button secondary" type="button" aria-expanded={skillReviewOpen} onClick={() => setSkillReviewOpen((current) => !current)}>{skillReviewOpen ? 'Hide skill review' : needsSkillAction ? 'Review and enable all' : 'Review skills'}</button>{skillReviewOpen && <div className="workflow-skill-review-details"><ol>{referencedSkillIds.map((id, index) => { const skill = workflowSkills[index]; return <li key={id}><details><summary><strong>{skill?.name ?? id}</strong><span>{skill ? `v${skill.version} · ${skill.status}` : 'Missing'}{assignment && !assignment.selectedSkills.some((reference) => reference.skillId === id) ? ' · not selected' : ''}</span></summary>{skill && <><p>{skill.description}</p><pre>{skill.instructions}</pre>{skill.requiredPermissions.length > 0 && <small>Required tools: {skill.requiredPermissions.join(', ')}</small>}</>}</details></li>; })}</ol>{needsSkillAction && <button className="dash-button primary" type="button" disabled={enablingSkills || workflowSkills.some((skill) => !skill || skill.status === 'archived')} onClick={() => void enableWorkflowSkills()}>{enablingSkills ? 'Enabling skills…' : skillActionLabel}</button>}</div>}{skillEnableError && <p className="route-banner error" role="alert">{skillEnableError}</p>}{skillEnableMessage && <p className="route-banner" role="status">{skillEnableMessage}</p>}</section>}
    {Boolean(workflow.planningLogs?.length) && <details className="saved-planning-log"><summary>Creation history <span>{workflow.planningLogs?.length} events</span></summary><div>{workflow.planningLogs?.map((entry, index) => <p key={`${entry}-${index}`}><time>{String(index + 1).padStart(2, '0')}</time>{entry}</p>)}</div></details>}
    <Phase3GraphEditor key={`${workflow.id}-${assignment?.id ?? 'definition'}`} availableModels={availableModels} workflow={workflow} skills={skills} assignment={assignment} onBack={() => router.push('/studio')} onSave={save} onApprove={approve} onOpenSkill={(id) => router.push(`/skills/${encodeURIComponent(id)}/edit?returnTo=${encodeURIComponent(graphReturnTo)}`)} onCreateSkill={(name) => router.push(`/skills/new?name=${encodeURIComponent(name)}&returnTo=${encodeURIComponent(graphReturnTo)}`)} onAddSkill={addSkillToAssignment} />
  </StudioPageShell>;
}
