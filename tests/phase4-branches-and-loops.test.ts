import { describe, expect, it } from 'vitest';
import type { WorkflowPlan } from '@/src/domain/models';
import { compileWorkflowRun, type WorkflowRun } from '@/src/domain/runtime';
import { completeNode, startNextNode } from '@/src/domain/runtime-engine';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

function compile(plan: WorkflowPlan): WorkflowRun {
  const project = createProject({ id: 'branch-project', name: 'Branch project', rootPath: 'C:\\projects\\branch', workspaceKind: 'repository' });
  const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: 'Testing', status: 'published' });
  const assignment = createProjectWorkflow({ id: 'branch-assignment', project, workflow, status: 'ready', approval: testAssignmentApproval(workflow.version), graphOverride: plan, inputOverrides: { project: project.rootPath }, permissions: { sandboxMode: 'read-only', allowedWorkspacePaths: [project.rootPath], requireApprovalForDestructiveActions: true } });
  const result = compileWorkflowRun('branch-user', plan, assignment, []);
  if (!result.run) throw new Error(result.errors.join(' '));
  return result.run;
}

function loopPlan(maxLoopIterations: number): WorkflowPlan {
  const timestamp = '2026-09-01T00:00:00.000Z';
  return {
    id: 'revision-loop', schemaVersion: 1, name: 'Draft review loop', description: 'Draft, review, revise, and validate until accepted.',
    planningPrompt: 'Create a bounded content revision workflow.', workspacePath: 'C:\\projects\\branch', constraints: [], openQuestions: [], completionCriteria: ['Draft is accepted.'],
    nodes: [
      { id: 'start', name: 'Prepare brief', type: 'agent', prompt: 'Prepare the source brief.', skillIds: [], inputKeys: [], outputKeys: ['brief'], retryLimit: 0, requiresApproval: false },
      { id: 'draft', name: 'Draft', type: 'codex', prompt: 'Create or update the draft.', skillIds: [], inputKeys: [], outputKeys: ['draft'], retryLimit: 0, requiresApproval: false },
      { id: 'review', name: 'Review', type: 'validation', prompt: 'Review the draft.', skillIds: [], inputKeys: ['draft'], outputKeys: ['review'], retryLimit: 0, requiresApproval: false },
      { id: 'gate', name: 'Validate decision', type: 'loop', prompt: 'Choose accepted, revise, or blocked.', skillIds: [], inputKeys: ['review'], outputKeys: ['decision'], retryLimit: 0, requiresApproval: false },
      { id: 'revise', name: 'Revise', type: 'codex', prompt: 'Apply the review feedback.', skillIds: [], inputKeys: ['review'], outputKeys: ['revision'], retryLimit: 0, requiresApproval: false },
      { id: 'success', name: 'Accepted', type: 'success', prompt: 'Record the accepted draft.', skillIds: [], inputKeys: ['decision'], outputKeys: ['accepted'], retryLimit: 0, requiresApproval: false },
      { id: 'failure', name: 'Blocked', type: 'failure', prompt: 'Record why validation is blocked.', skillIds: [], inputKeys: ['decision'], outputKeys: ['failure'], retryLimit: 0, requiresApproval: false }
    ],
    edges: [
      { from: 'start', to: 'draft' }, { from: 'draft', to: 'review' }, { from: 'review', to: 'gate' },
      { from: 'gate', to: 'success', condition: 'accepted' }, { from: 'gate', to: 'revise', condition: 'revise' }, { from: 'gate', to: 'failure', condition: 'blocked' },
      { from: 'revise', to: 'draft' }
    ],
    harness: { sandboxMode: 'read-only', maxRetries: 0, maxLoopIterations, maxConcurrentNodes: 1, allowedTools: [], allowedWorkspacePaths: ['C:\\projects\\branch'], requireApprovalForDestructiveActions: true },
    status: 'approved', createdAt: timestamp, updatedAt: timestamp
  };
}

function runNode(run: WorkflowRun, nodeId: string, output: Record<string, unknown>, selectedCondition = '') {
  const started = startNextNode(run);
  expect(started.nodeRun?.nodeId).toBe(nodeId);
  return completeNode(started.run, nodeId, output, selectedCondition).run;
}

describe('Phase 4 conditional branches and bounded loops', () => {
  it('selects one explicit branch and durably skips the rejected path', () => {
    const plan = structuredClone(STARTER_WORKFLOWS[0]);
    let run = compile(plan);
    run = runNode(run, plan.nodes[0].id, { result: { valid: true } }, 'validation passes');
    expect(run.edgeRuns).toEqual([
      expect.objectContaining({ condition: 'validation passes', status: 'selected', traversalCount: 1 }),
      expect.objectContaining({ condition: 'validation fails or required context is missing', status: 'rejected', traversalCount: 0 })
    ]);
    expect(run.nodeRuns.find((node) => node.nodeId === plan.nodes[2].id)?.status).toBe('skipped');
    run = runNode(run, plan.nodes[1].id, { 'approved-result': { valid: true } });
    expect(run.status).toBe('completed');
  });

  it('repeats a draft-review-revise cycle and exits through the accepted branch', () => {
    let run = compile(loopPlan(2));
    run = runNode(run, 'start', { brief: 'requirements' });
    run = runNode(run, 'draft', { draft: 'v1' });
    run = runNode(run, 'review', { review: 'Needs evidence.' });
    run = runNode(run, 'gate', { decision: 'revise' }, 'revise');
    expect(run.loopIterations).toEqual({ gate: 1 });
    expect(run.nodeRuns.find((node) => node.nodeId === 'revise')).toMatchObject({ status: 'pending', iteration: 1 });
    expect(run.nodeRuns.find((node) => node.nodeId === 'draft')).toMatchObject({ status: 'pending', iteration: 1 });

    run = runNode(run, 'revise', { revision: 'Add evidence.' });
    run = runNode(run, 'draft', { draft: 'v2 with evidence' });
    run = runNode(run, 'review', { review: 'Accepted.' });
    run = runNode(run, 'gate', { decision: 'accepted' }, 'accepted');
    expect(run.nodeRuns.find((node) => node.nodeId === 'revise')).toMatchObject({ status: 'completed', iteration: 1 });
    expect(run.nodeRuns.find((node) => node.nodeId === 'failure')?.status).toBe('skipped');
    run = runNode(run, 'success', { accepted: 'v2 with evidence' });
    expect(run.status).toBe('completed');
    expect(run.loopIterations.gate).toBe(1);
  });

  it('fails visibly when the selected revision path exceeds the compiled loop limit', () => {
    let run = compile(loopPlan(1));
    run = runNode(run, 'start', { brief: 'requirements' });
    run = runNode(run, 'draft', { draft: 'v1' });
    run = runNode(run, 'review', { review: 'Revise.' });
    run = runNode(run, 'gate', { decision: 'revise' }, 'revise');
    run = runNode(run, 'revise', { revision: 'First revision.' });
    run = runNode(run, 'draft', { draft: 'v2' });
    run = runNode(run, 'review', { review: 'Revise again.' });
    run = runNode(run, 'gate', { decision: 'revise' }, 'revise');
    expect(run.status).toBe('failed');
    expect(run.loopIterations.gate).toBe(1);
    expect(run.nodeRuns.find((node) => node.nodeId === 'gate')).toMatchObject({ status: 'failed', error: 'Loop limit exhausted after 1 iterations.' });
  });

  it('rejects missing or unknown explicit condition selections', () => {
    const plan = structuredClone(STARTER_WORKFLOWS[0]);
    const started = startNextNode(compile(plan));
    expect(() => completeNode(started.run, plan.nodes[0].id, { result: true })).toThrow('must select one explicit outgoing condition');
    expect(() => completeNode(started.run, plan.nodes[0].id, { result: true }, 'not a real branch')).toThrow('not an outgoing edge');
  });

  it('exposes and selects an explicit default route beside conditional routes', () => {
    const plan = structuredClone(STARTER_WORKFLOWS[0]);
    plan.edges[0].condition = '';
    const started = startNextNode(compile(plan));
    expect(started.task?.edgeConditions).toContain('__default__');

    const routed = completeNode(started.run, plan.nodes[0].id, { result: true }, '__default__').run;
    expect(routed.edgeRuns[0]).toMatchObject({ status: 'selected', traversalCount: 1 });
    expect(routed.edgeRuns[1]).toMatchObject({ status: 'rejected', traversalCount: 0 });
  });
});
