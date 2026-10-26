import { describe, expect, it, vi } from 'vitest';
import type { CodexAdapter, CodexFocusedTaskRequest } from '@/src/adapters/codex-adapter';
import { CodexNodeExecutor, buildCodexFocusedTaskRequest } from '@/src/adapters/codex-node-executor';
import { buildFocusedTaskPrompt, parseFocusedTaskMessage } from '@/src/adapters/focused-task';
import type { FocusedNodeTask } from '@/src/domain/runtime-engine';
import { createSkill } from '@/src/domain/workspace';

function request(): CodexFocusedTaskRequest {
  return {
    runId: 'run-1', taskId: 'run-1:inspect', sourcePlanId: 'plan-1', workflowId: 'workflow-1', workflowVersion: 3,
    assignmentId: 'assignment-1', projectId: 'project-1', nodeId: 'inspect', nodeName: 'Inspect project', nodeType: 'codex',
    prompt: 'Inspect the project evidence.', workspacePath: 'C:\\projects\\demo', input: { inventory: ['requirements.md'] }, outputKeys: ['findings'], edgeConditions: [],
    skills: [{ id: 'review-skill', name: 'Review evidence', version: 2, instructions: 'Link every finding to evidence.', requiredContext: ['inventory'], requiredPermissions: [], validationCriteria: ['Every finding has evidence.'] }],
    modelSettings: { model: 'gpt-5.6-sol', reasoningEffort: 'medium', modelSource: 'system', reasoningSource: 'system' },
    harness: { sandboxMode: 'read-only', maxRetries: 1, maxLoopIterations: 3, maxConcurrentNodes: 1, allowedTools: [], allowedWorkspacePaths: ['C:\\projects\\demo'], requireApprovalForDestructiveActions: true }
  };
}

function response(overrides: Record<string, unknown> = {}) {
  const task = request();
  return JSON.stringify({
    outputs: [{ key: 'findings', valueJson: JSON.stringify([{ issue: 'Missing acceptance criteria' }]) }], selectedCondition: '',
    summary: 'Review completed.', artifacts: [],
    trace: { runId: task.runId, taskId: task.taskId, sourcePlanId: task.sourcePlanId, workflowId: task.workflowId, assignmentId: task.assignmentId, projectId: task.projectId, nodeId: task.nodeId },
    ...overrides
  });
}

describe('focused Codex task execution', () => {
  it('limits inherited skill criteria to the current stage while retaining their instructions', () => {
    const task = request();
    task.skills[0].validationCriteria = ['The final package receives human approval.'];
    const prompt = buildFocusedTaskPrompt(task);

    expect(prompt).toContain('The final package receives human approval.');
    expect(prompt).toContain('Workflow completion criteria and checks for downstream deliverables or later human approvals are not prerequisites for this node unless its instructions or declared inputs explicitly require them.');
    expect(prompt).toContain('For shared skills, apply only the criteria for the current node.');
  });

  it('builds a focused prompt and validates schema-constrained output and trace identity', () => {
    const task = request();
    const prompt = buildFocusedTaskPrompt(task);
    expect(prompt).toContain(task.prompt);
    expect(prompt).toContain('Link every finding to evidence.');
    expect(prompt).toContain(JSON.stringify(task.workspacePath));
    expect(prompt).not.toContain('planningPrompt');
    expect(parseFocusedTaskMessage(response(), task, 'thread-1')).toEqual({
      output: { findings: [{ issue: 'Missing acceptance criteria' }] }, selectedCondition: '', summary: 'Review completed.', artifacts: [],
      trace: { runId: task.runId, taskId: task.taskId, sourcePlanId: task.sourcePlanId, workflowId: task.workflowId, assignmentId: task.assignmentId, projectId: task.projectId, nodeId: task.nodeId },
      providerThreadId: 'thread-1'
    });
    expect(() => parseFocusedTaskMessage(response({ trace: { runId: 'wrong' } }), task)).toThrow('trace does not match runId');
    expect(() => parseFocusedTaskMessage(response({ outputs: [] }), task)).toThrow('missing required keys');
    const routed = { ...task, edgeConditions: ['accepted', 'revise'] };
    expect(parseFocusedTaskMessage(response({ selectedCondition: 'accepted' }), routed).selectedCondition).toBe('accepted');
    expect(() => parseFocusedTaskMessage(response({ selectedCondition: 'unknown' }), routed)).toThrow('unavailable edge condition');
  });

  it('sends only pinned published skill versions and all execution identities to the adapter', async () => {
    const skill = createSkill({ id: 'review-skill', familyId: 'review-skill', name: 'Review evidence', version: 2, status: 'published', instructions: 'Link every finding to evidence.', requiredContext: ['inventory'], validationCriteria: ['Every finding has evidence.'] });
    const task: FocusedNodeTask = {
      runId: 'run-1', taskId: 'run-1:inspect',
      node: { id: 'inspect', name: 'Inspect project', type: 'codex', focusedPrompt: 'Inspect the project evidence.', skillVersions: [{ skillId: skill.id, version: skill.version }], inputKeys: ['inventory'], outputKeys: ['findings'], retryLimit: 1, requiresApproval: false, modelSettings: { model: 'gpt-5.6-sol', reasoningEffort: 'medium', modelSource: 'system', reasoningSource: 'system' } },
      input: { inventory: ['requirements.md'] }, edgeConditions: [], harness: request().harness,
      context: { userId: 'user-1', projectId: 'project-1', workflowId: 'workflow-1', workflowVersion: 3, assignmentId: 'assignment-1', sourcePlanId: 'plan-1', rootPath: 'C:\\projects\\demo' }
    };
    const runFocusedTask = vi.fn(async (focused: CodexFocusedTaskRequest) => ({ output: { findings: ['linked'] }, selectedCondition: '', summary: 'done', artifacts: [], trace: { runId: focused.runId, taskId: focused.taskId, sourcePlanId: focused.sourcePlanId, workflowId: focused.workflowId, assignmentId: focused.assignmentId, projectId: focused.projectId, nodeId: focused.nodeId } }));
    const adapter = { createPlanningThread: vi.fn(), runFocusedTask } as unknown as CodexAdapter;
    const built = buildCodexFocusedTaskRequest(task, [skill]);
    expect(built).toMatchObject({ runId: task.runId, taskId: task.taskId, sourcePlanId: 'plan-1', workflowId: 'workflow-1', workflowVersion: 3, assignmentId: 'assignment-1', projectId: 'project-1', nodeId: 'inspect', input: task.input, skills: [{ id: skill.id, version: 2, instructions: skill.instructions }] });
    await expect(new CodexNodeExecutor(adapter, [skill]).execute(task)).resolves.toEqual({
      output: { findings: ['linked'] },
      selectedCondition: '',
      summary: 'done',
      artifacts: []
    });
    expect(runFocusedTask).toHaveBeenCalledWith(built);
  });
});
