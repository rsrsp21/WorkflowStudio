import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexFocusedTaskRequest } from '@/src/adapters/codex-adapter';
import { compileWorkflowRun } from '@/src/domain/runtime';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-focused-api-'));
  vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory);
  vi.resetModules();
});

afterEach(async () => {
  const { resetDatabaseForTests } = await import('@/src/storage/async-database');
  await resetDatabaseForTests();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe('Phase 4 focused execution API', () => {
  it('executes the next owned node with focused context and persists structured output', async () => {
    const { createSession, createUser } = await import('@/src/auth/auth');
    const user = await createUser({ name: 'Execution owner', email: 'execution@example.com', password: 'password-123', role: 'builder' });
    if (!user) throw new Error('Could not create user.');
    const session = await createSession(user.id);
    const plan = structuredClone(STARTER_WORKFLOWS[0]);
    plan.planningPrompt = 'SECRET FULL PLANNING PROMPT';
    plan.status = 'approved';
    const project = createProject({ id: 'focused-project', name: 'Focused project', rootPath: directory, workspaceKind: 'repository' });
    const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: plan.domain ?? 'General', status: 'published' });
    const assignment = createProjectWorkflow({ id: 'focused-assignment', project, workflow, status: 'ready', approval: testAssignmentApproval(workflow.version), graphOverride: plan, inputOverrides: {}, permissions: { sandboxMode: 'read-only', allowedWorkspacePaths: [directory], requireApprovalForDestructiveActions: true } });
    const compiled = compileWorkflowRun(user.id, plan, assignment, []);
    if (!compiled.run) throw new Error(compiled.errors.join(' '));
    const { RunRepository } = await import('@/src/storage/run-repository');
    await new RunRepository().upsert(user.id, compiled.run);
    const { WorkflowRepository } = await import('@/src/storage/workflow-repository');
    const { createWorkspaceStores } = await import('@/src/storage/workspace-stores');
    await new WorkflowRepository().upsert(user.id, plan);
    const stores = createWorkspaceStores(directory, user.id);
    await Promise.all([stores.projects.writeAll([project]), stores.workflows.writeAll([workflow]), stores.projectWorkflows.writeAll([assignment]), stores.skills.writeAll([])]);

    const requests: CodexFocusedTaskRequest[] = [];
    vi.doMock('@/src/adapters/codex-app-server-adapter', () => ({ createCodexPlanningAdapter: () => ({
      createPlanningThread: vi.fn(),
      runFocusedTask: vi.fn(async (request: CodexFocusedTaskRequest) => {
        requests.push(request);
        const output = Object.fromEntries(request.outputKeys.map((key) => [key, { accepted: true }]));
        return { output, selectedCondition: request.edgeConditions[0] ?? '', summary: 'Focused node completed.', artifacts: [{ path: path.join(directory, 'focused-result.json'), description: 'Focused result', rootPath: directory, sandboxMode: 'read-only' as const, writeAllowed: false }], providerThreadId: 'thread-focused-api', trace: { runId: request.runId, taskId: request.taskId, sourcePlanId: request.sourcePlanId, workflowId: request.workflowId, assignmentId: request.assignmentId, projectId: request.projectId, nodeId: request.nodeId } };
      })
    }) }));
    const route = await import('@/src/app/api/runs/[runId]/execute/route');
    const executeHeaders = { 'content-type': 'application/json', cookie: `workflow_studio_session=${session.token}` };
    const waitingResponse = await route.POST(new Request(`http://localhost/api/runs/${compiled.run.id}/execute`, { method: 'POST', headers: executeHeaders, body: JSON.stringify({ idempotencyKey: 'request-node-input' }) }), { params: Promise.resolve({ runId: compiled.run.id }) });
    expect(waitingResponse.status).toBe(200);
    expect(await waitingResponse.json()).toMatchObject({ transition: { kind: 'waiting-input' }, run: { pendingInput: { nodeId: plan.nodes[0].id, keys: ['project'] } } });
    expect(requests).toHaveLength(0);
    const inputRoute = await import('@/src/app/api/runs/[runId]/inputs/route');
    const emptyInputResponse = await inputRoute.POST(new Request(`http://localhost/api/runs/${compiled.run.id}/inputs`, { method: 'POST', headers: executeHeaders, body: JSON.stringify({ nodeId: plan.nodes[0].id, values: { project: '' } }) }), { params: Promise.resolve({ runId: compiled.run.id }) });
    expect(emptyInputResponse.status).toBe(400);
    const inputResponse = await inputRoute.POST(new Request(`http://localhost/api/runs/${compiled.run.id}/inputs`, { method: 'POST', headers: executeHeaders, body: JSON.stringify({ nodeId: plan.nodes[0].id, values: { project: directory } }) }), { params: Promise.resolve({ runId: compiled.run.id }) });
    expect(inputResponse.status).toBe(200);
    const response = await route.POST(new Request(`http://localhost/api/runs/${compiled.run.id}/execute`, { method: 'POST', headers: executeHeaders, body: JSON.stringify({ idempotencyKey: 'execute-node-once' }) }), { params: Promise.resolve({ runId: compiled.run.id }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.transition).toMatchObject({ kind: 'branched', nodeRun: { nodeId: plan.nodes[0].id, status: 'completed', attempt: 1 } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ runId: compiled.run.id, taskId: `${compiled.run.id}:${plan.nodes[0].id}`, sourcePlanId: plan.id, workflowId: plan.id, assignmentId: assignment.id, projectId: project.id, nodeId: plan.nodes[0].id, prompt: plan.nodes[0].prompt, workspacePath: directory, harness: { sandboxMode: 'read-only' } });
    expect(requests[0].input).toEqual({ project: directory });
    expect(JSON.stringify(requests[0])).not.toContain(plan.planningPrompt);
    const persisted = await new RunRepository().read(user.id, compiled.run.id);
    expect(persisted?.nodeRuns[0]).toMatchObject({ status: 'completed', output: { result: { accepted: true } }, summary: 'Focused node completed.', providerThreadId: 'thread-focused-api', artifactIds: [`${compiled.run.id}:artifact:1`] });
    expect(persisted?.artifacts[0]).toMatchObject({ nodeId: plan.nodes[0].id, path: path.join(directory, 'focused-result.json'), rootPath: directory, writeAllowed: false });
    expect(persisted?.events.map((event) => event.type)).toEqual(['run.compiled', 'node.input-requested', 'node.input-provided', 'node.started', 'node.completed', 'route.selected']);

    const replayResponse = await route.POST(new Request(`http://localhost/api/runs/${compiled.run.id}/execute`, { method: 'POST', headers: executeHeaders, body: JSON.stringify({ idempotencyKey: 'execute-node-once' }) }), { params: Promise.resolve({ runId: compiled.run.id }) });
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toMatchObject({ idempotentReplay: true, run: { id: compiled.run.id } });
    expect(requests).toHaveLength(1);

    const recovery = await import('@/src/app/api/runs/[runId]/recover/route');
    const { acquireRunExecutionLock, releaseRunExecutionLock } = await import('@/src/storage/run-execution-lock');
    const activeLock = await acquireRunExecutionLock(user.id, compiled.run.id);
    expect(activeLock).toBeTruthy();
    try {
      const recoveryResponse = await recovery.POST(new Request(`http://localhost/api/runs/${compiled.run.id}/recover`, { method: 'POST', headers: executeHeaders }), { params: Promise.resolve({ runId: compiled.run.id }) });
      expect(recoveryResponse.status).toBe(409);
      expect((await recoveryResponse.json()).error).toContain('actively executing');
      expect(requests).toHaveLength(1);
    } finally { await releaseRunExecutionLock(user.id, compiled.run.id, activeLock!); }

    await stores.projectWorkflows.upsert({ ...assignment, configurationVersion: 2, permissions: { ...assignment.permissions, allowedTools: ['read-file'] }, approval: { ...assignment.approval!, configurationVersion: 2 }, updatedAt: new Date().toISOString() });
    const staleRunResponse = await route.POST(new Request(`http://localhost/api/runs/${compiled.run.id}/execute`, { method: 'POST', headers: executeHeaders, body: JSON.stringify({ idempotencyKey: 'execute-after-config-change' }) }), { params: Promise.resolve({ runId: compiled.run.id }) });
    expect(staleRunResponse.status).toBe(409);
    expect((await staleRunResponse.json()).errors.join(' ')).toContain('older assignment configuration');
    expect(requests).toHaveLength(1);
  }, 15000);
});
