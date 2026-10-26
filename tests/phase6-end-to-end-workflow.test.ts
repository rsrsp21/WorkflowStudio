import { describe, expect, it } from 'vitest';
import type { WorkflowPlan } from '@/src/domain/models';
import { compileWorkflowRun } from '@/src/domain/runtime';
import { completeNode, decideRuntimeApprovalByKeyword, resumeRuntimeApproval, startNextNode } from '@/src/domain/runtime-engine';
import { createProject, createProjectWorkflow, createSkill, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

const actor = { id: 'product-owner', name: 'Product owner', role: 'reviewer' };

describe('Phase 6 representative end-to-end workflow', () => {
  it('runs skill stages, a custom revision loop, approvals, verification, and completion', () => {
    const rootPath = 'C:\\projects\\generic-planning';
    const requirementsSkill = createSkill({ id: 'common-requirements-generator', familyId: 'requirements', name: 'Requirements generator', instructions: 'Create requirements.', version: 2, status: 'published', source: 'Installed Codex skill' });
    const designSkill = createSkill({ id: 'common-design-generator', familyId: 'design', name: 'Design generator', instructions: 'Create design guidance.', version: 4, status: 'published', source: 'Installed Codex skill' });
    const plan: WorkflowPlan = {
      id: 'generic-product-plan', schemaVersion: 1, name: 'Generic product planning', description: 'An editable example of a user-authored multi-skill workflow.', version: 1,
      planningPrompt: 'Create planning artifacts with explicit review gates.', workspacePath: rootPath, constraints: [], openQuestions: [], completionCriteria: ['Requirements and design are explicitly approved.'], completionContract: { requiredOutputKeys: ['handoff'], requiredArtifacts: [] },
      nodes: [
        { id: 'requirements', name: 'Create requirements', type: 'agent', prompt: 'Create the PRD and requirements.', skillIds: [requirementsSkill.id], inputKeys: ['brief'], outputKeys: ['requirements'], outputSchemas: { requirements: 'object' }, retryLimit: 1, requiresApproval: false },
        { id: 'requirements_gate', name: 'Review requirements', type: 'approval', prompt: 'Choose the exact next route.', skillIds: [], inputKeys: ['requirements'], outputKeys: ['requirementsDecision'], outputSchemas: { requirementsDecision: 'string' }, retryLimit: 0, requiresApproval: true, approvalOptions: [{ id: 'continue-design', label: 'Continue to design', keyword: 'CONTINUE TO DESIGN', action: 'continue' }, { id: 'revise-requirements', label: 'Revise requirements', keyword: 'REVISE REQUIREMENTS', action: 'revise' }, { id: 'stop', label: 'Stop', keyword: 'STOP', action: 'stop' }] },
        { id: 'requirements_revision', name: 'Revise requirements', type: 'loop', prompt: 'Apply the reviewer feedback to the requirements artifact.', skillIds: [requirementsSkill.id], inputKeys: ['requirements', 'requirementsDecision'], outputKeys: ['revisionNotes'], outputSchemas: { revisionNotes: 'string' }, retryLimit: 1, requiresApproval: false },
        { id: 'design', name: 'Create design', type: 'agent', prompt: 'Create design guidance from approved requirements.', skillIds: [designSkill.id], inputKeys: ['requirements'], outputKeys: ['design'], outputSchemas: { design: 'object' }, retryLimit: 1, requiresApproval: false },
        { id: 'design_gate', name: 'Review design', type: 'approval', prompt: 'Approve the planning handoff.', skillIds: [], inputKeys: ['design'], outputKeys: ['designDecision'], outputSchemas: { designDecision: 'string' }, retryLimit: 0, requiresApproval: true, approvalOptions: [{ id: 'approve', label: 'Approve plan', keyword: 'APPROVE PLAN', action: 'continue' }, { id: 'stop', label: 'Stop', keyword: 'STOP', action: 'stop' }] },
        { id: 'success', name: 'Planning approved', type: 'success', prompt: 'Package the approved handoff.', skillIds: [], inputKeys: ['requirements', 'design'], outputKeys: ['handoff'], outputSchemas: { handoff: 'object' }, retryLimit: 0, requiresApproval: false },
        { id: 'failure', name: 'Planning stopped', type: 'failure', prompt: 'Record the decision.', skillIds: [], inputKeys: [], outputKeys: ['blocked'], outputSchemas: { blocked: 'string' }, retryLimit: 0, requiresApproval: false }
      ],
      edges: [
        { from: 'requirements', to: 'requirements_gate' },
        { from: 'requirements_gate', to: 'design', condition: 'CONTINUE TO DESIGN' },
        { from: 'requirements_gate', to: 'requirements_revision', condition: 'REVISE REQUIREMENTS' },
        { from: 'requirements_gate', to: 'failure', condition: 'STOP' },
        { from: 'requirements_revision', to: 'requirements_gate', condition: 'REVIEW AGAIN' },
        { from: 'design', to: 'design_gate' },
        { from: 'design_gate', to: 'success', condition: 'APPROVE PLAN' },
        { from: 'design_gate', to: 'failure', condition: 'STOP' }
      ],
      harness: { sandboxMode: 'read-only', maxRetries: 1, maxLoopIterations: 2, maxConcurrentNodes: 1, allowedTools: ['workspace.read'], allowedWorkspacePaths: [rootPath], requireApprovalForDestructiveActions: true, adaptationEnabled: true, adaptationScope: 'project' },
      status: 'approved', createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z'
    };
    const project = createProject({ id: 'generic-project', name: 'Generic project', rootPath, workspaceKind: 'repository' });
    const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: 'General', status: 'published', defaultSkillVersions: [{ skillId: requirementsSkill.id, version: 2 }, { skillId: designSkill.id, version: 4 }] });
    const assignment = createProjectWorkflow({ id: 'generic-assignment', project, workflow, status: 'ready', approval: testAssignmentApproval(), graphOverride: plan, inputOverrides: { brief: 'Create a product plan.' }, permissions: { sandboxMode: 'read-only', allowedTools: ['workspace.read'], allowedWorkspacePaths: [rootPath], requireApprovalForDestructiveActions: true }, selectedSkills: [requirementsSkill, designSkill] });
    const compiled = compileWorkflowRun('workflow-owner', plan, assignment, [requirementsSkill, designSkill]);
    if (!compiled.run) throw new Error(compiled.errors.join(' '));

    const requirements = startNextNode(compiled.run, '2026-09-04T10:00:00.000Z');
    const requirementsDone = completeNode(requirements.run, 'requirements', { requirements: { title: 'Approved product' } }, '', '2026-09-04T10:01:00.000Z');
    const firstGate = startNextNode(requirementsDone.run, '2026-09-04T10:02:00.000Z');
    const revisionChosen = decideRuntimeApprovalByKeyword(firstGate.run, 'requirements_gate', 'REVISE REQUIREMENTS', actor, 'Add measurable acceptance criteria.', '2026-09-04T10:03:00.000Z');
    const revisionRouted = resumeRuntimeApproval(revisionChosen, 'requirements_gate', actor, '2026-09-04T10:04:00.000Z');
    const revision = startNextNode(revisionRouted, '2026-09-04T10:05:00.000Z');
    const revised = completeNode(revision.run, 'requirements_revision', { revisionNotes: 'Acceptance criteria added.' }, 'REVIEW AGAIN', '2026-09-04T10:06:00.000Z');
    const secondGate = startNextNode(revised.run, '2026-09-04T10:07:00.000Z');
    const continueChosen = decideRuntimeApprovalByKeyword(secondGate.run, 'requirements_gate', 'CONTINUE TO DESIGN', actor, '', '2026-09-04T10:08:00.000Z');
    const continueRouted = resumeRuntimeApproval(continueChosen, 'requirements_gate', actor, '2026-09-04T10:09:00.000Z');
    const design = startNextNode(continueRouted, '2026-09-04T10:10:00.000Z');
    const designDone = completeNode(design.run, 'design', { design: { system: 'Workflow UI' } }, '', '2026-09-04T10:11:00.000Z');
    const designGate = startNextNode(designDone.run, '2026-09-04T10:12:00.000Z');
    const approved = decideRuntimeApprovalByKeyword(designGate.run, 'design_gate', 'APPROVE PLAN', actor, '', '2026-09-04T10:13:00.000Z');
    const approvedRoute = resumeRuntimeApproval(approved, 'design_gate', actor, '2026-09-04T10:14:00.000Z');
    const success = startNextNode(approvedRoute, '2026-09-04T10:15:00.000Z');
    const finished = completeNode(success.run, 'success', { handoff: { requirements: true, design: true } }, '', '2026-09-04T10:16:00.000Z');

    expect(finished.run.status).toBe('completed');
    expect(finished.run.loopIterations.requirements_revision).toBe(1);
    expect(finished.run.approvalRecords.map((item) => item.keyword)).toEqual(['REVISE REQUIREMENTS', 'CONTINUE TO DESIGN', 'APPROVE PLAN']);
    expect(finished.run.adaptationCandidates).toEqual([expect.objectContaining({ scope: 'project', status: 'proposed', summary: expect.stringContaining('acceptance criteria') })]);
    expect(finished.run.verificationResults.filter((result) => result.status === 'passed')).toHaveLength(7);
    expect(finished.run.compiledWorkflow.nodes.flatMap((node) => node.skillVersions)).toEqual(expect.arrayContaining([{ skillId: requirementsSkill.id, version: 2 }, { skillId: designSkill.id, version: 4 }]));
  });
});
