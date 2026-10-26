import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';

let directory = '';

afterEach(async () => {
  const { resetDatabaseForTests } = await import('@/src/storage/async-database');
  await resetDatabaseForTests();
  vi.unstubAllEnvs(); vi.resetModules();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

async function authenticatedHeaders() {
  const { createSession, createUser } = await import('@/src/auth/auth');
  const user = await createUser({ name: 'Definition Approver', email: 'definition@example.com', password: 'password-123', role: 'reviewer' });
  if (!user) throw new Error('Test user was not created.');
  const session = await createSession(user.id);
  return { user, headers: { 'content-type': 'application/json', cookie: `workflow_studio_session=${session.token}` } };
}

describe('Phase 5 reusable definition approval API', () => {
  it('persists actor, time, and version without creating an assignment or granting project access', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-definition-approval-'));
    vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory); vi.resetModules();
    const { user, headers } = await authenticatedHeaders();
    const route = await import('@/src/app/api/workflows/route');
    const plan = structuredClone(STARTER_WORKFLOWS[0]);
    plan.id = 'approved-without-assignment';
    plan.openQuestions = ['Question retained for later context.'];

    const response = await route.POST(new Request('http://localhost/api/workflows', { method: 'POST', headers, body: JSON.stringify({ ...plan, lifecycleAction: 'approve-definition' }) }));
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.workflow.status).toBe('approved');
    expect(result.workflow.openQuestions).toEqual(plan.openQuestions);
    expect(result.workflow.definitionApproval).toMatchObject({ approvedBy: { id: user.id, name: user.name, role: user.role }, workflowVersion: plan.version });
    expect(Date.parse(result.workflow.definitionApproval.approvedAt)).not.toBeNaN();
    expect(result.workflow.harness.allowedWorkspacePaths).toEqual(plan.harness.allowedWorkspacePaths);

    const { createWorkspaceStores } = await import('@/src/storage/workspace-stores');
    expect(await createWorkspaceStores(directory, user.id).projectWorkflows.readAll()).toEqual([]);
  }, 15000);
});
