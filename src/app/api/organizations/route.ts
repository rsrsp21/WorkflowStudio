import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { appendAuditEvent } from '@/src/storage/audit-repository';
import { OrganizationRepository } from '@/src/storage/organization-repository';

export const dynamic = 'force-dynamic';
const organizations = new OrganizationRepository();

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const [memberships, invitations] = await Promise.all([organizations.listForUser(user.id), organizations.invitationsForUser(user.email)]);
  return NextResponse.json({ organizations: memberships, invitations });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 100) return NextResponse.json({ errors: ['Organization name must contain between 2 and 100 characters.'] }, { status: 400 });
  const organization = await organizations.create(user.id, name);
  await appendAuditEvent({ userId: user.id, actor: user, action: 'organization.create', resourceType: 'organization', resourceId: organization.id, decision: 'allowed', correlationId: organization.id, details: { name: organization.name } });
  return NextResponse.json({ organization }, { status: 201 });
}
