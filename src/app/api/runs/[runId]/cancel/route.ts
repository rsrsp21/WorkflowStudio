import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { SequentialRuntime } from '@/src/domain/runtime-engine';
import { RunRepository } from '@/src/storage/run-repository';
import { cancelRuntimeJobsForRun } from '@/src/storage/runtime-connection-repository';
import { appendAuditEvent } from '@/src/storage/audit-repository';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { runId } = await context.params;
  const repository = new RunRepository();
  const current = await repository.read(user.id, runId);
  if (!current) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { reason?: unknown };
  if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 1000)) return NextResponse.json({ errors: ['Cancellation reason must be a string no longer than 1,000 characters.'] }, { status: 400 });
  try {
    const actor = { id: user.id, name: user.name, role: user.role };
    const reason = typeof body.reason === 'string' ? body.reason : '';
    let cancelledRun;
    if (current.mastra) {
      const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
      const adapter = new LocalMastraAdapter({ store: repository });
      try { cancelledRun = await adapter.cancel(user.id, runId, { actor, reason }); }
      finally { await adapter.close(); }
    } else cancelledRun = (await new SequentialRuntime(repository).cancel(user.id, runId, actor, reason)).run;
    const cancelledJobs = await cancelRuntimeJobsForRun(user.id, runId);
    await appendAuditEvent({ userId: user.id, actor, action: 'run.cancel', resourceType: 'run', resourceId: runId, decision: 'cancelled', reason: reason || undefined, correlationId: runId, details: { cancelledJobs, engine: current.mastra ? 'mastra' : 'legacy' } });
    return NextResponse.json({ run: cancelledRun, transition: { kind: 'run-cancelled' }, cancelledJobs, engine: current.mastra ? 'mastra' : 'legacy' });
  } catch (error) {
    return NextResponse.json({ errors: [error instanceof Error ? error.message : 'Run could not be cancelled.'] }, { status: 409 });
  }
}
