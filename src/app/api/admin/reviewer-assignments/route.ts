import { NextResponse } from 'next/server';
import { getRequestUser, getUserById, listUsers } from '@/src/auth/auth';
import { appendAuditEvent } from '@/src/storage/audit-repository';
import { ReviewerAssignmentRepository } from '@/src/storage/reviewer-assignment-repository';

async function administrator(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return { response: NextResponse.json({ error: 'Authentication required.' }, { status: 401 }) };
  if (user.role !== 'administrator') return { response: NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 }) };
  return { user };
}

export async function GET(request: Request) {
  const auth = await administrator(request);
  if (auth.response) return auth.response;
  const [assignments, users] = await Promise.all([new ReviewerAssignmentRepository().list(), listUsers(2000, 0)]);
  return NextResponse.json({ assignments, reviewers: users.filter((user) => user.role === 'reviewer' || user.role === 'administrator') }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  const auth = await administrator(request);
  if (auth.response || !auth.user) return auth.response;
  const body = await request.json().catch(() => ({})) as { ownerUserId?: unknown; reviewerUserId?: unknown };
  if (typeof body.ownerUserId !== 'string' || typeof body.reviewerUserId !== 'string') return NextResponse.json({ errors: ['Owner and reviewer are required.'] }, { status: 400 });
  const [owner, reviewer] = await Promise.all([getUserById(body.ownerUserId), getUserById(body.reviewerUserId)]);
  if (!owner || !reviewer) return NextResponse.json({ error: 'Owner or reviewer was not found.' }, { status: 404 });
  if (reviewer.role !== 'reviewer' && reviewer.role !== 'administrator') return NextResponse.json({ errors: ['The delegated account must have reviewer or administrator role.'] }, { status: 400 });
  try {
    const assignment = await new ReviewerAssignmentRepository().assign(owner.id, reviewer.id, auth.user.id);
    await appendAuditEvent({ userId: owner.id, actor: { id: auth.user.id, name: auth.user.name, role: auth.user.role }, action: 'reviewer-assignment.create', resourceType: 'reviewer-assignment', resourceId: `${owner.id}:${reviewer.id}`, decision: 'approved', correlationId: `reviewer-assignment:${owner.id}:${reviewer.id}`, details: { ownerUserId: owner.id, reviewerUserId: reviewer.id } });
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Reviewer assignment failed.' }, { status: 409 }); }
}

export async function DELETE(request: Request) {
  const auth = await administrator(request);
  if (auth.response || !auth.user) return auth.response;
  const body = await request.json().catch(() => ({})) as { ownerUserId?: unknown; reviewerUserId?: unknown };
  if (typeof body.ownerUserId !== 'string' || typeof body.reviewerUserId !== 'string') return NextResponse.json({ errors: ['Owner and reviewer are required.'] }, { status: 400 });
  const removed = await new ReviewerAssignmentRepository().remove(body.ownerUserId, body.reviewerUserId);
  if (!removed) return NextResponse.json({ error: 'Reviewer assignment was not found.' }, { status: 404 });
  await appendAuditEvent({ userId: body.ownerUserId, actor: { id: auth.user.id, name: auth.user.name, role: auth.user.role }, action: 'reviewer-assignment.delete', resourceType: 'reviewer-assignment', resourceId: `${body.ownerUserId}:${body.reviewerUserId}`, decision: 'approved', correlationId: `reviewer-assignment:${body.ownerUserId}:${body.reviewerUserId}`, details: { ownerUserId: body.ownerUserId, reviewerUserId: body.reviewerUserId } });
  return NextResponse.json({ removed: true });
}
