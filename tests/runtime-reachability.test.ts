import { describe, expect, it } from 'vitest';
import { revisionBranchPlan } from './revision-branch-fixture';
import { compileWorkflowRun, type WorkflowRun } from '@/src/domain/runtime';
import { completeNode, nextRunnableNode, recheckRejectedValidation, startNextNode } from '@/src/domain/runtime-engine';
import { rejectedValidationForRecheck } from '@/src/domain/rejected-validation';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';
import { executionProgressToken } from '@/src/domain/execution-progress';

function compile() {
  const plan = revisionBranchPlan();
  plan.edges = plan.edges.filter((edge) => edge.from !== 'review');
  plan.edges.push({ from: 'review', to: 'gate', condition: 'valid' }, { from: 'review', to: 'failure', condition: 'invalid' });
  const project = createProject({ name: 'Branch pruning', rootPath: plan.workspacePath, workspaceKind: 'repository' });
  const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: 'Tests', status: 'published' });
  const assignment = createProjectWorkflow({ project, workflow, status: 'ready', approval: testAssignmentApproval(), graphOverride: plan, permissions: { allowedWorkspacePaths: [project.rootPath] } });
  const result = compileWorkflowRun('pruning-user', plan, assignment, []);
  if (!result.run) throw new Error(result.errors.join(' '));
  return result.run;
}
function finish(run: WorkflowRun, nodeId: string, output: Record<string, unknown>, condition = '') {
  const started = startNextNode(run);
  expect(started.nodeRun?.nodeId).toBe(nodeId);
  return completeNode(started.run, nodeId, output, condition).run;
}

describe('live branch reachability and progress', () => {
  it('prunes an unchosen revision cycle and executes its shared failure terminal', () => {
    let run = finish(compile(), 'context', { sources: 'evidence' });
    run = finish(run, 'initial', { initialDocument: 'saved result' });
    run = finish(run, 'review', { findings: 'invalid mapping' }, 'invalid');
    expect(nextRunnableNode(run)?.id).toBe('failure');
    expect(run.nodeRuns.find((node) => node.nodeId === 'gate')?.status).toBe('skipped');
    expect(run.nodeRuns.find((node) => node.nodeId === 'loop')?.status).toBe('skipped');
    run = finish(run, 'failure', { reason: 'invalid mapping' });
    expect(run.status).toBe('failed');
    expect(run.nodeRuns.find((node) => node.nodeId === 'initial')?.output).toEqual({ initialDocument: 'saved result' });
  });

  it('still waits at the requested human gate on the valid branch', () => {
    let run = finish(compile(), 'context', { sources: 'evidence' });
    run = finish(run, 'initial', { initialDocument: 'saved result' });
    run = finish(run, 'review', { findings: 'minor differences' }, 'valid');
    expect(nextRunnableNode(run)?.id).toBe('gate');
    expect(startNextNode(run).run.status).toBe('paused');
  });

  it('rechecks a rejected validation without rerunning file generation or bypassing checks', () => {
    let run = finish(compile(), 'context', { sources: 'evidence' });
    run = finish(run, 'initial', { initialDocument: 'saved result' });
    run = finish(run, 'review', { findings: 'incorrect manifest mapping' }, 'invalid');
    expect(rejectedValidationForRecheck(run)?.nodeId).toBe('review');
    run = finish(run, 'failure', { reason: 'incorrect mapping' });
    const rechecked = recheckRejectedValidation(run).run;
    expect(nextRunnableNode(rechecked)?.id).toBe('review');
    expect(rechecked.nodeRuns.find((node) => node.nodeId === 'initial')?.output).toEqual({ initialDocument: 'saved result' });
    run = finish(rechecked, 'review', { findings: 'mapping corrected and checked' }, 'valid');
    expect(nextRunnableNode(run)?.id).toBe('gate');
    expect(startNextNode(run).run.status).toBe('paused');
    const cancelled = { ...run, status: 'cancelled' as const };
    expect(() => recheckRejectedValidation(cancelled)).toThrow('no rejected validation');
  });

  it('does not treat refreshed timestamps, action receipts, or orchestration metadata as progress', () => {
    const run = compile();
    const refreshed = structuredClone(run);
    refreshed.updatedAt = new Date().toISOString();
    refreshed.processedActionKeys = ['new-request'];
    expect(executionProgressToken(refreshed)).toBe(executionProgressToken(run));
    refreshed.nodeRuns[0].status = 'running';
    expect(executionProgressToken(refreshed)).not.toBe(executionProgressToken(run));
  });
});
