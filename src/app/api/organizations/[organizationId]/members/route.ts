import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { appendAuditEvent } from '@/src/storage/audit-repository';
import { canManageOrganization, isAssignableOrganizationRole, OrganizationRepository } from '@/src/storage/organization-repository';

export const dynamic = 'force-dynamic';
const organizations = new OrganizationRepository();

async function manager(request: Request, organizationId: string) {
  const user = await getRequestUser(request);
  if (!user) return { response: NextResponse.json({ error: 'Authentication required.' }, { status: 401 }) };
  const role = await organizations.membershipRole(organizationId, user.id);
  if (!canManageOrganization(role)) return { response: NextResponse.json({ error: 'Organization administrator access is required.' }, { status: 403 }) };
  return { user, role };
}

export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  const access = await manager(request, organizationId);
  if (access.response) return access.response;
  return NextResponse.json({ members: await organizations.listMembers(organizationId) });
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  const access = await manager(request, organizationId);
  if (access.response || !access.user) return access.response;
  const body = await request.json().catch(() => null) as { email?: unknown; role?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !isAssignableOrganizationRole(body?.role)) return NextResponse.json({ errors: ['A valid email and organization role are required.'] }, { status: 400 });
  const invitation = await organizations.invite(organizationId, email, body.role, access.user.id);
  await appendAuditEvent({ userId: access.user.id, actor: access.user, action: 'organization.member.invite', resourceType: 'organization', resourceId: organizationId, decision: 'allowed', correlationId: organizationId, details: { email, role: body.role } });
  return NextResponse.json({ invitation }, { status: invitation.accepted ? 200 : 201 });
}

export async function PATCH(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  const access = await manager(request, organizationId);
  if (access.response || !access.user) return access.response;
  const body = await request.json().catch(() => null) as { userId?: unknown; role?: unknown } | null;
  if (typeof body?.userId !== 'string' || !body.userId.trim() || (body.role !== 'owner' && !isAssignableOrganizationRole(body.role))) return NextResponse.json({ errors: ['Member user id and valid role are required.'] }, { status: 400 });
  const userId = body.userId.trim();
  if (body.role === 'owner') {
    if (access.role !== 'owner') return NextResponse.json({ error: 'Only the current organization owner can transfer ownership.' }, { status: 403 });
    if (userId === access.user.id) return NextResponse.json({ errors: ['This user already owns the organization.'] }, { status: 409 });
    const result = await organizations.transferOwnership(organizationId, access.user.id, userId);
    if (result === 'missing') return NextResponse.json({ error: 'Organization member was not found.' }, { status: 404 });
    if (result === 'forbidden') return NextResponse.json({ error: 'Organization owner access is required.' }, { status: 403 });
    await appendAuditEvent({ userId: access.user.id, actor: access.user, action: 'organization.owner.transfer', resourceType: 'organization', resourceId: organizationId, decision: 'approved', correlationId: organizationId, details: { nextOwnerUserId: userId } });
    return NextResponse.json({ transferred: true });
  }
  const result = await organizations.setMemberRole(organizationId, userId, body.role);
  if (result === 'missing') return NextResponse.json({ error: 'Organization member was not found.' }, { status: 404 });
  if (result === 'owner-protected') return NextResponse.json({ errors: ['Use ownership transfer to change the owner.'] }, { status: 409 });
  await appendAuditEvent({ userId: access.user.id, actor: access.user, action: 'organization.member.role', resourceType: 'organization', resourceId: organizationId, decision: 'approved', correlationId: organizationId, details: { memberUserId: userId, role: body.role } });
  return NextResponse.json({ updated: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  const access = await manager(request, organizationId);
  if (access.response || !access.user) return access.response;
  const userId = new URL(request.url).searchParams.get('userId')?.trim();
  if (!userId) return NextResponse.json({ errors: ['Member user id is required.'] }, { status: 400 });
  if (userId === access.user.id && access.role === 'owner') return NextResponse.json({ errors: ['The organization owner cannot remove their own membership.'] }, { status: 409 });
  const result = await organizations.removeMember(organizationId, userId);
  if (result === 'missing') return NextResponse.json({ error: 'Organization member was not found.' }, { status: 404 });
  if (result === 'owner-protected') return NextResponse.json({ errors: ['Transfer organization ownership before removing the owner.'] }, { status: 409 });
  await appendAuditEvent({ userId: access.user.id, actor: access.user, action: 'organization.member.remove', resourceType: 'organization', resourceId: organizationId, decision: 'deleted', correlationId: organizationId, details: { removedUserId: userId } });
  return NextResponse.json({ removed: true });
}
