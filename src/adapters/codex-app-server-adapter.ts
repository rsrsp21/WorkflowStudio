import { assertStudioProject, studioRuntimeEnvironment } from '@/scripts/studio-home.cjs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { PlanningRequest, PlanningResult } from '@/src/domain/planning';
import { LocalCodexAdapter, type CodexAdapter, type CodexEvent, type CodexFocusedTaskRequest } from './codex-adapter';
import { buildPlanningPrompt, CodexCliAdapter, parsePlanningMessage } from './codex-cli-adapter';
import { buildFocusedTaskPrompt, parseFocusedTaskMessage, prepareFocusedTaskArtifacts } from './focused-task';
import { resolveCodexInvocation } from './codex-runtime';
import focusedTaskResponseSchema from './focused-task-response.schema.json';
import planningResponseSchema from './planning-response.schema.json';
import { assertRuntimeWorkspaceBoundary } from '@/src/domain/workspace-boundary';
import { PairedCodexRuntimeAdapter, shouldUsePairedRuntime } from './paired-runtime-adapter';

type JsonRpcId = number;

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcMessage {
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: JsonRpcError;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function providerFailure(message: string, planningRequestId: string, planningThreadId?: string): PlanningResult {
  return {
    ok: false,
    error: {
      code: 'PROVIDER_FAILURE',
      message,
      trace: { planningRequestId, ...(planningThreadId ? { planningThreadId } : {}) }
    }
  };
}

function eventMessage(method: string, params: Record<string, unknown>): string | undefined {
  if (method === 'thread/started') return 'Codex App Server thread started.';
  if (method === 'turn/started') return 'Codex planning turn started.';
  if (method === 'turn/completed') {
    const turn = params.turn as Record<string, unknown> | undefined;
    return `Codex planning turn ${String(turn?.status ?? 'completed')}.`;
  }
  if (method === 'item/started' || method === 'item/completed') {
    const item = params.item as Record<string, unknown> | undefined;
    const itemType = typeof item?.type === 'string' ? item.type : 'item';
    return `${method === 'item/started' ? 'Started' : 'Completed'} ${itemType}.`;
  }
  return undefined;
}

function isInternalStderrNoise(line: string): boolean {
  return line.includes('codex_core_plugins::manifest: ignoring interface.defaultPrompt')
    || line.includes('codex_core::shell_snapshot: Failed to create shell snapshot');
}

class CodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private nextId = 1;
  private stdoutBuffer = '';
  private stopped = false;

  constructor(
    workspacePath: string,
    private readonly onNotification: (message: JsonRpcMessage, raw: string) => void,
    onStderr: (line: string) => void,
    spawnProcess: typeof spawn = spawn
  ) {
    const { executable, args } = resolveCodexInvocation(['app-server', '--listen', 'stdio://']);
    const runtimeEnvironment = studioRuntimeEnvironment();
    this.child = spawnProcess(executable, args, {
      cwd: assertStudioProject(workspacePath),
      shell: false,
      windowsHide: true,
      env: runtimeEnvironment
    });

    this.child.stdout.on('data', (chunk: Buffer) => this.consumeStdout(chunk.toString()));
    this.child.stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) onStderr(line);
    });
    this.child.on('error', (error) => this.rejectPending(new Error(`Could not start Codex App Server: ${error.message}`)));
    this.child.on('close', (code) => {
      if (!this.stopped) this.rejectPending(new Error(`Codex App Server exited with code ${code ?? 'unknown'}.`));
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      clientInfo: { name: 'workflow_studio', title: 'Workflow Studio', version: '0.1.0' },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: [
          'remoteControl/status/changed',
          'mcpServer/startupStatus/updated'
        ]
      }
    });
    this.notify('initialized', {});
  }

  request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.write({ id, method, params });
    });
  }

  stop(): void {
    this.stopped = true;
    this.rejectPending(new Error('Codex App Server stopped.'));
    this.child.kill();
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.write({ method, params });
  }

  private write(message: JsonRpcMessage): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? '';
    for (const line of lines.filter(Boolean)) {
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        this.onNotification({ method: 'app-server/protocol-warning', params: { message: 'Received malformed JSONL.' } }, line);
        continue;
      }

      if (message.id !== undefined && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`Codex App Server ${message.error.code}: ${message.error.message}`));
        else pending.resolve(message.result);
        continue;
      }

      if (message.id !== undefined && message.method) {
        // Planning runs with approvals disabled and read-only access. Decline any
        // unexpected approval request instead of allowing the server to wait.
        if (message.method.endsWith('/requestApproval')) {
          this.write({ id: message.id, result: { decision: 'decline' } });
        } else {
          this.write({ id: message.id, error: { code: -32601, message: `Unsupported client method: ${message.method}` } });
        }
      }

      this.onNotification(message, line);
    }
  }

  private rejectPending(error: Error): void {
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();
  }
}

export class CodexAppServerAdapter implements CodexAdapter {
  constructor(private readonly spawnProcess: typeof spawn = spawn) {}

  async createPlanningThread(request: PlanningRequest, onEvent?: (event: CodexEvent) => void): Promise<PlanningResult> {
    const planningRequestId = `planning_${crypto.randomUUID()}`;
    try { assertStudioProject(request.workspacePath); } catch (error) { return providerFailure(error instanceof Error ? error.message : 'Project is outside Workflow Studio.', planningRequestId); }
    const timeoutMs = Number(process.env.CODEX_TIMEOUT_MS ?? 120000);
    let planningThreadId: string | undefined;
    let finalMessage = '';
    let streamedMessage = '';
    let turnCompletionResolve: (() => void) | undefined;
    let turnCompletionReject: ((error: Error) => void) | undefined;
    let timedOut = false;

    const turnCompletion = new Promise<void>((resolve, reject) => {
      turnCompletionResolve = resolve;
      turnCompletionReject = reject;
    });

    const client = new CodexAppServerClient(
      request.workspacePath,
      (message, raw) => {
        const method = message.method ?? 'app-server.message';
        const params = message.params ?? {};
        if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') streamedMessage += params.delta;
        if (method === 'item/completed') {
          const item = params.item as Record<string, unknown> | undefined;
          if (item?.type === 'agentMessage' && typeof item.text === 'string') finalMessage = item.text;
        }
        if (method === 'turn/completed') {
          const turn = params.turn as Record<string, unknown> | undefined;
          if (turn?.status === 'completed') turnCompletionResolve?.();
          else {
            const error = turn?.error as Record<string, unknown> | undefined;
            turnCompletionReject?.(new Error(typeof error?.message === 'string' ? error.message : `Codex turn ${String(turn?.status ?? 'failed')}.`));
          }
        }
        if (method === 'remoteControl/status/changed' || method === 'mcpServer/startupStatus/updated') return;
        const messageText = eventMessage(method, params);
        const includeRaw = ['error', 'warning', 'configWarning', 'app-server/protocol-warning'].includes(method);
        if (!messageText && !includeRaw) return;
        onEvent?.({ type: method, message: messageText, threadId: planningThreadId, ...(includeRaw ? { raw } : {}) });
      },
      (line) => {
        if (isInternalStderrNoise(line)) return;
        onEvent?.({ type: 'app-server.stderr', message: line.slice(0, 500), stream: 'stderr', raw: line });
      },
      this.spawnProcess
    );

    const timer = setTimeout(() => {
      timedOut = true;
      client.stop();
      turnCompletionReject?.(new Error('Codex App Server planning request timed out.'));
    }, timeoutMs);

    try {
      await client.initialize();
      const threadResult = await client.request<{ thread?: { id?: string } }>('thread/start', {
        cwd: request.workspacePath,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        serviceName: 'workflow_studio',
        model: request.executionSettings.planningModel,
        config: { model_reasoning_effort: request.executionSettings.planningReasoningEffort }
      });
      planningThreadId = threadResult.thread?.id;
      if (!planningThreadId) throw new Error('Codex App Server did not return a thread id.');

      await client.request('turn/start', {
        threadId: planningThreadId,
        input: [{ type: 'text', text: buildPlanningPrompt(request) }],
        cwd: request.workspacePath,
        approvalPolicy: 'never',
        outputSchema: planningResponseSchema
      });
      await turnCompletion;
      const raw = finalMessage.trim() || streamedMessage.trim();
      if (!raw) return providerFailure('Codex App Server completed without a final planning message.', planningRequestId, planningThreadId);
      return parsePlanningMessage(raw, planningRequestId, planningThreadId);
    } catch (error) {
      if (timedOut) {
        return { ok: false, error: { code: 'TIMEOUT', message: 'Codex App Server planning request timed out.', trace: { planningRequestId, ...(planningThreadId ? { planningThreadId } : {}) } } };
      }
      return providerFailure(error instanceof Error ? error.message : 'Codex App Server planning failed.', planningRequestId, planningThreadId);
    } finally {
      clearTimeout(timer);
      client.stop();
    }
  }

  async runFocusedTask(request: CodexFocusedTaskRequest) {
    const boundary = assertRuntimeWorkspaceBoundary(request.workspacePath, request.harness);
    const deliverables = await prepareFocusedTaskArtifacts(request);
    const timeoutMs = Number(process.env.CODEX_EXECUTION_TIMEOUT_MS ?? process.env.CODEX_TIMEOUT_MS ?? 120000);
    let providerThreadId: string | undefined;
    let finalMessage = '';
    let streamedMessage = '';
    let completionResolve: (() => void) | undefined;
    let completionReject: ((error: Error) => void) | undefined;
    const completion = new Promise<void>((resolve, reject) => { completionResolve = resolve; completionReject = reject; });
    const client = new CodexAppServerClient(
      request.workspacePath,
      (message) => {
        const params = message.params ?? {};
        if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') streamedMessage += params.delta;
        if (message.method === 'item/completed') {
          const item = params.item as Record<string, unknown> | undefined;
          if (item?.type === 'agentMessage' && typeof item.text === 'string') finalMessage = item.text;
        }
        if (message.method === 'turn/completed') {
          const turn = params.turn as Record<string, unknown> | undefined;
          if (turn?.status === 'completed') completionResolve?.();
          else {
            const error = turn?.error as Record<string, unknown> | undefined;
            completionReject?.(new Error(typeof error?.message === 'string' ? error.message : `Codex focused turn ${String(turn?.status ?? 'failed')}.`));
          }
        }
      },
      () => undefined,
      this.spawnProcess
    );
    const timer = setTimeout(() => {
      client.stop();
      completionReject?.(new Error('Codex focused task timed out.'));
    }, timeoutMs);

    try {
      await client.initialize();
      const threadResult = await client.request<{ thread?: { id?: string } }>('thread/start', {
        cwd: boundary.rootPath,
        approvalPolicy: 'never',
        sandbox: boundary.sandbox,
        ephemeral: true,
        serviceName: 'workflow_studio_execution',
        model: request.modelSettings.model,
        config: { model_reasoning_effort: request.modelSettings.reasoningEffort, ...(request.modelSettings.verbosity ? { model_verbosity: request.modelSettings.verbosity } : {}) }
      });
      providerThreadId = threadResult.thread?.id;
      if (!providerThreadId) throw new Error('Codex App Server did not return a focused-task thread id.');
      await client.request('turn/start', {
        threadId: providerThreadId,
        input: [{ type: 'text', text: buildFocusedTaskPrompt(request) }],
        cwd: boundary.rootPath,
        approvalPolicy: 'never',
        outputSchema: focusedTaskResponseSchema,
        responsesapiClientMetadata: {
          workflow_studio_run_id: request.runId,
          workflow_studio_task_id: request.taskId,
          workflow_studio_plan_id: request.sourcePlanId,
          workflow_studio_workflow_id: request.workflowId,
          workflow_studio_assignment_id: request.assignmentId,
          workflow_studio_project_id: request.projectId,
          workflow_studio_node_id: request.nodeId
        }
      });
      await completion;
      const raw = finalMessage.trim() || streamedMessage.trim();
      if (!raw) throw new Error('Codex App Server completed without a focused-task result.');
      return parseFocusedTaskMessage(await deliverables.finish(raw), request, providerThreadId);
    } finally {
      clearTimeout(timer);
      client.stop();
    }
  }
}

class CodexFallbackAdapter implements CodexAdapter {
  constructor(private readonly primary: CodexAdapter, private readonly fallback: CodexAdapter) {}

  async createPlanningThread(request: PlanningRequest, onEvent?: (event: CodexEvent) => void): Promise<PlanningResult> {
    const result = await this.primary.createPlanningThread(request, onEvent);
    if (result.ok || result.error.code !== 'PROVIDER_FAILURE') return result;
    onEvent?.({ type: 'app-server.fallback', message: `App Server unavailable: ${result.error.message} Retrying with Codex CLI.` });
    return this.fallback.createPlanningThread(request, onEvent);
  }

  async runFocusedTask(request: CodexFocusedTaskRequest) {
    try { return await this.primary.runFocusedTask(request); } catch (error) {
      if ((error as { code?: string })?.code === 'PROJECT_DELIVERABLE_INVALID') throw error;
      return this.fallback.runFocusedTask(request);
    }
  }
}

export function createCodexPlanningAdapter(options: { userId?: string } = {}): CodexAdapter {
  if (shouldUsePairedRuntime()) {
    if (!options.userId) return new LocalCodexAdapter();
    return new PairedCodexRuntimeAdapter(options.userId);
  }
  if (process.env.CODEX_PROVIDER === 'cli') return new CodexCliAdapter();
  const appServer = new CodexAppServerAdapter();
  if (process.env.CODEX_APP_SERVER_FALLBACK === 'false') return appServer;
  return new CodexFallbackAdapter(appServer, new CodexCliAdapter());
}
