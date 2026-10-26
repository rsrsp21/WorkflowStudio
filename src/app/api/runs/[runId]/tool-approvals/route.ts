import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import type { RuntimeToolApprovalDecision } from '@/src/domain/runtime-connection';
import { RunRepository } from '@/src/storage/run-repository';
import { decideRuntimeToolApproval, listRuntimeToolApprovalsForRun } from '@/src/storage/runtime-connection-repository';
import { appendAuditEvent } from '@/src/storage/audit-repository';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { runId } = await context.params;
  if (!await new RunRepository().read(user.id, runId)) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
  return NextResponse.json({ approvals: await listRuntimeToolApprovalsForRun(user.id, runId) });
}

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { runId } = await context.params;
  if (!await new RunRepository().read(user.id, runId)) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const approvalId = typeof body?.approvalId === 'string' ? body.approvalId.trim() : '';
  const decision = body?.decision as RuntimeToolApprovalDecision;
  if (!approvalId || !['accept', 'decline', 'cancel'].includes(decision)) return NextResponse.json({ errors: ['Approval id and a valid decision are required.'] }, { status: 400 });
  const response = body?.response && typeof body.response === 'object' && !Array.isArray(body.response) ? body.response as Record<string, unknown> : undefined;
  const approval = await decideRuntimeToolApproval(user.id, runId, approvalId, decision, { id: user.id, name: user.name, role: user.role }, response);
  if (approval) await appendAuditEvent({ userId: user.id, actor: { id: user.id, name: user.name, role: user.role }, action: 'codex-action.decide', resourceType: 'runtime-tool-approval', resourceId: approvalId, decision: decision === 'accept' ? 'approved' : decision === 'decline' ? 'rejected' : 'cancelled', correlationId: `${runId}:${approvalId}`, details: { runId, kind: approval.kind, requestMethod: approval.requestMethod } });
  return approval ? NextResponse.json({ approval }) : NextResponse.json({ errors: ['Approval is unavailable, expired, or already decided.'] }, { status: 409 });
}
