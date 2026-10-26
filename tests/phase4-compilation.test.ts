import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-phase4-'));
  vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory);
  vi.resetModules();
});

afterEach(async () => {
  const { resetDatabaseForTests } = await import('@/src/storage/async-database');
  await resetDatabaseForTests();
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(directory, { recursive: true, force: true });
});

async function account(email: string) {
  const { createSession, createUser } = await import('@/src/auth/auth');
  const user = await createUser({ name: email.split('@')[0], email, password: 'password-123', role: 'builder' });
  if (!user) throw new Error('Could not create account.');
  const session = await createSession(user.id);
  return { user, headers: { 'content-type': 'application/json', cookie: `workflow_studio_session=${session.token}` } };
}

async function readyAssignment(userId: string, status: 'draft' | 'ready' = 'ready') {
  const plan = structuredClone(STARTER_WORKFLOWS[0]);
  plan.id = `phase4-plan-${status}`;
  plan.name = `Phase 4 ${status}`;
  plan.planningPrompt = 'This full planning prompt must never be copied into focused node tasks.';
  plan.status = 'approved';
  plan.nodes = plan.nodes.map((node) => ({ ...node, id: node.id.replace(STARTER_WORKFLOWS[0].id, plan.id) }));
  plan.edges = plan.edges.map((edge) => ({ ...edge, from: edge.from.replace(STARTER_WORKFLOWS[0].id, plan.id), to: edge.to.replace(STARTER_WORKFLOWS[0].id, plan.id) }));
  const project = createProject({ id: `project-${status}`, name: 'Runtime project', rootPath: path.join(directory, 'project'), workspaceKind: 'empty' });
  await mkdir(project.rootPath, { recursive: true });
  const definition = createWorkflow({ id: plan.id, name: plan.name, domain: plan.domain ?? 'General', version: plan.version ?? 1, status: 'published' });
  const assignment = createProjectWorkflow({ id: `assignment-${status}`, project, workflow: definition, status, ...(status === 'ready' ? { approval: testAssignmentApproval(definition.version) } : {}), graphOverride: plan, inputOverrides: { project: project.rootPath }, permissions: { sandboxMode: 'read-only', allowedWorkspacePaths: [project.rootPath], requireApprovalForDestructiveActions: true } });
  const { WorkflowRepository } = await import('@/src/storage/workflow-repository');
  const { createWorkspaceStores } = await import('@/src/storage/workspace-stores');
  await new WorkflowRepository().upsert(userId, plan);
  const stores = createWorkspaceStores(directory, userId);
  await Promise.all([stores.projects.writeAll([project]), stores.workflows.writeAll([definition]), stores.projectWorkflows.writeAll([assignment]), stores.skills.writeAll([])]);
  return { plan, assignment, stores };
}

describe('Phase 4 approval-bound compilation', () => {
  it('compiles a ready assignment into a durable focused run without copying the planning prompt', async () => {
    const owner = await account('owner@example.com');
    const { plan, assignment, stores } = await readyAssignment(owner.user.id);
    const route = await import('@/src/app/api/runs/route');
    const compilePayload = { assignmentId: assignment.id, idempotencyKey: 'compile-once' };
    const response = await route.POST(new Request('http://localhost/api/runs', { method: 'POST', headers: owner.headers, body: JSON.stringify(compilePayload) }));
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.run).toMatchObject({ userId: owner.user.id, projectId: assignment.projectId, workflowId: assignment.workflowId, assignmentId: assignment.id, rootPath: assignment.rootPath, status: 'compiled' });
    expect(result.run.compiledWorkflow.nodes.map((node: { focusedPrompt: string }) => node.focusedPrompt)).toEqual(plan.nodes.map((node) => node.prompt));
    expect(result.run.compiledWorkflow.assignmentInputs).toEqual({ project: assignment.rootPath });
    expect(JSON.stringify(result.run)).not.toContain(plan.planningPrompt);
    expect(result.run.nodeRuns).toHaveLength(plan.nodes.length);
    expect((await stores.projectWorkflows.readAll())[0].runIds).toEqual([result.run.id]);

    const replayResponse = await route.POST(new Request('http://localhost/api/runs', { method: 'POST', headers: owner.headers, body: JSON.stringify(compilePayload) }));
    const replay = await replayResponse.json();
    expect(replayResponse.status).toBe(200);
    expect(replay).toMatchObject({ idempotentReplay: true, run: { id: result.run.id } });
    expect((await stores.projectWorkflows.readAll())[0].runIds).toEqual([result.run.id]);

    const persisted = await route.GET(new NextRequest(`http://localhost/api/runs?id=${encodeURIComponent(result.run.id)}`, { headers: owner.headers }));
    expect((await persisted.json()).run.id).toBe(result.run.id);

    const currentAssignment = (await stores.projectWorkflows.readAll())[0];
    await stores.projectWorkflows.upsert({ ...currentAssignment, configurationVersion: 2, permissions: { ...currentAssignment.permissions, allowedTools: ['read-file'] }, approval: { ...currentAssignment.approval!, configurationVersion: 2 }, updatedAt: new Date().toISOString() });
    const conflictingReplay = await route.POST(new Request('http://localhost/api/runs', { method: 'POST', headers: owner.headers, body: JSON.stringify(compilePayload) }));
    expect(conflictingReplay.status).toBe(409);
    expect((await conflictingReplay.json()).errors.join(' ')).toContain('different approved assignment state');
  });

  it('rejects draft assignments and hides compiled runs from other users', async () => {
    const owner = await account('owner@example.com');
    const other = await account('other@example.com');
    const route = await import('@/src/app/api/runs/route');
    const ready = await readyAssignment(owner.user.id, 'ready');
    const compiled = await route.POST(new Request('http://localhost/api/runs', { method: 'POST', headers: owner.headers, body: JSON.stringify({ assignmentId: ready.assignment.id }) }));
    const compiledRun = (await compiled.json()).run;
    expect(compiled.status).toBe(201);

    const draft = await readyAssignment(owner.user.id, 'draft');
    const rejected = await route.POST(new Request('http://localhost/api/runs', { method: 'POST', headers: owner.headers, body: JSON.stringify({ assignmentId: draft.assignment.id }) }));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).errors.join(' ')).toContain('Approve the project assignment');

    const hidden = await route.GET(new NextRequest(`http://localhost/api/runs?id=${encodeURIComponent(compiledRun.id)}`, { headers: other.headers }));
    expect(hidden.status).toBe(404);
    expect((await (await route.GET(new NextRequest('http://localhost/api/runs', { headers: other.headers }))).json()).runs).toEqual([]);
  });

  it('rejects compilation when the approved project root was deleted', async () => {
    const owner = await account('deleted-root@example.com');
    const { assignment } = await readyAssignment(owner.user.id);
    await rm(assignment.rootPath, { recursive: true, force: true });
    const route = await import('@/src/app/api/runs/route');
    const response = await route.POST(new Request('http://localhost/api/runs', { method: 'POST', headers: owner.headers, body: JSON.stringify({ assignmentId: assignment.id }) }));
    expect(response.status).toBe(409);
    expect((await response.json()).errors.join(' ')).toContain('Project root is unavailable');
  });

  it('blocks compilation with structured capability gaps before runtime dispatch', async () => {
    const owner = await account('capability-preflight@example.com');
    const { plan, assignment, stores } = await readyAssignment(owner.user.id);
    const capabilityPlan = { ...plan, nodes: plan.nodes.map((node, index) => index === 0 ? { ...node, skillIds: ['missing-local-skill'] } : node) };
    await stores.projectWorkflows.upsert({ ...assignment, graphOverride: capabilityPlan });
    const route = await import('@/src/app/api/runs/route');
    const response = await route.POST(new Request('http://localhost/api/runs', { method: 'POST', headers: owner.headers, body: JSON.stringify({ assignmentId: assignment.id }) }));
    const result = await response.json();
    expect(response.status).toBe(409);
    expect(result.capabilityIssues).toEqual([expect.objectContaining({ kind: 'skill', key: 'missing-local-skill' })]);
    expect(result.errors.join(' ')).toContain('Missing skill: missing-local-skill');
  });
});
