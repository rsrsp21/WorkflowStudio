import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { compileWorkflowRun, validateWorkflowRun } from '@/src/domain/runtime';
import { completeNode, failNode, nextRunnableNode, retryFailedNode, startNextNode } from '@/src/domain/runtime-engine';
import { failedStepForRetry } from '@/src/domain/failed-step-retry';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import RunSummaryPage from '@/src/components/run-summary-page';
import { testAssignmentApproval } from './test-helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
let directory = '';
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-retry-'));
  vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory); vi.resetModules();
});
afterEach(async () => {
  const { resetDatabaseForTests } = await import('@/src/storage/async-database');
  await resetDatabaseForTests(); vi.unstubAllEnvs(); vi.resetModules();
  await rm(directory, { recursive: true, force: true });
});

function failedRun(userId = 'retry-owner') {
  const plan = structuredClone(STARTER_WORKFLOWS[0]);
  plan.status = 'approved'; plan.nodes[0].retryLimit = 0;
  plan.nodes.unshift({ id: 'prepare', name: 'Prepare inputs', type: 'agent', prompt: 'Prepare.', skillIds: [], inputKeys: ['project'], outputKeys: ['brief'], retryLimit: 0, requiresApproval: false });
  plan.edges.unshift({ from: 'prepare', to: plan.nodes[1].id });
  const project = createProject({ id: 'retry-project', name: 'Retry project', rootPath: directory, workspaceKind: 'workspace' });
  const definition = createWorkflow({ id: plan.id, name: plan.name, domain: 'Testing', status: 'published' });
  const assignment = createProjectWorkflow({ id: 'retry-assignment', project, workflow: definition, status: 'ready', approval: testAssignmentApproval(definition.version), graphOverride: plan, inputOverrides: { project: directory }, permissions: { sandboxMode: 'read-only', allowedWorkspacePaths: [directory], requireApprovalForDestructiveActions: true } });
  const result = compileWorkflowRun(userId, plan, assignment, []);
  if (!result.run) throw new Error(result.errors.join(' '));
  const started = startNextNode(result.run);
  const prepared = completeNode(started.run, 'prepare', { brief: 'Keep completed output.' });
  const working = startNextNode(prepared.run);
  return failNode(working.run, plan.nodes[1].id, 'The paired local runtime did not complete the task before the timeout.').run;
}

describe('retrying a failed step', () => {
  it('preserves completed work, inputs and history and reopens only the saved execution path', () => {
    const failed = failedRun();
    const before = structuredClone(failed);
    const retried = retryFailedNode(failed).run;
    expect(failed).toEqual(before);
    expect(retried.id).toBe(failed.id);
    expect(retried.compiledWorkflow).toEqual(failed.compiledWorkflow);
    expect(retried.nodeRuns[0]).toEqual(failed.nodeRuns[0]);
    expect(retried.artifacts).toEqual(failed.artifacts);
    expect(retried.approvalRecords).toEqual(failed.approvalRecords);
    expect(retried.events.slice(0, failed.events.length)).toEqual(failed.events);
    expect(retried.events.at(-1)?.type).toBe('node.recovered');
    expect(validateWorkflowRun(retried)).toEqual([]);
    const next = startNextNode(retried);
    expect(next.nodeRun?.nodeId).toBe(failedStepForRetry(failed)?.nodeId);
    expect(next.nodeRun?.attempt).toBe(2);
    const success = completeNode(next.run, next.nodeRun!.nodeId, { result: 'Recovered.' }, 'validation passes').run;
    expect(nextRunnableNode(success)?.type).toBe('success');
    expect(success.nodeRuns.find((node) => node.nodeId.endsWith('-failure'))?.status).toBe('skipped');
  });

  it('does not reopen cancelled runs, human stops, failure outcomes or loop-limit failures', () => {
    const failed = failedRun();
    for (const status of ['completed', 'cancelled', 'running', 'paused'] as const) expect(() => retryFailedNode({ ...failed, status })).toThrow('no retryable');
    const human = structuredClone(failed); human.nodeRuns[1].failureKind = 'human-rejection';
    expect(failedStepForRetry(human)).toBeUndefined();
    const loop = structuredClone(failed); loop.events[loop.events.length - 2].type = 'loop.exhausted';
    expect(failedStepForRetry(loop)).toBeUndefined();
  });

  it('shows a retry action for an exhausted execution failure', () => {
    expect(renderToStaticMarkup(<RunSummaryPage run={failedRun()} />)).toContain('Retry failed step');
  });

  it('prepares an owned run idempotently and rejects another user', async () => {
    const { createUser, createSession, SESSION_COOKIE } = await import('@/src/auth/auth');
    const owner = await createUser({ name: 'Retry owner', email: 'retry-owner@example.com', password: 'password-123', role: 'builder' });
    const other = await createUser({ name: 'Other owner', email: 'retry-other@example.com', password: 'password-123', role: 'builder' });
    if (!owner || !other) throw new Error('User setup failed.');
    const session = await createSession(owner.id); const otherSession = await createSession(other.id);
    const { RunRepository } = await import('@/src/storage/run-repository');
    const repository = new RunRepository(); const failed = failedRun(owner.id);
    await repository.upsert(owner.id, failed);
    const route = await import('@/src/app/api/runs/[runId]/retry/route');
    const context = { params: Promise.resolve({ runId: failed.id }) };
    const request = (token: string, key = 'retry-1') => new Request('http://localhost/api/runs/id/retry', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${token}` }, body: JSON.stringify({ idempotencyKey: key }) });
    expect((await route.POST(request(otherSession.token), context)).status).toBe(404);
    const { acquireRunExecutionLock, releaseRunExecutionLock } = await import('@/src/storage/run-execution-lock');
    const lock = await acquireRunExecutionLock(owner.id, failed.id);
    if (!lock) throw new Error('Lock setup failed.');
    expect((await route.POST(request(session.token), context)).status).toBe(409);
    await releaseRunExecutionLock(owner.id, failed.id, lock);
    const first = await route.POST(request(session.token), context);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.run.status).toBe('running');
    expect(firstBody.run.nodeRuns[0]).toEqual(failed.nodeRuns[0]);
    const replay = await route.POST(request(session.token), context);
    expect(await replay.json()).toMatchObject({ idempotentReplay: true, run: { events: firstBody.run.events } });
    expect((await route.POST(request(session.token, 'another-retry'), context)).status).toBe(409);
  });
});
