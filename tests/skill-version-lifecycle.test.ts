import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Skill } from '@/src/domain/workspace';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { resetDatabaseForTests } = await import('@/src/storage/async-database'); await resetDatabaseForTests();
  vi.unstubAllEnvs(); vi.resetModules();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Phase 3 skill version lifecycle', () => {
  it('publishes a draft and creates a new immutable draft version when edited', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-skill-versions-')); temporaryDirectories.push(directory);
    vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory); vi.resetModules();
    const signup = await import('@/src/app/api/auth/signup/route');
    const signupResponse = await signup.POST(new Request('http://localhost/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Skill Tester', email: 'skills@example.com', password: 'password-123', role: 'builder', position: 'QA Engineer' }) }));
    const headers = { 'content-type': 'application/json', cookie: signupResponse.headers.get('set-cookie')?.split(';')[0] ?? '' };
    const route = await import('@/src/app/api/skills/route');
    const createResponse = await route.POST(new Request('http://localhost/api/skills', { method: 'POST', headers, body: JSON.stringify({ name: 'Evidence review', instructions: 'Review evidence.', author: 'QA', source: 'Internal', compatibility: ['Codex App Server'], estimatedContextTokens: 900 }) }));
    const created = (await createResponse.json()).skill as Skill;
    const publishResponse = await route.PATCH(new Request('http://localhost/api/skills', { method: 'PATCH', headers, body: JSON.stringify({ id: created.id, action: 'publish' }) }));
    const published = (await publishResponse.json()).skill as Skill;
    expect(published.status).toBe('published');
    const editResponse = await route.POST(new Request('http://localhost/api/skills', { method: 'POST', headers, body: JSON.stringify({ ...published, instructions: 'Review evidence and cite every finding.' }) }));
    const edited = (await editResponse.json()).skill as Skill;
    expect(edited.id).not.toBe(published.id); expect(edited.familyId).toBe(published.familyId);
    expect(edited.version).toBe(2); expect(edited.status).toBe('draft');
    const all = (await (await route.GET(new Request('http://localhost/api/skills', { headers }))).json()).skills as Skill[];
    expect(all.find((skill) => skill.id === published.id)?.status).toBe('published');
    expect(all.find((skill) => skill.id === edited.id)?.status).toBe('draft');
  }, 15_000);
});
