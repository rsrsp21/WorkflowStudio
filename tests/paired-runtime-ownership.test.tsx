import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RuntimeConnectionPanel from '@/src/components/runtime-connection-panel';
import { validResponse } from './fixtures';

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-paired-runtime-'));
  vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory);
  vi.stubEnv('CODEX_RUNTIME_MODE', 'paired');
  vi.resetModules();
});

afterEach(async () => {
  const { resetDatabaseForTests } = await import('@/src/storage/async-database');
  await resetDatabaseForTests();
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(directory, { recursive: true, force: true });
});

async function userSession(email: string) {
  const { createSession, createUser, SESSION_COOKIE } = await import('@/src/auth/auth');
  const user = await createUser({ name: email.split('@')[0], email, password: 'password-123', role: 'builder', position: 'Developer' });
  if (!user) throw new Error('User setup failed.');
  const session = await createSession(user.id);
  return { user, headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${session.token}` } };
}

async function waitForLease(repository: typeof import('@/src/storage/runtime-connection-repository'), connectionId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = await repository.leaseNextRuntimeJob(connectionId);
    if (job) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected the paired runtime to receive a queued job.');
}

describe('paired user-owned Codex runtimes', () => {
  it('preserves completion when deadline cancellation loses and fences completion when cancellation wins', async () => {
    const owner = await userSession('completion-deadline@example.com');
    const repository = await import('@/src/storage/runtime-connection-repository');
    const pairing = await repository.createRuntimePairing(owner.user.id);
    const claimed = await repository.claimRuntimePairing({ code: pairing.pairingCode, allowedRoots: [directory] });
    if (!claimed) throw new Error('Runtime setup failed.');
    const enqueue = () => repository.enqueueRuntimeJob(owner.user.id, claimed.connection.id, 'focused-task', {
      cwd: directory, prompt: 'Deterministic test task.', permission: 'read-only'
    });

    const first = await enqueue();
    const firstLease = await repository.leaseNextRuntimeJob(claimed.connection.id);
    if (!firstLease?.leaseId) throw new Error('Runtime lease failed.');
    const result = { raw: 'verified output' };
    expect(await repository.completeRuntimeJob(claimed.connection.id, first.id, firstLease.leaseId, { result })).toBe(true);
    await repository.cancelRuntimeJob(owner.user.id, first.id);
    expect(await repository.getRuntimeJob(owner.user.id, first.id)).toMatchObject({ status: 'completed', result });
    // Lost HTTP acknowledgement: replay the same completion, not the provider task.
    expect(await repository.completeRuntimeJob(claimed.connection.id, first.id, firstLease.leaseId, { result })).toBe(true);
    expect(await repository.completeRuntimeJob(claimed.connection.id, first.id, firstLease.leaseId, { result: { raw: 'conflicting output' } })).toBe(false);

    const second = await enqueue();
    const secondLease = await repository.leaseNextRuntimeJob(claimed.connection.id);
    if (!secondLease?.leaseId) throw new Error('Second runtime lease failed.');
    await repository.cancelRuntimeJob(owner.user.id, second.id);
    expect(await repository.completeRuntimeJob(claimed.connection.id, second.id, secondLease.leaseId, { result })).toBe(false);
    expect(await repository.getRuntimeJob(owner.user.id, second.id)).toMatchObject({ status: 'cancelled' });
  });

  it('uses one-time pairing, hashed runtime credentials, and user-scoped jobs', async () => {
    const first = await userSession('first@example.com');
    const second = await userSession('second@example.com');
    const repository = await import('@/src/storage/runtime-connection-repository');
    const firstPairing = await repository.createRuntimePairing(first.user.id);
    const secondPairing = await repository.createRuntimePairing(second.user.id);
    const claimed = await repository.claimRuntimePairing({ code: firstPairing.pairingCode, hostname: 'FIRST-PC', allowedRoots: [directory] });
    expect(claimed?.connection).toMatchObject({ hostname: 'FIRST-PC', allowedRoots: [directory] });
    expect(await repository.claimRuntimePairing({ code: firstPairing.pairingCode })).toBeNull();
    expect((await repository.authenticateRuntimeToken(claimed?.token))?.userId).toBe(first.user.id);
    await repository.heartbeatRuntime(claimed!.connection.id, { authMode: 'chatgpt', codexAccountLabel: 'first@example.com' });
    expect(await repository.getOnlineRuntimeConnection(first.user.id)).toMatchObject({ authMode: 'chatgpt', codexAccountLabel: 'first@example.com' });
    await repository.heartbeatRuntime(claimed!.connection.id, {});
    expect(await repository.getOnlineRuntimeConnection(first.user.id)).toMatchObject({ authMode: 'chatgpt', codexAccountLabel: 'first@example.com' });
    expect(await repository.getOnlineRuntimeConnection(second.user.id)).toBeNull();

    const job = await repository.enqueueRuntimeJob(first.user.id, claimed!.connection.id, 'planning', {
      cwd: directory, prompt: 'Plan.', outputSchema: { type: 'object' }, permission: 'read-only', serviceName: 'test'
    });
    const leased = await repository.leaseNextRuntimeJob(claimed!.connection.id);
    expect(leased).toMatchObject({ id: job.id, userId: first.user.id, status: 'leased' });
    expect(await repository.appendRuntimeJobEvent('another-runtime', job.id, leased!.leaseId!, 0, { type: 'turn/started' })).toBe(false);
    expect(await repository.appendRuntimeJobEvent(claimed!.connection.id, job.id, leased!.leaseId!, 0, { type: 'turn/started' })).toBe(true);
    expect(await repository.appendRuntimeJobEvent(claimed!.connection.id, job.id, leased!.leaseId!, 0, { type: 'duplicate' })).toBe(true);
    expect(await repository.listRuntimeJobEvents(first.user.id, job.id)).toEqual([{ sequence: 0, payload: { type: 'turn/started' } }]);
    expect(await repository.listRuntimeJobEvents(second.user.id, job.id)).toEqual([]);
    expect(await repository.completeRuntimeJob(claimed!.connection.id, job.id, 'wrong-lease', { result: {} })).toBe(false);
    expect(await repository.completeRuntimeJob(claimed!.connection.id, job.id, leased!.leaseId!, { result: { raw: '{}' } })).toBe(true);

    const { getDatabase } = await import('@/src/storage/async-database');
    const stored = await (await getDatabase()).get<{ pairing_code_hash: string | null; token_hash: string }>('SELECT pairing_code_hash, token_hash FROM runtime_connections WHERE id = ?', [claimed!.connection.id]);
    if (!stored) throw new Error('Runtime connection was not persisted.');
    expect(stored.pairing_code_hash).toBeNull();
    expect(stored.token_hash).not.toBe(claimed!.token);
    expect(secondPairing.pairingCode).not.toBe(firstPairing.pairingCode);
  });

  it('keeps browser and companion authentication separate', async () => {
    const owner = await userSession('owner@example.com');
    const connectionsRoute = await import('@/src/app/api/runtime/connections/route');
    const unauthenticated = await connectionsRoute.POST(new Request('http://localhost/api/runtime/connections', { method: 'POST' }));
    expect(unauthenticated.status).toBe(401);
    const created = await connectionsRoute.POST(new Request('http://localhost/api/runtime/connections', { method: 'POST', headers: owner.headers, body: '{}' }));
    const pairing = (await created.json()).pairing;

    const pairRoute = await import('@/src/app/api/runtime/pair/route');
    const paired = await pairRoute.POST(new Request('http://localhost/api/runtime/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.pairingCode, allowedRoots: [directory] }) }));
    const pairedBody = await paired.json();
    expect(paired.status).toBe(200);

    const heartbeatRoute = await import('@/src/app/api/runtime/agent/heartbeat/route');
    expect((await heartbeatRoute.POST(new Request('http://localhost/api/runtime/agent/heartbeat', { method: 'POST', body: '{}' }))).status).toBe(401);
    expect((await heartbeatRoute.POST(new Request('http://localhost/api/runtime/agent/heartbeat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${pairedBody.token}` }, body: JSON.stringify({ authMode: 'chatgpt', protocolVersion: 0, companionVersion: 'old' }) }))).status).toBe(426);
    const heartbeat = await heartbeatRoute.POST(new Request('http://localhost/api/runtime/agent/heartbeat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${pairedBody.token}` }, body: JSON.stringify({ authMode: 'chatgpt', codexAccountLabel: 'owner@example.com', protocolVersion: 1, companionVersion: '0.1.0' }) }));
    expect(heartbeat.status).toBe(200);

    const listed = await connectionsRoute.GET(new Request('http://localhost/api/runtime/connections', { headers: owner.headers }));
    expect(await listed.json()).toMatchObject({ mode: 'paired', connections: [expect.objectContaining({ status: 'online', authMode: 'chatgpt', protocolVersion: 1, companionVersion: '0.1.0' })] });
  });

  it('renews, reclaims, and fences companion leases without duplicating an execution attempt', async () => {
    const owner = await userSession('lease-owner@example.com');
    const repository = await import('@/src/storage/runtime-connection-repository');
    const pairing = await repository.createRuntimePairing(owner.user.id);
    const claimed = await repository.claimRuntimePairing({ code: pairing.pairingCode, allowedRoots: [directory] });
    if (!claimed) throw new Error('Runtime setup failed.');
    const payload = {
      prompt: 'Execute once.',
      metadata: {
        workflow_studio_run_id: 'run_lease', workflow_studio_task_id: 'run_lease:node', workflow_studio_node_id: 'node',
        workflow_studio_attempt: '1', workflow_studio_iteration: '0'
      }
    };
    const queued = await repository.enqueueRuntimeJob(owner.user.id, claimed.connection.id, 'focused-task', payload, new Date('2026-09-09T00:00:00.000Z'));
    expect((await repository.enqueueRuntimeJob(owner.user.id, claimed.connection.id, 'focused-task', payload, new Date('2026-09-09T00:00:01.000Z'))).id).toBe(queued.id);
    const firstLease = await repository.leaseNextRuntimeJob(claimed.connection.id, new Date('2026-09-09T00:00:02.000Z'));
    if (!firstLease?.leaseId) throw new Error('Initial lease failed.');
    expect(await repository.renewRuntimeJobLease(claimed.connection.id, queued.id, firstLease.leaseId, new Date('2026-09-09T00:00:50.000Z'))).toBe(true);
    expect(await repository.leaseNextRuntimeJob(claimed.connection.id, new Date('2026-09-09T00:01:30.000Z'))).toBeNull();

    const reclaimed = await repository.leaseNextRuntimeJob(claimed.connection.id, new Date('2026-09-09T00:01:51.000Z'));
    expect(reclaimed?.id).toBe(queued.id);
    expect(reclaimed?.leaseId).not.toBe(firstLease.leaseId);
    expect(await repository.appendRuntimeJobEvent(claimed.connection.id, queued.id, firstLease.leaseId, 0, { type: 'late' })).toBe(false);
    expect(await repository.completeRuntimeJob(claimed.connection.id, queued.id, firstLease.leaseId, { result: { raw: 'late' } })).toBe(false);
    expect(await repository.appendRuntimeJobEvent(claimed.connection.id, queued.id, reclaimed!.leaseId!, 0, { type: 'active' })).toBe(true);
    expect(await repository.completeRuntimeJob(claimed.connection.id, queued.id, reclaimed!.leaseId!, { result: { raw: 'done' } })).toBe(true);
    expect(await repository.completeRuntimeJob(claimed.connection.id, queued.id, reclaimed!.leaseId!, { result: { raw: 'done' } })).toBe(true);
  });

  it('dispatches planning through the signed-in user runtime instead of the web host', async () => {
    const owner = await userSession('planner@example.com');
    const repository = await import('@/src/storage/runtime-connection-repository');
    const pairing = await repository.createRuntimePairing(owner.user.id);
    const claimed = await repository.claimRuntimePairing({ code: pairing.pairingCode, allowedRoots: [directory] });
    if (!claimed) throw new Error('Runtime setup failed.');
    await repository.heartbeatRuntime(claimed.connection.id, { authMode: 'chatgpt', codexAccountLabel: 'planner@example.com' });

    const { PairedCodexRuntimeAdapter } = await import('@/src/adapters/paired-runtime-adapter');
    const planning = new PairedCodexRuntimeAdapter(owner.user.id).createPlanningThread({
      workflowName: 'Paired plan', planningPrompt: 'Create a review workflow.', workspacePath: directory,
      constraints: [], outputRequirements: [],
      executionSettings: { approvalPolicy: 'destructive-actions', sandboxMode: 'read-only', maxRetries: 1, maxConcurrentNodes: 1, planningModel: 'gpt-5.6-sol', planningReasoningEffort: 'medium' }
    });
    const leased = await repository.leaseNextRuntimeJob(claimed.connection.id);
    expect(leased).toMatchObject({ userId: owner.user.id, connectionId: claimed.connection.id, kind: 'planning' });
    expect(leased?.payload).toMatchObject({ cwd: directory, permission: 'read-only', serviceName: 'workflow_studio_planning' });
    await repository.completeRuntimeJob(claimed.connection.id, leased!.id, leased!.leaseId!, { result: { raw: JSON.stringify(validResponse()), providerThreadId: 'thread-user-runtime' } });

    await expect(planning).resolves.toMatchObject({ ok: true, value: { trace: { planningThreadId: 'thread-user-runtime' } } });
  });

  it('routes local project inspection and installed-skill discovery to the owning user companion', async () => {
    const owner = await userSession('workspace-owner@example.com');
    const repository = await import('@/src/storage/runtime-connection-repository');
    const pairing = await repository.createRuntimePairing(owner.user.id);
    const claimed = await repository.claimRuntimePairing({ code: pairing.pairingCode, allowedRoots: [directory] });
    if (!claimed) throw new Error('Runtime setup failed.');
    await repository.heartbeatRuntime(claimed.connection.id, { authMode: 'chatgpt', codexAccountLabel: owner.user.email });

    const inspectRoute = await import('@/src/app/api/projects/inspect/route');
    const inspectionResponse = inspectRoute.POST(new Request('http://localhost/api/projects/inspect', {
      method: 'POST', headers: owner.headers, body: JSON.stringify({ rootPath: directory })
    }));
    const inspectionJob = await waitForLease(repository, claimed.connection.id);
    expect(inspectionJob).toMatchObject({ userId: owner.user.id, kind: 'workspace-inspection', payload: { operation: 'inspect', rootPath: directory } });
    await repository.completeRuntimeJob(claimed.connection.id, inspectionJob.id, inspectionJob.leaseId!, {
      result: { inspection: { rootPath: directory, workspaceKind: 'empty', entryCount: 0, directoryCount: 0, fileCount: 0, hasGitMetadata: false, inspectionMode: 'read-only', inspectedAt: new Date().toISOString() } }
    });
    await expect(inspectionResponse.then((response) => response.json())).resolves.toMatchObject({ inspection: { rootPath: directory, inspectionMode: 'read-only' } });

    const { discoverUserCodexSkills } = await import('@/src/storage/codex-skill-catalog');
    const skillResponse = discoverUserCodexSkills(owner.user.id);
    const skillJob = await waitForLease(repository, claimed.connection.id);
    expect(skillJob).toMatchObject({ userId: owner.user.id, kind: 'skill-discovery' });
    await repository.completeRuntimeJob(claimed.connection.id, skillJob.id, skillJob.leaseId!, {
      result: { skills: [{ id: 'imagegen', name: 'imagegen', description: 'Generate images.', source: 'installed-codex' }] }
    });
    await expect(skillResponse).resolves.toEqual([{ id: 'imagegen', name: 'imagegen', description: 'Generate images.', source: 'installed-codex' }]);
  });

  it('does not expose one user saved project roots to another user', async () => {
    const first = await userSession('projects-first@example.com');
    const second = await userSession('projects-second@example.com');
    const { createProject } = await import('@/src/domain/workspace');
    const { createWorkspaceStores } = await import('@/src/storage/workspace-stores');
    const { claimProjectOwnership } = await import('@/src/storage/project-ownership-repository');
    const firstStores = createWorkspaceStores(directory, first.user.id);
    const secondStores = createWorkspaceStores(directory, second.user.id);
    const firstProject = createProject({ id: 'first-project', name: 'First project', rootPath: path.join(directory, 'first'), workspaceKind: 'empty' });
    const secondProject = createProject({ id: 'second-project', name: 'Second project', rootPath: path.join(directory, 'second'), workspaceKind: 'empty' });
    await Promise.all([firstStores.projects.writeAll([firstProject]), secondStores.projects.writeAll([secondProject])]);
    await claimProjectOwnership(first.user.id, firstProject.id);
    await claimProjectOwnership(second.user.id, secondProject.id);

    const projectsRoute = await import('@/src/app/api/projects/route');
    const firstResult = await (await projectsRoute.GET(new Request('http://localhost/api/projects', { headers: first.headers }))).json();
    const secondResult = await (await projectsRoute.GET(new Request('http://localhost/api/projects', { headers: second.headers }))).json();
    expect(firstResult.projects.map((project: { id: string }) => project.id)).toEqual([firstProject.id]);
    expect(secondResult.projects.map((project: { id: string }) => project.id)).toEqual([secondProject.id]);
  });

  it('explains that pairing uses local Codex authentication instead of an API key', () => {
    const html = renderToStaticMarkup(<RuntimeConnectionPanel />);
    expect(html).toContain('Generate pairing code');
    expect(html).toContain('Workflow Studio Companion');
    expect(html).not.toContain('npm run');
    expect(html).toContain('No OpenAI API key is collected');
    expect(html).toContain('Codex authentication stays in the private local runtime');
  });
});
