import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';

beforeEach(() => vi.stubEnv('WORKFLOW_STUDIO_ENFORCE_ROLE_GATES', 'true'));
afterEach(async () => {
  const { resetDatabaseForTests } = await import('@/src/storage/async-database');
  await resetDatabaseForTests();
  vi.unstubAllEnvs();
});

async function sessionFor(userId: string) {
  const { createSession } = await import('@/src/auth/auth');
  const session = await createSession(userId);
  return { cookie: `workflow_studio_session=${session.token}`, 'content-type': 'application/json' };
}

describe('Phase 8 delegated review queue', () => {
  it('shows owner-scoped drafts only to reviewers and records a reviewer approval', async () => {
    const { createUser } = await import('@/src/auth/auth');
    const builder = await createUser({ name: 'Queue builder', email: `builder-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'builder' });
    const reviewer = await createUser({ name: 'Queue reviewer', email: `reviewer-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'reviewer' });
    if (!builder || !reviewer) throw new Error('Could not create review users.');
    const plan = structuredClone(STARTER_WORKFLOWS[0]);
    plan.id = `workflow_${crypto.randomUUID()}`;
    plan.status = 'draft';
    plan.nodes = plan.nodes.map((node) => ({ ...node, skillIds: [] }));
    const { WorkflowRepository } = await import('@/src/storage/workflow-repository');
    await new WorkflowRepository().upsert(builder.id, plan);
    const route = await import('@/src/app/api/reviews/route');

    expect((await route.GET(new Request('http://localhost/api/reviews', { headers: await sessionFor(builder.id) }))).status).toBe(403);
    expect((await route.GET(new Request('http://localhost/api/reviews', { headers: await sessionFor(reviewer.id) })).then((response) => response.json())).reviews).toEqual([]);
    const denied = await route.POST(new Request('http://localhost/api/reviews', { method: 'POST', headers: await sessionFor(reviewer.id), body: JSON.stringify({ kind: 'definition', id: plan.id, ownerUserId: builder.id, expectedUpdatedAt: plan.updatedAt }) }));
    expect(denied.status).toBe(403);
    const { ReviewerAssignmentRepository } = await import('@/src/storage/reviewer-assignment-repository');
    await new ReviewerAssignmentRepository().assign(builder.id, reviewer.id, reviewer.id);
    const queueResponse = await route.GET(new Request('http://localhost/api/reviews', { headers: await sessionFor(reviewer.id) }));
    expect(queueResponse.status).toBe(200);
    const item = (await queueResponse.json()).reviews.find((candidate: { id: string }) => candidate.id === plan.id);
    expect(item).toMatchObject({ kind: 'definition', owner: { id: builder.id }, name: plan.name });

    const decision = await route.POST(new Request('http://localhost/api/reviews', { method: 'POST', headers: await sessionFor(reviewer.id), body: JSON.stringify({ kind: 'definition', id: plan.id, ownerUserId: builder.id, expectedUpdatedAt: plan.updatedAt }) }));
    expect(decision.status).toBe(200);
    const approved = (await new WorkflowRepository().readAll(builder.id)).find((candidate) => candidate.id === plan.id);
    expect(approved).toMatchObject({ status: 'approved', definitionApproval: { approvedBy: { id: reviewer.id, role: 'reviewer' } } });
    expect((await route.GET(new Request('http://localhost/api/reviews', { headers: await sessionFor(reviewer.id) })).then((response) => response.json())).reviews.some((candidate: { id: string }) => candidate.id === plan.id)).toBe(false);
  });

  it('enforces a different reviewer when separation of duties is required', async () => {
    vi.stubEnv('WORKFLOW_STUDIO_REQUIRE_SEPARATE_REVIEWER', 'true');
    const { createUser } = await import('@/src/auth/auth');
    const reviewer = await createUser({ name: 'Self reviewer', email: `self-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'reviewer' });
    if (!reviewer) throw new Error('Could not create reviewer.');
    const route = await import('@/src/app/api/reviews/route');
    const response = await route.POST(new Request('http://localhost/api/reviews', { method: 'POST', headers: await sessionFor(reviewer.id), body: JSON.stringify({ kind: 'definition', id: 'workflow-test', ownerUserId: reviewer.id }) }));
    expect(response.status).toBe(403);
    expect((await response.json()).errors.join(' ')).toContain('different reviewer');
  });

  it('lets a reviewer approve another user assignment without transferring ownership', async () => {
    const { createUser } = await import('@/src/auth/auth');
    const builder = await createUser({ name: 'Assignment builder', email: `assignment-builder-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'builder' });
    const reviewer = await createUser({ name: 'Assignment reviewer', email: `assignment-reviewer-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'reviewer' });
    if (!builder || !reviewer) throw new Error('Could not create assignment review users.');
    const plan = structuredClone(STARTER_WORKFLOWS[0]);
    plan.id = `workflow_${crypto.randomUUID()}`; plan.status = 'approved';
    plan.nodes = plan.nodes.map((node) => ({ ...node, skillIds: [] }));
    plan.definitionApproval = { approvedAt: new Date().toISOString(), approvedBy: { id: reviewer.id, name: reviewer.name, role: reviewer.role }, workflowVersion: plan.version ?? 1 };
    const { createProject, createProjectWorkflow, createWorkflow } = await import('@/src/domain/workspace');
    const project = createProject({ id: `project_${crypto.randomUUID()}`, name: 'Reviewed project', rootPath: 'C:\\projects\\reviewed', workspaceKind: 'workspace' });
    const definition = createWorkflow({ id: plan.id, name: plan.name, domain: plan.domain ?? 'General', status: 'published', version: plan.version ?? 1 });
    const assignment = createProjectWorkflow({ project, workflow: definition, graphOverride: plan, inputOverrides: { project: project.rootPath }, permissions: { allowedWorkspacePaths: [project.rootPath] } });
    const { claimProjectOwnership, projectOwnerId } = await import('@/src/storage/project-ownership-repository');
    await claimProjectOwnership(builder.id, project.id);
    const { createWorkspaceStores } = await import('@/src/storage/workspace-stores');
    const stores = createWorkspaceStores('', builder.id);
    await stores.projects.upsert(project); await stores.workflows.upsert(definition); await stores.projectWorkflows.upsert(assignment);
    await new (await import('@/src/storage/workflow-repository')).WorkflowRepository().upsert(builder.id, plan);
    await new (await import('@/src/storage/reviewer-assignment-repository')).ReviewerAssignmentRepository().assign(builder.id, reviewer.id, reviewer.id);
    const route = await import('@/src/app/api/reviews/route');
    const response = await route.POST(new Request('http://localhost/api/reviews', { method: 'POST', headers: await sessionFor(reviewer.id), body: JSON.stringify({ kind: 'assignment', id: assignment.id, ownerUserId: builder.id, expectedUpdatedAt: assignment.updatedAt }) }));
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect((await stores.projectWorkflows.readAll()).find((candidate) => candidate.id === assignment.id)).toMatchObject({ status: 'ready', approval: { approvedBy: { id: reviewer.id } } });
    expect(await projectOwnerId(project.id)).toBe(builder.id);
  });
});
