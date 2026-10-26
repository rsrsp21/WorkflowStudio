import crypto from 'node:crypto';
import { RuntimeUnavailableError } from '@/src/domain/runtime-unavailable';
import type { CodexAdapter, CodexEvent, CodexFocusedTaskRequest } from './codex-adapter';
import { buildPlanningPrompt, parsePlanningMessage } from './codex-cli-adapter';
import { buildFocusedTaskPrompt, parseFocusedTaskMessage } from './focused-task';
import focusedTaskResponseSchema from './focused-task-response.schema.json';
import planningResponseSchema from './planning-response.schema.json';
import type { PlanningRequest, PlanningResult } from '@/src/domain/planning';
import type { RuntimeJobKind } from '@/src/domain/runtime-connection';
import { companionSupportsDurableResults, companionSupportsVerbosity } from '@/src/domain/runtime-connection';
import { assertRuntimeWorkspaceBoundary } from '@/src/domain/workspace-boundary';
import {
  cancelRuntimeJob, enqueueRuntimeJob, getOnlineRuntimeConnection, getRuntimeJob, listRuntimeJobEvents, listRuntimeConnections
} from '@/src/storage/runtime-connection-repository';
import { subscribeRuntimeJobUpdates } from '@/src/server/runtime-job-events';

type RuntimeResult = { raw?: unknown; providerThreadId?: unknown; runtimeJobId?: string; runtimeConnectionId?: string };

export type PairedRuntimeJobErrorCode = 'RUNTIME_OFFLINE' | 'JOB_DISAPPEARED' | 'JOB_FAILED' | 'JOB_TIMEOUT';

export class PairedRuntimeJobError extends Error {
  constructor(readonly code: PairedRuntimeJobErrorCode, message: string, readonly jobId?: string) {
    super(message);
    this.name = 'PairedRuntimeJobError';
  }
}

function providerFailure(message: string, planningRequestId: string): PlanningResult {
  return { ok: false, error: { code: 'PROVIDER_FAILURE', message, trace: { planningRequestId } } };
}

async function waitForRuntimeJob(
  userId: string,
  jobId: string,
  timeoutMs: number,
  onEvent?: (event: CodexEvent) => void,
  preserveProviderCompletion = false,
  durableResults = false
): Promise<RuntimeResult> {
  const startedAt = Date.now();
  let lastSequence = -1;
  let providerCompleted = false;
  let wake = () => {};
  let notified = false;
  let notificationsAvailable = true;
  let unsubscribe = () => {};
  try {
    unsubscribe = await subscribeRuntimeJobUpdates(jobId, () => { notified = true; wake(); });
  } catch {
    // The isolated in-memory database used by tests has no PostgreSQL LISTEN socket.
    // Deployed PostgreSQL runtimes always use notifications.
    notificationsAvailable = false;
  }
  try {
  while (Date.now() - startedAt < timeoutMs) {
    for (const event of await listRuntimeJobEvents(userId, jobId, lastSequence)) {
      lastSequence = event.sequence;
      if (event.payload && typeof event.payload === 'object' && 'type' in event.payload && event.payload.type === 'turn/completed'
        && 'message' in event.payload && event.payload.message === 'Codex turn completed.') providerCompleted = true;
      if (event.payload && typeof event.payload === 'object') onEvent?.(event.payload as CodexEvent);
    }
    const job = await getRuntimeJob(userId, jobId);
    if (!job) throw new PairedRuntimeJobError('JOB_DISAPPEARED', 'Paired runtime job disappeared before completion.', jobId);
    if (job.status === 'completed') return { ...((job.result ?? {}) as RuntimeResult), runtimeJobId: job.id, runtimeConnectionId: job.connectionId };
    if (job.status === 'failed' || job.status === 'cancelled') throw new PairedRuntimeJobError('JOB_FAILED', job.error || `Paired runtime job ${job.status}.`, jobId);
    const connection = (await listRuntimeConnections(userId)).find((candidate) => candidate.id === job.connectionId);
    if (!connection || connection.status !== 'online') throw new RuntimeUnavailableError();
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const nextUpdate = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, notificationsAvailable ? Math.min(remaining, 5000) : Math.min(remaining, 25));
      wake = () => { if (timer) clearTimeout(timer); resolve(); };
    });
    if (!notified) await nextUpdate;
    else if (timer) clearTimeout(timer);
    notified = false;
  }
  if (preserveProviderCompletion) {
    const tail = await listRuntimeJobEvents(userId, jobId, lastSequence);
    providerCompleted ||= tail.some((event) => event.payload && typeof event.payload === 'object' && 'type' in event.payload
      && event.payload.type === 'turn/completed' && 'message' in event.payload && event.payload.message === 'Codex turn completed.');
    const latest = await getRuntimeJob(userId, jobId);
    if (latest?.status === 'completed') return { ...((latest.result ?? {}) as RuntimeResult), runtimeJobId: latest.id, runtimeConnectionId: latest.connectionId };
    if (durableResults && latest && ['queued', 'leased'].includes(latest.status)) throw new RuntimeUnavailableError(providerCompleted
      ? 'Provider work finished. Waiting for verified result delivery. Reconnect the same companion to replay its saved result.'
      : 'Waiting for the existing companion attempt or its saved result. The companion enforces the provider timeout; uncertain work is not regenerated automatically.');
    if (providerCompleted && latest?.status === 'leased') throw new RuntimeUnavailableError('Provider work finished. Waiting for verified result delivery; this task will not be regenerated automatically. Reconnect the same companion to replay its saved result.');
  }
  await cancelRuntimeJob(userId, jobId);
  // Cancellation conditionally updates only queued/leased jobs. A completion
  // that won that database race must still be consumed, even if its notification
  // arrived at the deadline and the polling loop never observed it.
  const settled = await getRuntimeJob(userId, jobId);
  if (!settled) throw new PairedRuntimeJobError('JOB_DISAPPEARED', 'Paired runtime job disappeared before completion.', jobId);
  if (settled.status === 'completed') return { ...((settled.result ?? {}) as RuntimeResult), runtimeJobId: settled.id, runtimeConnectionId: settled.connectionId };
  if (settled.status === 'failed') throw new PairedRuntimeJobError('JOB_FAILED', settled.error || 'Paired runtime job failed.', jobId);
  throw new PairedRuntimeJobError('JOB_TIMEOUT', 'The paired local runtime did not complete the task before the timeout.', jobId);
  } finally {
    unsubscribe();
  }
}

export async function dispatchPairedRuntimeJob<TResult = RuntimeResult>(
  userId: string,
  kind: RuntimeJobKind,
  payload: unknown,
  options: { timeoutMs?: number; onEvent?: (event: CodexEvent) => void; requireDurableResults?: boolean; modelSettings?: { model: string; reasoningEffort: string; verbosity?: 'low' | 'medium' | 'high' } } = {}
): Promise<TResult> {
  const connection = await getOnlineRuntimeConnection(userId);
  if (!connection) throw new RuntimeUnavailableError();
  if (options.modelSettings?.verbosity && !companionSupportsVerbosity(connection.companionVersion)) throw new PairedRuntimeJobError('RUNTIME_OFFLINE', 'Update and restart the companion to version 0.1.1 or later to apply output verbosity.');
  if (options.requireDurableResults && !companionSupportsDurableResults(connection.companionVersion)) throw new RuntimeUnavailableError('Update and restart the companion to version 0.2.0 or later for durable results and parallel execution. Existing work has not been regenerated.');
  if (options.modelSettings && connection.supportedModels?.length && !connection.supportedModels.includes(options.modelSettings.model)) throw new PairedRuntimeJobError('RUNTIME_OFFLINE', `The connected companion does not support the selected model: ${options.modelSettings.model}.`);
  if (options.modelSettings && connection.supportedReasoningEfforts?.length && !connection.supportedReasoningEfforts.includes(options.modelSettings.reasoningEffort)) throw new PairedRuntimeJobError('RUNTIME_OFFLINE', `The connected companion does not support the selected reasoning effort: ${options.modelSettings.reasoningEffort}.`);
  const job = await enqueueRuntimeJob(userId, connection.id, kind, payload);
  return await waitForRuntimeJob(userId, job.id, options.timeoutMs ?? Number(process.env.CODEX_TIMEOUT_MS ?? 120000), options.onEvent, kind === 'focused-task', Boolean(options.requireDurableResults)) as TResult;
}

export class PairedCodexRuntimeAdapter implements CodexAdapter {
  constructor(private readonly userId: string) {}

  async createPlanningThread(request: PlanningRequest, onEvent?: (event: CodexEvent) => void): Promise<PlanningResult> {
    const planningRequestId = `planning_${crypto.randomUUID()}`;
    try {
      const result = await dispatchPairedRuntimeJob<RuntimeResult>(this.userId, 'planning', {
        cwd: request.workspacePath,
        prompt: buildPlanningPrompt(request),
        outputSchema: planningResponseSchema,
        permission: 'read-only',
        sandbox: 'read-only',
        requireRuntimeApprovals: false,
        serviceName: 'workflow_studio_planning',
        modelSettings: { model: request.executionSettings.planningModel, reasoningEffort: request.executionSettings.planningReasoningEffort }
      }, {
        timeoutMs: Number(process.env.CODEX_PLANNING_TIMEOUT_MS ?? 900_000),
        onEvent,
        modelSettings: { model: request.executionSettings.planningModel, reasoningEffort: request.executionSettings.planningReasoningEffort }
      });
      if (typeof result.raw !== 'string') return providerFailure('The paired runtime completed without a final planning message.', planningRequestId);
      const threadId = typeof result.providerThreadId === 'string' ? result.providerThreadId : undefined;
      return parsePlanningMessage(result.raw, planningRequestId, threadId);
    } catch (error) {
      return providerFailure(error instanceof Error ? error.message : 'Paired runtime planning failed.', planningRequestId);
    }
  }

  async runFocusedTask(request: CodexFocusedTaskRequest) {
    const boundary = assertRuntimeWorkspaceBoundary(request.workspacePath, request.harness);
    const result = await dispatchPairedRuntimeJob<RuntimeResult>(this.userId, 'focused-task', {
      cwd: boundary.rootPath,
      prompt: buildFocusedTaskPrompt(request),
      outputSchema: focusedTaskResponseSchema,
      permission: boundary.writeAllowed ? 'workspace' : 'read-only',
      sandbox: boundary.sandbox,
      requireRuntimeApprovals: request.harness.requireApprovalForDestructiveActions,
      allowedTools: [...request.harness.allowedTools],
      artifactInputs: request.input,
      serviceName: 'workflow_studio_execution',
      durableResults: true,
      executionTimeoutMs: Math.min(900_000, Math.max(1000, Number(process.env.CODEX_EXECUTION_TIMEOUT_MS ?? process.env.CODEX_TIMEOUT_MS) || 900_000)),
      modelSettings: request.modelSettings,
      metadata: {
        workflow_studio_run_id: request.runId,
        workflow_studio_task_id: request.taskId,
        workflow_studio_plan_id: request.sourcePlanId,
        workflow_studio_workflow_id: request.workflowId,
        workflow_studio_assignment_id: request.assignmentId,
        workflow_studio_project_id: request.projectId,
        workflow_studio_node_id: request.nodeId,
        workflow_studio_attempt: String(request.attempt ?? 1),
        workflow_studio_iteration: String(request.iteration ?? 0)
      }
    }, { timeoutMs: Number(process.env.CODEX_EXECUTION_TIMEOUT_MS ?? process.env.CODEX_TIMEOUT_MS ?? 120000), modelSettings: request.modelSettings, requireDurableResults: true });
    if (typeof result.raw !== 'string') throw new Error('The paired runtime completed without a focused-task result.');
    return {
      ...parseFocusedTaskMessage(result.raw, request, typeof result.providerThreadId === 'string' ? result.providerThreadId : undefined),
      ...(result.runtimeJobId ? { runtimeJobId: result.runtimeJobId } : {}),
      ...(result.runtimeConnectionId ? { runtimeConnectionId: result.runtimeConnectionId } : {})
    };
  }
}

export function shouldUsePairedRuntime() {
  if (process.env.CODEX_RUNTIME_MODE === 'local') return false;
  if (process.env.CODEX_RUNTIME_MODE === 'paired') return true;
  return process.env.NODE_ENV === 'production';
}
