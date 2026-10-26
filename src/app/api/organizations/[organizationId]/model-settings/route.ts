import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { CODEX_MODELS, REASONING_EFFORTS, validModelSettings } from '@/src/domain/model-settings';
import { canManageOrganization, OrganizationRepository } from '@/src/storage/organization-repository';
import { appendAuditEvent } from '@/src/storage/audit-repository';
import type { ModelSettings } from '@/src/domain/model-settings';
const organizations = new OrganizationRepository();
export async function PATCH(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const user = await getRequestUser(request); if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { organizationId } = await context.params;
  const role = await organizations.membershipRole(organizationId, user.id);
  if (!canManageOrganization(role)) return NextResponse.json({ error: 'Organization administrator access is required.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['model', 'reasoningEffort'].includes(key))) return NextResponse.json({ errors: ['Organization defaults support model and reasoning effort. Configure verbosity on a workflow, node, or run; temperature and top-p are unavailable with Codex.'] }, { status: 400 });
  const settings = { ...(typeof body.model === 'string' && body.model ? { model: body.model } : {}), ...(typeof body.reasoningEffort === 'string' && body.reasoningEffort ? { reasoningEffort: body.reasoningEffort } : {}) } as ModelSettings;
  if (!validModelSettings(settings) || (settings.model && !CODEX_MODELS.includes(settings.model as typeof CODEX_MODELS[number])) || (settings.reasoningEffort && !REASONING_EFFORTS.includes(settings.reasoningEffort as typeof REASONING_EFFORTS[number]))) return NextResponse.json({ errors: ['Model settings are invalid.'] }, { status: 400 });
  await organizations.setModelSettings(organizationId, settings);
  await appendAuditEvent({ userId: user.id, actor: user, action: 'organization.model-settings.update', resourceType: 'organization', resourceId: organizationId, decision: 'approved', correlationId: organizationId, details: { ...settings } });
  return NextResponse.json({ settings });
}
