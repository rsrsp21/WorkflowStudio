import { NextResponse } from 'next/server';
import { runtimeFromRequest } from '@/src/server/runtime-auth';
import { heartbeatRuntime, leaseNextRuntimeJob } from '@/src/storage/runtime-connection-repository';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const authenticated = await runtimeFromRequest(request);
  if (!authenticated) return NextResponse.json({ errors: ['Runtime authentication failed.'] }, { status: 401 });
  await heartbeatRuntime(authenticated.connection.id, {});
  return NextResponse.json({ job: await leaseNextRuntimeJob(authenticated.connection.id) });
}
