import { studioPaths } from '@/scripts/studio-home.cjs';
import { realpath, stat } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { createCodexPlanningAdapter } from '@/src/adapters/codex-app-server-adapter';
import { CodexNodeExecutor } from '@/src/adapters/codex-node-executor';
import { getRequestUser } from '@/src/auth/auth';
import { nextRunnableNode, resolveNodeInput, SequentialRuntime } from '@/src/domain/runtime-engine';
import { appendRunEvent } from '@/src/domain/runtime';
import { executionProgressToken, NO_EXECUTION_PROGRESS } from '@/src/domain/execution-progress';
import { evaluateLifecycleTransition } from '@/src/domain/lifecycle-policy';
import { isWithinWorkspaceRoot } from '@/src/domain/workspace-boundary';
import { validateProjectWorkflow } from '@/src/domain/workspace';
import { WorkflowRepository } from '@/src/storage/workflow-repository';
import { RunRepository } from '@/src/storage/run-repository';
import { createWorkspaceStores } from '@/src/storage/workspace-stores';
import { requestFingerprint } from '@/src/server/request-fingerprint';
import { shouldUsePairedRuntime } from '@/src/adapters/paired-runtime-adapter';
import { getOnlineRuntimeConnection } from '@/src/storage/runtime-connection-repository';
import { consumeRateLimit, rateLimitHeaders, rateLimitKey } from '@/src/server/rate-limit';
import { acquireRunExecutionLock, releaseRunExecutionLock, renewRunExecutionLock } from '@/src/storage/run-execution-lock';

export const dynamic = 'force-dynamic';
const dataDirectory = process.env.WORKFLOW_STUDIO_DATA_DIR ?? studioPaths().data;
const runs = new RunRepository();
const workflows = new WorkflowRepository();
const MAX_NODE_EXECUTION_MS = 15 * 60 * 1000;

async function requestBody(request: Request) {
  const raw = await request.text();
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const limit = await consumeRateLimit(rateLimitKey(request, 'run-execute', user.id), 120, 15 * 60);
  if (!limit.allowed) return NextResponse.json({ errors: ['Too many execution requests. Try again later.'] }, { status: 429, headers: rateLimitHeaders(limit) });
  const stores = createWorkspaceStores(dataDirectory, user.id);
  const { runId } = await context.params;
  const run = await runs.read(user.id, runId);
  if (!run) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
  const body = await requestBody(request);
  if (!body) return NextResponse.json({ errors: ['Execution request body must be a JSON object.'] }, { status: 400 });
  const actionKey = body.idempotencyKey;
  if (actionKey !== undefined && (typeof actionKey !== 'string' || !actionKey.trim() || actionKey.length > 128)) return NextResponse.json({ errors: ['Execution idempotency key is invalid.'] }, { status: 400 });
  const idempotencyKey = typeof actionKey === 'string' ? actionKey.trim() : undefined;
  if (idempotencyKey && (run.processedActionKeys ?? []).includes(idempotencyKey)) return NextResponse.json({ run, idempotentReplay: true });

  try {
    const [assignments, projects, definitions, skills] = await Promise.all([stores.projectWorkflows.readAll(), stores.projects.readAll(), stores.workflows.readAll(), stores.skills.readAll()]);
    const assignment = assignments.find((candidate) => candidate.id === run.assignmentId);
    const definition = (await workflows.readAll(user.id)).find((candidate) => candidate.id === run.workflowId);
    if (!definition || !assignment) return NextResponse.json({ errors: ['The approved workflow definition or project assignment is no longer available.'] }, { status: 409 });
    const assignmentErrors = validateProjectWorkflow(assignment, { projects, workflows: definitions, skills });
    if (assignmentErrors.length) return NextResponse.json({ errors: assignmentErrors }, { status: 409 });
    if (run.workflowVersion !== (definition.version ?? 1) || run.workflowVersion !== assignment.workflowVersion) return NextResponse.json({ errors: ['Run was compiled from an older reusable workflow version. Compile a new run before continuing.'] }, { status: 409 });
    if (run.assignmentConfigurationVersion !== (assignment.configurationVersion ?? 1)) return NextResponse.json({ errors: ['Run was compiled from an older assignment configuration. Compile a new run before continuing.'] }, { status: 409 });
    const compiledScope = requestFingerprint({ inputs: run.compiledWorkflow.assignmentInputs, sandboxMode: run.compiledWorkflow.harness.sandboxMode, allowedTools: run.compiledWorkflow.harness.allowedTools, destructiveApproval: run.compiledWorkflow.harness.requireApprovalForDestructiveActions });
    const currentScope = requestFingerprint({ inputs: assignment.inputOverrides, sandboxMode: assignment.permissions.sandboxMode, allowedTools: assignment.permissions.allowedTools, destructiveApproval: assignment.permissions.requireApprovalForDestructiveActions });
    if (compiledScope !== currentScope || !isWithinWorkspaceRoot(run.rootPath, assignment.rootPath) || !isWithinWorkspaceRoot(assignment.rootPath, run.rootPath)) return NextResponse.json({ errors: ['Assignment inputs or permissions changed after this run was compiled. Compile a new run before continuing.'] }, { status: 409 });
    if (!shouldUsePairedRuntime()) {
      const rootInfo = await stat(assignment.rootPath);
      if (!rootInfo.isDirectory()) return NextResponse.json({ errors: ['The approved project root is no longer a directory.'] }, { status: 409 });
      const [resolvedRoot, resolvedAllowedRoot] = await Promise.all([realpath(assignment.rootPath), realpath(assignment.permissions.allowedWorkspacePaths[0])]);
      if (!isWithinWorkspaceRoot(resolvedRoot, resolvedAllowedRoot) || !isWithinWorkspaceRoot(resolvedAllowedRoot, resolvedRoot)) return NextResponse.json({ errors: ['Workspace permissions drifted outside the approved project root. Approve the assignment again.'] }, { status: 409 });
    }
    const lifecycle = evaluateLifecycleTransition({ action: 'execute', workflow: definition, graph: assignment.graphOverride ?? definition, assignment, skills });
    if (!lifecycle.allowed) return NextResponse.json({ errors: lifecycle.errors }, { status: 409 });
    const executionLock = await acquireRunExecutionLock(user.id, runId);
    if (!executionLock) return NextResponse.json({ errors: ['This workflow run is already advancing on another server instance.'] }, { status: 409 });
    const lockRenewal = setInterval(() => { void renewRunExecutionLock(user.id, runId, executionLock).catch(() => undefined); }, 60_000);
    lockRenewal.unref?.();
    try {
    const runs = new RunRepository({ userId: user.id, runId, token: executionLock });
    if (idempotencyKey) {
      const latest = await runs.read(user.id, runId);
      if (!latest) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
      if ((latest.processedActionKeys ?? []).includes(idempotencyKey)) return NextResponse.json({ run: latest, idempotentReplay: true });
      await runs.upsert(user.id, { ...latest, processedActionKeys: [...(latest.processedActionKeys ?? []), idempotencyKey], updatedAt: new Date().toISOString() });
    }
    const executionRun = await runs.read(user.id, runId);
    if (!executionRun) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
    if (!executionRun.executionRequested) {
      executionRun.executionRequested = true;
      await runs.upsert(user.id, executionRun);
    }
    if (executionRun.pendingInput) return NextResponse.json({ run: executionRun, transition: { kind: 'waiting-input' } });
    const nextNode = nextRunnableNode(executionRun);
    if (nextNode) {
      const resolved = resolveNodeInput(executionRun, nextNode.id);
      const missing = nextNode.inputKeys.filter((key) => !Object.hasOwn(resolved, key) || typeof resolved[key] === 'string' && !(resolved[key] as string).trim());
      if (missing.length) {
        executionRun.pendingInput = { nodeId: nextNode.id, keys: missing };
        executionRun.updatedAt = new Date().toISOString();
        appendRunEvent(executionRun, { type: 'node.input-requested', timestamp: executionRun.updatedAt, nodeId: nextNode.id, message: `${nextNode.name} needs user input before execution.`, data: { keys: missing } });
        await runs.upsert(user.id, executionRun);
        return NextResponse.json({ run: executionRun, transition: { kind: 'waiting-input' } });
      }
    }
    const codexExecutor = new CodexNodeExecutor(createCodexPlanningAdapter({ userId: user.id }), skills);
    if (nextNode && nextNode.type !== 'approval' && shouldUsePairedRuntime() && !await getOnlineRuntimeConnection(user.id)) {
      if (!executionRun.runtimeWaiting) {
        executionRun.runtimeWaiting = { nodeId: nextNode.id, since: new Date().toISOString(), message: 'Waiting for the paired local runtime to reconnect.' };
        appendRunEvent(executionRun, { type: 'node.runtime-waiting', timestamp: executionRun.runtimeWaiting.since, nodeId: nextNode.id, message: executionRun.runtimeWaiting.message });
        await runs.upsert(user.id, executionRun);
      }
      return NextResponse.json({ run: executionRun, transition: { kind: 'waiting-runtime' } });
    }
    const executor = {
      execute: async (task: Parameters<typeof codexExecutor.execute>[0]) => {
        await runs.assertExecutionOwnership();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            codexExecutor.execute(task),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Node execution exceeded ${MAX_NODE_EXECUTION_MS} ms.`)), MAX_NODE_EXECUTION_MS + 30_000); })
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
    };
    if (executionRun.mastra) {
      const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
      const adapter = new LocalMastraAdapter({ executor, store: runs });
      try {
        await adapter.start(executionRun.mastra.workflowId, runId, { userId: user.id, run: executionRun });
      } finally {
        await adapter.close();
      }
      const updated = await runs.read(user.id, runId);
      if (!updated) throw new Error('Mastra execution completed without a durable run state.');
      if (updated.status === 'running' && !updated.runtimeWaiting && !updated.pendingInput
        && !updated.nodeRuns.some((node) => node.status === 'running' || node.status === 'waiting-approval')
        && executionProgressToken(updated) === executionProgressToken(executionRun)) {
        return NextResponse.json({ run: updated, errors: [NO_EXECUTION_PROGRESS], code: 'NO_EXECUTION_PROGRESS' }, { status: 409 });
      }
      const nodeRun = [...updated.nodeRuns].reverse().find((candidate) => candidate.status !== 'pending' && candidate.status !== 'skipped');
      return NextResponse.json({ run: updated, transition: { kind: updated.runtimeWaiting ? 'waiting-runtime' : updated.status === 'paused' ? 'waiting-approval' : updated.status === 'completed' ? 'run-completed' : updated.status === 'failed' ? 'run-failed' : 'completed', nodeRun }, engine: 'mastra' });
    }
    const transition = await new SequentialRuntime(runs).executeNext(user.id, runId, executor);
    return NextResponse.json({ run: transition.run, transition: { kind: transition.kind, nodeRun: transition.nodeRun }, engine: 'legacy' });
    } finally {
      clearInterval(lockRenewal);
      await releaseRunExecutionLock(user.id, runId, executionLock);
    }
  } catch (error) {
    if (idempotencyKey) {
      const latest = await runs.read(user.id, runId);
      if (latest?.processedActionKeys?.includes(idempotencyKey)) await runs.upsert(user.id, { ...latest, processedActionKeys: latest.processedActionKeys.filter((key) => key !== idempotencyKey), updatedAt: new Date().toISOString() });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Run could not advance.' }, { status: 409 });
  }
}
