import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileWorkflowRun } from '@/src/domain/runtime';
import { startNextNode } from '@/src/domain/runtime-engine';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { testAssignmentApproval } from './test-helpers';

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-adaptation-'));
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

describe('human-approved adaptation reuse', () => {
  it('promotes project guidance and compiles it only into a later matching run', async () => {
    const { createUser } = await import('@/src/auth/auth');
    const user = await createUser({ name: 'Adaptation owner', email: 'adaptation@example.com', password: 'password-123', role: 'builder' });
    if (!user) throw new Error('User setup failed.');
    const plan = structuredClone(STARTER_WORKFLOWS[0]);
    plan.workspacePath = directory;
    plan.nodes = plan.nodes.map((node) => ({ ...node, skillIds: [] }));
    plan.harness = { ...plan.harness, allowedWorkspacePaths: [directory], adaptationEnabled: true, adaptationScope: 'project' };
    plan.status = 'approved';
    const project = createProject({ id: 'adapt-project', name: 'Adaptation project', rootPath: directory, workspaceKind: 'workspace' });
    const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: 'Testing', status: 'published' });
    const assignment = createProjectWorkflow({ id: 'adapt-assignment', project, workflow, status: 'ready', approval: testAssignmentApproval(workflow.version), graphOverride: plan, inputOverrides: { project: directory }, permissions: { sandboxMode: 'read-only', allowedWorkspacePaths: [directory] } });
    const original = compileWorkflowRun(user.id, plan, assignment, []);
    if (!original.run) throw new Error(original.errors.join(' '));
    const nodeId = plan.nodes[0].id;
    const candidate = { id: `${original.run.id}:adaptation:1`, nodeId, sourceEventId: `${original.run.id}:event:1`, scope: 'project' as const, summary: 'Always link acceptance criteria to measurable evidence.', status: 'approved' as const, createdAt: original.run.createdAt, decidedAt: original.run.createdAt, decidedBy: { id: user.id, name: user.name, role: user.role } };
    original.run.adaptationCandidates.push(candidate);
    const { promoteApprovedAdaptation, listApplicableAdaptations } = await import('@/src/storage/adaptation-repository');
    expect(await promoteApprovedAdaptation(user, original.run, candidate)).toMatchObject({ scope: 'project', nodeId });
    const guidance = await listApplicableAdaptations(user.id, project.id, workflow.id);
    expect(guidance).toHaveLength(1);
    expect(await listApplicableAdaptations(user.id, 'another-project', workflow.id)).toEqual([]);
    const next = compileWorkflowRun(user.id, plan, assignment, [], 'run_adaptation-next', guidance);
    if (!next.run) throw new Error(next.errors.join(' '));
    expect(next.run.compiledWorkflow.approvedAdaptations).toEqual(guidance);
    expect(startNextNode(next.run).task?.approvedAdaptations).toEqual([expect.objectContaining({ summary: candidate.summary, sourceRunId: original.run.id })]);
  });
});
