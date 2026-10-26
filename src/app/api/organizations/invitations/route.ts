import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { appendAuditEvent } from '@/src/storage/audit-repository';
import { OrganizationRepository } from '@/src/storage/organization-repository';

export const dynamic = 'force-dynamic';
const organizations = new OrganizationRepository();

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { invitationId?: unknown } | null;
  if (typeof body?.invitationId !== 'string' || !body.invitationId.trim()) return NextResponse.json({ errors: ['Invitation id is required.'] }, { status: 400 });
  const organizationId = await organizations.acceptInvitation(body.invitationId.trim(), user.id, user.email);
  if (!organizationId) return NextResponse.json({ error: 'Invitation was not found or has expired.' }, { status: 404 });
  await appendAuditEvent({ userId: user.id, actor: user, action: 'organization.invitation.accept', resourceType: 'organization', resourceId: organizationId, decision: 'approved', correlationId: body.invitationId.trim(), details: {} });
  return NextResponse.json({ organizationId });
}
