import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowPlan } from '@/src/domain/models';
import type { NodeTaskExecutor } from '@/src/domain/runtime-engine';
import { updateRunExecutionSettings } from '@/src/domain/run-execution-settings';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';
import { RuntimeUnavailableError } from '@/src/domain/runtime-unavailable';
import type { Mastra } from '@mastra/core/mastra';

let directory = '';
let adapters: Array<{ close(): Promise<void> }> = [];

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-mastra-control-'));
  vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory);
  vi.resetModules();
  adapters = [];
});

afterEach(async () => {
  await Promise.all(adapters.map((adapter) => adapter.close().catch(() => undefined)));
  const { resetDatabaseForTests } = await import('@/src/storage/async-database');
  await resetDatabaseForTests();
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EBUSY') throw error;
  });
});

function graph(kind: 'branch' | 'loop' | 'approval'): WorkflowPlan {
  const rootPath = path.join(directory, 'project');
  const base = {
    schemaVersion: 1, description: 'Mastra control flow test.', planningPrompt: 'Execute the graph.', workspacePath: rootPath,
    constraints: [], openQuestions: [], completionCriteria: ['The workflow reaches an explicit terminal.'],
    harness: { sandboxMode: 'read-only' as const, maxRetries: 1, maxLoopIterations: 2, maxConcurrentNodes: 1, allowedTools: [], allowedWorkspacePaths: [rootPath], requireApprovalForDestructiveActions: true },
    status: 'approved' as const, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z'
  };
  if (kind === 'branch') return {
    ...base, id: 'mastra-branch', name: 'Mastra branch',
    nodes: [
      { id: 'route', name: 'Route', type: 'validation', prompt: 'Choose.', skillIds: [], inputKeys: ['project'], outputKeys: ['choice'], retryLimit: 1, requiresApproval: false },
      { id: 'success', name: 'Success', type: 'success', prompt: 'Finish.', skillIds: [], inputKeys: ['choice'], outputKeys: ['result'], retryLimit: 0, requiresApproval: false },
      { id: 'failure', name: 'Failure', type: 'failure', prompt: 'Stop.', skillIds: [], inputKeys: ['choice'], outputKeys: ['reason'], retryLimit: 0, requiresApproval: false }
    ],
    edges: [{ from: 'route', to: 'success', condition: 'accept' }, { from: 'route', to: 'failure', condition: 'stop' }]
  };
  if (kind === 'approval') return {
    ...base, id: 'mastra-approval', name: 'Mastra approval',
    nodes: [
      { id: 'start', name: 'Start', type: 'agent', prompt: 'Start.', skillIds: [], inputKeys: ['project'], outputKeys: ['brief'], retryLimit: 0, requiresApproval: false },
      { id: 'prepare', name: 'Prepare', type: 'codex', prompt: 'Prepare.', skillIds: [], inputKeys: ['brief'], outputKeys: ['draft'], retryLimit: 0, requiresApproval: false },
      { id: 'approve', name: 'Approve', type: 'approval', prompt: 'Review.', skillIds: [], inputKeys: ['draft'], outputKeys: ['decision'], retryLimit: 0, requiresApproval: true, approvalOptions: [
        { id: 'ship', label: 'Ship', keyword: 'SHIP', action: 'continue' }, { id: 'revise', label: 'Revise', keyword: 'REVISE', action: 'revise' }, { id: 'stop', label: 'Stop', keyword: 'STOP', action: 'stop' }
      ] },
      { id: 'revision', name: 'Revision route', type: 'loop', prompt: 'Route feedback.', skillIds: [], inputKeys: ['decision'], outputKeys: ['revision'], retryLimit: 0, requiresApproval: false },
      { id: 'success', name: 'Success', type: 'success', prompt: 'Finish.', skillIds: [], inputKeys: ['decision'], outputKeys: ['result'], retryLimit: 0, requiresApproval: false },
      { id: 'failure', name: 'Failure', type: 'failure', prompt: 'Stop.', skillIds: [], inputKeys: ['decision'], outputKeys: ['reason'], retryLimit: 0, requiresApproval: false }
    ],
    edges: [
      { from: 'start', to: 'prepare' }, { from: 'prepare', to: 'approve' }, { from: 'approve', to: 'success', condition: 'SHIP' },
      { from: 'approve', to: 'revision', condition: 'REVISE' }, { from: 'approve', to: 'failure', condition: 'STOP' },
      { from: 'revision', to: 'prepare', condition: 'revise' }
    ]
  };
  return {
    ...base, id: 'mastra-loop', name: 'Mastra loop',
    nodes: [
      { id: 'start', name: 'Start', type: 'agent', prompt: 'Start.', skillIds: [], inputKeys: ['project'], outputKeys: ['brief'], retryLimit: 0, requiresApproval: false },
      { id: 'draft', name: 'Draft', type: 'codex', prompt: 'Draft.', skillIds: [], inputKeys: ['brief'], outputKeys: ['draft'], retryLimit: 0, requiresApproval: false },
      { id: 'review', name: 'Review', type: 'validation', prompt: 'Review.', skillIds: [], inputKeys: ['draft'], outputKeys: ['review'], retryLimit: 0, requiresApproval: false },
      { id: 'gate', name: 'Gate', type: 'loop', prompt: 'Route.', skillIds: [], inputKeys: ['review'], outputKeys: ['decision'], retryLimit: 0, requiresApproval: false },
      { id: 'revise', name: 'Revise', type: 'codex', prompt: 'Revise.', skillIds: [], inputKeys: ['review'], outputKeys: ['revision'], retryLimit: 0, requiresApproval: false },
      { id: 'success', name: 'Success', type: 'success', prompt: 'Finish.', skillIds: [], inputKeys: ['decision'], outputKeys: ['result'], retryLimit: 0, requiresApproval: false },
      { id: 'failure', name: 'Failure', type: 'failure', prompt: 'Stop.', skillIds: [], inputKeys: ['decision'], outputKeys: ['reason'], retryLimit: 0, requiresApproval: false }
    ],
    edges: [
      { from: 'start', to: 'draft' }, { from: 'draft', to: 'review' }, { from: 'review', to: 'gate' }, { from: 'gate', to: 'revise', condition: 'revise' },
      { from: 'gate', to: 'success', condition: 'accept' }, { from: 'gate', to: 'failure', condition: 'stop' }, { from: 'revise', to: 'draft' }
    ]
  };
}

function assignmentFor(plan: WorkflowPlan) {
  const project = createProject({ id: `${plan.id}-project`, name: plan.name, rootPath: plan.workspacePath, workspaceKind: 'workspace' });
  const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: 'Testing', status: 'published' });
  return createProjectWorkflow({
    id: `${plan.id}-assignment`, project, workflow, status: 'ready', graphOverride: plan, approval: testAssignmentApproval(workflow.version),
    inputOverrides: { project: plan.workspacePath }, permissions: { sandboxMode: 'read-only', allowedWorkspacePaths: [plan.workspacePath], requireApprovalForDestructiveActions: true }
  });
}

async function userAndRepository() {
  const { createUser } = await import('@/src/auth/auth');
  const user = await createUser({ name: 'Mastra owner', email: `mastra-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'builder' });
  if (!user) throw new Error('Could not create test user.');
  const { RunRepository } = await import('@/src/storage/run-repository');
  return { user, repository: new RunRepository() };
}

describe('Phase 7 Mastra control flow and PostgreSQL recovery', () => {
  it('rechecks an explicitly rejected validation from durable state without a new workflow run', async () => {
    const { user, repository } = await userAndRepository();
    const source = graph('branch');
    let valid = false;
    const executed: string[] = [];
    const executor: NodeTaskExecutor = { execute: async ({ node }) => {
      executed.push(node.id);
      if (node.id === 'route') return { output: { choice: valid ? 'accept' : 'stop' }, selectedCondition: valid ? 'accept' : 'stop' };
      return node.id === 'failure' ? { output: { reason: 'Rejected mapping' } } : { output: { result: 'Checked' } };
    } };
    const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
    const schema = `test_${path.basename(directory).replace(/\W/g, '_')}_recheck`;
    const first = new LocalMastraAdapter({ executor, store: repository, storageSchema: schema }); adapters.push(first);
    const compiled = await first.compile(user.id, source, assignmentFor(source), [], 'run_validation-recheck');
    if (!compiled.run || !compiled.registration) throw new Error(compiled.errors.join(' '));
    await first.start(compiled.registration.registrationKey, compiled.run.id, { userId: user.id, run: compiled.run });
    const failed = await repository.read(user.id, compiled.run.id);
    expect(failed?.status).toBe('failed');
    const { recheckRejectedValidation } = await import('@/src/domain/runtime-engine');
    const ready = recheckRejectedValidation(failed!).run;
    await repository.upsert(user.id, ready); await first.close(); valid = true;
    const second = new LocalMastraAdapter({ executor, store: repository, storageSchema: schema }); adapters.push(second);
    await second.start(compiled.registration.registrationKey, ready.id, { userId: user.id, run: ready });
    const completed = await repository.read(user.id, ready.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.events.slice(0, failed!.events.length)).toEqual(failed!.events);
    expect(executed).toEqual(['route', 'failure', 'route', 'success']);
  }, 60_000);
  it('returns when the runtime disconnects and resumes without exhausting retries', async () => {
    const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
    const { user, repository } = await userAndRepository();
    let online = false;
    const execute = vi.fn(async (task: Parameters<NodeTaskExecutor['execute']>[0]) => {
      if (!online) throw new RuntimeUnavailableError();
      return task.node.id === 'route' ? { output: { choice: 'accept' }, selectedCondition: 'accept' } : { output: { result: 'Done' } };
    });
    const adapter = new LocalMastraAdapter({ executor: { execute }, store: repository, storageSchema: 'runtime_reconnect' });
    adapters.push(adapter);
    const source = graph('branch');
    const compiled = await adapter.compile(user.id, source, assignmentFor(source), [], 'run_mastra-reconnect');
    if (!compiled.run || !compiled.registration) throw new Error(compiled.errors.join(' '));
    await adapter.start(compiled.registration.registrationKey, compiled.run.id, { userId: user.id, run: compiled.run });
    const waiting = await repository.read(user.id, compiled.run.id);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(waiting?.runtimeWaiting?.nodeId).toBe('route');
    expect(waiting?.nodeRuns[0]).toMatchObject({ status: 'pending', attempt: 0 });
    online = true;
    await adapter.start(compiled.registration.registrationKey, compiled.run.id, { userId: user.id, run: waiting! });
    const completed = await repository.read(user.id, compiled.run.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.runtimeWaiting).toBeUndefined();
    expect(completed?.nodeRuns[0].attempt).toBe(1);
  });

  it('preserves exact branch selection and retries through a Mastra loop', async () => {
    const { user, repository } = await userAndRepository();
    const source = graph('branch');
    let routeAttempts = 0;
    const executor: NodeTaskExecutor = { execute: async ({ node }) => {
      if (node.id === 'route' && routeAttempts++ === 0) throw new Error('Temporary failure.');
      if (node.id === 'route') return { output: { choice: 'accept' }, selectedCondition: 'accept' };
      if (node.id === 'success') return { output: { result: 'done' } };
      return { output: { reason: 'stopped' } };
    } };
    const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
    const adapter = new LocalMastraAdapter({ executor, store: repository, storageSchema: `test_${path.basename(directory).replace(/\W/g, '_')}_branch` });
    adapters.push(adapter);
    const compiled = await adapter.compile(user.id, source, assignmentFor(source), [], 'run_mastra-branch');
    if (!compiled.run || !compiled.registration) throw new Error(compiled.errors.join(' '));
    const result = await adapter.start(compiled.registration.registrationKey, compiled.run.id, { userId: user.id, run: compiled.run }) as { status: string };
    const saved = await repository.read(user.id, compiled.run.id);
    expect(result.status).toBe('success');
    expect(routeAttempts).toBe(2);
    expect(saved).toMatchObject({ status: 'completed', mastra: { status: 'completed', runId: compiled.run.id } });
    expect(saved?.edgeRuns.find((edge) => edge.from === 'route' && edge.to === 'success')).toMatchObject({ status: 'selected', traversalCount: 1 });
    expect(saved?.nodeRuns.find((node) => node.nodeId === 'failure')?.status).toBe('skipped');
    await adapter.close();
  }, 60_000);

  it('executes a bounded revision loop and exits on the configured route', async () => {
    const { user, repository } = await userAndRepository();
    const source = graph('loop');
    let gateVisits = 0;
    const executor: NodeTaskExecutor = { execute: async ({ node }) => {
      if (node.id === 'start') return { output: { brief: 'requirements' } };
      if (node.id === 'draft') return { output: { draft: gateVisits ? 'v2' : 'v1' } };
      if (node.id === 'review') return { output: { review: gateVisits ? 'ready' : 'revise' } };
      if (node.id === 'gate') { gateVisits += 1; const route = gateVisits === 1 ? 'revise' : 'accept'; return { output: { decision: route }, selectedCondition: route }; }
      if (node.id === 'revise') return { output: { revision: 'changes' } };
      if (node.id === 'success') return { output: { result: 'v2' } };
      return { output: { reason: 'stopped' } };
    } };
    const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
    const adapter = new LocalMastraAdapter({ executor, store: repository, storageSchema: `test_${path.basename(directory).replace(/\W/g, '_')}_loop` });
    adapters.push(adapter);
    const compiled = await adapter.compile(user.id, source, assignmentFor(source), [], 'run_mastra-loop');
    if (!compiled.run || !compiled.registration) throw new Error(compiled.errors.join(' '));
    const result = await adapter.start(compiled.registration.registrationKey, compiled.run.id, { userId: user.id, run: compiled.run }) as { status: string; error?: unknown };
    if (result.status !== 'success') throw new Error(`Mastra loop failed: ${JSON.stringify({ error: result.error ?? result, saved: await repository.read(user.id, compiled.run.id) })}`);
    const saved = await repository.read(user.id, compiled.run.id);
    expect(saved).toMatchObject({ status: 'completed', loopIterations: { gate: 1 }, mastra: { status: 'completed' } });
    expect(saved?.nodeRuns.find((node) => node.nodeId === 'draft')).toMatchObject({ status: 'completed', iteration: 1 });
    await adapter.close();
  }, 60_000);

  it('stops deterministically when a Mastra revision path exhausts its loop bound', async () => {
    const { user, repository } = await userAndRepository();
    const source = graph('loop');
    source.harness.maxLoopIterations = 1;
    const executor: NodeTaskExecutor = { execute: async ({ node }) => {
      if (node.id === 'start') return { output: { brief: 'requirements' } };
      if (node.id === 'draft') return { output: { draft: 'draft' } };
      if (node.id === 'review') return { output: { review: 'revise' } };
      if (node.id === 'gate') return { output: { decision: 'revise' }, selectedCondition: 'revise' };
      if (node.id === 'revise') return { output: { revision: 'changes' } };
      if (node.id === 'success') return { output: { result: 'unexpected' } };
      return { output: { reason: 'stopped' } };
    } };
    const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
    const adapter = new LocalMastraAdapter({ executor, store: repository, storageSchema: `test_${path.basename(directory).replace(/\W/g, '_')}_loop_limit` });
    adapters.push(adapter);
    const compiled = await adapter.compile(user.id, source, assignmentFor(source), [], 'run_mastra-loop-limit');
    if (!compiled.run || !compiled.registration) throw new Error(compiled.errors.join(' '));
    await adapter.start(compiled.registration.registrationKey, compiled.run.id, { userId: user.id, run: compiled.run });
    const saved = await repository.read(user.id, compiled.run.id);
    expect(saved).toMatchObject({ status: 'failed', loopIterations: { gate: 1 }, mastra: { status: 'failed' } });
    expect(saved?.nodeRuns.find((node) => node.nodeId === 'gate')?.error).toBe('Loop limit exhausted after 1 iterations.');
  }, 60_000);

  it('cancels an active Mastra run once and fences its late node failure', async () => {
    const { user, repository } = await userAndRepository();
    const source = graph('branch');
    let rejectExecution: ((error: Error) => void) | undefined;
    const executor: NodeTaskExecutor = { execute: () => new Promise((_, reject) => { rejectExecution = reject; }) };
    const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
    const adapter = new LocalMastraAdapter({ executor, store: repository, storageSchema: `test_${path.basename(directory).replace(/\W/g, '_')}_cancel` });
    adapters.push(adapter);
    const compiled = await adapter.compile(user.id, source, assignmentFor(source), [], 'run_mastra-cancel');
    if (!compiled.run || !compiled.registration) throw new Error(compiled.errors.join(' '));
    const execution = adapter.start(compiled.registration.registrationKey, compiled.run.id, { userId: user.id, run: compiled.run });
    for (let attempt = 0; !(await repository.read(user.id, compiled.run.id))?.nodeRuns.some((node) => node.status === 'running') && attempt < 100; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const cancelled = await adapter.cancel(user.id, compiled.run.id, { actor: { id: user.id, name: user.name, role: user.role }, reason: 'Stop active work.' });
    expect(cancelled).toMatchObject({ status: 'cancelled', mastra: { status: 'cancelled' } });
    rejectExecution?.(new Error('Late companion failure.'));
    await execution.catch(() => undefined);
    const saved = await repository.read(user.id, compiled.run.id);
    expect(saved).toMatchObject({ status: 'cancelled', mastra: { status: 'cancelled' } });
    expect(saved?.events.filter((event) => event.type === 'run.cancelled')).toHaveLength(1);
    expect(saved?.events.some((event) => event.message.includes('Late companion failure'))).toBe(false);
  }, 60_000);

  it('keeps an invalid approval suspended, then recovers and resumes once', async () => {
    const { user, repository } = await userAndRepository();
    const source = graph('approval');
    const executor: NodeTaskExecutor = { execute: async ({ node }) => {
      if (node.id === 'start') return { output: { brief: 'requirements' } };
      if (node.id === 'prepare') return { output: { draft: 'review me' } };
      if (node.id === 'revision') return { output: { revision: 'revise' }, selectedCondition: 'revise' };
      if (node.id === 'success') return { output: { result: 'approved' } };
      return { output: { reason: 'stopped' } };
    } };
    const storageSchema = `test_${path.basename(directory).replace(/\W/g, '_')}_approval`;
    const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
    const first = new LocalMastraAdapter({ executor, store: repository, storageSchema });
    adapters.push(first);
    const compiled = await first.compile(user.id, source, assignmentFor(source), [], 'run_mastra-approval');
    if (!compiled.run || !compiled.registration) throw new Error(compiled.errors.join(' '));
    const suspended = await first.start(compiled.registration.registrationKey, compiled.run.id, { userId: user.id, run: compiled.run }) as { status: string };
    if (suspended.status !== 'suspended') throw new Error(`Approval did not suspend: ${JSON.stringify({ result: suspended, saved: await repository.read(user.id, compiled.run.id) })}`);
    const waiting = await repository.read(user.id, compiled.run.id);
    const approval = waiting?.approvalRecords[0];
    expect(waiting).toMatchObject({ status: 'paused', mastra: { status: 'suspended', activeStepId: 'approve' } });
    if (!approval) throw new Error('Approval was not persisted.');
    const second = new LocalMastraAdapter({ executor, store: repository, storageSchema });
    adapters.push(second);
    const recovered = await second.recover(user.id, compiled.run.id) as { status: string };
    expect(recovered.status).toBe('suspended');
    await expect(second.resume(user.id, compiled.run.id, { nodeId: 'approve', approvalId: approval.id, keyword: 'MAYBE', actor: { id: user.id, name: user.name, role: user.role } })).rejects.toThrow('not configured');
    expect(await repository.read(user.id, compiled.run.id)).toMatchObject({ status: 'paused', mastra: { status: 'suspended' } });

    const paused = await repository.read(user.id, compiled.run.id);
    if (!paused) throw new Error('Suspended run was not persisted.');
    await repository.upsert(user.id, updateRunExecutionSettings(paused, { modelSettings: { reasoningEffort: 'high', verbosity: 'low' }, harness: paused.compiledWorkflow.harness }, { id: user.id, name: user.name, role: user.role }, 0));
    const resumed = await second.resume(user.id, compiled.run.id, { nodeId: 'approve', approvalId: approval.id, keyword: 'ship', feedback: 'Reviewed.', actor: { id: user.id, name: user.name, role: user.role } }) as { status: string };
    expect(resumed.status).toBe('success');
    expect(await repository.read(user.id, compiled.run.id)).toMatchObject({ status: 'completed', mastra: { status: 'completed' } });
    const completed = await repository.read(user.id, compiled.run.id);
    expect(completed?.nodeRuns.find((node) => node.nodeId === 'prepare')?.executionSettings?.revision).toBe(0);
    expect(completed?.nodeRuns.find((node) => node.nodeId === 'success')?.executionSettings).toMatchObject({ revision: 1, modelSettings: { reasoningEffort: 'high', verbosity: 'low' } });
    await expect(second.resume(user.id, compiled.run.id, { nodeId: 'approve', approvalId: approval.id, keyword: 'SHIP', actor: { id: user.id, name: user.name, role: user.role } })).rejects.toThrow('not waiting');
    await second.close();
  }, 60_000);

  it('routes rejection and revision feedback only through their configured approval outcomes', async () => {
    const { user, repository } = await userAndRepository();
    const source = graph('approval');
    const executor: NodeTaskExecutor = { execute: async ({ node }) => {
      if (node.id === 'start') return { output: { brief: 'requirements' } };
      if (node.id === 'prepare') return { output: { draft: 'review me' } };
      if (node.id === 'revision') return { output: { revision: 'revise' }, selectedCondition: 'revise' };
      if (node.id === 'success') return { output: { result: 'approved' } };
      return { output: { reason: 'stopped' } };
    } };
    const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
    const adapter = new LocalMastraAdapter({ executor, store: repository, storageSchema: `test_${path.basename(directory).replace(/\W/g, '_')}_approval_routes` });
    adapters.push(adapter);

    const rejected = await adapter.compile(user.id, source, assignmentFor(source), [], 'run_mastra-rejected');
    if (!rejected.run || !rejected.registration) throw new Error(rejected.errors.join(' '));
    await adapter.start(rejected.registration.registrationKey, rejected.run.id, { userId: user.id, run: rejected.run });
    const rejectionApproval = (await repository.read(user.id, rejected.run.id))?.approvalRecords[0];
    if (!rejectionApproval) throw new Error('Rejection approval was not persisted.');
    await adapter.resume(user.id, rejected.run.id, { nodeId: 'approve', approvalId: rejectionApproval.id, keyword: 'STOP', feedback: 'Do not ship.', actor: { id: user.id, name: user.name, role: user.role } });
    expect(await repository.read(user.id, rejected.run.id)).toMatchObject({ status: 'failed', mastra: { status: 'failed' } });

    const revised = await adapter.compile(user.id, source, assignmentFor(source), [], 'run_mastra-revised');
    if (!revised.run || !revised.registration) throw new Error(revised.errors.join(' '));
    await adapter.start(revised.registration.registrationKey, revised.run.id, { userId: user.id, run: revised.run });
    const firstApproval = (await repository.read(user.id, revised.run.id))?.approvalRecords[0];
    if (!firstApproval) throw new Error('Revision approval was not persisted.');
    const revisionResult = await adapter.resume(user.id, revised.run.id, { nodeId: 'approve', approvalId: firstApproval.id, keyword: 'REVISE', feedback: 'Add evidence.', actor: { id: user.id, name: user.name, role: user.role } }) as { status: string };
    expect(revisionResult.status).toBe('suspended');
    const waitingAgain = await repository.read(user.id, revised.run.id);
    expect(waitingAgain).toMatchObject({ status: 'paused', loopIterations: { revision: 1 } });
    expect(waitingAgain?.nodeRuns.find((node) => node.nodeId === 'prepare')).toMatchObject({ status: 'completed', iteration: 1 });
    expect(waitingAgain?.approvalRecords[0]).toMatchObject({ feedback: 'Add evidence.', outcomeAction: 'revise' });
    const secondApproval = waitingAgain?.approvalRecords[1];
    if (!secondApproval) throw new Error('Revised output did not return to approval.');
    await adapter.resume(user.id, revised.run.id, { nodeId: 'approve', approvalId: secondApproval.id, keyword: 'SHIP', actor: { id: user.id, name: user.name, role: user.role } });
    expect(await repository.read(user.id, revised.run.id)).toMatchObject({ status: 'completed', mastra: { status: 'completed' } });
  }, 60_000);

  it('rejects an incompatible persisted snapshot version with a clear recovery error', async () => {
    const { user, repository } = await userAndRepository();
    const source = graph('branch');
    const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
    const compiler = new LocalMastraAdapter({ store: repository, storageSchema: ':memory:' });
    adapters.push(compiler);
    const compiled = await compiler.compile(user.id, source, assignmentFor(source), [], 'run_mastra-incompatible');
    if (!compiled.run?.mastra) throw new Error(compiled.errors.join(' '));
    const incompatible = structuredClone(compiled.run);
    (incompatible.mastra as { schemaVersion: number }).schemaVersion = 99;
    const incompatibleStore = {
      read: async () => incompatible,
      upsert: async (userId: string, run: typeof incompatible) => { void userId; return run; }
    };
    const recovery = new LocalMastraAdapter({ store: incompatibleStore, storageSchema: ':memory:' });
    adapters.push(recovery);
    await expect(recovery.recover(user.id, incompatible.id)).rejects.toThrow('Unsupported Mastra snapshot schema version: 99');
  });

  it('reconciles an older active snapshot without repeating a durably completed node', async () => {
    const { user } = await userAndRepository();
    const source = graph('branch');
    const { LocalMastraAdapter, reconcileMastraRunState } = await import('@/src/adapters/mastra-adapter');
    const { completeNode, nextRunnableNode, startNextNode } = await import('@/src/domain/runtime-engine');
    const compiler = new LocalMastraAdapter({ storageSchema: ':memory:' });
    adapters.push(compiler);
    const compiled = await compiler.compile(user.id, source, assignmentFor(source), [], 'run_mastra-active-recovery');
    if (!compiled.run) throw new Error(compiled.errors.join(' '));
    const staleSnapshot = structuredClone(compiled.run);
    const started = startNextNode(compiled.run);
    const durable = completeNode(started.run, 'route', { choice: 'accept' }, 'accept').run;
    const reconciled = reconcileMastraRunState(staleSnapshot, durable);
    expect(reconciled.events.length).toBeGreaterThan(staleSnapshot.events.length);
    expect(nextRunnableNode(reconciled)?.id).toBe('success');
    expect(reconciled.nodeRuns.find((node) => node.nodeId === 'route')).toMatchObject({ status: 'completed', attempt: 1 });
  });

  it('compares snapshot event content independently of JSON object key order', async () => {
    const { user } = await userAndRepository();
    const source = graph('branch');
    const { LocalMastraAdapter, reconcileMastraRunState } = await import('@/src/adapters/mastra-adapter');
    const compiler = new LocalMastraAdapter({ storageSchema: ':memory:' });
    adapters.push(compiler);
    const compiled = await compiler.compile(user.id, source, assignmentFor(source), [], 'run_jsonb-order');
    if (!compiled.run) throw new Error(compiled.errors.join(' '));
    function reorder(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(reorder);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)]));
    }
    const snapshot = reorder(JSON.parse(JSON.stringify(compiled.run))) as typeof compiled.run;
    expect(JSON.stringify(snapshot.events)).not.toBe(JSON.stringify(compiled.run.events));
    expect(reconcileMastraRunState(snapshot, compiled.run)).toEqual(compiled.run);
    snapshot.events[0].message = 'Actually changed event';
    expect(() => reconcileMastraRunState(snapshot, compiled.run!)).toThrow('journals have diverged');
  });

  it('restores a gate failed by the old JSON comparison without redoing completed tasks', async () => {
    const { user, repository } = await userAndRepository();
    const source = graph('approval');
    const executed: string[] = [];
    const executor: NodeTaskExecutor = { execute: async ({ node }) => {
      executed.push(node.id);
      if (node.id === 'start') return { output: { brief: 'requirements' } };
      if (node.id === 'prepare') return { output: { draft: 'keep this result' } };
      return { output: { result: 'approved' } };
    } };
    const storageSchema = `test_${path.basename(directory).replace(/\W/g, '_')}_gate_repair`;
    const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
    const first = new LocalMastraAdapter({ executor, store: repository, storageSchema });
    adapters.push(first);
    const compiled = await first.compile(user.id, source, assignmentFor(source), [], 'run_old-gate-repair');
    if (!compiled.run || !compiled.registration) throw new Error(compiled.errors.join(' '));
    await first.start(compiled.registration.registrationKey, compiled.run.id, { userId: user.id, run: compiled.run });
    const waiting = await repository.read(user.id, compiled.run.id);
    if (!waiting) throw new Error('Missing paused run.');
    const runtime = (first as unknown as { persistentRuntime: Mastra }).persistentRuntime;
    const workflows = await runtime.getStorage()?.getStore('workflows');
    const snapshot = await workflows?.loadWorkflowSnapshot({ workflowName: compiled.registration.registrationKey, runId: waiting.id });
    if (!snapshot || !workflows) throw new Error('Missing engine checkpoint.');
    const failure = { name: 'Error', message: 'Mastra snapshot and durable run event journals have diverged.' };
    snapshot.status = 'failed'; snapshot.error = failure; snapshot.suspendedPaths = {};
    snapshot.context[compiled.registration.runnerStepId] = { ...snapshot.context[compiled.registration.runnerStepId], status: 'failed', endedAt: Date.now(), error: failure, payload: { userId: user.id, run: waiting } };
    await workflows.persistWorkflowSnapshot({ workflowName: compiled.registration.registrationKey, runId: waiting.id, resourceId: user.id, snapshot });
    const second = new LocalMastraAdapter({ executor, store: repository, storageSchema });
    adapters.push(second);
    const result = await second.resume(user.id, waiting.id, { nodeId: 'approve', approvalId: waiting.approvalRecords[0].id, keyword: 'SHIP', actor: { id: user.id, name: user.name, role: user.role } }) as { status: string };
    expect(result.status).toBe('success');
    expect(executed).toEqual(['start', 'prepare', 'success']);
    const completed = await repository.read(user.id, waiting.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.approvalRecords).toHaveLength(1);
    expect(completed?.nodeRuns.find((node) => node.nodeId === 'prepare')).toMatchObject({ attempt: 1, output: { draft: 'keep this result' } });
  });

  it('continues an exhausted failure after a human gate without repeating prior steps or approval', async () => {
    const { user, repository } = await userAndRepository();
    const source = graph('approval');
    source.nodes.splice(4, 0, { id: 'generate', name: 'Generate screens', type: 'agent', prompt: 'Generate.', skillIds: [], inputKeys: ['decision'], outputKeys: ['images'], retryLimit: 0, requiresApproval: false });
    source.edges.find((edge) => edge.from === 'approve' && edge.condition === 'SHIP')!.to = 'generate';
    source.edges.push({ from: 'generate', to: 'success' });
    let fail = true;
    const executed: string[] = [];
    const executor: NodeTaskExecutor = { execute: async ({ node }) => {
      executed.push(node.id);
      if (node.id === 'start') return { output: { brief: 'requirements' } };
      if (node.id === 'prepare') return { output: { draft: 'approved concept' } };
      if (node.id === 'generate') {
        if (fail) throw new Error('Image generation timed out.');
        return { output: { images: ['generated-screen.png'] } };
      }
      return { output: { result: 'approved' } };
    } };
    const storageSchema = `test_${path.basename(directory).replace(/\W/g, '_')}_retry_failed`;
    const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
    const first = new LocalMastraAdapter({ executor, store: repository, storageSchema });
    adapters.push(first);
    const compiled = await first.compile(user.id, source, assignmentFor(source), [], 'run_retry-approved-work');
    if (!compiled.run || !compiled.registration) throw new Error(compiled.errors.join(' '));
    await first.start(compiled.registration.registrationKey, compiled.run.id, { userId: user.id, run: compiled.run });
    const paused = await repository.read(user.id, compiled.run.id);
    if (!paused) throw new Error('Gate state missing.');
    await first.resume(user.id, paused.id, { nodeId: 'approve', approvalId: paused.approvalRecords[0].id, keyword: 'SHIP', actor: { id: user.id, name: user.name, role: user.role } });
    const failed = await repository.read(user.id, paused.id);
    expect(failed?.status).toBe('failed');
    if (!failed) throw new Error('Failed run missing.');
    const { retryFailedNode } = await import('@/src/domain/runtime-engine');
    const ready = retryFailedNode(failed).run;
    await repository.upsert(user.id, ready);
    await first.close();
    const second = new LocalMastraAdapter({ executor, store: repository, storageSchema });
    adapters.push(second); fail = false;
    await second.start(compiled.registration.registrationKey, ready.id, { userId: user.id, run: ready });
    const completed = await repository.read(user.id, ready.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.approvalRecords).toEqual(failed.approvalRecords);
    expect(completed?.events.slice(0, failed.events.length)).toEqual(failed.events);
    expect(completed?.nodeRuns.find((node) => node.nodeId === 'prepare')).toEqual(failed.nodeRuns.find((node) => node.nodeId === 'prepare'));
    expect(executed).toEqual(['start', 'prepare', 'generate', 'generate', 'success']);
  });
});
