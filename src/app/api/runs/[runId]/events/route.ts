import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { eventStream } from '@/src/server/event-stream';
import { subscribeUserEvent } from '@/src/server/user-events';
import { RunRepository } from '@/src/storage/run-repository';
import { listRuntimeToolApprovalsForRun } from '@/src/storage/runtime-connection-repository';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ errors: ['Sign in to view this run.'] }, { status: 401 });
  const { runId } = await context.params;
  const repository = new RunRepository();
  if (!await repository.read(user.id, runId)) return NextResponse.json({ errors: ['Run was not found.'] }, { status: 404 });
  return eventStream(request, (notify) => subscribeUserEvent(`run:${user.id}:${runId}`, notify), async () => ({ run: await repository.read(user.id, runId), approvals: await listRuntimeToolApprovalsForRun(user.id, runId) }));
}
