import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateWorkflowGraph, validateWorkflowPlan } from '@/src/domain/models';
import { compileWorkflowRun } from '@/src/domain/runtime';
import { completeNode, startNextNode } from '@/src/domain/runtime-engine';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { assertNoSymlinkEscape } from '@/src/domain/workspace-boundary';
import { createProject, createProjectWorkflow, createSkill, createWorkflow, validateProjectWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function approvedRun() {
  const plan = structuredClone(STARTER_WORKFLOWS[0]);
  plan.status = 'approved';
  const project = createProject({ id: 'edge-project', name: 'Edge project', rootPath: plan.workspacePath, workspaceKind: 'workspace' });
  const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: plan.domain ?? 'General', status: 'published' });
  const assignment = createProjectWorkflow({ project, workflow, status: 'ready', approval: testAssignmentApproval(workflow.version), graphOverride: plan, inputOverrides: { project: project.rootPath }, permissions: { allowedWorkspacePaths: [project.rootPath] } });
  const result = compileWorkflowRun('edge-user', plan, assignment, []);
  if (!result.run) throw new Error(result.errors.join(' '));
  return { plan, run: result.run, project, workflow };
}

describe('Phase 5 validation edge cases', () => {
  it('returns deterministic graph errors for empty, duplicate, incomplete, and cyclic structures', () => {
    const empty = structuredClone(STARTER_WORKFLOWS[0]);
    empty.nodes = [];
    empty.edges = [];
    expect(validateWorkflowGraph(empty).errors).toContain('Graph must contain at least one node.');

    const duplicate = structuredClone(STARTER_WORKFLOWS[0]);
    duplicate.edges.push(structuredClone(duplicate.edges[0]), { from: duplicate.nodes[0].id, to: duplicate.nodes[0].id });
    const duplicateErrors = validateWorkflowGraph(duplicate).errors.join(' ');
    expect(duplicateErrors).toContain('Connection is duplicated');
    expect(duplicateErrors).toContain('Self connection is not allowed');

    const incompleteApproval = structuredClone(STARTER_WORKFLOWS[0]);
    incompleteApproval.nodes[0].type = 'approval';
    incompleteApproval.edges = incompleteApproval.edges.filter((edge) => edge.from !== incompleteApproval.nodes[0].id);
    expect(validateWorkflowGraph(incompleteApproval).errors.join(' ')).toContain('Workflow path is incomplete after');

    const terminalContinuation = structuredClone(STARTER_WORKFLOWS[0]);
    terminalContinuation.edges.push({ from: terminalContinuation.nodes[1].id, to: terminalContinuation.nodes[2].id });
    expect(validateWorkflowGraph(terminalContinuation).errors.join(' ')).toContain('Terminal node cannot have a continuation');

    const cycle = structuredClone(STARTER_WORKFLOWS[0]);
    cycle.edges.push({ from: cycle.nodes[1].id, to: cycle.nodes[0].id });
    expect(validateWorkflowGraph(cycle).errors).toContain('Graph contains a cycle outside a bounded loop node.');
  });

  it('rejects conflicting producers, malformed payloads, and graph resource overflows without throwing', () => {
    const conflicting = structuredClone(STARTER_WORKFLOWS[0]);
    conflicting.nodes[1].outputKeys = ['result'];
    expect(validateWorkflowGraph(conflicting).errors.join(' ')).toContain('Output key has multiple producers');
    expect(() => validateWorkflowPlan({ name: 42, domain: 10, nodes: 'bad' })).not.toThrow();
    expect(validateWorkflowPlan({ name: 42, domain: 10, nodes: 'bad' }).length).toBeGreaterThan(0);

    const oversized = structuredClone(STARTER_WORKFLOWS[0]);
    oversized.nodes = Array.from({ length: 501 }, (_, index) => ({ ...oversized.nodes[0], id: `node-${index}` }));
    oversized.edges = [];
    expect(validateWorkflowPlan(oversized)).toContain('Workflow cannot contain more than 500 nodes.');
    oversized.harness.maxRetries = 11;
    oversized.harness.maxLoopIterations = 101;
    oversized.harness.maxConcurrentNodes = 11;
    expect(validateWorkflowPlan(oversized).join(' ')).toContain('Maximum retries must be between 0 and 10');
  });

  it('bounds selected skill context, assignment inputs, node output, and accumulated artifacts', () => {
    const { plan, run, project, workflow } = approvedRun();
    const skills = [
      createSkill({ id: 'large-a', name: 'Large A', instructions: 'A', status: 'published', estimatedContextTokens: 60_000 }),
      createSkill({ id: 'large-b', name: 'Large B', instructions: 'B', status: 'published', estimatedContextTokens: 60_000 })
    ];
    const assignment = createProjectWorkflow({ project, workflow, selectedSkills: skills, inputOverrides: Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`input-${index}`, 'value'])), permissions: { allowedWorkspacePaths: [project.rootPath] } });
    const assignmentErrors = validateProjectWorkflow(assignment, { projects: [project], workflows: [workflow], skills }).join(' ');
    expect(assignmentErrors).toContain('100,000 token assignment limit');
    expect(assignmentErrors).toContain('inputs exceed the supported size');

    const started = startNextNode(run);
    expect(() => completeNode(started.run, plan.nodes[0].id, { result: 'x'.repeat(1_000_001) })).toThrow('1 MB limit');
    const artifacts = Array.from({ length: 51 }, (_, index) => ({ path: `artifact-${index}.json`, description: `Artifact ${index}`, rootPath: project.rootPath, sandboxMode: 'read-only' as const, writeAllowed: false }));
    expect(() => completeNode(started.run, plan.nodes[0].id, { result: {} }, '', undefined, { artifacts })).toThrow('Artifact limit exceeded');
  });

  it('rejects an existing symlink or junction that escapes the approved root', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-symlink-'));
    temporaryDirectories.push(directory);
    const root = path.join(directory, 'root');
    const outside = path.join(directory, 'outside');
    await Promise.all([mkdir(root), mkdir(outside)]);
    const escape = path.join(root, 'escape');
    await symlink(outside, escape, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => assertNoSymlinkEscape(path.join(escape, 'result.json'), root)).toThrow('outside the approved project root');
  });
});
