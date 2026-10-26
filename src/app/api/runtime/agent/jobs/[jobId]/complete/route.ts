import { NextResponse } from 'next/server';
import { runtimeFromRequest } from '@/src/server/runtime-auth';
import { completeRuntimeJob } from '@/src/storage/runtime-connection-repository';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const authenticated = await runtimeFromRequest(request);
  if (!authenticated) return NextResponse.json({ errors: ['Runtime authentication failed.'] }, { status: 401 });
  const { jobId } = await context.params;
  const body = await request.json().catch(() => ({})) as { leaseId?: unknown; result?: unknown; error?: unknown };
  if (typeof body.leaseId !== 'string' || (!('result' in body) && typeof body.error !== 'string')) return NextResponse.json({ errors: ['Lease id and either a result or error are required.'] }, { status: 400 });
  const completed = await completeRuntimeJob(authenticated.connection.id, jobId, body.leaseId, {
    ...('result' in body ? { result: body.result } : {}),
    ...(typeof body.error === 'string' ? { error: body.error.slice(0, 4000) } : {})
  });
  return completed ? NextResponse.json({ completed: true }) : NextResponse.json({ errors: ['Runtime job lease is stale or invalid.'] }, { status: 409 });
}
