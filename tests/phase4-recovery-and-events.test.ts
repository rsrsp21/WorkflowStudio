import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileWorkflowRun, hydrateWorkflowRun } from '@/src/domain/runtime';
import { SequentialRuntime } from '@/src/domain/runtime-engine';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-recovery-'));
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

async function durableRun() {
  const { createUser } = await import('@/src/auth/auth');
  const user = await createUser({ name: 'Recovery owner', email: `recovery-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'builder' });
  if (!user) throw new Error('Could not create recovery owner.');
  const plan = structuredClone(STARTER_WORKFLOWS[0]);
  const project = createProject({ id: 'recovery-project', name: 'Recovery', rootPath: directory, workspaceKind: 'workspace' });
  const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: 'Testing', status: 'published' });
  const assignment = createProjectWorkflow({ id: 'recovery-assignment', project, workflow, status: 'ready', approval: testAssignmentApproval(workflow.version), graphOverride: plan, inputOverrides: { project: directory }, permissions: { sandboxMode: 'read-only', allowedWorkspacePaths: [directory] } });
  const result = compileWorkflowRun(user.id, plan, assignment, []);
  if (!result.run) throw new Error(result.errors.join(' '));
  const { RunRepository } = await import('@/src/storage/run-repository');
  const repository = new RunRepository();
  await repository.upsert(user.id, result.run);
  return { user, plan, run: result.run, repository };
}

describe('Phase 4 durable events, artifacts, and recovery', () => {
  it('fences expired execution owners at the transaction boundary and before dispatch', async () => {
    const { user, run, repository } = await durableRun();
    const { acquireRunExecutionLock, renewRunExecutionLock } = await import('@/src/storage/run-execution-lock');
    const { RunRepository } = await import('@/src/storage/run-repository');
    const { getDatabase } = await import('@/src/storage/async-database');
    const first = await acquireRunExecutionLock(user.id, run.id);
    const oldWriter = new RunRepository({ userId: user.id, runId: run.id, token: first! });
    await oldWriter.assertExecutionOwnership();
    await (await getDatabase()).run('UPDATE run_execution_locks SET expires_at = ? WHERE run_id = ?', ['2000-01-01T00:00:00Z', run.id]);
    expect(await renewRunExecutionLock(user.id, run.id, first!)).toBe(false);
    const takeover = await acquireRunExecutionLock(user.id, run.id);
    expect(takeover).not.toBe(first);
    await expect(oldWriter.assertExecutionOwnership()).rejects.toMatchObject({ code: 'RUN_STATE_CONFLICT' });
    await expect(oldWriter.upsert(user.id, run)).rejects.toMatchObject({ code: 'RUN_STATE_CONFLICT' });
    expect((await repository.read(user.id, run.id))?.stateRevision).toBe(run.stateRevision);
    const newWriter = new RunRepository({ userId: user.id, runId: run.id, token: takeover! });
    await expect(newWriter.upsert(user.id, run)).resolves.toMatchObject({ stateRevision: run.stateRevision! + 1 });
  });

  it('serializes metadata-only writes with revisions instead of silently losing one update', async () => {
    const { user, run, repository } = await durableRun();
    const first = await repository.read(user.id, run.id);
    const second = await repository.read(user.id, run.id);
    if (!first || !second) throw new Error('Saved run is missing.');
    const revision = first.stateRevision!;
    first.processedActionKeys = ['first'];
    second.processedActionKeys = ['second'];
    const results = await Promise.allSettled([repository.upsert(user.id, first), repository.upsert(user.id, second)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason).toMatchObject({ code: 'RUN_STATE_CONFLICT' });
    const saved = await repository.read(user.id, run.id);
    expect(saved?.stateRevision).toBe(revision + 1);
    expect(saved?.processedActionKeys).toHaveLength(1);
    expect(await repository.read('another-user', run.id)).toBeNull();
  });

  it('persists structured output, artifacts, provider metadata, and an append-only event journal', async () => {
    const { user, plan, run, repository } = await durableRun();
    const runtime = new SequentialRuntime(repository);
    await runtime.startNext(user.id, run.id, '2026-09-01T02:00:00.000Z');
    await runtime.complete(user.id, run.id, plan.nodes[0].id, {
      output: { result: { accepted: true } }, selectedCondition: 'validation passes', summary: 'Inspection complete.', providerThreadId: 'thread-durable',
      artifacts: [{ path: path.join(directory, 'review.json'), description: 'Review result', rootPath: directory, sandboxMode: 'read-only', writeAllowed: false }]
    }, '2026-09-01T02:00:01.000Z');

    const persisted = await repository.read(user.id, run.id);
    expect(persisted?.nodeRuns[0]).toMatchObject({ status: 'completed', summary: 'Inspection complete.', providerThreadId: 'thread-durable', artifactIds: [`${run.id}:artifact:1`] });
    expect(persisted?.artifacts[0]).toMatchObject({ runId: run.id, nodeId: plan.nodes[0].id, taskId: `${run.id}:${plan.nodes[0].id}`, path: path.join(directory, 'review.json') });
    expect(persisted?.events.map((event) => event.type)).toEqual(['run.compiled', 'node.started', 'node.completed', 'route.selected']);

    const rewritten = structuredClone(persisted!);
    rewritten.events.shift();
    await expect(repository.upsert(user.id, rewritten)).rejects.toThrow('append-only');
  });

  it('recovers an interrupted running node and resumes from durable state', async () => {
    const { user, plan, run, repository } = await durableRun();
    await new SequentialRuntime(repository).startNext(user.id, run.id, '2026-09-01T03:00:00.000Z');

    const restartedRuntime = new SequentialRuntime(repository);
    const recovered = await restartedRuntime.recover(user.id, run.id, '2026-09-01T03:01:00.000Z');
    expect(recovered).toMatchObject({ kind: 'retried', run: { status: 'running' }, nodeRun: { nodeId: plan.nodes[0].id, status: 'pending', attempt: 1, error: 'Execution was interrupted before completion and is ready to resume.' } });
    expect((await repository.read(user.id, run.id))?.events.at(-1)?.type).toBe('node.recovered');

    const resumed = await restartedRuntime.executeNext(user.id, run.id, { execute: async () => ({ output: { result: true }, selectedCondition: 'validation passes' }) });
    expect(resumed.kind).toBe('branched');
    expect(resumed.nodeRun).toMatchObject({ status: 'completed', attempt: 2 });
    expect((await repository.read(user.id, run.id))?.events.map((event) => event.type)).toEqual(['run.compiled', 'node.started', 'node.recovered', 'node.started', 'node.completed', 'route.selected']);
  });

  it('hydrates pre-journal runs without losing their existing runtime state', async () => {
    const { run } = await durableRun();
    const legacy = structuredClone(run) as unknown as Record<string, unknown>;
    delete legacy.events;
    delete legacy.artifacts;
    delete legacy.runtimeEngine;
    const compiled = legacy.compiledWorkflow as Record<string, unknown>;
    delete compiled.assignmentInputs;
    for (const node of legacy.nodeRuns as Array<Record<string, unknown>>) delete node.artifactIds;

    const hydrated = hydrateWorkflowRun(legacy as unknown as typeof run);
    expect(hydrated.events).toEqual([{ id: `${run.id}:event:1`, sequence: 1, runId: run.id, type: 'run.compiled', timestamp: run.createdAt, message: 'Approved assignment compiled into a durable run.' }]);
    expect(hydrated.artifacts).toEqual([]);
    expect(hydrated.compiledWorkflow.assignmentInputs).toEqual({});
    expect(hydrated.nodeRuns.every((node) => Array.isArray(node.artifactIds))).toBe(true);
    expect(hydrated.runtimeEngine).toEqual({ name: 'legacy', version: 1 });
  });
});
