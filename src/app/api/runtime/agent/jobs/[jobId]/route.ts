import { NextResponse } from 'next/server';
import { runtimeFromRequest } from '@/src/server/runtime-auth';
import { getRuntimeJob, renewRuntimeJobLease } from '@/src/storage/runtime-connection-repository';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const authenticated = await runtimeFromRequest(request);
  if (!authenticated) return NextResponse.json({ errors: ['Runtime authentication failed.'] }, { status: 401 });
  const { jobId } = await context.params;
  const leaseId = new URL(request.url).searchParams.get('leaseId');
  if (leaseId && !await renewRuntimeJobLease(authenticated.connection.id, jobId, leaseId)) return NextResponse.json({ errors: ['Runtime job lease is stale or invalid.'] }, { status: 409 });
  const job = await getRuntimeJob(authenticated.userId, jobId);
  if (!job || job.connectionId !== authenticated.connection.id) return NextResponse.json({ errors: ['Runtime job was not found.'] }, { status: 404 });
  return NextResponse.json({ job: { id: job.id, status: job.status, updatedAt: job.updatedAt } });
}
