import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validPlan } from './fixtures';

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-auth-'));
  vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory);
  vi.resetModules();
});

afterEach(async () => {
  const { resetDatabaseForTests } = await import('@/src/storage/async-database');
  await resetDatabaseForTests();
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(directory, { recursive: true, force: true });
});

async function signup(email: string, name: string) {
  const route = await import('@/src/app/api/auth/signup/route');
  const response = await route.POST(new Request('http://localhost/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, email, password: 'password-123', role: 'builder', position: 'Software Developer' }) }));
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  expect(response.status).toBe(201);
  expect(cookie).toContain('workflow_studio_session=');
  return { 'content-type': 'application/json', cookie: cookie as string };
}

function resolvedPlan(id: string, name: string) {
  const plan = validPlan();
  return { ...plan, id, name, openQuestions: [], questionResponses: [] };
}

describe('PostgreSQL authentication and workflow ownership', () => {
  it('creates sessions without storing plaintext passwords', async () => {
    const headers = await signup('owner@example.com', 'Workflow Owner');
    const meRoute = await import('@/src/app/api/auth/me/route');
    const me = await (await meRoute.GET(new Request('http://localhost/api/auth/me', { headers }))).json();
    expect(me.user).toMatchObject({ name: 'Workflow Owner', email: 'owner@example.com', role: 'builder', position: 'Software Developer' });

    const { getDatabase } = await import('@/src/storage/async-database');
    const stored = await (await getDatabase()).get<{ password_hash: string }>('SELECT password_hash FROM users WHERE email = ?', ['owner@example.com']);
    if (!stored) throw new Error('Stored user was not found.');
    expect(stored.password_hash).not.toContain('password-123');
    expect(stored.password_hash.split(':')).toHaveLength(2);
  });

  it('assigns the builder role server-side and ignores signup privilege claims', async () => {
    const route = await import('@/src/app/api/auth/signup/route');
    const response = await route.POST(new Request('http://localhost/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Role Claim', email: 'role-claim@example.com', password: 'password-123', role: 'administrator', position: 'Developer' }) }));
    expect(response.status).toBe(201);
    expect((await response.json()).user.role).toBe('builder');
  });

  it('isolates workflow lists and prevents cross-user overwrite or deletion', async () => {
    const ownerHeaders = await signup('owner@example.com', 'Owner');
    const otherHeaders = await signup('other@example.com', 'Other User');
    const route = await import('@/src/app/api/workflows/route');
    const ownerPlan = resolvedPlan('owner-workflow', 'Owner workflow');
    const otherPlan = resolvedPlan('other-workflow', 'Other workflow');

    expect((await route.POST(new Request('http://localhost/api/workflows', { method: 'POST', headers: ownerHeaders, body: JSON.stringify(ownerPlan) }))).status).toBe(201);
    expect((await route.POST(new Request('http://localhost/api/workflows', { method: 'POST', headers: otherHeaders, body: JSON.stringify(otherPlan) }))).status).toBe(201);

    const ownerList = await (await route.GET(new Request('http://localhost/api/workflows', { headers: ownerHeaders }))).json();
    const otherList = await (await route.GET(new Request('http://localhost/api/workflows', { headers: otherHeaders }))).json();
    expect(ownerList.workflows.map((workflow: { id: string }) => workflow.id)).toEqual(['owner-workflow']);
    expect(otherList.workflows.map((workflow: { id: string }) => workflow.id)).toEqual(['other-workflow']);

    const overwrite = await route.POST(new Request('http://localhost/api/workflows', { method: 'POST', headers: otherHeaders, body: JSON.stringify({ ...ownerPlan, name: 'Stolen' }) }));
    const deletion = await route.DELETE(new (await import('next/server')).NextRequest('http://localhost/api/workflows?id=owner-workflow', { method: 'DELETE', headers: otherHeaders }));
    expect(overwrite.status).toBe(404);
    expect(deletion.status).toBe(404);
  });

  it('isolates skill records even when two users choose the same skill id', async () => {
    const firstHeaders = await signup('skills-one@example.com', 'Skills One');
    const secondHeaders = await signup('skills-two@example.com', 'Skills Two');
    const route = await import('@/src/app/api/skills/route');
    const create = (headers: Record<string, string>, instructions: string) => route.POST(new Request('http://localhost/api/skills', { method: 'POST', headers, body: JSON.stringify({ id: 'shared-name', name: 'Shared name', instructions, author: 'User', source: 'User registry' }) }));
    expect((await create(firstHeaders, 'First private instructions.')).status).toBe(201);
    expect((await create(secondHeaders, 'Second private instructions.')).status).toBe(201);
    const first = await (await route.GET(new Request('http://localhost/api/skills', { headers: firstHeaders }))).json();
    const second = await (await route.GET(new Request('http://localhost/api/skills', { headers: secondHeaders }))).json();
    expect(first.skills).toEqual([expect.objectContaining({ id: 'shared-name', instructions: 'First private instructions.' })]);
    expect(second.skills).toEqual([expect.objectContaining({ id: 'shared-name', instructions: 'Second private instructions.' })]);
  });

  it('supports profile and password updates', async () => {
    const headers = await signup('profile@example.com', 'Alex Morgan');
    const meRoute = await import('@/src/app/api/auth/me/route');
    const profileResponse = await meRoute.PATCH(new Request('http://localhost/api/auth/me', { method: 'PATCH', headers, body: JSON.stringify({ action: 'profile', name: 'Alex M. Morgan', position: 'Lead Developer', role: 'administrator' }) }));
    expect(profileResponse.status).toBe(200);
    expect((await profileResponse.json()).user).toMatchObject({ name: 'Alex M. Morgan', position: 'Lead Developer', role: 'builder' });

    const wrongPassword = await meRoute.PATCH(new Request('http://localhost/api/auth/me', { method: 'PATCH', headers, body: JSON.stringify({ action: 'password', currentPassword: 'incorrect-password', newPassword: 'new-password-456' }) }));
    expect(wrongPassword.status).toBe(400);
    const changedPassword = await meRoute.PATCH(new Request('http://localhost/api/auth/me', { method: 'PATCH', headers, body: JSON.stringify({ action: 'password', currentPassword: 'password-123', newPassword: 'new-password-456' }) }));
    expect(changedPassword.status).toBe(200);

    const loginRoute = await import('@/src/app/api/auth/login/route');
    const oldLogin = await loginRoute.POST(new Request('http://localhost/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'profile@example.com', password: 'password-123' }) }));
    const newLogin = await loginRoute.POST(new Request('http://localhost/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'profile@example.com', password: 'new-password-456' }) }));
    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);
  }, 20_000);

  it('rejects unauthenticated profile changes', async () => {
    const meRoute = await import('@/src/app/api/auth/me/route');
    const response = await meRoute.PATCH(new Request('http://localhost/api/auth/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'profile', name: 'No session', position: 'Developer', role: 'builder' }) }));
    expect(response.status).toBe(401);
  });

});
