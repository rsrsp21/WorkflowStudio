import { describe, expect, it } from 'vitest';
import { evaluateLifecycleTransition, type WorkflowLifecycleAction } from '@/src/domain/lifecycle-policy';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

function lifecycleFixtures() {
  const draft = structuredClone(STARTER_WORKFLOWS[0]);
  draft.openQuestions = ['Which evidence source is authoritative?'];
  draft.questionResponses = [{ question: draft.openQuestions[0], answer: '' }];
  const approved = structuredClone(draft);
  approved.status = 'approved';
  approved.definitionApproval = {
    approvedAt: '2026-01-01T00:00:00.000Z',
    approvedBy: { id: 'definition-approver', name: 'Definition approver', role: 'reviewer' },
    workflowVersion: approved.version ?? 1
  };
  const project = createProject({ id: 'matrix-project', name: 'Matrix project', rootPath: approved.workspacePath, workspaceKind: 'workspace' });
  const definition = createWorkflow({ id: approved.id, name: approved.name, domain: approved.domain ?? 'General', version: approved.version, status: 'published' });
  const draftAssignment = createProjectWorkflow({ project, workflow: definition, graphOverride: approved, inputOverrides: { project: project.rootPath }, permissions: { allowedWorkspacePaths: [project.rootPath] } });
  const readyAssignment = createProjectWorkflow({ project, workflow: definition, status: 'ready', approval: testAssignmentApproval(definition.version), graphOverride: approved, inputOverrides: { project: project.rootPath }, permissions: { allowedWorkspacePaths: [project.rootPath] } });
  return { draft, approved, draftAssignment, readyAssignment };
}

describe('Phase 5 lifecycle validation matrix', () => {
  it('keeps planning revisions and unresolved draft persistence independent of project approval', () => {
    const { draft } = lifecycleFixtures();
    const actions: WorkflowLifecycleAction[] = ['save-draft', 'replan', 'continue-unresolved'];
    for (const action of actions) expect(evaluateLifecycleTransition({ action, workflow: draft }), action).toMatchObject({ allowed: true, errors: [] });
    expect(evaluateLifecycleTransition({ action: 'approve-definition', workflow: draft }).allowed).toBe(true);
    expect(evaluateLifecycleTransition({ action: 'create-assignment', workflow: draft }).errors).toContain('Approve the reusable workflow graph before creating a project assignment.');
  });

  it('separates definition, assignment, compile, and execute gates', () => {
    const { approved, draftAssignment, readyAssignment } = lifecycleFixtures();
    expect(evaluateLifecycleTransition({ action: 'create-assignment', workflow: approved }).allowed).toBe(true);
    expect(evaluateLifecycleTransition({ action: 'approve-assignment', workflow: approved, graph: approved, assignment: draftAssignment }).allowed).toBe(true);
    for (const action of ['compile', 'execute'] as const) {
      expect(evaluateLifecycleTransition({ action, workflow: approved, graph: approved, assignment: draftAssignment }).allowed).toBe(false);
      expect(evaluateLifecycleTransition({ action, workflow: approved, graph: approved, assignment: readyAssignment }).allowed).toBe(true);
    }
  });

  it('blocks missing approval records and stale definition or assignment versions', () => {
    const { approved, readyAssignment } = lifecycleFixtures();
    const missingApproval = { ...readyAssignment, approval: undefined };
    expect(evaluateLifecycleTransition({ action: 'compile', workflow: approved, assignment: missingApproval }).errors.join(' ')).toContain('approval metadata is missing');

    const staleDefinition = { ...approved, version: (approved.version ?? 1) + 1, definitionApproval: undefined };
    const stale = evaluateLifecycleTransition({ action: 'execute', workflow: staleDefinition, graph: staleDefinition, assignment: readyAssignment });
    expect(stale.allowed).toBe(false);
    expect(stale.errors.join(' ')).toContain('pins workflow version');

    const staleConfiguration = { ...readyAssignment, configurationVersion: (readyAssignment.configurationVersion ?? 1) + 1 };
    expect(evaluateLifecycleTransition({ action: 'execute', workflow: approved, assignment: staleConfiguration }).errors.join(' ')).toContain('configuration changed');
  });
});
