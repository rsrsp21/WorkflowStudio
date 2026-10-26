import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { recheckRejectedValidation, retryFailedNode } from '@/src/domain/runtime-engine';
import { RunRepository } from '@/src/storage/run-repository';
import { acquireRunExecutionLock, releaseRunExecutionLock } from '@/src/storage/run-execution-lock';
import { appendAuditEvent } from '@/src/storage/audit-repository';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { runId } = await context.params;
  const body = await request.json().catch(() => null);
  const key = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!key || key.length > 128) return NextResponse.json({ error: 'A retry request key of at most 128 characters is required.' }, { status: 400 });
  if (body.mode !== undefined && body.mode !== 'revalidate') return NextResponse.json({ error: 'Retry mode is invalid.' }, { status: 400 });
  const repository = new RunRepository();
  if (!await repository.read(user.id, runId)) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
  const lock = await acquireRunExecutionLock(user.id, runId);
  if (!lock) return NextResponse.json({ error: 'This run is already advancing. Wait for the current operation to finish.' }, { status: 409 });
  try {
    const current = await repository.read(user.id, runId);
    if (!current) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
    if (current.processedActionKeys?.includes(key)) return NextResponse.json({ run: current, idempotentReplay: true });
    const transition = body.mode === 'revalidate' ? recheckRejectedValidation(current) : retryFailedNode(current);
    transition.run.processedActionKeys = [...(transition.run.processedActionKeys ?? []), key];
    await repository.upsert(user.id, transition.run);
    await appendAuditEvent({ userId: user.id, actor: user, action: body.mode === 'revalidate' ? 'run.recheck-validation' : 'run.retry-failed-step', resourceType: 'run', resourceId: runId,
      decision: 'allowed', correlationId: `${runId}:${key}`, details: { nodeId: transition.nodeRun?.nodeId, previousAttempt: transition.nodeRun?.attempt } });
    return NextResponse.json({ run: transition.run, transition: { kind: 'retried', nodeRun: transition.nodeRun } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The failed step could not be retried.' }, { status: 409 });
  } finally { await releaseRunExecutionLock(user.id, runId, lock); }
}
