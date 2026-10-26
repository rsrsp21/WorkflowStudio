import { describe, expect, it, vi } from 'vitest';
import type { CodexAdapter, CodexEvent } from '@/src/adapters/codex-adapter';
import { createValidatedPlanningPlan, normalizeGeneratedGraph } from '@/src/domain/planning-orchestrator';
import { unboundedWorkflowCycle, validateWorkflowGraph, type WorkflowPlan } from '@/src/domain/models';
import { DEFAULT_PLANNING_EXECUTION_SETTINGS, type PlanningRequest, type PlanningResult } from '@/src/domain/planning';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';

function request(): PlanningRequest {
  return {
    workflowName: 'Review workflow',
    planningPrompt: 'Review the project.',
    workspacePath: 'C:\\projects\\review',
    constraints: [],
    outputRequirements: ['Approved result'],
    executionSettings: DEFAULT_PLANNING_EXECUTION_SETTINGS
  };
}

function result(plan = structuredClone(STARTER_WORKFLOWS[0]), thread = 'thread-1'): PlanningResult {
  return { ok: true, value: { plan, warnings: [], openQuestions: [], trace: { planningRequestId: `request-${thread}`, planningThreadId: thread, planId: plan.id } } };
}

function invalidPlan() {
  const plan = structuredClone(STARTER_WORKFLOWS[0]);
  plan.nodes[1].outputKeys = ['result'];
  return plan;
}

describe('planning graph repair orchestration', () => {
  it('identifies the exact bypass cycle and conflicting route conditions in repair feedback', async () => {
    const plan = structuredClone(STARTER_WORKFLOWS[0]);
    const first = plan.nodes[0].id;
    const selector = 'candidate-selector';
    const loop = 'bounded-revision';
    plan.nodes.push(
      { ...plan.nodes[0], id: selector, name: 'Select candidate', inputKeys: [], outputKeys: [] },
      { ...plan.nodes[0], id: loop, name: 'Bound revisions', type: 'loop', inputKeys: [], outputKeys: [] }
    );
    plan.edges.push(
      { from: first, to: selector, condition: 'accept' },
      { from: selector, to: first, condition: 'candidate_ready' },
      { from: first, to: loop, condition: 'revise' },
      { from: loop, to: first, condition: 'budget_available' },
      { from: loop, to: first, condition: 'another_outcome' }
    );
    expect(unboundedWorkflowCycle(plan)).toEqual([first, selector, first]);
    const normalized = normalizeGeneratedGraph(plan);
    // Different route conditions cannot be discarded to make validation pass.
    expect(normalized.edges.filter((edge) => edge.from === loop && edge.to === first)).toHaveLength(2);
    const createPlanningThread = vi.fn()
      .mockResolvedValueOnce(result(plan))
      .mockResolvedValue(result());
    await createValidatedPlanningPlan({ createPlanningThread } as unknown as CodexAdapter, request());
    const feedback = createPlanningThread.mock.calls[1][0].graphRepairFeedback.join('\n');
    expect(feedback).toContain(`${first} -> ${selector} -> ${first}`);
    expect(feedback).toContain('adding a loop elsewhere does not bound this cycle');
    expect(feedback).toContain('["budget_available","another_outcome"]');
    expect(feedback).toContain('Do not silently discard an outcome');
  });

  it('normalizes a generated initial-pass and bounded-revision loop without another Codex turn', async () => {
    const base = structuredClone(STARTER_WORKFLOWS[0]);
    const plan: WorkflowPlan = {
      ...base,
      nodes: [
        { id: 'initial', name: 'Generate initial screens', type: 'codex', prompt: 'Generate screens.', skillIds: [], inputKeys: ['project'], outputKeys: ['screens'], retryLimit: 1, requiresApproval: false },
        { id: 'review', name: 'Review screens', type: 'validation', prompt: 'Review screens.', skillIds: [], inputKeys: ['screens'], outputKeys: ['review'], retryLimit: 1, requiresApproval: false },
        { id: 'revise', name: 'Regenerate screens', type: 'codex', prompt: 'Revise screens.', skillIds: [], inputKeys: ['review'], outputKeys: ['revised_screens'], retryLimit: 1, requiresApproval: false },
        { id: 'loop', name: 'Bound revisions', type: 'loop', prompt: 'Count revisions.', skillIds: [], inputKeys: [], outputKeys: [], retryLimit: 0, requiresApproval: false },
        { id: 'success', name: 'Screens approved', type: 'success', prompt: 'Record approval.', skillIds: [], inputKeys: ['review'], outputKeys: ['approved'], retryLimit: 0, requiresApproval: false },
        { id: 'failure', name: 'Screens blocked', type: 'failure', prompt: 'Record failure.', skillIds: [], inputKeys: ['review'], outputKeys: ['failure'], retryLimit: 0, requiresApproval: false }
      ],
      edges: [
        { from: 'initial', to: 'loop' },
        { from: 'revise', to: 'loop' },
        { from: 'loop', to: 'review' },
        { from: 'review', to: 'success', condition: 'accepted' },
        { from: 'review', to: 'revise', condition: 'revise' },
        { from: 'review', to: 'failure', condition: 'blocked' }
      ]
    };
    const normalized = normalizeGeneratedGraph(plan);
    expect(normalized.edges).toContainEqual({ from: 'initial', to: 'review' });
    expect(normalized.edges).toContainEqual({ from: 'revise', to: 'loop' });
    expect(validateWorkflowGraph(normalized, [], undefined, { allowUnavailableSkills: true }).errors).toEqual([]);
    const createPlanningThread = vi.fn().mockResolvedValue(result(plan));
    const planned = await createValidatedPlanningPlan({ createPlanningThread } as unknown as CodexAdapter, request());
    expect(planned.ok).toBe(true);
    expect(createPlanningThread).toHaveBeenCalledTimes(1);
  });

  it('repairs an invalid generated graph before returning it to review', async () => {
    const createPlanningThread = vi.fn()
      .mockResolvedValueOnce(result(invalidPlan(), 'thread-invalid'))
      .mockResolvedValueOnce(result(structuredClone(STARTER_WORKFLOWS[0]), 'thread-repaired'));
    const adapter = { createPlanningThread } as unknown as CodexAdapter;
    const events: CodexEvent[] = [];

    const repaired = await createValidatedPlanningPlan(adapter, request(), (event) => events.push(event));

    expect(repaired.ok).toBe(true);
    expect(createPlanningThread).toHaveBeenCalledTimes(2);
    expect(createPlanningThread.mock.calls[1][0].graphRepairFeedback.join(' ')).toContain('multiple producers');
    expect(events).toContainEqual(expect.objectContaining({ type: 'planning.repairing' }));
    if (repaired.ok) expect(repaired.repairAttempts).toBe(1);
  });

  it('never releases a graph that remains structurally invalid after bounded repair attempts', async () => {
    const adapter = { createPlanningThread: vi.fn().mockResolvedValue(result(invalidPlan())) } as unknown as CodexAdapter;
    const repaired = await createValidatedPlanningPlan(adapter, request());

    expect(repaired.ok).toBe(false);
    expect(adapter.createPlanningThread).toHaveBeenCalledTimes(3);
    if (!repaired.ok) {
      expect(repaired.error.code).toBe('INVALID_PLAN');
      expect(repaired.error.message).toContain('No workflow was saved');
    }
  });
});
