import { randomUUID } from 'node:crypto';
import type { WorkflowPlan } from '@/src/domain/models';
import { getDatabase } from './async-database';
import type { ModelSettings, ReasoningEffort } from '@/src/domain/model-settings';

export const ORGANIZATION_ROLES = ['owner', 'administrator', 'reviewer', 'member'] as const;
export type OrganizationRole = typeof ORGANIZATION_ROLES[number];
export type AssignableOrganizationRole = Exclude<OrganizationRole, 'owner'>;

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  createdBy: string;
  createdAt: string;
  defaultModel?: string;
  defaultReasoningEffort?: ReasoningEffort;
}

type OrganizationRow = { id: string; name: string; slug: string; role: OrganizationRole; created_by: string; created_at: string; default_model: string | null; default_reasoning_effort: ReasoningEffort | null };
type MembershipRow = { user_id: string; name: string; email: string; role: OrganizationRole; joined_at: string; added_by: string };
type InvitationRow = { id: string; organization_id: string; organization_name: string; email: string; role: AssignableOrganizationRole; invited_by: string; status: string; created_at: string; expires_at: string };

function slugify(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'organization';
}

function publicOrganization(row: OrganizationRow): OrganizationSummary {
  return { id: row.id, name: row.name, slug: row.slug, role: row.role, createdBy: row.created_by, createdAt: row.created_at, ...(row.default_model ? { defaultModel: row.default_model } : {}), ...(row.default_reasoning_effort ? { defaultReasoningEffort: row.default_reasoning_effort } : {}) };
}

export function isOrganizationRole(value: unknown): value is OrganizationRole { return ORGANIZATION_ROLES.includes(value as OrganizationRole); }
export function isAssignableOrganizationRole(value: unknown): value is AssignableOrganizationRole { return value === 'administrator' || value === 'reviewer' || value === 'member'; }
export function canManageOrganization(role: OrganizationRole | null) { return role === 'owner' || role === 'administrator'; }

export class OrganizationRepository {
  async create(userId: string, name: string) {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const id = `org_${randomUUID()}`;
    const baseSlug = slugify(name);
    const slug = `${baseSlug}-${id.slice(-8)}`;
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO organizations (id, name, slug, created_by, created_at) VALUES (?, ?, ?, ?, ?)', [id, name.trim(), slug, userId, now]);
      await tx.run("INSERT INTO organization_memberships (organization_id, user_id, role, added_by, joined_at) VALUES (?, ?, 'owner', ?, ?)", [id, userId, userId, now]);
    });
    return { id, name: name.trim(), slug, role: 'owner' as const, createdBy: userId, createdAt: now };
  }

  async listForUser(userId: string) {
    const rows = await (await getDatabase()).all<OrganizationRow>(`SELECT o.id, o.name, o.slug, m.role, o.created_by, o.created_at, o.default_model, o.default_reasoning_effort FROM organizations o JOIN organization_memberships m ON m.organization_id = o.id WHERE m.user_id = ? ORDER BY o.name`, [userId]);
    return rows.map(publicOrganization);
  }

  async membershipRole(organizationId: string, userId: string): Promise<OrganizationRole | null> {
    return (await (await getDatabase()).get<{ role: OrganizationRole }>('SELECT role FROM organization_memberships WHERE organization_id = ? AND user_id = ?', [organizationId, userId]))?.role ?? null;
  }

  async modelSettings(organizationId: string, userId: string): Promise<ModelSettings | null> {
    const row = await (await getDatabase()).get<{ default_model: string | null; default_reasoning_effort: ReasoningEffort | null }>('SELECT o.default_model, o.default_reasoning_effort FROM organizations o JOIN organization_memberships m ON m.organization_id = o.id WHERE o.id = ? AND m.user_id = ?', [organizationId, userId]);
    return row ? { ...(row.default_model ? { model: row.default_model } : {}), ...(row.default_reasoning_effort ? { reasoningEffort: row.default_reasoning_effort } : {}) } : null;
  }

  async setModelSettings(organizationId: string, settings: ModelSettings) {
    return Boolean((await (await getDatabase()).run('UPDATE organizations SET default_model = ?, default_reasoning_effort = ? WHERE id = ?', [settings.model ?? null, settings.reasoningEffort ?? null, organizationId])).changes);
  }

  async listMembers(organizationId: string) {
    return await (await getDatabase()).all<MembershipRow>(`SELECT m.user_id, u.name, u.email, m.role, m.joined_at, m.added_by FROM organization_memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'administrator' THEN 1 WHEN 'reviewer' THEN 2 ELSE 3 END, LOWER(u.name)`, [organizationId]);
  }

  async invite(organizationId: string, email: string, role: AssignableOrganizationRole, invitedBy: string) {
    const db = await getDatabase();
    const normalizedEmail = email.trim().toLowerCase();
    const now = new Date();
    const existingUser = await db.get<{ id: string }>('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [normalizedEmail]);
    if (existingUser) {
      await db.run(`INSERT INTO organization_memberships (organization_id, user_id, role, added_by, joined_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(organization_id, user_id) DO UPDATE SET role = CASE WHEN organization_memberships.role = 'owner' THEN 'owner' ELSE excluded.role END, added_by = excluded.added_by`, [organizationId, existingUser.id, role, invitedBy, now.toISOString()]);
      return { accepted: true, userId: existingUser.id };
    }
    const id = `invite_${randomUUID()}`;
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.run(`INSERT INTO organization_invitations (id, organization_id, email, role, invited_by, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT(organization_id, LOWER(email)) WHERE status = 'pending' DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by, created_at = excluded.created_at, expires_at = excluded.expires_at`, [id, organizationId, normalizedEmail, role, invitedBy, now.toISOString(), expiresAt]);
    return { accepted: false, invitationId: id, expiresAt };
  }

  async invitationsForUser(email: string) {
    return await (await getDatabase()).all<InvitationRow>(`SELECT i.id, i.organization_id, o.name AS organization_name, i.email, i.role, i.invited_by, i.status, i.created_at, i.expires_at FROM organization_invitations i JOIN organizations o ON o.id = i.organization_id WHERE LOWER(i.email) = LOWER(?) AND i.status = 'pending' AND i.expires_at > ? ORDER BY i.created_at DESC`, [email, new Date().toISOString()]);
  }

  async acceptInvitation(invitationId: string, userId: string, email: string) {
    return await (await getDatabase()).transaction(async (tx) => {
      const invitation = await tx.get<{ organization_id: string; role: AssignableOrganizationRole; status: string; expires_at: string }>(`SELECT organization_id, role, status, expires_at FROM organization_invitations WHERE id = ? AND LOWER(email) = LOWER(?) FOR UPDATE`, [invitationId, email]);
      if (!invitation || invitation.status !== 'pending' || Date.parse(invitation.expires_at) <= Date.now()) return null;
      const now = new Date().toISOString();
      await tx.run('INSERT INTO organization_memberships (organization_id, user_id, role, added_by, joined_at) SELECT organization_id, ?, role, invited_by, ? FROM organization_invitations WHERE id = ? ON CONFLICT(organization_id, user_id) DO NOTHING', [userId, now, invitationId]);
      await tx.run("UPDATE organization_invitations SET status = 'accepted', accepted_by = ? WHERE id = ?", [userId, invitationId]);
      return invitation.organization_id;
    });
  }

  async removeMember(organizationId: string, userId: string) {
    const db = await getDatabase();
    return await db.transaction(async (tx) => {
      const membership = await tx.get<{ role: OrganizationRole }>('SELECT role FROM organization_memberships WHERE organization_id = ? AND user_id = ? FOR UPDATE', [organizationId, userId]);
      if (!membership) return 'missing' as const;
      if (membership.role === 'owner') return 'owner-protected' as const;
      await tx.run('DELETE FROM organization_memberships WHERE organization_id = ? AND user_id = ?', [organizationId, userId]);
      return 'removed' as const;
    });
  }

  async setMemberRole(organizationId: string, userId: string, role: AssignableOrganizationRole) {
    const db = await getDatabase();
    const current = await db.get<{ role: OrganizationRole }>('SELECT role FROM organization_memberships WHERE organization_id = ? AND user_id = ?', [organizationId, userId]);
    if (!current) return 'missing' as const;
    if (current.role === 'owner') return 'owner-protected' as const;
    await db.run('UPDATE organization_memberships SET role = ? WHERE organization_id = ? AND user_id = ?', [role, organizationId, userId]);
    return 'updated' as const;
  }

  async transferOwnership(organizationId: string, currentOwnerId: string, nextOwnerId: string) {
    return await (await getDatabase()).transaction(async (tx) => {
      const current = await tx.get<{ role: OrganizationRole }>('SELECT role FROM organization_memberships WHERE organization_id = ? AND user_id = ? FOR UPDATE', [organizationId, currentOwnerId]);
      const target = await tx.get<{ role: OrganizationRole }>('SELECT role FROM organization_memberships WHERE organization_id = ? AND user_id = ? FOR UPDATE', [organizationId, nextOwnerId]);
      if (current?.role !== 'owner') return 'forbidden' as const;
      if (!target) return 'missing' as const;
      await tx.run("UPDATE organization_memberships SET role = 'administrator' WHERE organization_id = ? AND user_id = ?", [organizationId, currentOwnerId]);
      await tx.run("UPDATE organization_memberships SET role = 'owner' WHERE organization_id = ? AND user_id = ?", [organizationId, nextOwnerId]);
      return 'transferred' as const;
    });
  }

  async shareWorkflow(organizationId: string, workflowId: string, userId: string) {
    const db = await getDatabase();
    const workflow = await db.get<{ status: string | null }>('SELECT status FROM workflows WHERE id = ? AND user_id = ?', [workflowId, userId]);
    if (!workflow) return 'missing' as const;
    if (workflow.status !== 'approved') return 'not-approved' as const;
    await db.run('INSERT INTO organization_workflows (organization_id, workflow_id, shared_by, shared_at) VALUES (?, ?, ?, ?) ON CONFLICT(organization_id, workflow_id) DO NOTHING', [organizationId, workflowId, userId, new Date().toISOString()]);
    return 'shared' as const;
  }

  async unshareWorkflow(organizationId: string, workflowId: string) {
    return (await (await getDatabase()).run('DELETE FROM organization_workflows WHERE organization_id = ? AND workflow_id = ?', [organizationId, workflowId])).changes > 0;
  }

  async listSharedWorkflows(organizationId: string): Promise<Array<{ workflow: WorkflowPlan; ownerUserId: string; sharedBy: string; sharedAt: string }>> {
    const rows = await (await getDatabase()).all<{ payload: string; user_id: string; shared_by: string; shared_at: string }>(`SELECT w.payload, w.user_id, ow.shared_by, ow.shared_at FROM organization_workflows ow JOIN workflows w ON w.id = ow.workflow_id WHERE ow.organization_id = ? ORDER BY ow.shared_at DESC`, [organizationId]);
    return rows.flatMap((row) => { try { return [{ workflow: JSON.parse(row.payload) as WorkflowPlan, ownerUserId: row.user_id, sharedBy: row.shared_by, sharedAt: row.shared_at }]; } catch { return []; } });
  }
}
