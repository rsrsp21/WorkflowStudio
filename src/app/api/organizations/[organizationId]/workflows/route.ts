import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { appendAuditEvent } from '@/src/storage/audit-repository';
import { canManageOrganization, OrganizationRepository } from '@/src/storage/organization-repository';

export const dynamic = 'force-dynamic';
const organizations = new OrganizationRepository();

export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { organizationId } = await context.params;
  if (!await organizations.membershipRole(organizationId, user.id)) return NextResponse.json({ error: 'Organization was not found.' }, { status: 404 });
  return NextResponse.json({ workflows: await organizations.listSharedWorkflows(organizationId) });
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { organizationId } = await context.params;
  if (!await organizations.membershipRole(organizationId, user.id)) return NextResponse.json({ error: 'Organization was not found.' }, { status: 404 });
  const body = await request.json().catch(() => null) as { workflowId?: unknown } | null;
  if (typeof body?.workflowId !== 'string' || !body.workflowId.trim()) return NextResponse.json({ errors: ['Workflow id is required.'] }, { status: 400 });
  const result = await organizations.shareWorkflow(organizationId, body.workflowId.trim(), user.id);
  if (result === 'missing') return NextResponse.json({ error: 'Workflow was not found.' }, { status: 404 });
  if (result === 'not-approved') return NextResponse.json({ errors: ['Only approved workflows can be shared with an organization.'] }, { status: 409 });
  await appendAuditEvent({ userId: user.id, actor: user, action: 'organization.workflow.share', resourceType: 'workflow', resourceId: body.workflowId.trim(), decision: 'approved', correlationId: organizationId, details: { organizationId } });
  return NextResponse.json({ shared: true }, { status: 201 });
}

export async function DELETE(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { organizationId } = await context.params;
  const role = await organizations.membershipRole(organizationId, user.id);
  if (!canManageOrganization(role)) return NextResponse.json({ error: 'Organization administrator access is required.' }, { status: 403 });
  const workflowId = new URL(request.url).searchParams.get('workflowId')?.trim();
  if (!workflowId) return NextResponse.json({ errors: ['Workflow id is required.'] }, { status: 400 });
  if (!await organizations.unshareWorkflow(organizationId, workflowId)) return NextResponse.json({ error: 'Shared workflow was not found.' }, { status: 404 });
  await appendAuditEvent({ userId: user.id, actor: user, action: 'organization.workflow.unshare', resourceType: 'workflow', resourceId: workflowId, decision: 'deleted', correlationId: organizationId, details: { organizationId } });
  return NextResponse.json({ removed: true });
}
