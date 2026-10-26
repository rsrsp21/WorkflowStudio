import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowPlan } from '@/src/domain/models';
import { completeNode, cancelWorkflowRun, startNextNode } from '@/src/domain/runtime-engine';
import { compileWorkflowRun } from '@/src/domain/runtime';
import { createProject, createProjectWorkflow, createSkill, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-phase6-lifecycle-'));
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

function fixture(userId = 'phase6-owner') {
  const rootPath = path.join(directory, 'project');
  const skill = createSkill({ id: 'requirements-specialist', familyId: 'requirements-specialist', name: 'Requirements specialist', instructions: 'Produce evidence-backed requirements.', version: 3, status: 'published', source: 'Installed Codex skill', estimatedContextTokens: 1200 });
  const plan: WorkflowPlan = {
    id: 'phase6-general-workflow', schemaVersion: 1, name: 'Any-domain workflow', description: 'Run a user-authored specialist workflow.', version: 1,
    planningPrompt: 'Compose and verify a result.', workspacePath: rootPath, constraints: [], openQuestions: [], completionCriteria: ['A final result is verified.'], completionContract: { requiredOutputKeys: ['final'], requiredArtifacts: [] },
    nodes: [
      { id: 'compose', name: 'Compose result', type: 'agent', prompt: 'Use the selected specialist.', skillIds: [skill.id], inputKeys: ['brief'], outputKeys: ['draft'], outputSchemas: { draft: 'string' }, retryLimit: 1, requiresApproval: false },
      { id: 'finish', name: 'Finish', type: 'success', prompt: 'Package the result.', skillIds: [], inputKeys: ['draft'], outputKeys: ['final'], outputSchemas: { final: 'string' }, retryLimit: 0, requiresApproval: false },
      { id: 'blocked', name: 'Blocked', type: 'failure', prompt: 'Record the blocker.', skillIds: [], inputKeys: [], outputKeys: ['failure'], outputSchemas: { failure: 'string' }, retryLimit: 0, requiresApproval: false }
    ],
    edges: [{ from: 'compose', to: 'finish', condition: 'READY' }, { from: 'compose', to: 'blocked', condition: 'BLOCKED' }],
    harness: { sandboxMode: 'read-only', maxRetries: 2, maxLoopIterations: 3, maxConcurrentNodes: 1, allowedTools: ['workspace.read'], allowedWorkspacePaths: [rootPath], requireApprovalForDestructiveActions: true },
    status: 'approved', createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z'
  };
  const project = createProject({ id: 'phase6-project', name: 'Phase 6', rootPath, workspaceKind: 'empty' });
  const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: 'General', status: 'published', version: 1, defaultSkillVersions: [{ skillId: skill.id, version: skill.version }] });
  const assignment = createProjectWorkflow({ id: 'phase6-assignment', project, workflow, status: 'ready', approval: testAssignmentApproval(), graphOverride: plan, inputOverrides: { brief: 'Build the requested result.' }, permissions: { sandboxMode: 'read-only', allowedTools: ['workspace.read'], allowedWorkspacePaths: [rootPath], requireApprovalForDestructiveActions: true }, selectedSkills: [skill] });
  const compiled = compileWorkflowRun(userId, plan, assignment, [skill]);
  if (!compiled.run) throw new Error(compiled.errors.join(' '));
  return { rootPath, skill, plan, project, workflow, assignment, run: compiled.run };
}

describe('Phase 6 harness, cancellation, and data lifecycle', () => {
  it('compiles all six harness layers with exact immutable skill identity', () => {
    const { run, skill } = fixture();
    const harness = run.compiledWorkflow.harnessV2;
    expect(Object.keys(harness)).toEqual(expect.arrayContaining(['identityAndBehavior', 'runtime', 'observability', 'verification', 'adaptation', 'governanceAndSecurity']));
    expect(harness.identityAndBehavior.skills).toEqual([expect.objectContaining({ skillId: skill.id, version: 3, source: 'Installed Codex skill', integrity: expect.stringMatching(/^fnv1a-/) })]);
    expect(harness.runtime).toMatchObject({ engine: 'Mastra', taskExecutor: 'Codex App Server', cancellationMode: 'checkpoint-and-provider-interrupt' });
    expect(harness.adaptation).toMatchObject({ enabled: false, promotionRequiresHumanApproval: true, prohibitedSelfModification: true });
  });

  it('records verification independently and prevents late completion after cancellation', () => {
    const { run } = fixture();
    const started = startNextNode(run, '2026-09-04T10:00:00.000Z');
    const completed = completeNode(started.run, 'compose', { draft: 'Ready' }, 'READY', '2026-09-04T10:01:00.000Z');
    expect(completed.run.verificationResults).toEqual([expect.objectContaining({ nodeId: 'compose', status: 'passed' })]);
    const next = startNextNode(completed.run, '2026-09-04T10:02:00.000Z');
    const cancelled = cancelWorkflowRun(next.run, { id: 'owner', name: 'Owner', role: 'builder' }, 'No longer needed.', '2026-09-04T10:03:00.000Z');
    expect(cancelled).toMatchObject({ kind: 'run-cancelled', run: { status: 'cancelled' } });
    expect(cancelled.run.events.at(-1)).toMatchObject({ type: 'run.cancelled', data: { reason: 'No longer needed.' } });
    expect(() => completeNode(cancelled.run, 'finish', { final: 'Late result' })).toThrow('is not active');
  });

  it('exports only the owning account records and preserves retained run evidence', async () => {
    const { createUser } = await import('@/src/auth/auth');
    const user = await createUser({ name: 'Backup owner', email: 'backup-owner@example.com', password: 'password-123', role: 'builder', position: 'Developer' });
    if (!user) throw new Error('User setup failed.');
    const data = fixture(user.id);
    await mkdir(data.rootPath, { recursive: true });
    const { claimProjectOwnership } = await import('@/src/storage/project-ownership-repository');
    const { createWorkspaceStores } = await import('@/src/storage/workspace-stores');
    const { WorkflowRepository } = await import('@/src/storage/workflow-repository');
    const { RunRepository } = await import('@/src/storage/run-repository');
    await claimProjectOwnership(user.id, data.project.id);
    const stores = createWorkspaceStores(directory, user.id);
    await stores.projects.upsert(data.project); await stores.workflows.upsert(data.workflow); await stores.skills.upsert(data.skill); await stores.projectWorkflows.upsert(data.assignment);
    await new WorkflowRepository().upsert(user.id, data.plan);
    await new RunRepository().upsert(user.id, data.run);
    const { createUserBackup } = await import('@/src/storage/user-backup');
    const backup = await createUserBackup(user.id);
    expect(backup).toMatchObject({ schemaVersion: 1, product: 'Workflow Studio' });
    expect(backup.workflows.map((item) => item.id)).toEqual([data.plan.id]);
    expect(backup.runs.map((item) => item.id)).toEqual([data.run.id]);
    expect(backup.skills.map((item) => item.id)).toEqual([data.skill.id]);
  });

  it('quarantines malformed retained runs and reports versioned database health', async () => {
    const { createUser } = await import('@/src/auth/auth');
    const user = await createUser({ name: 'Recovery owner', email: 'recovery-owner@example.com', password: 'password-123', role: 'builder', position: 'Developer' });
    if (!user) throw new Error('User setup failed.');
    const { getDatabase, databaseHealth } = await import('@/src/storage/async-database');
    await (await getDatabase()).run('INSERT INTO runs (id, user_id, assignment_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', ['run_corrupt', user.id, 'assignment', '{', new Date().toISOString(), new Date().toISOString()]);
    const { RunRepository } = await import('@/src/storage/run-repository');
    expect(await new RunRepository().readAll(user.id)).toEqual([]);
    expect(await databaseHealth()).toMatchObject({ provider: 'postgres', quarantinedRecords: 1, integrity: [{ connection_check: 1 }] });
    expect((await databaseHealth()).migrations).toHaveLength(15);
  });
});
