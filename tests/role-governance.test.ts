import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canPerformGovernedAction } from '@/src/domain/authorization';

let directory = '';
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-roles-')); vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory); vi.resetModules(); });
afterEach(async () => { const { resetDatabaseForTests } = await import('@/src/storage/async-database'); await resetDatabaseForTests(); vi.unstubAllEnvs(); vi.resetModules(); await rm(directory, { recursive: true, force: true }); });

describe('managed roles and governance gates', () => {
  it('enforces reviewer decisions only when the production role gate is enabled', () => {
    expect(canPerformGovernedAction({ role: 'builder' }, 'approve-definition', {})).toBe(true);
    expect(canPerformGovernedAction({ role: 'builder' }, 'approve-definition', { WORKFLOW_STUDIO_ENFORCE_ROLE_GATES: 'true' })).toBe(false);
    expect(canPerformGovernedAction({ role: 'reviewer' }, 'decide-workflow-gate', { WORKFLOW_STUDIO_ENFORCE_ROLE_GATES: 'true' })).toBe(true);
    expect(canPerformGovernedAction({ role: 'administrator' }, 'promote-adaptation', { WORKFLOW_STUDIO_ENFORCE_ROLE_GATES: 'true' })).toBe(true);
  });

  it('bootstraps configured administrators and lets only administrators manage roles', async () => {
    vi.stubEnv('WORKFLOW_STUDIO_BOOTSTRAP_ADMIN_EMAILS', 'admin@example.com');
    const signup = await import('@/src/app/api/auth/signup/route');
    const create = async (email: string) => {
      const response = await signup.POST(new Request('http://localhost/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': email }, body: JSON.stringify({ name: email.split('@')[0], email, password: 'password-123', position: 'Developer' }) }));
      return { response, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' };
    };
    const admin = await create('admin@example.com');
    const builder = await create('builder@example.com');
    expect(admin.body.user.role).toBe('administrator');
    expect(builder.body.user.role).toBe('builder');
    const route = await import('@/src/app/api/admin/users/route');
    expect((await route.GET(new Request('http://localhost/api/admin/users', { headers: { cookie: builder.cookie } }))).status).toBe(403);
    const changed = await route.PATCH(new Request('http://localhost/api/admin/users', { method: 'PATCH', headers: { cookie: admin.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ userId: builder.body.user.id, role: 'reviewer' }) }));
    expect(changed.status).toBe(200);
    expect((await changed.json()).user.role).toBe('reviewer');
    const selfDemotion = await route.PATCH(new Request('http://localhost/api/admin/users', { method: 'PATCH', headers: { cookie: admin.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ userId: admin.body.user.id, role: 'builder' }) }));
    expect(selfDemotion.status).toBe(409);
  });
});
