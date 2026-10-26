import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowPlan } from '@/src/domain/models';
import { compileWorkflowRun } from '@/src/domain/runtime';
import { SequentialRuntime, startNextNode } from '@/src/domain/runtime-engine';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';
import { RuntimeUnavailableError } from '@/src/domain/runtime-unavailable';

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-sequential-'));
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

function linearPlan(rootPath: string): WorkflowPlan {
  return {
    id: 'sequential-plan', schemaVersion: 1, name: 'Sequential review', description: 'Inspect, report, and finish.',
    planningPrompt: 'Long planning context must stay outside node tasks.', workspacePath: rootPath, constraints: [], openQuestions: [], completionCriteria: ['Approved report exists.'],
    nodes: [
      { id: 'inspect', name: 'Inspect', type: 'codex', prompt: 'Inspect the project.', skillIds: [], inputKeys: ['project'], outputKeys: ['inventory'], retryLimit: 1, requiresApproval: false },
      { id: 'report', name: 'Report', type: 'validation', prompt: 'Create the report.', skillIds: [], inputKeys: ['inventory'], outputKeys: ['report'], retryLimit: 0, requiresApproval: false },
      { id: 'success', name: 'Accepted', type: 'success', prompt: 'Record acceptance.', skillIds: [], inputKeys: ['report'], outputKeys: ['approvedReport'], retryLimit: 0, requiresApproval: false },
      { id: 'failure', name: 'Blocked', type: 'failure', prompt: 'Record failure.', skillIds: [], inputKeys: ['inventory'], outputKeys: ['failureReport'], retryLimit: 0, requiresApproval: false }
    ],
    edges: [
      { from: 'inspect', to: 'report' },
      { from: 'report', to: 'success' },
      { from: 'inspect', to: 'failure', condition: 'review cannot continue' }
    ],
    harness: { sandboxMode: 'read-only', maxRetries: 1, maxLoopIterations: 3, maxConcurrentNodes: 1, allowedTools: [], allowedWorkspacePaths: [rootPath], requireApprovalForDestructiveActions: true },
    status: 'approved', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z'
  };
}

async function persistedRuntime() {
  const { createSession, createUser } = await import('@/src/auth/auth');
  const user = await createUser({ name: 'Runtime owner', email: 'runtime@example.com', password: 'password-123', role: 'builder' });
  if (!user) throw new Error('Could not create runtime owner.');
  await createSession(user.id);
  const plan = linearPlan(path.join(directory, 'project'));
  const project = createProject({ id: 'runtime-project', name: 'Runtime project', rootPath: plan.workspacePath, workspaceKind: 'empty' });
  const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: 'Testing', status: 'published' });
  const assignment = createProjectWorkflow({ id: 'runtime-assignment', project, workflow, status: 'ready', approval: testAssignmentApproval(workflow.version), graphOverride: plan, inputOverrides: { project: project.rootPath }, permissions: { sandboxMode: 'read-only', allowedWorkspacePaths: [project.rootPath], requireApprovalForDestructiveActions: true } });
  const compiled = compileWorkflowRun(user.id, plan, assignment, []);
  if (!compiled.run) throw new Error(compiled.errors.join(' '));
  const { RunRepository } = await import('@/src/storage/run-repository');
  const repository = new RunRepository();
  await repository.upsert(user.id, compiled.run);
  return { user, run: compiled.run, repository, runtime: new SequentialRuntime(repository) };
}

describe('Phase 4 sequential runtime', () => {
  it('waits through repeated disconnects without spending attempts and resumes the same task', async () => {
    const { user, run, runtime } = await persistedRuntime();
    for (let index = 0; index < 3; index++) {
      const waiting = await runtime.executeNext(user.id, run.id, { execute: async () => { throw new RuntimeUnavailableError(); } });
      expect(waiting.kind).toBe('waiting-runtime');
      expect(waiting.run.status).toBe('running');
      expect(waiting.nodeRun).toMatchObject({ nodeId: 'inspect', status: 'pending', attempt: 0 });
      expect(waiting.run.verificationResults).toHaveLength(0);
      expect(waiting.run.events.some((event) => event.type === 'node.retry-scheduled')).toBe(false);
    }
    const resumed = await runtime.executeNext(user.id, run.id, { execute: async (task) => {
      expect(task.attempt).toBe(1);
      return { output: { inventory: ['requirements.md'] } };
    } });
    expect(resumed.run.runtimeWaiting).toBeUndefined();
    expect(resumed.nodeRun).toMatchObject({ status: 'completed', attempt: 1 });
  });

  it('executes one node at a time, persists transitions, and resolves prior outputs', async () => {
    const { user, run, repository, runtime } = await persistedRuntime();
    const seenInputs: Record<string, unknown>[] = [];

    const inspect = await runtime.executeNext(user.id, run.id, { execute: async (task) => { seenInputs.push(task.input); return { output: { inventory: ['requirements.md'] } }; } });
    expect(inspect.kind).toBe('branched');
    expect((await repository.read(user.id, run.id))?.nodeRuns.find((node) => node.nodeId === 'inspect')).toMatchObject({ status: 'completed', attempt: 1, output: { inventory: ['requirements.md'] } });

    const report = await runtime.executeNext(user.id, run.id, { execute: async (task) => { seenInputs.push(task.input); return { output: { report: 'Requirements are traceable.' } }; } });
    expect(report.kind).toBe('completed');
    expect(seenInputs).toEqual([{ project: run.rootPath }, { inventory: ['requirements.md'] }]);

    const success = await runtime.executeNext(user.id, run.id, { execute: async (task) => ({ output: { approvedReport: task.input.report } }) });
    expect(success.kind).toBe('run-completed');
    expect(success.run.status).toBe('completed');
    expect(success.run.nodeRuns.find((node) => node.nodeId === 'failure')?.status).toBe('skipped');
    expect((await repository.read(user.id, run.id))?.status).toBe('completed');
  });

  it('retries within the node limit and durably fails when attempts are exhausted', async () => {
    const retrying = await persistedRuntime();
    const first = await retrying.runtime.executeNext(retrying.user.id, retrying.run.id, { execute: async () => { throw new Error('Temporary provider failure.'); } });
    expect(first).toMatchObject({ kind: 'retried', run: { status: 'running' }, nodeRun: { status: 'pending', attempt: 1, error: 'Temporary provider failure.' } });
    const second = await retrying.runtime.executeNext(retrying.user.id, retrying.run.id, { execute: async () => { throw new Error('Provider unavailable.'); } });
    expect(second).toMatchObject({ kind: 'run-failed', run: { status: 'failed' }, nodeRun: { status: 'failed', attempt: 2, error: 'Provider unavailable.' } });
    expect(second.run.nodeRuns.filter((node) => node.nodeId !== 'inspect').every((node) => node.status === 'skipped')).toBe(true);
    expect((await retrying.repository.read(retrying.user.id, retrying.run.id))?.status).toBe('failed');
  });

  it('does not start a second node while another node is active', async () => {
    const { run } = await persistedRuntime();
    const started = startNextNode(run, '2026-09-01T01:00:00.000Z');
    expect(started.nodeRun).toMatchObject({ nodeId: 'inspect', status: 'running', attempt: 1 });
    expect(() => startNextNode(started.run, '2026-09-01T01:00:01.000Z')).toThrow('No node is runnable');
  });
});
