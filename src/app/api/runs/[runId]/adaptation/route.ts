import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { SequentialRuntime } from '@/src/domain/runtime-engine';
import { RunRepository } from '@/src/storage/run-repository';
import { promoteApprovedAdaptation } from '@/src/storage/adaptation-repository';
import { canPerformGovernedAction } from '@/src/domain/authorization';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { runId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const candidateId = typeof body?.candidateId === 'string' ? body.candidateId.trim() : '';
  const decision = body?.decision;
  if (decision === 'approved' && !canPerformGovernedAction(user, 'promote-adaptation')) return NextResponse.json({ errors: ['Reviewer or administrator role is required to promote an improvement.'] }, { status: 403 });
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if (!candidateId || !['approved', 'rejected'].includes(decision as string) || note.length > 2_000) return NextResponse.json({ errors: ['Candidate, valid decision, and an optional note up to 2,000 characters are required.'] }, { status: 400 });
  const repository = new RunRepository();
  if (!await repository.read(user.id, runId)) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
  try {
    const run = await new SequentialRuntime(repository).decideAdaptation(user.id, runId, candidateId, decision as 'approved' | 'rejected', { id: user.id, name: user.name, role: user.role }, note);
    const candidate = run.adaptationCandidates.find((item) => item.id === candidateId);
    const promoted = candidate ? await promoteApprovedAdaptation(user, run, candidate) : null;
    return NextResponse.json({ run, promoted });
  } catch (error) { return NextResponse.json({ errors: [error instanceof Error ? error.message : 'Improvement candidate could not be decided.'] }, { status: 409 }); }
}
