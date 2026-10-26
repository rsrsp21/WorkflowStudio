import { describe, expect, it } from 'vitest';
import type { CodexFocusedTaskRequest } from '@/src/adapters/codex-adapter';
import { buildFocusedTaskPrompt } from '@/src/adapters/focused-task';

function focusedRequest(): CodexFocusedTaskRequest {
  return {
    runId: 'run-1', taskId: 'task-1', sourcePlanId: 'plan-1', workflowId: 'workflow-1', workflowVersion: 2,
    assignmentId: 'assignment-1', projectId: 'project-1', nodeId: 'node-1', nodeName: 'Inspect files', nodeType: 'codex',
    prompt: 'Inspect only the selected project files.', workspacePath: 'C:\\projects\\demo', input: { inventory: ['a.ts'] }, outputKeys: ['findings'], edgeConditions: [], skills: [],
    modelSettings: { model: 'gpt-5.6-sol', reasoningEffort: 'medium', modelSource: 'system', reasoningSource: 'system' },
    harness: { sandboxMode: 'read-only', maxRetries: 1, maxLoopIterations: 3, maxConcurrentNodes: 1, allowedTools: [], allowedWorkspacePaths: ['C:\\projects\\demo'], requireApprovalForDestructiveActions: true }
  };
}

describe('planning execution boundary', () => {
  it('builds focused execution context without accepting the planning prompt', () => {
    const request = focusedRequest();
    const prompt = buildFocusedTaskPrompt(request);
    expect(prompt).toContain(request.prompt);
    expect(prompt).toContain(request.runId);
    expect(prompt).toContain(request.assignmentId);
    expect(prompt).toContain('Do not request, reconstruct, or use the original workflow planning prompt');
    expect(prompt).not.toContain('Long private planning request');
    expect('planningPrompt' in request).toBe(false);
  });
});
