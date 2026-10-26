import { NextResponse } from 'next/server';
import { runtimeFromRequest } from '@/src/server/runtime-auth';
import { appendRuntimeJobEvent } from '@/src/storage/runtime-connection-repository';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const authenticated = await runtimeFromRequest(request);
  if (!authenticated) return NextResponse.json({ errors: ['Runtime authentication failed.'] }, { status: 401 });
  const { jobId } = await context.params;
  const body = await request.json().catch(() => ({})) as { leaseId?: unknown; sequence?: unknown; event?: unknown };
  const deliveryEvent = body.event && typeof body.event === 'object' && 'type' in body.event && ['runtime.delivery.blocked', 'runtime.result.verified'].includes(String(body.event.type));
  if (typeof body.leaseId !== 'string' || !(deliveryEvent && body.sequence === null) && (!Number.isInteger(body.sequence) || (body.sequence as number) < 0) || body.event === undefined) return NextResponse.json({ errors: ['A current lease id, non-negative event sequence, and event payload are required.'] }, { status: 400 });
  return await appendRuntimeJobEvent(authenticated.connection.id, jobId, body.leaseId, body.sequence as number | null, body.event)
    ? NextResponse.json({ accepted: true })
    : NextResponse.json({ errors: ['Runtime job lease is stale or invalid.'] }, { status: 409 });
}
