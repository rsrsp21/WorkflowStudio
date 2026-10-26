import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { RunRepository } from '@/src/storage/run-repository';
import { artifactResponseForUser } from '@/src/app/api/runs/[runId]/artifacts/[artifactId]/route';
import { ReviewerAssignmentRepository } from '@/src/storage/reviewer-assignment-repository';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const reviewer = await getRequestUser(request);
  if (!reviewer) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (reviewer.role !== 'reviewer' && reviewer.role !== 'administrator') return NextResponse.json({ error: 'Reviewer or administrator access is required.' }, { status: 403 });
  const url = new URL(request.url);
  const ownerUserId = url.searchParams.get('ownerUserId');
  const runId = url.searchParams.get('runId');
  const artifactId = url.searchParams.get('artifactId');
  if (!ownerUserId || !runId || !artifactId) return NextResponse.json({ error: 'Owner, run, and artifact are required.' }, { status: 400 });
  if (reviewer.role !== 'administrator' && !(await new ReviewerAssignmentRepository().canReview(reviewer.id, ownerUserId))) return NextResponse.json({ error: 'You are not assigned to review this account.' }, { status: 403 });
  const run = await new RunRepository().read(ownerUserId, runId);
  const approval = run?.approvalRecords.findLast((record) => !record.decision && !record.resumedAt);
  const artifact = run?.artifacts.find((candidate) => candidate.id === artifactId);
  const nodeRun = approval && run?.nodeRuns.find((candidate) => candidate.nodeId === approval.nodeId);
  if (!run || run.status !== 'paused' || !approval || !artifact || (!nodeRun?.artifactIds.includes(artifact.id) && artifact.nodeId !== approval.nodeId)) return NextResponse.json({ error: 'Reviewable artifact was not found.' }, { status: 404 });
  return artifactResponseForUser(ownerUserId, runId, artifactId);
}
