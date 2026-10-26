import { describe, expect, it } from 'vitest';
import { evaluateLifecycleTransition } from '@/src/domain/lifecycle-policy';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';

describe('Phase 5 lifecycle policy', () => {
  it('allows draft persistence and explicit continuation with unresolved questions', () => {
    const workflow = structuredClone(STARTER_WORKFLOWS[0]);
    workflow.openQuestions = ['Which evidence source should be preferred?'];
    workflow.questionResponses = [{ question: workflow.openQuestions[0], answer: '' }];

    expect(evaluateLifecycleTransition({ action: 'save-draft', workflow })).toMatchObject({ allowed: true, errors: [] });
    expect(evaluateLifecycleTransition({ action: 'continue-unresolved', workflow })).toMatchObject({ allowed: true, errors: [] });
  });

  it('approves a valid reusable graph without a project assignment', () => {
    const workflow = structuredClone(STARTER_WORKFLOWS[0]);
    workflow.openQuestions = ['This may remain unresolved.'];
    expect(evaluateLifecycleTransition({ action: 'approve-definition', workflow })).toMatchObject({ allowed: true, errors: [] });
  });

  it('keeps assignment and execution gates separate from definition approval', () => {
    const workflow = structuredClone(STARTER_WORKFLOWS[0]);
    expect(evaluateLifecycleTransition({ action: 'create-assignment', workflow }).errors).toContain('Approve the reusable workflow graph before creating a project assignment.');

    workflow.status = 'approved';
    expect(evaluateLifecycleTransition({ action: 'create-assignment', workflow }).allowed).toBe(true);
    expect(evaluateLifecycleTransition({ action: 'compile', workflow }).errors).toContain('Create a project assignment before continuing.');

    const project = createProject({ name: 'Project', rootPath: workflow.workspacePath, workspaceKind: 'workspace' });
    const definition = createWorkflow({ id: workflow.id, name: workflow.name, domain: workflow.domain ?? 'General', status: 'published' });
    const assignment = createProjectWorkflow({ project, workflow: definition, status: 'draft' });
    expect(evaluateLifecycleTransition({ action: 'compile', workflow, assignment }).errors).toContain('Approve the project assignment before compilation or execution.');
  });
});
