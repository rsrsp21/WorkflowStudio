import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileWorkflowRun } from '@/src/domain/runtime';
import { startNextNode } from '@/src/domain/runtime-engine';
import { buildCodexFocusedTaskRequest } from '@/src/adapters/codex-node-executor';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { createProject, createWorkflow, createProjectWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';
const fake = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/src/adapters/codex-app-server-adapter', () => ({ createCodexPlanningAdapter: () => ({ runFocusedTask: fake.execute }) }));
let directory = '';
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'workflow-durable-'));
  vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory); vi.stubEnv('CODEX_RUNTIME_MODE', 'local'); vi.resetModules(); fake.execute.mockReset();
});
afterEach(async () => {
  const { resetDatabaseForTests } = await import('@/src/storage/async-database'); await resetDatabaseForTests();
  vi.unstubAllEnvs(); vi.resetModules();
  if (!path.basename(directory).startsWith('workflow-durable-')) throw new Error('Invalid test cleanup target.');
  await rm(directory, { recursive: true, force: true });
});

async function fixture(start = true) {
  const { createUser } = await import('@/src/auth/auth');
  const user = await createUser({ name: 'Durable result owner', email: `receipt-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'builder' });
  if (!user) throw new Error('Test user creation failed.');
  const source = structuredClone(STARTER_WORKFLOWS[0]);
  const project = createProject({ id: 'durable-project', name: 'Durable', rootPath: directory, workspaceKind: 'workspace' });
  const workflow = createWorkflow({ id: source.id, name: source.name, domain: 'Tests', status: 'published' });
  const assignment = createProjectWorkflow({ id: 'durable-assignment', project, workflow, graphOverride: source, status: 'ready', approval: testAssignmentApproval(workflow.version),
    inputOverrides: { project: directory }, permissions: { sandboxMode: 'read-only', allowedWorkspacePaths: [directory] } });
  const compiled = compileWorkflowRun(user.id, source, assignment, []);
  if (!compiled.run) throw new Error(compiled.errors.join(' '));
  const { RunRepository } = await import('@/src/storage/run-repository');
  const runs = new RunRepository();
  const run = start ? startNextNode(compiled.run).run : compiled.run;
  await runs.upsert(user.id, run);
  const runtime = await import('@/src/storage/runtime-connection-repository');
  const pairing = await runtime.createRuntimePairing(user.id);
  const claimed = await runtime.claimRuntimePairing({ code: pairing.pairingCode, allowedRoots: [directory] });
  if (!claimed) throw new Error('Runtime pairing failed.');
  if (!start) return { user, run, runs, runtime, connection: claimed.connection, job: undefined, body: undefined };
  const task = startNextNode(compiled.run).task!;
  const request = buildCodexFocusedTaskRequest(task, []);
  const job = await runtime.enqueueRuntimeJob(user.id, claimed.connection.id, 'focused-task', { cwd: directory, permission: 'read-only', metadata: {
    workflow_studio_run_id: run.id, workflow_studio_node_id: task.node.id, workflow_studio_task_id: task.taskId,
    workflow_studio_attempt: String(task.attempt), workflow_studio_iteration: String(task.iteration)
  } });
  const leased = await runtime.leaseNextRuntimeJob(claimed.connection.id);
  if (!leased || leased.id !== job.id) throw new Error('Runtime lease failed.');
  const raw = JSON.stringify({ outputs: request.outputKeys.map((key) => ({ key, valueJson: 'true' })), selectedCondition: request.edgeConditions[0] ?? '', summary: 'Verified result.', artifacts: [],
    trace: { runId: run.id, taskId: task.taskId, nodeId: task.node.id, sourcePlanId: run.sourcePlanId, workflowId: run.workflowId, assignmentId: run.assignmentId, projectId: run.projectId } });
  return { user, run, runs, runtime, connection: claimed.connection, job: leased, body: { result: { raw, providerThreadId: 'thread-durable' } } };
}

describe('durable result acceptance and continuation', () => {
  it('commits the receipt, verified output, artifacts/events, and reconciliation revision once', async () => {
    const f = await fixture();
    expect(await f.runtime.completeRuntimeJob(f.connection.id, f.job!.id, f.job!.leaseId!, f.body!)).toBe(true);
    const saved = await f.runs.read(f.user.id, f.run.id);
    expect(saved?.nodeRuns[0]).toMatchObject({ status: 'completed', runtimeJobId: f.job!.id, output: { result: true } });
    const revision = saved!.stateRevision;
    expect(await f.runtime.completeRuntimeJob(f.connection.id, f.job!.id, f.job!.leaseId!, f.body!)).toBe(true);
    expect((await f.runs.read(f.user.id, f.run.id))?.stateRevision).toBe(revision);
    expect(await f.runtime.completeRuntimeJob(f.connection.id, f.job!.id, f.job!.leaseId!, { result: { raw: 'conflicting' } })).toBe(false);
    const { getDatabase } = await import('@/src/storage/async-database');
    expect(await (await getDatabase()).get('SELECT applied_revision FROM runtime_jobs WHERE id = ?', [f.job!.id])).toMatchObject({ applied_revision: revision });
    expect(await (await getDatabase()).get('SELECT state_revision FROM run_reconciliation WHERE run_id = ?', [f.run.id])).toMatchObject({ state_revision: revision });
  });

  it('rolls back node completion if receipt persistence fails, then accepts the exact retry', async () => {
    const f = await fixture();
    const { getDatabase } = await import('@/src/storage/async-database'); const db = await getDatabase();
    await db.run("CREATE FUNCTION fail_receipt_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt failure'; END; $$");
    await db.run('CREATE TRIGGER fail_receipt_test BEFORE UPDATE ON runtime_jobs FOR EACH ROW EXECUTE FUNCTION fail_receipt_test()');
    await expect(f.runtime.completeRuntimeJob(f.connection.id, f.job!.id, f.job!.leaseId!, f.body!)).rejects.toThrow('injected');
    expect((await f.runs.read(f.user.id, f.run.id))?.nodeRuns[0].status).toBe('running');
    expect((await f.runtime.getRuntimeJob(f.user.id, f.job!.id))?.status).toBe('leased');
    await db.run('DROP TRIGGER fail_receipt_test ON runtime_jobs');
    expect(await f.runtime.completeRuntimeJob(f.connection.id, f.job!.id, f.job!.leaseId!, f.body!)).toBe(true);
  });

  it('does not reclaim provider-completed work for regeneration after lease expiry', async () => {
    const f = await fixture();
    await f.runtime.appendRuntimeJobEvent(f.connection.id, f.job!.id, f.job!.leaseId!, 0, { type: 'turn/completed', message: 'Codex turn completed.' });
    expect(await f.runtime.leaseNextRuntimeJob(f.connection.id, new Date(Date.now() + 120_000))).toBeNull();
    expect(await f.runtime.completeRuntimeJob(f.connection.id, f.job!.id, f.job!.leaseId!, f.body!)).toBe(true);
  });

  it('preserves a durable lease after notification loss rather than starting uncertain work twice', async () => {
    const f = await fixture();
    const { getDatabase } = await import('@/src/storage/async-database');
    const db = await getDatabase();
    const row = await db.get<{ payload: string }>('SELECT payload FROM runtime_jobs WHERE id = ?', [f.job!.id]);
    await db.run('UPDATE runtime_jobs SET payload = ? WHERE id = ?', [JSON.stringify({ ...JSON.parse(row!.payload), durableResults: true }), f.job!.id]);
    expect(await f.runtime.leaseNextRuntimeJob(f.connection.id, new Date(Date.now() + 120_000))).toBeNull();
    expect(await f.runtime.completeRuntimeJob(f.connection.id, f.job!.id, f.job!.leaseId!, f.body!)).toBe(true);
  });

  it('advances an authorized run from durable work without a browser execute loop', async () => {
    const f = await fixture(false);
    f.run.executionRequested = true;
    await f.runs.upsert(f.user.id, f.run);
    fake.execute.mockImplementation(async (request: { outputKeys: string[]; edgeConditions: string[] }) => ({ output: Object.fromEntries(request.outputKeys.map((key) => [key, true])), selectedCondition: request.edgeConditions[0] ?? '', summary: 'Fake provider.', artifacts: [] }));
    const { coordinateNextRun } = await import('@/src/server/run-coordinator');
    const { getDatabase } = await import('@/src/storage/async-database');
    for (let step = 0; step < 4; step++) {
      await (await getDatabase()).run('UPDATE run_reconciliation SET available_at = ? WHERE run_id = ?', ['2000-01-01T00:00:00Z', f.run.id]);
      await Promise.all([coordinateNextRun(), coordinateNextRun()]);
      if ((await f.runs.read(f.user.id, f.run.id))?.status === 'completed') break;
    }
    expect((await f.runs.read(f.user.id, f.run.id))?.status).toBe('completed');
    expect(fake.execute).toHaveBeenCalledTimes(2);
  });
});
