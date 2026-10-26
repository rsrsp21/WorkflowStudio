import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { createProject } from '@/src/domain/workspace';

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-api-safety-'));
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

async function authenticatedHeaders() {
  const { createSession, createUser } = await import('@/src/auth/auth');
  const user = await createUser({ name: 'Safety tester', email: 'safety@example.com', password: 'password-123', role: 'builder' });
  if (!user) throw new Error('Test user was not created.');
  const session = await createSession(user.id);
  return { user, headers: { 'content-type': 'application/json', cookie: `workflow_studio_session=${session.token}` } };
}

describe('Phase 5 API safety and concurrency controls', () => {
  it('makes workflow approval retry-safe and rejects stale or malformed writes without corruption', async () => {
    const { headers } = await authenticatedHeaders();
    const route = await import('@/src/app/api/workflows/route');
    const malformed = await route.POST(new Request('http://localhost/api/workflows', { method: 'POST', headers, body: '[]' }));
    expect(malformed.status).toBe(400);
    expect((await (await route.GET(new Request('http://localhost/api/workflows', { headers }))).json()).workflows).toEqual([]);

    const plan = structuredClone(STARTER_WORKFLOWS[0]);
    plan.id = 'api-safe-workflow';
    const payload = { ...plan, lifecycleAction: 'approve-definition', idempotencyKey: 'approve-definition-once', futureExtension: { supportedLater: true } };
    const createdResponse = await route.POST(new Request('http://localhost/api/workflows', { method: 'POST', headers, body: JSON.stringify(payload) }));
    const created = await createdResponse.json();
    expect(createdResponse.status).toBe(201);

    const replayResponse = await route.POST(new Request('http://localhost/api/workflows', { method: 'POST', headers, body: JSON.stringify(payload) }));
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toMatchObject({ idempotentReplay: true, workflow: { id: plan.id } });

    const reusedKey = await route.POST(new Request('http://localhost/api/workflows', { method: 'POST', headers, body: JSON.stringify({ ...payload, name: 'Different mutation' }) }));
    expect(reusedKey.status).toBe(409);
    expect((await reusedKey.json()).errors.join(' ')).toContain('different workflow mutation');

    const staleResponse = await route.POST(new Request('http://localhost/api/workflows', { method: 'POST', headers, body: JSON.stringify({ ...created.workflow, name: 'Stale overwrite', lifecycleAction: 'save-draft', expectedUpdatedAt: plan.updatedAt, idempotencyKey: 'stale-save' }) }));
    expect(staleResponse.status).toBe(409);
    const saved = (await (await route.GET(new Request('http://localhost/api/workflows', { headers }))).json()).workflows;
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe(created.workflow.name);

    const directRevision = await route.POST(new Request('http://localhost/api/workflows', { method: 'POST', headers, body: JSON.stringify({ ...created.workflow, name: 'Approved revision', lifecycleAction: 'approve-definition', expectedUpdatedAt: created.workflow.updatedAt, idempotencyKey: 'approve-revision' }) }));
    expect(directRevision.status).toBe(201);
    expect(await directRevision.json()).toMatchObject({ workflow: { name: 'Approved revision', status: 'approved', version: 2, definitionApproval: { workflowVersion: 2 } } });
    const delayedReplay = await route.POST(new Request('http://localhost/api/workflows', { method: 'POST', headers, body: JSON.stringify(payload) }));
    expect(delayedReplay.status).toBe(200);
    expect(await delayedReplay.json()).toMatchObject({ idempotentReplay: true, workflow: { name: 'Approved revision', version: 2 } });

    const idlessPlan = structuredClone(STARTER_WORKFLOWS[1]);
    Reflect.deleteProperty(idlessPlan, 'id');
    const idlessPayload = { ...idlessPlan, lifecycleAction: 'save-draft', idempotencyKey: 'create-idless-once' };
    const idlessCreated = await route.POST(new Request('http://localhost/api/workflows', { method: 'POST', headers, body: JSON.stringify(idlessPayload) }));
    const idlessReplay = await route.POST(new Request('http://localhost/api/workflows', { method: 'POST', headers, body: JSON.stringify(idlessPayload) }));
    expect(idlessCreated.status).toBe(201);
    expect(idlessReplay.status).toBe(200);
    expect((await idlessReplay.json()).workflow.id).toBe((await idlessCreated.json()).workflow.id);
    expect((await (await route.GET(new Request('http://localhost/api/workflows', { headers }))).json()).workflows).toHaveLength(2);
  }, 15000);

  it('requires elevated permission confirmations and makes assignment mutations idempotent and stale-safe', async () => {
    const { user, headers } = await authenticatedHeaders();
    const workflowRoute = await import('@/src/app/api/workflows/route');
    const plan = structuredClone(STARTER_WORKFLOWS[0]);
    plan.id = 'assignment-safe-workflow';
    const approvedResponse = await workflowRoute.POST(new Request('http://localhost/api/workflows', { method: 'POST', headers, body: JSON.stringify({ ...plan, lifecycleAction: 'approve-definition' }) }));
    expect(approvedResponse.status).toBe(201);

    const rootPath = path.join(directory, 'project');
    await mkdir(rootPath);
    const project = createProject({ id: 'assignment-safe-project', name: 'Safe project', rootPath, workspaceKind: 'workspace' });
    const { createWorkspaceStores } = await import('@/src/storage/workspace-stores');
    const stores = createWorkspaceStores(directory, user.id);
    await stores.projects.writeAll([project]);
    const assignmentRoute = await import('@/src/app/api/assignments/route');
    const malformed = await assignmentRoute.POST(new Request('http://localhost/api/assignments', { method: 'POST', headers, body: 'null' }));
    expect(malformed.status).toBe(400);
    const assignmentPayload = {
      projectId: project.id,
      workflowId: plan.id,
      inputOverrides: { project: rootPath },
      permissions: { sandboxMode: 'workspace', allowedWorkspacePaths: [rootPath], requireApprovalForDestructiveActions: true },
      idempotencyKey: 'create-assignment-once'
    };
    const unconfirmed = await assignmentRoute.POST(new Request('http://localhost/api/assignments', { method: 'POST', headers, body: JSON.stringify(assignmentPayload) }));
    expect(unconfirmed.status).toBe(400);
    expect((await unconfirmed.json()).errors.join(' ')).toContain('Confirm workspace write access');
    const destructiveBypass = await assignmentRoute.POST(new Request('http://localhost/api/assignments', { method: 'POST', headers, body: JSON.stringify({ ...assignmentPayload, idempotencyKey: 'unconfirmed-bypass', permissions: { sandboxMode: 'read-only', allowedWorkspacePaths: [rootPath], requireApprovalForDestructiveActions: false } }) }));
    expect(destructiveBypass.status).toBe(400);
    expect((await destructiveBypass.json()).errors.join(' ')).toContain('destructive-action approval bypass');

    const createResponse = await assignmentRoute.POST(new Request('http://localhost/api/assignments', { method: 'POST', headers, body: JSON.stringify({ ...assignmentPayload, confirmWorkspaceWrite: true }) }));
    const created = await createResponse.json();
    expect(createResponse.status).toBe(201);
    const replayResponse = await assignmentRoute.POST(new Request('http://localhost/api/assignments', { method: 'POST', headers, body: JSON.stringify({ ...assignmentPayload, confirmWorkspaceWrite: true }) }));
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toMatchObject({ idempotentReplay: true, assignment: { id: created.assignment.id } });
    const reusedCreateKey = await assignmentRoute.POST(new Request('http://localhost/api/assignments', { method: 'POST', headers, body: JSON.stringify({ ...assignmentPayload, inputOverrides: { project: `${rootPath}-different` }, confirmWorkspaceWrite: true }) }));
    expect(reusedCreateKey.status).toBe(409);
    expect((await reusedCreateKey.json()).errors.join(' ')).toContain('different assignment creation request');
    expect(await stores.projectWorkflows.readAll()).toHaveLength(1);

    const mutation = { id: created.assignment.id, permissions: { allowedTools: ['read-file'] }, expectedConfigurationVersion: 1, idempotencyKey: 'assignment-edit-once' };
    const updateResponse = await assignmentRoute.PATCH(new Request('http://localhost/api/assignments', { method: 'PATCH', headers, body: JSON.stringify(mutation) }));
    expect(updateResponse.status).toBe(200);
    expect((await updateResponse.clone().json()).assignment.configurationVersion).toBe(2);
    const updateReplay = await assignmentRoute.PATCH(new Request('http://localhost/api/assignments', { method: 'PATCH', headers, body: JSON.stringify(mutation) }));
    expect(updateReplay.status).toBe(200);
    expect(await updateReplay.json()).toMatchObject({ idempotentReplay: true, assignment: { configurationVersion: 2 } });
    const reusedMutationKey = await assignmentRoute.PATCH(new Request('http://localhost/api/assignments', { method: 'PATCH', headers, body: JSON.stringify({ ...mutation, permissions: { allowedTools: ['write-file'] } }) }));
    expect(reusedMutationKey.status).toBe(409);
    expect((await reusedMutationKey.json()).errors.join(' ')).toContain('different assignment mutation');

    const secondMutation = await assignmentRoute.PATCH(new Request('http://localhost/api/assignments', { method: 'PATCH', headers, body: JSON.stringify({ id: created.assignment.id, permissions: { allowedTools: ['read-file', 'list-files'] }, expectedConfigurationVersion: 2, idempotencyKey: 'assignment-edit-two' }) }));
    expect(secondMutation.status).toBe(200);
    expect((await secondMutation.json()).assignment.configurationVersion).toBe(3);
    const delayedMutationReplay = await assignmentRoute.PATCH(new Request('http://localhost/api/assignments', { method: 'PATCH', headers, body: JSON.stringify(mutation) }));
    expect(delayedMutationReplay.status).toBe(200);
    expect(await delayedMutationReplay.json()).toMatchObject({ idempotentReplay: true, assignment: { configurationVersion: 3 } });

    const stale = await assignmentRoute.PATCH(new Request('http://localhost/api/assignments', { method: 'PATCH', headers, body: JSON.stringify({ id: created.assignment.id, status: 'ready', expectedConfigurationVersion: 1, idempotencyKey: 'stale-approval' }) }));
    expect(stale.status).toBe(409);
    expect((await stores.projectWorkflows.readAll())[0]).toMatchObject({ status: 'draft', configurationVersion: 3 });
  }, 15000);
});
