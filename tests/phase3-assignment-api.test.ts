import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { createProject, createSkill, createWorkflow } from '@/src/domain/workspace';
import { createWorkspaceStores } from '@/src/storage/workspace-stores';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { resetDatabaseForTests } = await import('@/src/storage/async-database'); await resetDatabaseForTests();
  vi.unstubAllEnvs(); vi.resetModules();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function authFor(plan: (typeof STARTER_WORKFLOWS)[number]) {
  const { createSession, createUser } = await import('@/src/auth/auth');
  const { WorkflowRepository } = await import('@/src/storage/workflow-repository');
  const user = await createUser({ name: 'Assignment Tester', email: 'assignments@example.com', password: 'password-123', role: 'builder' });
  if (!user) throw new Error('Could not create test user.');
  await new WorkflowRepository().upsert(user.id, plan);
  const session = await createSession(user.id);
  return { user, headers: { 'content-type': 'application/json', cookie: `workflow_studio_session=${session.token}` } };
}

describe('Phase 3 project workflow assignment API', () => {
  it('pins ordered skill versions across multiple projects without mutating the definition', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-assignments-')); temporaryDirectories.push(directory);
    vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory); vi.resetModules();
    const plan = { ...structuredClone(STARTER_WORKFLOWS[0]), id: 'workflow-assignment-test', starter: false, status: 'approved' as const };
    plan.nodes = plan.nodes.map((node) => ({ ...node, id: node.id.replace(STARTER_WORKFLOWS[0].id, plan.id) }));
    plan.edges = plan.edges.map((edge) => ({ ...edge, from: edge.from.replace(STARTER_WORKFLOWS[0].id, plan.id), to: edge.to.replace(STARTER_WORKFLOWS[0].id, plan.id) }));
    const projectOne = createProject({ id: 'project-one', name: 'Project one', rootPath: path.join(directory, 'one'), workspaceKind: 'empty' });
    const projectTwo = createProject({ id: 'project-two', name: 'Project two', rootPath: path.join(directory, 'two'), workspaceKind: 'empty' });
    const firstSkill = createSkill({ id: 'skill-first', name: 'First skill', instructions: 'Perform first capability.', status: 'published' });
    const secondSkill = createSkill({ id: 'skill-second', name: 'Second skill', instructions: 'Perform second capability.', status: 'published', version: 3 });
    const definition = createWorkflow({ id: plan.id, name: plan.name, domain: plan.domain ?? 'General', status: 'published' });
    const originalDefinition = structuredClone(definition);
    const auth = await authFor(plan);
    const headers = auth.headers;
    const stores = createWorkspaceStores(directory, auth.user.id);
    await Promise.all([
      stores.projects.writeAll([projectOne, projectTwo]), stores.skills.writeAll([firstSkill, secondSkill]), stores.workflows.writeAll([definition])
    ]);
    const route = await import('@/src/app/api/assignments/route');
    const create = (projectId: string, projectRoot: string) => route.POST(new Request('http://localhost/api/assignments', { method: 'POST', headers, body: JSON.stringify({ projectId, workflowId: plan.id, selectedSkillIds: [secondSkill.id, firstSkill.id], inputOverrides: { project: projectRoot } }) }));
    const firstResponse = await create(projectOne.id, projectOne.rootPath); const first = await firstResponse.json();
    const secondResponse = await create(projectTwo.id, projectTwo.rootPath); const second = await secondResponse.json();
    expect(firstResponse.status).toBe(201); expect(secondResponse.status).toBe(201);
    expect(first.assignment.selectedSkills).toEqual([{ skillId: secondSkill.id, version: 3 }, { skillId: firstSkill.id, version: 1 }]);
    expect(first.assignment.projectId).toBe(projectOne.id); expect(second.assignment.projectId).toBe(projectTwo.id);
    expect(first.assignment.workflowId).toBe(plan.id); expect(first.assignment.rootPath).toBe(projectOne.rootPath);
    expect(first.assignment.inputOverrides).toEqual({ project: projectOne.rootPath });
    expect(second.assignment.inputOverrides).toEqual({ project: projectTwo.rootPath });
    expect(await stores.workflows.readAll()).toEqual([originalDefinition]);
    const assignmentGraph = { ...structuredClone(plan), name: 'Project one tailored review' };
    const graphSaveResponse = await route.PATCH(new Request('http://localhost/api/assignments', { method: 'PATCH', headers, body: JSON.stringify({ id: first.assignment.id, graphOverride: assignmentGraph }) }));
    expect(graphSaveResponse.status).toBe(200);
    expect((await graphSaveResponse.json()).assignment.graphOverride.name).toBe('Project one tailored review');
    expect(await stores.workflows.readAll()).toEqual([originalDefinition]);
    const approvalResponse = await route.PATCH(new Request('http://localhost/api/assignments', { method: 'PATCH', headers, body: JSON.stringify({ id: first.assignment.id, graphOverride: { ...assignmentGraph, modelSettings: { model: 'gpt-5.6-luna', reasoningEffort: 'medium' } }, status: 'ready' }) }));
    expect(approvalResponse.status).toBe(200);
    const approvedAssignment = (await approvalResponse.json()).assignment;
    expect(approvedAssignment.status).toBe('ready');
    expect(approvedAssignment.graphOverride.modelSettings.model).toBe('gpt-5.6-luna');
    expect(approvedAssignment.configurationVersion).toBe(first.assignment.configurationVersion + 2);
    expect(approvedAssignment.approval).toMatchObject({ workflowVersion: definition.version, configurationVersion: approvedAssignment.configurationVersion, approvedBy: { role: 'builder' } });
    const changedResponse = await route.PATCH(new Request('http://localhost/api/assignments', { method: 'PATCH', headers, body: JSON.stringify({ id: first.assignment.id, permissions: { allowedTools: ['read-file'] } }) }));
    const changedAssignment = (await changedResponse.json()).assignment;
    expect(changedAssignment).toMatchObject({ status: 'draft', configurationVersion: approvedAssignment.configurationVersion + 1 });
    expect(changedAssignment.approval).toBeUndefined();
    const list = await route.GET(new NextRequest(`http://localhost/api/assignments?workflowId=${plan.id}`, { headers }));
    expect((await list.json()).assignments).toHaveLength(2);
  });

  it('rejects archived and draft skills during new selection', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-inactive-')); temporaryDirectories.push(directory);
    vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory); vi.resetModules();
    const project = createProject({ id: 'project-inactive', name: 'Project', rootPath: directory, workspaceKind: 'workspace' });
    const plan = { ...STARTER_WORKFLOWS[1], status: 'approved' as const };
    const definition = createWorkflow({ id: plan.id, name: plan.name, domain: plan.domain ?? 'General', status: 'published' });
    const draft = createSkill({ id: 'draft-skill', name: 'Draft', instructions: 'Not active.', status: 'draft' });
    const auth = await authFor(plan);
    const headers = auth.headers;
    const stores = createWorkspaceStores(directory, auth.user.id);
    await Promise.all([stores.projects.writeAll([project]), stores.workflows.writeAll([definition]), stores.skills.writeAll([draft])]);
    const route = await import('@/src/app/api/assignments/route');
    const response = await route.POST(new Request('http://localhost/api/assignments', { method: 'POST', headers, body: JSON.stringify({ projectId: project.id, workflowId: plan.id, selectedSkillIds: [draft.id], inputOverrides: { project: project.rootPath } }) }));
    expect(response.status).toBe(400);
    expect((await response.json()).errors.join(' ')).toContain('published');
  });

  it('leaves external workflow inputs empty for the live run to request', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-required-inputs-')); temporaryDirectories.push(directory);
    vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory); vi.resetModules();
    const plan = { ...structuredClone(STARTER_WORKFLOWS[0]), id: 'workflow-required-inputs', starter: false, status: 'approved' as const };
    const project = createProject({ id: 'required-input-project', name: 'Project', rootPath: directory, workspaceKind: 'workspace' });
    const definition = createWorkflow({ id: plan.id, name: plan.name, domain: plan.domain ?? 'General', status: 'published' });
    const auth = await authFor(plan);
    const stores = createWorkspaceStores(directory, auth.user.id);
    await Promise.all([stores.projects.writeAll([project]), stores.workflows.writeAll([definition])]);
    const route = await import('@/src/app/api/assignments/route');
    const response = await route.POST(new Request('http://localhost/api/assignments', { method: 'POST', headers: auth.headers, body: JSON.stringify({ projectId: project.id, workflowId: plan.id }) }));
    expect(response.status).toBe(201);
    expect((await response.json()).assignment.inputOverrides).toEqual({});
    expect(await stores.projectWorkflows.readAll()).toHaveLength(1);
  });
});
