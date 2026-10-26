import { describe, expect, it } from 'vitest';
import { validateWorkflowGraph, workflowEntryNodeIds } from '@/src/domain/models';
import { compileWorkflowRun, type WorkflowRun } from '@/src/domain/runtime';
import { completeNode, decideRuntimeApprovalByKeyword, resumeRuntimeApproval, startNextNode } from '@/src/domain/runtime-engine';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { createValidatedPlanningPlan } from '@/src/domain/planning-orchestrator';
import { DEFAULT_PLANNING_EXECUTION_SETTINGS } from '@/src/domain/planning';
import type { CodexAdapter } from '@/src/adapters/codex-adapter';
import { revisionBranchPlan } from './revision-branch-fixture';
import { testAssignmentApproval } from './test-helpers';

function compile() {
  const plan = revisionBranchPlan();
  const project = createProject({ id: 'revision-project', name: 'Revision project', rootPath: plan.workspacePath, workspaceKind: 'repository' });
  const workflow = createWorkflow({ id: plan.id, name: plan.name, status: 'published', domain: 'Documents' });
  const assignment = createProjectWorkflow({ project, workflow, status: 'ready', approval: testAssignmentApproval(), graphOverride: plan, permissions: { allowedWorkspacePaths: [project.rootPath] } });
  const compiled = compileWorkflowRun('revision-user', plan, assignment, []);
  if (!compiled.run) throw new Error(compiled.errors.join(' '));
  return compiled.run;
}
const actor = { id: 'reviewer', name: 'Reviewer', role: 'reviewer' };
function execute(run: WorkflowRun, nodeId: string, output: Record<string, unknown>, condition = '') {
  const transition = startNextNode(run);
  expect(transition.nodeRun?.nodeId).toBe(nodeId);
  return completeNode(transition.run, nodeId, output, condition).run;
}

describe('revision-only branch context', () => {
  it('retains pre-loop input contracts without introducing an artificial entry node', () => {
    const plan = revisionBranchPlan();
    expect(workflowEntryNodeIds(plan)).toEqual(['context']);
    expect(validateWorkflowGraph(plan).errors).toEqual([]);
    expect(compile().compiledWorkflow.entryNodeIds).toEqual(['context']);
    plan.nodes.reverse();
    expect(workflowEntryNodeIds(plan)).toEqual(['context']);
  });

  it('still rejects truly unavailable future inputs outside a loop', () => {
    const plan = revisionBranchPlan();
    plan.nodes[0].inputKeys = ['revisedDocument'];
    expect(validateWorkflowGraph(plan).errors.join(' ')).toContain('Node context is missing input: revisedDocument');
  });

  it('executes two human-requested revisions with original inputs intact and resumes at the next gate', () => {
    let run = execute(compile(), 'context', { sources: 'approved evidence' });
    run = execute(run, 'initial', { initialDocument: 'initial draft' });
    run = execute(run, 'review', { findings: 'reviewed first draft' });
    for (let iteration = 1; iteration <= 2; iteration += 1) {
      run = startNextNode(run).run;
      expect(run.status).toBe('paused');
      run = resumeRuntimeApproval(decideRuntimeApprovalByKeyword(run, 'gate', 'REVISE', actor, 'Only revise selected items'), 'gate', actor);
      run = execute(run, 'loop', { revisionNumber: iteration }, 'budget available');
      expect(run.loopIterations.loop).toBe(iteration);
      const prepared = startNextNode(run);
      expect(prepared.nodeRun?.nodeId).toBe('prepareRevision');
      expect(prepared.task?.input).toMatchObject({ sources: 'approved evidence', initialDocument: 'initial draft', feedback: 'revision-requested' });
      // Context is durable across serialization/reload, not an in-memory shortcut.
      run = JSON.parse(JSON.stringify(completeNode(prepared.run, 'prepareRevision', { revisionPlan: 'targeted changes' }).run));
      run = execute(run, 'revise', { revisedDocument: `revision ${iteration}` });
      const merge = startNextNode(run);
      expect(merge.task?.input).toMatchObject({ sources: 'approved evidence', initialDocument: 'initial draft', revisedDocument: `revision ${iteration}` });
      run = completeNode(merge.run, 'merge', { findings: `accepted revision ${iteration}` }).run;
    }
    run = startNextNode(run).run;
    run = resumeRuntimeApproval(decideRuntimeApprovalByKeyword(run, 'gate', 'ACCEPT', actor), 'gate', actor);
    run = execute(run, 'success', { accepted: true });
    expect(run.status).toBe('completed');
    expect(run.nodeRuns.find((node) => node.nodeId === 'context')?.attempt).toBe(1);
    expect(run.nodeRuns.find((node) => node.nodeId === 'initial')?.attempt).toBe(1);
  });

  it('does not spend additional model turns repairing a valid revision branch', async () => {
    let attempts = 0;
    const plan = revisionBranchPlan();
    const adapter = { createPlanningThread: async () => {
      attempts += 1;
      return { ok: true, value: { plan, warnings: [], openQuestions: [], trace: { planningRequestId: 'request', planningThreadId: 'thread', planId: plan.id } } };
    } } as unknown as CodexAdapter;
    const result = await createValidatedPlanningPlan(adapter, { workflowName: plan.name, planningPrompt: 'Review documents with optional human revisions.', workspacePath: plan.workspacePath, constraints: [], outputRequirements: [], executionSettings: DEFAULT_PLANNING_EXECUTION_SETTINGS });
    expect(result.ok).toBe(true);
    expect(attempts).toBe(1);
  });
});
