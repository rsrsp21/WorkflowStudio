import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CodexFocusedTaskRequest } from '@/src/adapters/codex-adapter';
import { buildFocusedTaskCliArgs } from '@/src/adapters/codex-cli-adapter';
import { parseFocusedTaskMessage } from '@/src/adapters/focused-task';
import { compileWorkflowRun } from '@/src/domain/runtime';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { assertRuntimeWorkspaceBoundary, isWithinWorkspaceRoot } from '@/src/domain/workspace-boundary';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

function focusedRequest(sandboxMode: 'read-only' | 'workspace' | 'isolated' = 'read-only'): CodexFocusedTaskRequest {
  const rootPath = path.resolve('test-workspace');
  return {
    runId: 'run-boundary', taskId: 'run-boundary:inspect', sourcePlanId: 'plan-boundary', workflowId: 'workflow-boundary', workflowVersion: 1,
    assignmentId: 'assignment-boundary', projectId: 'project-boundary', nodeId: 'inspect', nodeName: 'Inspect', nodeType: 'codex', prompt: 'Inspect the approved root.',
    workspacePath: rootPath, input: {}, outputKeys: ['result'], edgeConditions: [], skills: [],
    modelSettings: { model: 'gpt-5.6-sol', reasoningEffort: 'medium', modelSource: 'system', reasoningSource: 'system' },
    harness: { sandboxMode, maxRetries: 0, maxLoopIterations: 1, maxConcurrentNodes: 1, allowedTools: [], allowedWorkspacePaths: [rootPath], requireApprovalForDestructiveActions: true }
  };
}

function response(request: CodexFocusedTaskRequest, artifactPath: string) {
  return JSON.stringify({
    outputs: [{ key: 'result', valueJson: 'true' }], selectedCondition: '', summary: 'done', artifacts: [{ path: artifactPath, description: 'Result' }],
    trace: { runId: request.runId, taskId: request.taskId, sourcePlanId: request.sourcePlanId, workflowId: request.workflowId, assignmentId: request.assignmentId, projectId: request.projectId, nodeId: request.nodeId }
  });
}

describe('Phase 4 runtime workspace boundaries', () => {
  it('allows only one exact approved root and treats isolated execution as read-only', () => {
    const request = focusedRequest('isolated');
    expect(assertRuntimeWorkspaceBoundary(request.workspacePath, request.harness)).toMatchObject({ sandbox: 'read-only', writeAllowed: false });
    expect(isWithinWorkspaceRoot(path.join(request.workspacePath, 'nested', 'file.txt'), request.workspacePath)).toBe(true);
    expect(isWithinWorkspaceRoot(path.resolve(request.workspacePath, '..', 'outside.txt'), request.workspacePath)).toBe(false);

    request.harness.allowedWorkspacePaths = [request.workspacePath, path.join(request.workspacePath, 'nested')];
    expect(() => assertRuntimeWorkspaceBoundary(request.workspacePath, request.harness)).toThrow('restricted to the approved project root');
  });

  it('locks CLI execution to the approved root and explicit assignment sandbox', () => {
    const readOnly = focusedRequest('read-only');
    const readOnlyArgs = buildFocusedTaskCliArgs(readOnly, 'schema.json', 'output.json');
    expect(readOnlyArgs).toEqual(expect.arrayContaining(['--ignore-user-config', '--sandbox', 'read-only', '-C', readOnly.workspacePath]));
    expect(readOnlyArgs).not.toContain('--add-dir');
    readOnly.modelSettings.verbosity = 'low';
    expect(buildFocusedTaskCliArgs(readOnly, 'schema.json', 'output.json')).toContain('model_verbosity=low');

    const writable = focusedRequest('workspace');
    expect(buildFocusedTaskCliArgs(writable, 'schema.json', 'output.json')).toEqual(expect.arrayContaining(['--sandbox', 'workspace-write', '-C', writable.workspacePath]));
  });

  it('rejects artifact paths outside the root and stamps accepted artifacts with the approved boundary', () => {
    const request = focusedRequest('workspace');
    expect(() => parseFocusedTaskMessage(response(request, path.resolve(request.workspacePath, '..', 'escape.txt')), request)).toThrow('outside the approved project root');

    const result = parseFocusedTaskMessage(response(request, path.join('reports', 'result.md')), request);
    expect(result.artifacts[0]).toEqual({
      path: path.join(request.workspacePath, 'reports', 'result.md'), description: 'Result', rootPath: request.workspacePath, sandboxMode: 'workspace', writeAllowed: true
    });
  });

  it('compiles assignment permissions instead of reusable-plan permissions', () => {
    const plan = structuredClone(STARTER_WORKFLOWS[0]);
    plan.harness.sandboxMode = 'workspace';
    plan.harness.allowedTools = ['unapproved-write'];
    plan.harness.allowedWorkspacePaths = [path.resolve('unapproved-root')];
    const project = createProject({ id: 'boundary-project', name: 'Boundary project', rootPath: path.resolve('approved-root'), workspaceKind: 'empty' });
    const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: 'Testing', status: 'published' });
    const assignment = createProjectWorkflow({ project, workflow, status: 'ready', approval: testAssignmentApproval(workflow.version), graphOverride: plan, inputOverrides: { project: project.rootPath }, permissions: { sandboxMode: 'read-only', allowedTools: [], allowedWorkspacePaths: [project.rootPath], requireApprovalForDestructiveActions: true } });
    const result = compileWorkflowRun('boundary-user', plan, assignment, []);

    expect(result.errors).toEqual([]);
    expect(result.run?.compiledWorkflow.harness).toMatchObject({ sandboxMode: 'read-only', allowedTools: [], allowedWorkspacePaths: [project.rootPath], requireApprovalForDestructiveActions: true });
    expect(result.run?.rootPath).toBe(project.rootPath);
  });
});
