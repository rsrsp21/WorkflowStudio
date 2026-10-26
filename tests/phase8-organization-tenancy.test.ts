import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validPlan } from './fixtures';

beforeEach(() => vi.resetModules());
afterEach(async () => {
  await (await import('@/src/storage/async-database')).resetDatabaseForTests();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function signup(email: string) {
  const route = await import('@/src/app/api/auth/signup/route');
  const response = await route.POST(new Request('http://localhost/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': email }, body: JSON.stringify({ name: email.split('@')[0], email, password: 'password-123', position: 'Developer' }) }));
  expect(response.status).toBe(201);
  const body = await response.json();
  return { user: body.user as { id: string; email: string }, headers: { cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '', 'content-type': 'application/json' } };
}

describe('organization tenancy and shared workflow library', () => {
  it('scopes membership management and shared approved workflows to organization members', async () => {
    const owner = await signup('org-owner@example.com');
    const member = await signup('org-member@example.com');
    const outsider = await signup('org-outsider@example.com');
    const organizations = await import('@/src/app/api/organizations/route');
    const created = await organizations.POST(new Request('http://localhost/api/organizations', { method: 'POST', headers: owner.headers, body: JSON.stringify({ name: 'Platform Engineering' }) }));
    expect(created.status).toBe(201);
    const organizationId = (await created.json()).organization.id as string;

    const members = await import('@/src/app/api/organizations/[organizationId]/members/route');
    const context = { params: Promise.resolve({ organizationId }) };
    const added = await members.POST(new Request(`http://localhost/api/organizations/${organizationId}/members`, { method: 'POST', headers: owner.headers, body: JSON.stringify({ email: member.user.email, role: 'reviewer' }) }), context);
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({ invitation: { accepted: true, userId: member.user.id } });
    expect((await members.GET(new Request(`http://localhost/api/organizations/${organizationId}/members`, { headers: member.headers }), context)).status).toBe(403);
    expect((await members.GET(new Request(`http://localhost/api/organizations/${organizationId}/members`, { headers: outsider.headers }), context)).status).toBe(403);

    const plan = { ...validPlan(), id: 'approved-org-workflow', status: 'approved' as const, openQuestions: [], questionResponses: [] };
    const { WorkflowRepository } = await import('@/src/storage/workflow-repository');
    await new WorkflowRepository().upsert(owner.user.id, plan);
    const workflowRoute = await import('@/src/app/api/organizations/[organizationId]/workflows/route');
    const shared = await workflowRoute.POST(new Request(`http://localhost/api/organizations/${organizationId}/workflows`, { method: 'POST', headers: owner.headers, body: JSON.stringify({ workflowId: plan.id }) }), context);
    expect(shared.status).toBe(201);
    const memberLibrary = await workflowRoute.GET(new Request(`http://localhost/api/organizations/${organizationId}/workflows`, { headers: member.headers }), context);
    expect(await memberLibrary.json()).toMatchObject({ workflows: [{ workflow: { id: plan.id }, ownerUserId: owner.user.id }] });
    expect((await workflowRoute.GET(new Request(`http://localhost/api/organizations/${organizationId}/workflows`, { headers: outsider.headers }), context)).status).toBe(404);
    expect((await workflowRoute.POST(new Request(`http://localhost/api/organizations/${organizationId}/workflows`, { method: 'POST', headers: member.headers, body: JSON.stringify({ workflowId: plan.id }) }), context)).status).toBe(404);
  });

  it('supports expiring email invitations without allowing another account to claim them', async () => {
    const owner = await signup('invite-owner@example.com');
    const organizations = await import('@/src/app/api/organizations/route');
    const created = await organizations.POST(new Request('http://localhost/api/organizations', { method: 'POST', headers: owner.headers, body: JSON.stringify({ name: 'Delivery Team' }) }));
    const organizationId = (await created.json()).organization.id as string;
    const members = await import('@/src/app/api/organizations/[organizationId]/members/route');
    const invited = await members.POST(new Request(`http://localhost/api/organizations/${organizationId}/members`, { method: 'POST', headers: owner.headers, body: JSON.stringify({ email: 'later-member@example.com', role: 'member' }) }), { params: Promise.resolve({ organizationId }) });
    expect(invited.status).toBe(201);
    const invitationId = (await invited.json()).invitation.invitationId as string;
    const wrong = await signup('wrong-member@example.com');
    const invitationRoute = await import('@/src/app/api/organizations/invitations/route');
    expect((await invitationRoute.POST(new Request('http://localhost/api/organizations/invitations', { method: 'POST', headers: wrong.headers, body: JSON.stringify({ invitationId }) }))).status).toBe(404);
    const intended = await signup('later-member@example.com');
    expect((await invitationRoute.POST(new Request('http://localhost/api/organizations/invitations', { method: 'POST', headers: intended.headers, body: JSON.stringify({ invitationId }) }))).status).toBe(200);
    const listing = await organizations.GET(new Request('http://localhost/api/organizations', { headers: intended.headers }));
    expect(await listing.json()).toMatchObject({ organizations: [{ id: organizationId, role: 'member' }], invitations: [] });
  });

  it('protects organization owners from removal', async () => {
    const owner = await signup('protected-owner@example.com');
    const organizations = await import('@/src/app/api/organizations/route');
    const created = await organizations.POST(new Request('http://localhost/api/organizations', { method: 'POST', headers: owner.headers, body: JSON.stringify({ name: 'Protected Org' }) }));
    const organizationId = (await created.json()).organization.id as string;
    const members = await import('@/src/app/api/organizations/[organizationId]/members/route');
    const response = await members.DELETE(new Request(`http://localhost/api/organizations/${organizationId}/members?userId=${owner.user.id}`, { method: 'DELETE', headers: owner.headers }), { params: Promise.resolve({ organizationId }) });
    expect(response.status).toBe(409);
  });

  it('transfers ownership atomically and preserves both memberships', async () => {
    const owner = await signup('transfer-owner@example.com');
    const nextOwner = await signup('transfer-next@example.com');
    const organizations = await import('@/src/app/api/organizations/route');
    const created = await organizations.POST(new Request('http://localhost/api/organizations', { method: 'POST', headers: owner.headers, body: JSON.stringify({ name: 'Transfer Org' }) }));
    const organizationId = (await created.json()).organization.id as string;
    const members = await import('@/src/app/api/organizations/[organizationId]/members/route');
    const context = { params: Promise.resolve({ organizationId }) };
    await members.POST(new Request(`http://localhost/api/organizations/${organizationId}/members`, { method: 'POST', headers: owner.headers, body: JSON.stringify({ email: nextOwner.user.email, role: 'member' }) }), context);
    const transferred = await members.PATCH(new Request(`http://localhost/api/organizations/${organizationId}/members`, { method: 'PATCH', headers: owner.headers, body: JSON.stringify({ userId: nextOwner.user.id, role: 'owner' }) }), context);
    expect(transferred.status).toBe(200);
    const list = await members.GET(new Request(`http://localhost/api/organizations/${organizationId}/members`, { headers: nextOwner.headers }), context);
    expect(await list.json()).toMatchObject({ members: expect.arrayContaining([expect.objectContaining({ user_id: nextOwner.user.id, role: 'owner' }), expect.objectContaining({ user_id: owner.user.id, role: 'administrator' })]) });
    expect((await members.PATCH(new Request(`http://localhost/api/organizations/${organizationId}/members`, { method: 'PATCH', headers: owner.headers, body: JSON.stringify({ userId: owner.user.id, role: 'owner' }) }), context)).status).toBe(403);
  });
});
