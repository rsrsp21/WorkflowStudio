import { afterEach, describe, expect, it, vi } from 'vitest';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';

afterEach(async () => {
  await (await import('@/src/storage/async-database')).resetDatabaseForTests();
  vi.unstubAllEnvs();
});

async function sessionFor(userId: string) {
  const session = await (await import('@/src/auth/auth')).createSession(userId);
  return { cookie: `workflow_studio_session=${session.token}`, 'content-type': 'application/json' };
}

describe('Phase 8 reviewer delegation', () => {
  it('lets an administrator scope a reviewer to one owner and audits assignment changes', async () => {
    const { createUser } = await import('@/src/auth/auth');
    const admin = await createUser({ name: 'Review admin', email: `admin-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'administrator' });
    const reviewer = await createUser({ name: 'Scoped reviewer', email: `reviewer-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'reviewer' });
    const owner = await createUser({ name: 'Assigned owner', email: `owner-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'builder' });
    const other = await createUser({ name: 'Other owner', email: `other-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'builder' });
    if (!admin || !reviewer || !owner || !other) throw new Error('Could not create delegation users.');

    const repository = new (await import('@/src/storage/workflow-repository')).WorkflowRepository();
    for (const user of [owner, other]) {
      const plan = structuredClone(STARTER_WORKFLOWS[0]);
      plan.id = `workflow_${user.id}`; plan.name = `${user.name} draft`; plan.status = 'draft'; plan.nodes = plan.nodes.map((node) => ({ ...node, skillIds: [] }));
      await repository.upsert(user.id, plan);
    }

    const assignmentRoute = await import('@/src/app/api/admin/reviewer-assignments/route');
    expect((await assignmentRoute.POST(new Request('http://localhost/api/admin/reviewer-assignments', { method: 'POST', headers: await sessionFor(owner.id), body: JSON.stringify({ ownerUserId: owner.id, reviewerUserId: reviewer.id }) }))).status).toBe(403);
    const assigned = await assignmentRoute.POST(new Request('http://localhost/api/admin/reviewer-assignments', { method: 'POST', headers: await sessionFor(admin.id), body: JSON.stringify({ ownerUserId: owner.id, reviewerUserId: reviewer.id }) }));
    expect(assigned.status).toBe(201);

    const reviews = await (await import('@/src/app/api/reviews/route')).GET(new Request('http://localhost/api/reviews', { headers: await sessionFor(reviewer.id) })).then((response) => response.json());
    expect(reviews.reviews.map((item: { owner: { id: string } }) => item.owner.id)).toEqual([owner.id]);
    const audit = await (await import('@/src/storage/async-database')).getDatabase().then((db) => db.all<{ action: string; user_id: string }>('SELECT action, user_id FROM audit_events WHERE resource_type = ?', ['reviewer-assignment']));
    expect(audit).toContainEqual({ action: 'reviewer-assignment.create', user_id: owner.id });
  });

  it('rejects self-delegation and delegation to a builder', async () => {
    const { createUser } = await import('@/src/auth/auth');
    const admin = await createUser({ name: 'Delegation admin', email: `admin-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'administrator' });
    const builder = await createUser({ name: 'Builder reviewer', email: `builder-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'builder' });
    if (!admin || !builder) throw new Error('Could not create delegation users.');
    const route = await import('@/src/app/api/admin/reviewer-assignments/route');
    const self = await route.POST(new Request('http://localhost/api/admin/reviewer-assignments', { method: 'POST', headers: await sessionFor(admin.id), body: JSON.stringify({ ownerUserId: admin.id, reviewerUserId: admin.id }) }));
    expect(self.status).toBe(409);
    const wrongRole = await route.POST(new Request('http://localhost/api/admin/reviewer-assignments', { method: 'POST', headers: await sessionFor(admin.id), body: JSON.stringify({ ownerUserId: admin.id, reviewerUserId: builder.id }) }));
    expect(wrongRole.status).toBe(400);
  });
});
