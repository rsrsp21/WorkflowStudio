import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Skill } from '@/src/domain/workspace';
import type { WorkflowPlan } from '@/src/domain/models';
import { validPlan } from './fixtures';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { resetDatabaseForTests } = await import('@/src/storage/async-database');
  await resetDatabaseForTests();
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function authenticatedHeaders() {
  const signupRoute = await import('@/src/app/api/auth/signup/route');
  const response = await signupRoute.POST(new Request('http://localhost/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Test Builder', email: 'builder@example.com', password: 'password-123', role: 'builder', position: 'Software Developer' }) }));
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Test signup did not return a session cookie.');
  return { 'content-type': 'application/json', cookie };
}

describe('generated skill API lifecycle', () => {
  it('creates workflow draft skills and removes deleted references from persisted plans', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-skills-'));
    temporaryDirectories.push(directory);
    vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory);
    vi.resetModules();
    const headers = await authenticatedHeaders();
    const workflowRoute = await import('@/src/app/api/workflows/route');
    const skillRoute = await import('@/src/app/api/skills/route');
    const resolvedPlan = validPlan();
    resolvedPlan.openQuestions = [];
    resolvedPlan.questionResponses = [{ question: 'Which report format is preferred?', answer: 'Markdown.' }];

    const saveResponse = await workflowRoute.POST(new Request('http://localhost/api/workflows', {
      method: 'POST', headers, body: JSON.stringify(resolvedPlan)
    }));
    const saved = await saveResponse.json();
    const createdSkills = saved.createdSkills as Skill[];

    expect(saveResponse.status).toBe(201);
    expect(createdSkills).toHaveLength(2);
    expect(createdSkills.every((skill) => skill.status === 'draft' && skill.scope.kind === 'workflow')).toBe(true);
    const generatedId = createdSkills.find((skill) => skill.id !== 'document-review')?.id;
    expect(generatedId).toBeTruthy();

    const deleteResponse = await skillRoute.DELETE(new NextRequest(`http://localhost/api/skills?id=${encodeURIComponent(generatedId!)}`, { method: 'DELETE', headers }));
    expect(deleteResponse.status).toBe(200);
    const persistedPlans = (await (await workflowRoute.GET(new Request('http://localhost/api/workflows', { headers }))).json()).workflows as WorkflowPlan[];
    expect(persistedPlans[0].nodes.flatMap((node) => node.skillIds)).not.toContain(generatedId);
  });

  it('saves a draft while planning questions remain unresolved', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-questions-'));
    temporaryDirectories.push(directory);
    vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory);
    vi.resetModules();
    const headers = await authenticatedHeaders();
    const workflowRoute = await import('@/src/app/api/workflows/route');

    const response = await workflowRoute.POST(new Request('http://localhost/api/workflows', {
      method: 'POST', headers, body: JSON.stringify(validPlan())
    }));
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.workflow.status).toBe('draft');
    expect(result.workflow.openQuestions).toEqual(validPlan().openQuestions);
  });

  it('saves acknowledged unresolved questions without pretending they were answered', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-acknowledged-questions-'));
    temporaryDirectories.push(directory);
    vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory);
    vi.resetModules();
    const headers = await authenticatedHeaders();
    const workflowRoute = await import('@/src/app/api/workflows/route');
    const plan = validPlan();
    plan.questionResponses = [{ question: plan.openQuestions[0], answer: '' }];

    const response = await workflowRoute.POST(new Request('http://localhost/api/workflows', {
      method: 'POST', headers, body: JSON.stringify({ ...plan, lifecycleAction: 'continue-unresolved' })
    }));
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.workflow.openQuestions).toEqual(plan.openQuestions);
    expect(result.workflow.questionResponses).toEqual(plan.questionResponses);
  });

  it('registers a referenced installed Codex skill instead of generating a substitute draft', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-installed-skill-'));
    temporaryDirectories.push(directory);
    const codexHome = path.join(directory, '.codex');
    const skillDirectory = path.join(codexHome, 'skills', 'imagegen');
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(path.join(skillDirectory, 'SKILL.md'), '---\nname: imagegen\ndescription: Generate or edit raster images and visual assets.\n---\n', 'utf8');
    vi.stubEnv('WORKFLOW_STUDIO_HOME', directory);
    vi.stubEnv('WORKFLOW_STUDIO_DATA_DIR', directory);
    vi.resetModules();
    const headers = await authenticatedHeaders();
    const workflowRoute = await import('@/src/app/api/workflows/route');
    const plan = validPlan();
    plan.openQuestions = [];
    plan.questionResponses = [{ question: 'Which report format is preferred?', answer: 'Visual UI screens.' }];
    plan.nodes[0].skillIds = ['imagegen'];

    const response = await workflowRoute.POST(new Request('http://localhost/api/workflows', {
      method: 'POST', headers, body: JSON.stringify(plan)
    }));
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.attachedSkills).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'imagegen', status: 'published', source: 'Installed Codex skill' })]));
    expect(result.createdSkills).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'imagegen' })]));
  });
});
