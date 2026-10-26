import { describe, expect, it } from 'vitest';
import { assertNodeAttempt, prepareRunTransition, RunStateConflictError } from '@/src/domain/run-transition-service';
import { compileWorkflowRun, hydrateWorkflowRun, type WorkflowRun } from '@/src/domain/runtime';
import { startNextNode, recoverInterruptedRun, SequentialRuntime } from '@/src/domain/runtime-engine';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { createProject, createWorkflow, createProjectWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

function run(): WorkflowRun {
  const plan = structuredClone(STARTER_WORKFLOWS[0]);
  const project = createProject({ id: 'transition-project', name: 'Transition', rootPath: 'C:\\projects\\transition', workspaceKind: 'workspace' });
  const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: 'Tests', status: 'published' });
  const assignment = createProjectWorkflow({ id: 'transition-assignment', project, workflow, status: 'ready', graphOverride: plan,
    inputOverrides: { project: project.rootPath }, approval: testAssignmentApproval(workflow.version),
    permissions: { sandboxMode: 'read-only', allowedWorkspacePaths: [project.rootPath] } });
  const result = compileWorkflowRun('transition-user', plan, assignment, []);
  if (!result.run) throw new Error(result.errors.join(' '));
  return result.run;
}

describe('authoritative run transition policy', () => {
  it('hydrates old revisions without resetting versioned state', () => {
    const legacy = run(); delete legacy.stateRevision;
    expect(hydrateWorkflowRun(legacy).stateRevision).toBe(0);
    legacy.stateRevision = 7;
    expect(hydrateWorkflowRun(legacy).stateRevision).toBe(7);
  });

  it('increments revisions without mutating its proposal and rejects metadata-only stale writes', () => {
    const proposal = run();
    const saved = prepareRunTransition(proposal.userId, proposal);
    expect(saved.stateRevision).toBe(1);
    expect(proposal.stateRevision).toBeUndefined();
    const next = prepareRunTransition(saved.userId, { ...saved, processedActionKeys: ['first'] }, saved);
    expect(next.stateRevision).toBe(2);
    expect(() => prepareRunTransition(saved.userId, { ...saved, processedActionKeys: ['second'] }, next)).toThrow(RunStateConflictError);
    expect(next.processedActionKeys).toEqual(['first']);
  });

  it.each(['completed', 'cancelled'] as const)('does not reopen %s runs even at the current revision', (status) => {
    const previous = { ...run(), status, stateRevision: 2 };
    expect(() => prepareRunTransition(previous.userId, { ...previous, status: 'running' }, previous)).toThrow('cannot be reopened');
  });

  it('preserves the event journal, owner, and persisted run identity', () => {
    const previous = prepareRunTransition('transition-user', run());
    expect(() => prepareRunTransition('other-user', previous, previous)).toThrow('owner');
    expect(() => prepareRunTransition(previous.userId, { ...previous, projectId: 'another-project' }, previous)).toThrow('identity');
    expect(() => prepareRunTransition(previous.userId, { ...previous, events: [] }, previous)).toThrow('append-only');
    expect(() => prepareRunTransition(previous.userId, { ...previous, stateRevision: -1 }, previous)).toThrow('revision');
  });

  it('rejects old results and old errors after recovery starts a new attempt', () => {
    const started = startNextNode(run());
    const fence = started.nodeRun!;
    expect(() => assertNodeAttempt(started.run, fence)).not.toThrow();
    const recovered = recoverInterruptedRun(started.run);
    const restarted = startNextNode(recovered.run);
    expect(restarted.nodeRun!.attempt).toBe(fence.attempt + 1);
    expect(() => assertNodeAttempt(restarted.run, fence)).toThrow('stale');
    expect(() => assertNodeAttempt({ ...started.run, status: 'cancelled' }, fence)).toThrow('stale');
    expect(() => assertNodeAttempt(started.run, { ...fence, iteration: fence.iteration + 1 })).toThrow('stale');
  });

  it.each(['result', 'error'] as const)('does not apply a delayed %s to a recovered legacy attempt', async (kind) => {
    let current = run();
    const runtime = new SequentialRuntime({
      read: async () => structuredClone(current),
      upsert: async (userId, proposal) => {
        current = prepareRunTransition(userId, proposal, current);
        proposal.stateRevision = current.stateRevision;
        return structuredClone(current);
      }
    });
    let release!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const execution = runtime.executeNext(current.userId, current.id, { execute: async () => {
      signalStarted(); await waiting;
      if (kind === 'error') throw new Error('Old provider error.');
      return { output: { result: 'Old result.' } };
    } });
    await started;
    await runtime.recover(current.userId, current.id);
    await runtime.startNext(current.userId, current.id);
    const before = structuredClone(current);
    const rejected = expect(execution).rejects.toThrow('stale');
    release();
    await rejected;
    expect(current).toEqual(before);
    expect(current.nodeRuns[0]).toMatchObject({ attempt: 2, status: 'running' });
  });
});
