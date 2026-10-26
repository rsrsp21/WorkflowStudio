import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowPlan } from '@/src/domain/models';
import { compileWorkflowRun } from '@/src/domain/runtime';
import { completeNode, startNextNode } from '@/src/domain/runtime-engine';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-phase6-approval-'));
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

function waitingApproval(userId: string, customOutcomes = false) {
  const rootPath = path.join(directory, 'project');
  const plan: WorkflowPlan = {
    id: 'approval-api-plan', schemaVersion: 1, name: 'Approval API', description: 'Approve a prepared result.', version: 1,
    planningPrompt: 'Prepare and approve.', workspacePath: rootPath, constraints: [], openQuestions: [], completionCriteria: ['Approved.'],
    nodes: [
      { id: 'prepare', name: 'Prepare', type: 'agent', prompt: 'Prepare.', skillIds: [], inputKeys: ['project'], outputKeys: ['draft'], retryLimit: 0, requiresApproval: false },
      { id: 'approve', name: 'Approve', type: 'approval', prompt: 'Approve.', skillIds: [], inputKeys: ['draft'], outputKeys: ['decision'], retryLimit: 0, requiresApproval: true, ...(customOutcomes ? { approvalOptions: [{ id: 'ship', label: 'Ship it', keyword: 'SHIP IT', action: 'continue' as const }, { id: 'stop', label: 'Stop here', keyword: 'STOP', action: 'stop' as const }] } : {}) },
      { id: 'success', name: 'Accepted', type: 'success', prompt: 'Finish.', skillIds: [], inputKeys: ['decision'], outputKeys: ['accepted'], retryLimit: 0, requiresApproval: false },
      { id: 'failure', name: 'Blocked', type: 'failure', prompt: 'Stop.', skillIds: [], inputKeys: ['decision'], outputKeys: ['reason'], retryLimit: 0, requiresApproval: false }
    ],
    edges: [{ from: 'prepare', to: 'approve' }, { from: 'approve', to: 'success', condition: customOutcomes ? 'SHIP IT' : 'approved' }, { from: 'approve', to: 'failure', condition: 'rejected' }],
    harness: { sandboxMode: 'read-only', maxRetries: 0, maxLoopIterations: 2, maxConcurrentNodes: 1, allowedTools: [], allowedWorkspacePaths: [rootPath], requireApprovalForDestructiveActions: true },
    status: 'approved', createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z'
  };
  const project = createProject({ id: 'approval-api-project', name: 'Approval API', rootPath, workspaceKind: 'empty' });
  const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: 'Testing', status: 'published' });
  const assignment = createProjectWorkflow({ id: 'approval-api-assignment', project, workflow, status: 'ready', approval: testAssignmentApproval(), graphOverride: plan, inputOverrides: { project: rootPath }, permissions: { allowedWorkspacePaths: [rootPath] } });
  const compiled = compileWorkflowRun(userId, plan, assignment, []);
  if (!compiled.run) throw new Error(compiled.errors.join(' '));
  const prepared = completeNode(startNextNode(compiled.run).run, 'prepare', { draft: 'Ready' });
  return startNextNode(prepared.run).run;
}

describe('Phase 6 runtime approval API', () => {
  it('revises execution settings at a gate with authorization, conflict checks, and future-step snapshots', async () => {
    const { createSession, createUser, SESSION_COOKIE } = await import('@/src/auth/auth');
    const user = await createUser({ name: 'Execution settings owner', email: 'settings-owner@example.com', password: 'password-123', role: 'builder' });
    if (!user) throw new Error('User setup failed.');
    const session = await createSession(user.id);
    const { RunRepository } = await import('@/src/storage/run-repository');
    const repository = new RunRepository();
    const waiting = waitingApproval(user.id);
    await repository.upsert(user.id, waiting);
    const route = await import('@/src/app/api/runs/[runId]/settings/route');
    const context = { params: Promise.resolve({ runId: waiting.id }) };
    const headers = { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${session.token}` };
    const payload = { expectedRevision: 0, approvalId: waiting.approvalRecords[0].id, modelSettings: { reasoningEffort: 'high', verbosity: 'low' }, harness: { sandboxMode: 'workspace', maxRetries: 2, maxLoopIterations: 4 }, confirmWorkspaceWrite: true };
    const send = (body: unknown, authenticated = true) => route.PATCH(new Request('http://localhost/api/runs/id/settings', { method: 'PATCH', headers: authenticated ? headers : { 'content-type': 'application/json' }, body: JSON.stringify(body) }), context);
    expect((await send(payload, false)).status).toBe(401);
    vi.stubEnv('WORKFLOW_STUDIO_ENFORCE_ROLE_GATES', 'true');
    expect((await send(payload)).status).toBe(403);
    vi.stubEnv('WORKFLOW_STUDIO_ENFORCE_ROLE_GATES', 'false');
    expect((await send({ ...payload, modelSettings: { temperature: 0.2 } })).status).toBe(400);
    expect((await send({ ...payload, harness: { allowedWorkspacePaths: ['C:\\outside'] } })).status).toBe(400);
    expect((await send({ ...payload, confirmWorkspaceWrite: false })).status).toBe(409);
    expect((await send({ ...payload, approvalId: 'stale-gate' })).status).toBe(409);
    const response = await send(payload);
    expect(response.status).toBe(200);
    const updated = (await response.json()).run;
    expect(updated.executionConfiguration).toMatchObject({ revision: 1, modelSettings: { reasoningEffort: 'high', verbosity: 'low' }, harness: { sandboxMode: 'workspace' }, updatedBy: { id: user.id } });
    expect(updated.compiledWorkflow).toEqual(waiting.compiledWorkflow);
    expect(updated.nodeRuns.find((node: { nodeId: string }) => node.nodeId === 'prepare').executionSettings).toEqual(waiting.nodeRuns.find((node) => node.nodeId === 'prepare')?.executionSettings);
    expect(updated.events.at(-1).type).toBe('run.settings-updated');
    expect((await send(payload)).status).toBe(409);
    const { decideRuntimeApproval, resumeRuntimeApproval, failNode } = await import('@/src/domain/runtime-engine');
    const resumed = resumeRuntimeApproval(decideRuntimeApproval(updated, 'approve', 'approved', user), 'approve', user);
    const next = startNextNode(resumed);
    expect(next.task).toMatchObject({ node: { modelSettings: { reasoningEffort: 'high', verbosity: 'low', reasoningSource: 'run' } }, harness: { sandboxMode: 'workspace', maxRetries: 2 } });
    expect(failNode(next.run, 'success', 'Temporary error').kind).toBe('retried');
    const finished = completeNode(next.run, 'success', { accepted: 'done' }, '', undefined, { artifacts: [{ path: path.join(waiting.rootPath, 'report.md'), rootPath: waiting.rootPath, description: 'Result', sandboxMode: 'workspace', writeAllowed: true }] });
    expect(finished.run.artifacts[0]).toMatchObject({ sandboxMode: 'workspace', writeAllowed: true });
    await repository.upsert(user.id, next.run);
    expect((await send({ ...payload, expectedRevision: 1 })).status).toBe(409);
  });

  it('persists the authenticated decision actor and requires a separate resume action', async () => {
    const { createSession, createUser, SESSION_COOKIE } = await import('@/src/auth/auth');
    const user = await createUser({ name: 'Runtime reviewer', email: 'phase6-reviewer@example.com', password: 'password-123', role: 'reviewer', position: 'Quality Lead' });
    if (!user) throw new Error('User setup failed.');
    const session = await createSession(user.id);
    const { RunRepository } = await import('@/src/storage/run-repository');
    const repository = new RunRepository();
    const waiting = waitingApproval(user.id);
    await repository.upsert(user.id, waiting);
    const route = await import('@/src/app/api/runs/[runId]/approval/route');
    const context = { params: Promise.resolve({ runId: waiting.id }) };
    const headers = { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${session.token}` };

    const decisionResponse = await route.POST(new Request('http://localhost/api/runs/id/approval', { method: 'POST', headers, body: JSON.stringify({ nodeId: 'approve', action: 'approved', feedback: 'Reviewed.', idempotencyKey: 'decision-1' }) }), context);
    expect(decisionResponse.status).toBe(200);
    const decision = (await decisionResponse.json()).run;
    expect(decision).toMatchObject({ status: 'paused', approvalRecords: [expect.objectContaining({ decision: 'approved', decidedBy: { id: user.id, name: user.name, role: user.role } })] });

    const resumeResponse = await route.POST(new Request('http://localhost/api/runs/id/approval', { method: 'POST', headers, body: JSON.stringify({ nodeId: 'approve', action: 'resume', idempotencyKey: 'resume-1' }) }), context);
    expect(resumeResponse.status).toBe(200);
    const resumed = (await resumeResponse.json()).run;
    expect(resumed.nodeRuns.find((node: { nodeId: string }) => node.nodeId === 'approve')).toMatchObject({ status: 'completed', output: { decision: 'approved' } });
    expect(resumed.approvalRecords[0].resumedBy).toMatchObject({ id: user.id, name: user.name, role: user.role });
  });

  it('protects approval actions with authentication and run ownership', async () => {
    const { createUser } = await import('@/src/auth/auth');
    const owner = await createUser({ name: 'Run owner', email: 'phase6-owner@example.com', password: 'password-123', role: 'builder', position: 'Developer' });
    if (!owner) throw new Error('Owner setup failed.');
    const { RunRepository } = await import('@/src/storage/run-repository');
    const waiting = waitingApproval(owner.id);
    await new RunRepository().upsert(owner.id, waiting);
    const route = await import('@/src/app/api/runs/[runId]/approval/route');
    const response = await route.POST(new Request('http://localhost/api/runs/id/approval', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId: 'approve', action: 'approved', idempotencyKey: 'unauthorized' }) }), { params: Promise.resolve({ runId: waiting.id }) });
    expect(response.status).toBe(401);
  });

  it('uses a custom keyword to decide and route a gate in one action', async () => {
    const { createSession, createUser, SESSION_COOKIE } = await import('@/src/auth/auth');
    const user = await createUser({ name: 'Custom gate reviewer', email: 'custom-gate@example.com', password: 'password-123', role: 'reviewer', position: 'Product Lead' });
    if (!user) throw new Error('User setup failed.');
    const session = await createSession(user.id);
    const { RunRepository } = await import('@/src/storage/run-repository');
    const waiting = waitingApproval(user.id, true);
    await new RunRepository().upsert(user.id, waiting);
    const route = await import('@/src/app/api/runs/[runId]/approval/route');
    const response = await route.POST(new Request('http://localhost/api/runs/id/approval', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${session.token}` },
      body: JSON.stringify({ nodeId: 'approve', action: 'choose', keyword: 'ship it', idempotencyKey: 'custom-decision-1' })
    }), { params: Promise.resolve({ runId: waiting.id }) });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.run.approvalRecords[0]).toMatchObject({ keyword: 'SHIP IT', outcomeAction: 'continue', selectedOptionId: 'ship', decision: 'approved' });
    expect(result.run.nodeRuns.find((node: { nodeId: string }) => node.nodeId === 'approve')).toMatchObject({ status: 'completed', selectedCondition: 'SHIP IT' });
    expect(result.run.edgeRuns.find((edge: { from: string; to: string }) => edge.from === 'approve' && edge.to === 'success')).toMatchObject({ status: 'selected' });
  });

  it('rejects generic decisions and unknown keywords for configured gates without unpausing', async () => {
    const { createSession, createUser, SESSION_COOKIE } = await import('@/src/auth/auth');
    const user = await createUser({ name: 'Strict gate reviewer', email: 'strict-gate@example.com', password: 'password-123', role: 'reviewer', position: 'Product Lead' });
    if (!user) throw new Error('User setup failed.');
    const session = await createSession(user.id);
    const { RunRepository } = await import('@/src/storage/run-repository');
    const waiting = waitingApproval(user.id, true);
    await new RunRepository().upsert(user.id, waiting);
    const route = await import('@/src/app/api/runs/[runId]/approval/route');
    const headers = { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${session.token}` };
    const generic = await route.POST(new Request('http://localhost/api/runs/id/approval', { method: 'POST', headers, body: JSON.stringify({ nodeId: 'approve', action: 'approved', idempotencyKey: 'strict-generic' }) }), { params: Promise.resolve({ runId: waiting.id }) });
    expect(generic.status).toBe(409);
    const resume = await route.POST(new Request('http://localhost/api/runs/id/approval', { method: 'POST', headers, body: JSON.stringify({ nodeId: 'approve', action: 'resume', idempotencyKey: 'strict-resume' }) }), { params: Promise.resolve({ runId: waiting.id }) });
    expect(resume.status).toBe(409);
    const unknown = await route.POST(new Request('http://localhost/api/runs/id/approval', { method: 'POST', headers, body: JSON.stringify({ nodeId: 'approve', action: 'choose', keyword: 'MAYBE', idempotencyKey: 'strict-unknown' }) }), { params: Promise.resolve({ runId: waiting.id }) });
    expect(unknown.status).toBe(409);
    expect((await new RunRepository().read(user.id, waiting.id))?.status).toBe('paused');
  });

  it('bridges a local Codex action only to the owning run and returns the decision to its companion', async () => {
    const { createSession, createUser, SESSION_COOKIE } = await import('@/src/auth/auth');
    const owner = await createUser({ name: 'Runtime owner', email: 'runtime-action-owner@example.com', password: 'password-123', role: 'builder', position: 'Developer' });
    const other = await createUser({ name: 'Other user', email: 'runtime-action-other@example.com', password: 'password-123', role: 'builder', position: 'Developer' });
    if (!owner || !other) throw new Error('User setup failed.');
    const ownerSession = await createSession(owner.id);
    const otherSession = await createSession(other.id);
    const waiting = waitingApproval(owner.id);
    const { RunRepository } = await import('@/src/storage/run-repository');
    await new RunRepository().upsert(owner.id, waiting);
    const repository = await import('@/src/storage/runtime-connection-repository');
    const pairing = await repository.createRuntimePairing(owner.id);
    const claimed = await repository.claimRuntimePairing({ code: pairing.pairingCode, allowedRoots: [waiting.rootPath] });
    if (!claimed) throw new Error('Runtime pairing failed.');
    const job = await repository.enqueueRuntimeJob(owner.id, claimed.connection.id, 'focused-task', {
      metadata: { workflow_studio_run_id: waiting.id, workflow_studio_task_id: `${waiting.id}:prepare`, workflow_studio_node_id: 'prepare' }
    });
    await repository.leaseNextRuntimeJob(claimed.connection.id);
    const agentRoute = await import('@/src/app/api/runtime/agent/jobs/[jobId]/approvals/route');
    const agentHeaders = { 'content-type': 'application/json', authorization: `Bearer ${claimed.token}` };
    const createdResponse = await agentRoute.POST(new Request(`http://localhost/api/runtime/agent/jobs/${job.id}/approvals`, {
      method: 'POST', headers: agentHeaders, body: JSON.stringify({ serverRequestId: '17', requestMethod: 'item/fileChange/requestApproval', kind: 'file-change', title: 'Apply local file changes', cwd: waiting.rootPath, details: { itemId: 'item-1' } })
    }), { params: Promise.resolve({ jobId: job.id }) });
    const created = (await createdResponse.json()).approval;
    expect(createdResponse.status).toBe(201);
    expect(created).toMatchObject({ runId: waiting.id, nodeId: 'prepare', status: 'pending' });

    const browserRoute = await import('@/src/app/api/runs/[runId]/tool-approvals/route');
    const ownerHeaders = { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${ownerSession.token}` };
    const otherHeaders = { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${otherSession.token}` };
    expect((await browserRoute.GET(new Request(`http://localhost/api/runs/${waiting.id}/tool-approvals`, { headers: otherHeaders }), { params: Promise.resolve({ runId: waiting.id }) })).status).toBe(404);
    const listed = await browserRoute.GET(new Request(`http://localhost/api/runs/${waiting.id}/tool-approvals`, { headers: ownerHeaders }), { params: Promise.resolve({ runId: waiting.id }) });
    expect((await listed.json()).approvals).toEqual([expect.objectContaining({ id: created.id, status: 'pending' })]);

    const decided = await browserRoute.POST(new Request(`http://localhost/api/runs/${waiting.id}/tool-approvals`, {
      method: 'POST', headers: ownerHeaders, body: JSON.stringify({ approvalId: created.id, decision: 'accept' })
    }), { params: Promise.resolve({ runId: waiting.id }) });
    expect((await decided.json()).approval).toMatchObject({ status: 'accepted', decision: 'accept', decidedBy: { id: owner.id } });
    const polled = await agentRoute.GET(new Request(`http://localhost/api/runtime/agent/jobs/${job.id}/approvals?approvalId=${created.id}`, { headers: agentHeaders }), { params: Promise.resolve({ jobId: job.id }) });
    expect((await polled.json()).approval).toMatchObject({ status: 'accepted', decision: 'accept' });
  });

  it('returns a redacted structured response to an MCP elicitation request', async () => {
    const { createSession, createUser, SESSION_COOKIE } = await import('@/src/auth/auth');
    const owner = await createUser({ name: 'Elicitation owner', email: 'elicitation-owner@example.com', password: 'password-123', role: 'builder', position: 'Developer' });
    if (!owner) throw new Error('User setup failed.');
    const session = await createSession(owner.id);
    const run = waitingApproval(owner.id);
    const { RunRepository } = await import('@/src/storage/run-repository');
    await new RunRepository().upsert(owner.id, run);
    const repository = await import('@/src/storage/runtime-connection-repository');
    const pairing = await repository.createRuntimePairing(owner.id);
    const claimed = await repository.claimRuntimePairing({ code: pairing.pairingCode, allowedRoots: [run.rootPath] });
    if (!claimed) throw new Error('Runtime pairing failed.');
    const job = await repository.enqueueRuntimeJob(owner.id, claimed.connection.id, 'focused-task', { metadata: { workflow_studio_run_id: run.id, workflow_studio_task_id: `${run.id}:prepare`, workflow_studio_node_id: 'prepare' } });
    await repository.leaseNextRuntimeJob(claimed.connection.id);
    const agentRoute = await import('@/src/app/api/runtime/agent/jobs/[jobId]/approvals/route');
    const agentHeaders = { 'content-type': 'application/json', authorization: `Bearer ${claimed.token}` };
    const createdResponse = await agentRoute.POST(new Request(`http://localhost/api/runtime/agent/jobs/${job.id}/approvals`, { method: 'POST', headers: agentHeaders, body: JSON.stringify({ serverRequestId: 'mcp-1', requestMethod: 'mcpServer/elicitation/request', kind: 'user-input', title: 'Choose a release channel', details: { requestedSchema: { type: 'object' } } }) }), { params: Promise.resolve({ jobId: job.id }) });
    const created = (await createdResponse.json()).approval;
    const browserRoute = await import('@/src/app/api/runs/[runId]/tool-approvals/route');
    const decided = await browserRoute.POST(new Request(`http://localhost/api/runs/${run.id}/tool-approvals`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${session.token}` }, body: JSON.stringify({ approvalId: created.id, decision: 'accept', response: { channel: 'staging', apiToken: 'sk_secret-value-123456' } }) }), { params: Promise.resolve({ runId: run.id }) });
    expect((await decided.json()).approval).toMatchObject({ status: 'accepted', response: { channel: 'staging', apiToken: '[redacted]' } });
    const polled = await agentRoute.GET(new Request(`http://localhost/api/runtime/agent/jobs/${job.id}/approvals?approvalId=${created.id}`, { headers: agentHeaders }), { params: Promise.resolve({ jobId: job.id }) });
    expect((await polled.json()).approval.response).toEqual({ channel: 'staging', apiToken: '[redacted]' });
  });

  it('cancels an active run and its leased companion job without accepting a late completion', async () => {
    const { createSession, createUser, SESSION_COOKIE } = await import('@/src/auth/auth');
    const owner = await createUser({ name: 'Cancellation owner', email: 'cancellation-owner@example.com', password: 'password-123', role: 'builder', position: 'Developer' });
    if (!owner) throw new Error('User setup failed.');
    const session = await createSession(owner.id);
    const run = waitingApproval(owner.id);
    const { RunRepository } = await import('@/src/storage/run-repository');
    await new RunRepository().upsert(owner.id, run);
    const repository = await import('@/src/storage/runtime-connection-repository');
    const pairing = await repository.createRuntimePairing(owner.id);
    const claimed = await repository.claimRuntimePairing({ code: pairing.pairingCode, allowedRoots: [run.rootPath] });
    if (!claimed) throw new Error('Runtime pairing failed.');
    const queued = await repository.enqueueRuntimeJob(owner.id, claimed.connection.id, 'focused-task', { metadata: { workflow_studio_run_id: run.id } });
    const leased = await repository.leaseNextRuntimeJob(claimed.connection.id);
    if (!leased?.leaseId) throw new Error('Runtime lease failed.');
    const route = await import('@/src/app/api/runs/[runId]/cancel/route');
    const response = await route.POST(new Request(`http://localhost/api/runs/${run.id}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${session.token}` }, body: JSON.stringify({ reason: 'Stop this run.' }) }), { params: Promise.resolve({ runId: run.id }) });
    expect((await response.json()).run).toMatchObject({ status: 'cancelled' });
    expect(await repository.getRuntimeJob(owner.id, queued.id)).toMatchObject({ status: 'cancelled', error: 'Workflow run was cancelled.' });
    expect(await repository.completeRuntimeJob(claimed.connection.id, queued.id, leased.leaseId, { result: { raw: 'late' } })).toBe(false);
  });
});
