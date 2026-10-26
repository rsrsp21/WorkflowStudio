import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { eventStream } from '@/src/server/event-stream';
import { subscribeUserEvent } from '@/src/server/user-events';
import { listRuntimeConnections } from '@/src/storage/runtime-connection-repository';
import { shouldUsePairedRuntime } from '@/src/adapters/paired-runtime-adapter';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ errors: ['Sign in to view local runtimes.'] }, { status: 401 });
  return eventStream(request, (notify) => subscribeUserEvent(`runtime:${user.id}`, notify), async () => ({ connections: await listRuntimeConnections(user.id), mode: shouldUsePairedRuntime() ? 'paired' : 'local' }));
}
