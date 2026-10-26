import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { appendRunEvent } from '@/src/domain/runtime';
import { RunRepository } from '@/src/storage/run-repository';
import { acquireRunExecutionLock, releaseRunExecutionLock } from '@/src/storage/run-execution-lock';

export const dynamic = 'force-dynamic';

const runs = new RunRepository();

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { runId } = await context.params;
  const body = await request.json().catch(() => null) as { nodeId?: unknown; values?: unknown } | null;
  if (!body || typeof body.nodeId !== 'string' || !body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
    return NextResponse.json({ errors: ['A node id and input values are required.'] }, { status: 400 });
  }
  const lock = await acquireRunExecutionLock(user.id, runId);
  if (!lock) return NextResponse.json({ errors: ['This workflow run is advancing. Try again shortly.'] }, { status: 409 });
  try {
    const run = await runs.read(user.id, runId);
    if (!run) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
    if (['completed', 'failed', 'cancelled'].includes(run.status)) return NextResponse.json({ errors: [`Run cannot accept input from ${run.status}.`] }, { status: 409 });
    const pending = run.pendingInput;
    if (!pending || pending.nodeId !== body.nodeId) return NextResponse.json({ errors: ['This node is not waiting for user input.'] }, { status: 409 });
    const values = body.values as Record<string, unknown>;
    if (Object.keys(values).length !== pending.keys.length || pending.keys.some((key) => typeof values[key] !== 'string' || !(values[key] as string).trim() || (values[key] as string).length > 10_000) || Object.keys(values).some((key) => !pending.keys.includes(key))) {
      return NextResponse.json({ errors: [`Provide a non-empty value for each requested input: ${pending.keys.join(', ')}.`] }, { status: 400 });
    }
    run.runtimeInputs = { ...(run.runtimeInputs ?? {}), ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, (value as string).trim()])) };
    run.pendingInput = undefined;
    run.updatedAt = new Date().toISOString();
    appendRunEvent(run, { type: 'node.input-provided', timestamp: run.updatedAt, nodeId: pending.nodeId, message: `User input provided for ${run.compiledWorkflow.nodes.find((node) => node.id === pending.nodeId)?.name ?? pending.nodeId}.`, data: { keys: pending.keys } });
    await runs.upsert(user.id, run);
    return NextResponse.json({ run });
  } finally {
    await releaseRunExecutionLock(user.id, runId, lock);
  }
}
