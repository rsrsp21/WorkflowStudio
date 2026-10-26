import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import type { RuntimeApprovalDecision } from '@/src/domain/runtime';
import { SequentialRuntime } from '@/src/domain/runtime-engine';
import { CodexNodeExecutor } from '@/src/adapters/codex-node-executor';
import { createCodexPlanningAdapter } from '@/src/adapters/codex-app-server-adapter';
import { RunRepository } from '@/src/storage/run-repository';
import { appendAuditEvent } from '@/src/storage/audit-repository';
import { createWorkspaceStores } from '@/src/storage/workspace-stores';
import { studioPaths } from '@/scripts/studio-home.cjs';
import { canPerformGovernedAction } from '@/src/domain/authorization';
import { acquireRunExecutionLock, releaseRunExecutionLock, renewRunExecutionLock } from '@/src/storage/run-execution-lock';
import { requestFingerprint } from '@/src/server/request-fingerprint';

export const dynamic = 'force-dynamic';

const decisions: RuntimeApprovalDecision[] = ['approved', 'rejected', 'revision-requested'];

async function requestBody(request: Request) {
  const raw = await request.text();
  if (!raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function handleApproval(request: Request, context: { params: Promise<{ runId: string }> }, executionToken: string) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!canPerformGovernedAction(user, 'decide-workflow-gate')) return NextResponse.json({ errors: ['Reviewer or administrator role is required to decide a workflow gate.'] }, { status: 403 });
  const { runId } = await context.params;
  const repository = new RunRepository({ userId: user.id, runId, token: executionToken });
  const current = await repository.read(user.id, runId);
  if (!current) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
  const body = await requestBody(request);
  if (!body) return NextResponse.json({ errors: ['Approval request body must be a JSON object.'] }, { status: 400 });
  const nodeId = typeof body.nodeId === 'string' ? body.nodeId.trim() : '';
  const action = body.action;
  const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';
  const feedback = typeof body.feedback === 'string' ? body.feedback : '';
  const actionKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!nodeId) return NextResponse.json({ errors: ['Approval node id is required.'] }, { status: 400 });
  if (action !== 'resume' && action !== 'choose' && !decisions.includes(action as RuntimeApprovalDecision)) return NextResponse.json({ errors: ['Approval action must select a configured outcome, approve, reject, request revision, or resume.'] }, { status: 400 });
  if (action === 'choose' && !keyword) return NextResponse.json({ errors: ['A configured approval keyword is required.'] }, { status: 400 });
  const approvalNode = current.compiledWorkflow.nodes.find((node) => node.id === nodeId);
  const existingDecision = current.approvalRecords.some((record) => record.nodeId === nodeId && Boolean(record.decision));
  if (approvalNode?.approvalOptions?.length && action !== 'choose' && (action !== 'resume' || !existingDecision)) {
    return NextResponse.json({ errors: ['This gate requires one of its configured outcomes. Choose one of the listed options.'] }, { status: 409 });
  }
  if (!actionKey || actionKey.length > 128) return NextResponse.json({ errors: ['Approval idempotency key is required and must not exceed 128 characters.'] }, { status: 400 });
  const actionFingerprint = requestFingerprint({ nodeId, action, keyword, feedback, approvalId: body.approvalId });
  if (current.actionReceipts?.[actionKey] && current.actionReceipts[actionKey] !== actionFingerprint) return NextResponse.json({ errors: ['This approval request key was already used for a different decision.'] }, { status: 409 });
  if ((current.processedActionKeys ?? []).includes(actionKey)) return NextResponse.json({ run: current, idempotentReplay: true });
  const currentGate = current.approvalRecords.findLast((record) => record.nodeId === nodeId && !record.resumedAt);
  if (body.approvalId !== undefined && body.approvalId !== currentGate?.id) return NextResponse.json({ errors: ['This approval belongs to an earlier gate or revision. Reload the current decision.'] }, { status: 409 });

  try {
    const actor = { id: user.id, name: user.name, role: user.role };
    let updated;
    if (current.mastra) {
      if (action === 'resume') throw new Error('This Mastra gate resumes when its decision is submitted.');
      const stores = createWorkspaceStores(process.env.WORKFLOW_STUDIO_DATA_DIR ?? studioPaths().data, user.id);
      const skills = await stores.skills.readAll();
      const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
      const codexExecutor = new CodexNodeExecutor(createCodexPlanningAdapter({ userId: user.id }), skills);
      const adapter = new LocalMastraAdapter({ executor: { execute: async (task) => {
        await repository.assertExecutionOwnership();
        return codexExecutor.execute(task);
      } }, store: repository });
      try {
        await adapter.resume(user.id, runId, {
          actionKey, actionFingerprint,
          nodeId,
          approvalId: current.approvalRecords.findLast((record) => record.nodeId === nodeId && !record.resumedAt)?.id ?? '',
          ...(action === 'choose' ? { keyword } : { decision: action as RuntimeApprovalDecision }),
          feedback,
          actor
        });
      } finally {
        await adapter.close();
      }
      updated = await repository.read(user.id, runId);
      if (!updated) throw new Error('Mastra approval completed without a durable run state.');
    } else {
      const runtime = new SequentialRuntime(repository);
      if (action === 'resume') updated = await runtime.resumeApproval(user.id, runId, nodeId, actor);
      else if (action === 'choose') {
        await runtime.decideApprovalByKeyword(user.id, runId, nodeId, keyword, actor, feedback);
        updated = await runtime.resumeApproval(user.id, runId, nodeId, actor);
      } else updated = await runtime.decideApproval(user.id, runId, nodeId, action as RuntimeApprovalDecision, actor, feedback);
    }
    updated.processedActionKeys = [...new Set([...(updated.processedActionKeys ?? []), actionKey])];
    updated.actionReceipts = { ...updated.actionReceipts, [actionKey]: actionFingerprint };
    updated.updatedAt = new Date().toISOString();
    await repository.upsert(user.id, updated);
    await appendAuditEvent({ userId: user.id, actor, action: `workflow-gate.${String(action)}`, resourceType: 'run', resourceId: runId, decision: action === 'rejected' ? 'rejected' : 'approved', reason: feedback || undefined, correlationId: `${runId}:${actionKey}`, details: { nodeId, keyword: keyword || undefined } });
    return NextResponse.json({ run: updated, action });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Approval action could not be completed.' }, { status: 409 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { runId } = await context.params;
  const lock = await acquireRunExecutionLock(user.id, runId);
  if (!lock) return NextResponse.json({ errors: ['The run is advancing. Wait for the current operation to finish.'] }, { status: 409 });
  const renewal = setInterval(() => { void renewRunExecutionLock(user.id, runId, lock).catch(() => undefined); }, 60_000);
  renewal.unref?.();
  try { return await handleApproval(request, context, lock); }
  finally { clearInterval(renewal); await releaseRunExecutionLock(user.id, runId, lock); }
}
