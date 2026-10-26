import { NextResponse } from 'next/server';
import type { RuntimeToolApprovalKind } from '@/src/domain/runtime-connection';
import { runtimeFromRequest } from '@/src/server/runtime-auth';
import { createRuntimeToolApproval, getRuntimeToolApprovalForAgent } from '@/src/storage/runtime-connection-repository';

export const runtime = 'nodejs';

const kinds: RuntimeToolApprovalKind[] = ['command', 'file-change', 'permissions', 'user-input', 'other'];

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const authenticated = await runtimeFromRequest(request);
  if (!authenticated) return NextResponse.json({ errors: ['Runtime authentication failed.'] }, { status: 401 });
  const { jobId } = await context.params;
  const approvalId = new URL(request.url).searchParams.get('approvalId')?.trim() ?? '';
  if (!approvalId) return NextResponse.json({ errors: ['Approval id is required.'] }, { status: 400 });
  const approval = await getRuntimeToolApprovalForAgent(authenticated.connection.id, jobId, approvalId);
  return approval ? NextResponse.json({ approval }) : NextResponse.json({ errors: ['Runtime approval was not found.'] }, { status: 404 });
}

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const authenticated = await runtimeFromRequest(request);
  if (!authenticated) return NextResponse.json({ errors: ['Runtime authentication failed.'] }, { status: 401 });
  const { jobId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const serverRequestId = typeof body?.serverRequestId === 'string' ? body.serverRequestId.trim() : '';
  const requestMethod = typeof body?.requestMethod === 'string' ? body.requestMethod.trim() : '';
  const kind = body?.kind as RuntimeToolApprovalKind;
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!serverRequestId || !requestMethod || !kinds.includes(kind) || !title) return NextResponse.json({ errors: ['Request id, method, approval kind, and title are required.'] }, { status: 400 });
  const details = body?.details && typeof body.details === 'object' && !Array.isArray(body.details) ? body.details as Record<string, unknown> : {};
  const approval = await createRuntimeToolApproval(authenticated.connection.id, jobId, {
    serverRequestId, requestMethod, kind, title,
    ...(typeof body?.reason === 'string' ? { reason: body.reason } : {}),
    ...(typeof body?.command === 'string' ? { command: body.command } : {}),
    ...(typeof body?.cwd === 'string' ? { cwd: body.cwd } : {}),
    details
  });
  return approval ? NextResponse.json({ approval }, { status: 201 }) : NextResponse.json({ errors: ['Runtime job is not active.'] }, { status: 409 });
}
