'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkflowPlan } from '@/src/domain/models';
import type { OrganizationRole, OrganizationSummary } from '@/src/storage/organization-repository';
import UiIcon from './ui-icon';
import { CODEX_MODELS, REASONING_EFFORTS } from '@/src/domain/model-settings';

type Invitation = { id: string; organization_id: string; organization_name: string; role: string; expires_at: string };
type Member = { user_id: string; name: string; email: string; role: OrganizationRole; joined_at: string };
type SharedWorkflow = { workflow: WorkflowPlan; ownerUserId: string; sharedAt: string };

export default function OrganizationManagement() {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [shared, setShared] = useState<SharedWorkflow[]>([]);
  const [personalWorkflows, setPersonalWorkflows] = useState<WorkflowPlan[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = useMemo(() => organizations.find((item) => item.id === selectedId), [organizations, selectedId]);
  const canManage = selected?.role === 'owner' || selected?.role === 'administrator';

  const refresh = useCallback(async () => {
    const [organizationResponse, workflowResponse] = await Promise.all([fetch('/api/organizations'), fetch('/api/workflows')]);
    if (!organizationResponse.ok) return;
    const organizationData = await organizationResponse.json();
    const workflowData = workflowResponse.ok ? await workflowResponse.json() : { workflows: [] };
    setOrganizations(organizationData.organizations ?? []);
    setInvitations(organizationData.invitations ?? []);
    setPersonalWorkflows((workflowData.workflows ?? []).filter((workflow: WorkflowPlan) => workflow.status === 'approved'));
    setSelectedId((current) => current || organizationData.organizations?.[0]?.id || '');
  }, []);

  const refreshSelected = useCallback(async () => {
    if (!selectedId) { setMembers([]); setShared([]); return; }
    const workflowRequest = fetch(`/api/organizations/${encodeURIComponent(selectedId)}/workflows`);
    const memberRequest = canManage ? fetch(`/api/organizations/${encodeURIComponent(selectedId)}/members`) : Promise.resolve(null);
    const [workflowResponse, memberResponse] = await Promise.all([workflowRequest, memberRequest]);
    if (workflowResponse.ok) setShared((await workflowResponse.json()).workflows ?? []);
    if (memberResponse?.ok) setMembers((await memberResponse.json()).members ?? []); else setMembers([]);
  }, [selectedId, canManage]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  useEffect(() => { const timer = window.setTimeout(() => void refreshSelected(), 0); return () => window.clearTimeout(timer); }, [refreshSelected]);

  async function request(url: string, init: RequestInit, success: string) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(url, init);
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.[0] || result.error || 'Organization action failed.');
      setMessage(success); await refresh(); await refreshSelected();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Organization action failed.'); }
    finally { setBusy(false); }
  }

  function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget); const name = String(form.get('name') ?? '');
    void request('/api/organizations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }, 'Organization created.');
    event.currentTarget.reset();
  }

  function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void request(`/api/organizations/${encodeURIComponent(selectedId)}/members`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: form.get('email'), role: form.get('role') }) }, 'Member or invitation updated.');
    event.currentTarget.reset();
  }

  return <section className="profile-settings-section organization-settings">
    <div className="profile-section-heading"><UiIcon name="user" /><div><h3>Organizations</h3><p>Share approved workflows with explicit members while personal work stays private.</p></div></div>
    {invitations.length > 0 && <div className="organization-invitations"><strong>Invitations</strong>{invitations.map((invitation) => <div key={invitation.id}><span>{invitation.organization_name} · {invitation.role}</span><button className="dash-button secondary" type="button" disabled={busy} onClick={() => void request('/api/organizations/invitations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invitationId: invitation.id }) }, 'Invitation accepted.')}>Accept</button></div>)}</div>}
    <form className="organization-inline-form" onSubmit={createOrganization}><label htmlFor="organization-name">New organization<input id="organization-name" name="name" minLength={2} maxLength={100} placeholder="Platform Engineering" required /></label><button className="dash-button secondary" type="submit" disabled={busy}>Create</button></form>
    {organizations.length > 0 && <><label htmlFor="organization-select">Current organization<select id="organization-select" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{organizations.map((organization) => <option value={organization.id} key={organization.id}>{organization.name} · {organization.role}</option>)}</select></label>
      {canManage && <form className="organization-inline-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void request(`/api/organizations/${encodeURIComponent(selectedId)}/model-settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: form.get('model'), reasoningEffort: form.get('reasoningEffort') }) }, 'Organization model defaults updated.'); }}><label>Default model<select name="model" defaultValue={selected?.defaultModel ?? 'gpt-5.6-sol'}>{CODEX_MODELS.map((model) => <option key={model}>{model}</option>)}</select></label><label>Reasoning effort<select name="reasoningEffort" defaultValue={selected?.defaultReasoningEffort ?? 'medium'}>{REASONING_EFFORTS.map((effort) => <option key={effort}>{effort}</option>)}</select></label><button className="dash-button secondary" disabled={busy}>Save model defaults</button></form>}
      <div className="organization-shared"><strong>Shared workflow library</strong>{shared.length ? shared.map((item) => <div key={item.workflow.id}><span>{item.workflow.name}</span><small>Version {item.workflow.version ?? 1}</small></div>) : <p>No approved workflows have been shared.</p>}</div>
      {personalWorkflows.length > 0 && <form className="organization-inline-form" onSubmit={(event) => { event.preventDefault(); const workflowId = String(new FormData(event.currentTarget).get('workflowId') ?? ''); void request(`/api/organizations/${encodeURIComponent(selectedId)}/workflows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workflowId }) }, 'Workflow shared.'); }}><label htmlFor="organization-workflow">Share your approved workflow<select id="organization-workflow" name="workflowId">{personalWorkflows.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}</select></label><button className="dash-button secondary" type="submit" disabled={busy}>Share</button></form>}
      {canManage && <><form className="organization-member-form" onSubmit={inviteMember}><label htmlFor="organization-member-email">Add member<input id="organization-member-email" name="email" type="email" placeholder="colleague@company.com" required /></label><label htmlFor="organization-member-role">Organization role<select id="organization-member-role" name="role" defaultValue="member"><option value="member">Member</option><option value="reviewer">Reviewer</option><option value="administrator">Administrator</option></select></label><button className="dash-button secondary" type="submit" disabled={busy}>Add or invite</button></form><div className="organization-members">{members.map((member) => <div key={member.user_id}><span><strong>{member.name}</strong><small>{member.email} · {member.role}</small></span>{member.role !== 'owner' && <span className="organization-member-actions"><select aria-label={`Role for ${member.name}`} value={member.role} onChange={(event) => void request(`/api/organizations/${encodeURIComponent(selectedId)}/members`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: member.user_id, role: event.target.value }) }, 'Member role updated.')}><option value="member">Member</option><option value="reviewer">Reviewer</option><option value="administrator">Administrator</option>{selected?.role === 'owner' && <option value="owner">Transfer ownership</option>}</select><button type="button" disabled={busy} onClick={() => void request(`/api/organizations/${encodeURIComponent(selectedId)}/members?userId=${encodeURIComponent(member.user_id)}`, { method: 'DELETE' }, 'Member removed.')}>Remove</button></span>}</div>)}</div></>}
    </>}
    {message && <p className="profile-form-message" role="status">{message}</p>}
  </section>;
}
