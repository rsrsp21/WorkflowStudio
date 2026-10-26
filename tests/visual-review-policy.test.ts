import { describe, expect, it, vi } from 'vitest';
import { visualReviewPolicyIssues } from '@/src/domain/visual-review-policy';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { createValidatedPlanningPlan } from '@/src/domain/planning-orchestrator';
import { buildPlanningPrompt } from '@/src/adapters/codex-cli-adapter';
import type { WorkflowNode, WorkflowPlan } from '@/src/domain/models';
import type { CodexAdapter } from '@/src/adapters/codex-adapter';
import { DEFAULT_PLANNING_EXECUTION_SETTINGS } from '@/src/domain/planning';

function plan(human: boolean): WorkflowPlan {
  const node = (id: string, name: string, type: WorkflowNode['type'], inputKeys: string[], outputKeys: string[]): WorkflowNode => ({ id, name, type, prompt: name, skillIds: [], inputKeys, outputKeys, retryLimit: 0, requiresApproval: type === 'approval' });
  return { ...structuredClone(STARTER_WORKFLOWS[0]), name: 'UI screen creation', nodes: [
    node('generate', 'Generate screen set', 'codex', [], ['screens']),
    node('review', 'Validate UI screen consistency', 'validation', ['screens'], ['findings']),
    ...(human ? [{ ...node('human', 'Review screens and findings', 'approval', ['screens', 'findings'], ['decision']), approvalOptions: [
      { id: 'continue', label: 'Continue with screens', keyword: 'continue', action: 'continue' as const },
      { id: 'revise', label: 'Revise selected screens', keyword: 'revise', action: 'revise' as const },
      { id: 'stop', label: 'Stop', keyword: 'stop', action: 'stop' as const }
    ] }] : []),
    node('loop', 'Bound selected revisions', 'loop', [], []),
    node('success', 'Package accepted screens', 'success', ['screens', 'findings'], ['package']),
    node('failure', 'Stopped', 'failure', [], ['reason'])
  ], edges: [
    { from: 'generate', to: 'review' },
    ...(human ? [{ from: 'review', to: 'human' }] : []),
    { from: human ? 'human' : 'review', to: 'success', condition: 'continue' },
    { from: human ? 'human' : 'review', to: 'loop', condition: 'revise' },
    { from: human ? 'human' : 'review', to: 'failure', condition: 'stop' },
    { from: 'loop', to: 'generate' }
  ] };
}

describe('human-controlled visual review policy', () => {
  it('rejects autonomous regeneration and failure branches, but accepts a human decision gate', () => {
    expect(visualReviewPolicyIssues(plan(false))).toHaveLength(1);
    expect(visualReviewPolicyIssues(plan(true))).toEqual([]);
  });
  it('requires the human gate to offer both acceptance and revision, not a forced retry', () => {
    const value = plan(true);
    value.nodes.find((node) => node.id === 'human')!.approvalOptions!.shift();
    expect(visualReviewPolicyIssues(value)).toHaveLength(1);
  });
  it('does not weaken non-visual technical or safety validations', () => {
    const value = plan(false);
    value.name = 'Database migration'; value.nodes[1].name = 'Validate reconciliation consistency';
    expect(visualReviewPolicyIssues(value)).toEqual([]);
  });
  it('repairs the generated graph before review instead of silently changing approved runs', async () => {
    const createPlanningThread = vi.fn().mockImplementation(async (request) => {
      const value = request.previousPlan ? plan(true) : plan(false);
      return { ok: true, value: { plan: value, warnings: [], openQuestions: [], trace: { planningRequestId: 'request', planningThreadId: 'thread', planId: value.id } } };
    });
    const request = { workflowName: 'UI screens', planningPrompt: 'Generate and review UI screens.', workspacePath: 'C:\\projects\\screens', constraints: [], outputRequirements: [], executionSettings: DEFAULT_PLANNING_EXECUTION_SETTINGS };
    const result = await createValidatedPlanningPlan({ createPlanningThread } as unknown as CodexAdapter, request);
    expect(result.ok).toBe(true);
    expect(createPlanningThread).toHaveBeenCalledTimes(2);
    expect(createPlanningThread.mock.calls[1][0].graphRepairFeedback.join(' ')).toContain('human review gate');
    expect(buildPlanningPrompt(request)).toContain('not autonomous perfection loops');
  });
});
