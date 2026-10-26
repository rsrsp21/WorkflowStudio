import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileWorkflowRun } from '@/src/domain/runtime';
import { completeNode, failNode, startNextNode } from '@/src/domain/runtime-engine';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

function compiledContractRun() {
  const plan = structuredClone(STARTER_WORKFLOWS[0]);
  plan.status = 'approved';
  plan.nodes[0].outputSchemas = { result: 'array' };
  plan.nodes[0].requiredArtifacts = ['Review report'];
  plan.nodes[1].outputSchemas = { 'approved-result': 'object' };
  plan.completionContract = { requiredOutputKeys: ['approved-result'], requiredArtifacts: ['Review report'] };
  const rootPath = path.resolve('contract-project');
  const project = createProject({ name: 'Contract project', rootPath, workspaceKind: 'workspace' });
  const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: plan.domain ?? 'General', status: 'published' });
  const assignment = createProjectWorkflow({ project, workflow, status: 'ready', approval: testAssignmentApproval(workflow.version), graphOverride: plan, inputOverrides: { project: rootPath }, permissions: { allowedWorkspacePaths: [rootPath] } });
  const compiled = compileWorkflowRun('contract-user', plan, assignment, []);
  if (!compiled.run) throw new Error(compiled.errors.join(' '));
  return { run: compiled.run, plan, rootPath };
}

describe('Phase 5 output, artifact, and completion contracts', () => {
  it('blocks missing, extra, and wrong-typed node outputs before downstream use', () => {
    const { run, plan } = compiledContractRun();
    const started = startNextNode(run);
    expect(() => completeNode(started.run, plan.nodes[0].id, {})).toThrow('missing required keys');
    expect(() => completeNode(started.run, plan.nodes[0].id, { result: [], extra: true })).toThrow('undeclared keys');
    expect(() => completeNode(started.run, plan.nodes[0].id, { result: 'wrong type' })).toThrow('must be array');
  });

  it('requires declared artifacts and enforces the workflow completion contract', () => {
    const { run, plan, rootPath } = compiledContractRun();
    const started = startNextNode(run);
    expect(() => completeNode(started.run, plan.nodes[0].id, { result: [] }, 'validation passes')).toThrow('missing required labels');
    const reviewed = completeNode(started.run, plan.nodes[0].id, { result: [] }, 'validation passes', undefined, { artifacts: [{ path: path.join(rootPath, 'review.md'), description: 'Review report', rootPath, sandboxMode: 'read-only', writeAllowed: false }] });
    const success = startNextNode(reviewed.run);
    const completed = completeNode(success.run, plan.nodes[1].id, { 'approved-result': { accepted: true } });
    expect(completed.run.status).toBe('completed');

    const missingContract = compiledContractRun();
    missingContract.run.compiledWorkflow.completionContract = { requiredOutputKeys: ['failure-report'], requiredArtifacts: ['Review report'] };
    const first = startNextNode(missingContract.run);
    const routed = completeNode(first.run, missingContract.plan.nodes[0].id, { result: [] }, 'validation passes', undefined, { artifacts: [{ path: path.join(missingContract.rootPath, 'review.md'), description: 'Review report', rootPath: missingContract.rootPath, sandboxMode: 'read-only', writeAllowed: false }] });
    const terminal = startNextNode(routed.run);
    expect(() => completeNode(terminal.run, missingContract.plan.nodes[1].id, { 'approved-result': { accepted: true } })).toThrow('missing required outputs');
  });

  it('persists distinct failure classifications for diagnostics and recovery', () => {
    const { run, plan } = compiledContractRun();
    const started = startNextNode(run);
    const failed = failNode(started.run, plan.nodes[0].id, 'Output schema did not match.', undefined, 'validation');
    expect(failed.nodeRun).toMatchObject({ failureKind: 'validation', error: 'Output schema did not match.' });
    expect(failed.run.events.at(-1)?.data).toMatchObject({ failureKind: 'validation' });
  });
});
