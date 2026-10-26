import { ensureStudioHome } from '@/scripts/studio-home.cjs';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

import { CodexAppServerAdapter } from '@/src/adapters/codex-app-server-adapter';
import type { CodexFocusedTaskRequest } from '@/src/adapters/codex-adapter';
import { DEFAULT_PLANNING_EXECUTION_SETTINGS } from '@/src/domain/planning';
import { validResponse } from './fixtures';

describe('Codex App Server planning adapter', () => {
  afterEach(() => {
    delete process.env.CODEX_TIMEOUT_MS;
    spawnMock.mockReset();
  });

  it('initializes the required protocol capabilities and runs a restricted read-only planning turn', async () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const requests: Array<Record<string, unknown>> = [];
    const emit = (...messages: Array<Record<string, unknown>>) => {
      stdout.emit('data', Buffer.from(`${messages.map((message) => JSON.stringify(message)).join('\n')}\n`));
    };
    const stdin = {
      write: vi.fn((data: string) => {
        const message = JSON.parse(data) as Record<string, unknown>;
        requests.push(message);
        const method = message.method;
        queueMicrotask(() => {
          if (method === 'initialize') emit(
            { id: message.id, result: { userAgent: 'test' } },
            { method: 'remoteControl/status/changed', params: { status: 'disabled' } },
            { method: 'mcpServer/startupStatus/updated', params: { name: 'codex_apps', status: 'starting' } }
          );
          if (method === 'thread/start') {
            stderr.emit('data', Buffer.from('WARN codex_core::shell_snapshot: Failed to create shell snapshot for powershell: Shell snapshot not supported yet for PowerShell\n'));
            emit({ id: message.id, result: { thread: { id: 'thread-app-server' } } });
          }
          if (method === 'turn/start') {
            emit(
              { id: message.id, result: { turn: { id: 'turn-1', status: 'inProgress', items: [] } } },
              { method: 'item/completed', params: { item: { type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(validResponse()) } } },
              { method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } }
            );
          }
        });
        return true;
      })
    };
    const child = Object.assign(new EventEmitter(), { stdout, stderr, stdin, kill: vi.fn() });
    spawnMock.mockReturnValue(child);

    const request = {
      workflowName: 'App Server test',
      planningPrompt: 'Return a plan.',
      workspacePath: ensureStudioHome().projects,
      constraints: [],
      outputRequirements: [],
      executionSettings: DEFAULT_PLANNING_EXECUTION_SETTINGS
    };
    const events: Array<{ type: string; message?: string; raw?: string }> = [];
    const result = await new CodexAppServerAdapter(spawnMock as never).createPlanningThread(request, (event) => events.push(event));

    expect(result).toMatchObject({
      ok: true,
      value: { trace: { planningThreadId: 'thread-app-server', planId: 'plan-1' } }
    });
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['app-server', '--listen', 'stdio://']));

    const initialize = requests.find((message) => message.method === 'initialize');
    expect(initialize).toMatchObject({ params: { capabilities: { experimentalApi: true, optOutNotificationMethods: ['remoteControl/status/changed', 'mcpServer/startupStatus/updated'] } } });
    expect((initialize?.params as Record<string, unknown>).experimentalApi).toBeUndefined();
    expect(requests.some((message) => message.method === 'initialized' && message.id === undefined)).toBe(true);
    expect(requests.some((message) => message.method === 'permissionProfile/list')).toBe(false);

    const threadStart = requests.find((message) => message.method === 'thread/start');
    expect(threadStart).toMatchObject({ params: { approvalPolicy: 'never', sandbox: 'read-only' } });

    const turnStart = requests.find((message) => message.method === 'turn/start');
    expect(turnStart).toMatchObject({
      params: {
        threadId: 'thread-app-server',
        approvalPolicy: 'never',
        outputSchema: { type: 'object' }
      }
    });
    expect((turnStart?.params as Record<string, unknown>).sandboxPolicy).toBeUndefined();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(events.some((event) => event.type === 'remoteControl/status/changed')).toBe(false);
    expect(events.some((event) => event.type === 'mcpServer/startupStatus/updated')).toBe(false);
    expect(events.some((event) => event.type === 'app-server.stderr')).toBe(false);
  });

  it('runs a focused task with runtime roots, trace metadata, and structured output', async () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const requests: Array<Record<string, unknown>> = [];
    const focused: CodexFocusedTaskRequest = {
      runId: 'run-focused', taskId: 'run-focused:inspect', sourcePlanId: 'plan-focused', workflowId: 'workflow-focused', workflowVersion: 1,
      assignmentId: 'assignment-focused', projectId: 'project-focused', nodeId: 'inspect', nodeName: 'Inspect', nodeType: 'codex', prompt: 'Inspect evidence.',
      workspacePath: ensureStudioHome().projects, input: {}, outputKeys: ['findings'], edgeConditions: [], skills: [],
      modelSettings: { model: 'gpt-5.6-sol', reasoningEffort: 'medium', verbosity: 'high', modelSource: 'system', reasoningSource: 'system' },
      harness: { sandboxMode: 'read-only', maxRetries: 1, maxLoopIterations: 3, maxConcurrentNodes: 1, allowedTools: [], allowedWorkspacePaths: [ensureStudioHome().projects], requireApprovalForDestructiveActions: true }
    };
    const final = JSON.stringify({
      outputs: [{ key: 'findings', valueJson: JSON.stringify(['evidence']) }], selectedCondition: '', summary: 'done', artifacts: [],
      trace: { runId: focused.runId, taskId: focused.taskId, sourcePlanId: focused.sourcePlanId, workflowId: focused.workflowId, assignmentId: focused.assignmentId, projectId: focused.projectId, nodeId: focused.nodeId }
    });
    const emit = (...messages: Array<Record<string, unknown>>) => stdout.emit('data', Buffer.from(`${messages.map((message) => JSON.stringify(message)).join('\n')}\n`));
    const stdin = { write: vi.fn((data: string) => {
      const message = JSON.parse(data) as Record<string, unknown>;
      requests.push(message);
      queueMicrotask(() => {
        if (message.method === 'initialize') emit({ id: message.id, result: { userAgent: 'test' } });
        if (message.method === 'thread/start') emit({ id: message.id, result: { thread: { id: 'thread-focused' } } });
        if (message.method === 'turn/start') emit(
          { id: message.id, result: { turn: { id: 'turn-focused', status: 'inProgress', items: [] } } },
          { method: 'item/completed', params: { item: { type: 'agentMessage', text: final } } },
          { method: 'turn/completed', params: { turn: { id: 'turn-focused', status: 'completed' } } }
        );
      });
      return true;
    }) };
    const child = Object.assign(new EventEmitter(), { stdout, stderr, stdin, kill: vi.fn() });
    spawnMock.mockReturnValue(child);

    await expect(new CodexAppServerAdapter(spawnMock as never).runFocusedTask(focused)).resolves.toMatchObject({ output: { findings: ['evidence'] }, providerThreadId: 'thread-focused' });
    expect(requests.find((message) => message.method === 'thread/start')).toMatchObject({ params: { cwd: ensureStudioHome().projects, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true, config: { model_reasoning_effort: 'medium', model_verbosity: 'high' } } });
    expect(requests.some((message) => message.method === 'permissionProfile/list')).toBe(false);
    expect(requests.find((message) => message.method === 'turn/start')).toMatchObject({ params: { threadId: 'thread-focused', outputSchema: { type: 'object' }, responsesapiClientMetadata: { workflow_studio_run_id: focused.runId, workflow_studio_task_id: focused.taskId, workflow_studio_node_id: focused.nodeId } } });
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
