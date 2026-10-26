import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import RunSummaryPage from '@/src/components/run-summary-page';
import type { WorkflowPlan } from '@/src/domain/models';
import { compileWorkflowRun } from '@/src/domain/runtime';
import { completeNode, decideRuntimeApproval, decideRuntimeApprovalByKeyword, resumeRuntimeApproval, startNextNode } from '@/src/domain/runtime-engine';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';
import { updateRunExecutionSettings } from '@/src/domain/run-execution-settings';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const actor = { id: 'reviewer-1', name: 'Release reviewer', role: 'reviewer' };

function approvalRun() {
  const rootPath = 'C:\\projects\\phase-six';
  const definitionApproval = { approvedAt: '2026-09-03T09:00:00.000Z', approvedBy: actor, workflowVersion: 1 };
  const plan: WorkflowPlan = {
    id: 'phase-six-plan', schemaVersion: 1, name: 'Approval lifecycle', description: 'Exercise a human runtime checkpoint.', version: 1,
    planningPrompt: 'Prepare and approve a release.', workspacePath: rootPath, constraints: [], openQuestions: ['Which release channel?'], questionResponses: [],
    completionCriteria: ['A decision is recorded.'], definitionApproval,
    nodes: [
      { id: 'prepare', name: 'Prepare release', type: 'codex', prompt: 'Prepare the release evidence.', skillIds: [], inputKeys: ['project'], outputKeys: ['draft'], outputSchemas: { draft: 'string' }, retryLimit: 1, requiresApproval: false },
      { id: 'approve', name: 'Approve release', type: 'approval', prompt: 'Review the evidence and decide.', skillIds: [], inputKeys: ['draft'], outputKeys: ['decision'], outputSchemas: { decision: 'string' }, retryLimit: 0, requiresApproval: true },
      { id: 'revise', name: 'Revise release', type: 'loop', prompt: 'Apply approval feedback and return for review.', skillIds: [], inputKeys: ['decision'], outputKeys: ['revisionNotes'], retryLimit: 0, requiresApproval: false },
      { id: 'success', name: 'Release approved', type: 'success', prompt: 'Record approval.', skillIds: [], inputKeys: ['decision'], outputKeys: ['accepted'], retryLimit: 0, requiresApproval: false },
      { id: 'failure', name: 'Release blocked', type: 'failure', prompt: 'Record rejection.', skillIds: [], inputKeys: ['decision'], outputKeys: ['reason'], retryLimit: 0, requiresApproval: false }
    ],
    edges: [
      { from: 'prepare', to: 'approve' },
      { from: 'approve', to: 'success', condition: 'approved' },
      { from: 'approve', to: 'revise', condition: 'revision requested' },
      { from: 'revise', to: 'approve', condition: 'retry' },
      { from: 'approve', to: 'failure', condition: 'rejected' }
    ],
    harness: { sandboxMode: 'read-only', maxRetries: 1, maxLoopIterations: 2, maxConcurrentNodes: 1, allowedTools: [], allowedWorkspacePaths: [rootPath], requireApprovalForDestructiveActions: true },
    status: 'approved', createdAt: '2026-09-03T08:00:00.000Z', updatedAt: '2026-09-03T09:00:00.000Z'
  };
  const project = createProject({ id: 'phase-six-project', name: 'Phase six', rootPath, workspaceKind: 'repository', createdAt: '2026-09-03T08:30:00.000Z' });
  const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: 'Engineering', status: 'published', version: 1 });
  const assignmentApproval = testAssignmentApproval(workflow.version, 1);
  const assignment = createProjectWorkflow({ id: 'phase-six-assignment', project, workflow, status: 'ready', approval: assignmentApproval, graphOverride: plan, inputOverrides: { project: rootPath }, permissions: { sandboxMode: 'read-only', allowedWorkspacePaths: [rootPath], requireApprovalForDestructiveActions: true } });
  const compiled = compileWorkflowRun('phase-six-user', plan, assignment, []);
  if (!compiled.run) throw new Error(compiled.errors.join(' '));
  return compiled.run;
}

function waitingRun() {
  const compiled = approvalRun();
  const started = startNextNode(compiled, '2026-09-03T10:00:00.000Z');
  const prepared = completeNode(started.run, 'prepare', { draft: 'Release evidence' }, '', '2026-09-03T10:01:00.000Z');
  return startNextNode(prepared.run, '2026-09-03T10:02:00.000Z').run;
}

describe('Phase 6 live runs and runtime approvals', () => {
  it('keeps the human gate open at the revision limit and allows continuing with accepted tradeoffs', () => {
    const waiting = waitingRun();
    waiting.loopIterations.revise = 2;
    const before = structuredClone(waiting);
    expect(() => decideRuntimeApproval(waiting, 'approve', 'revision-requested', actor, 'One more revision')).toThrow('revision limit');
    expect(waiting).toEqual(before);
    expect(waiting.status).toBe('paused');
    const accepted = decideRuntimeApproval(waiting, 'approve', 'approved', actor, 'Accept current results with recorded tradeoffs');
    expect(resumeRuntimeApproval(accepted, 'approve', actor).nodeRuns.find((node) => node.nodeId === 'success')?.status).toBe('pending');

    const gate = waiting.compiledWorkflow.nodes.find((node) => node.id === 'approve')!;
    gate.approvalOptions = [{ id: 'continue', label: 'Continue', keyword: 'approved', action: 'continue' }, { id: 'revise', label: 'Revise', keyword: 'revision requested', action: 'revise' }, { id: 'stop', label: 'Stop', keyword: 'rejected', action: 'stop' }];
    expect(() => decideRuntimeApprovalByKeyword(waiting, 'approve', 'revision requested', actor, 'Revise')).toThrow('revision limit');
    expect(decideRuntimeApprovalByKeyword(waiting, 'approve', 'approved', actor).approvalRecords.at(-1)?.decision).toBe('approved');
    expect(decideRuntimeApprovalByKeyword(waiting, 'approve', 'rejected', actor, 'Stop here').approvalRecords.at(-1)?.decision).toBe('rejected');
    const extended = updateRunExecutionSettings(waiting, { modelSettings: {}, harness: { ...waiting.compiledWorkflow.harness, maxLoopIterations: 3 } }, actor, 0);
    expect(decideRuntimeApprovalByKeyword(extended, 'approve', 'revision requested', actor, 'Only revise selected items').approvalRecords.at(-1)?.decision).toBe('revision-requested');
  });
  it('snapshots planning context and separate definition and assignment approvals', () => {
    const run = approvalRun();
    expect(run.lifecycleContext).toMatchObject({
      planning: { unresolvedQuestions: ['Which release channel?'], answeredQuestionCount: 0 },
      definitionApproval: { workflowVersion: 1, approvedBy: actor },
      assignmentApproval: { workflowVersion: 1, configurationVersion: 1 }
    });
  });

  it('persists an approval actor and resumes through the approved route', () => {
    const waiting = waitingRun();
    expect(waiting).toMatchObject({ status: 'paused', nodeRuns: expect.arrayContaining([expect.objectContaining({ nodeId: 'approve', status: 'waiting-approval' })]) });
    expect(waiting.approvalRecords).toHaveLength(1);

    const decided = decideRuntimeApproval(waiting, 'approve', 'approved', actor, 'Evidence is complete.', '2026-09-03T10:03:00.000Z');
    expect(decided.approvalRecords[0]).toMatchObject({ decision: 'approved', decidedBy: actor, feedback: 'Evidence is complete.' });
    const resumed = resumeRuntimeApproval(decided, 'approve', actor, '2026-09-03T10:04:00.000Z');
    expect(resumed.nodeRuns.find((node) => node.nodeId === 'approve')).toMatchObject({ status: 'completed', output: { decision: 'approved' }, selectedCondition: 'approved' });
    expect(resumed.edgeRuns.find((edge) => edge.from === 'approve' && edge.to === 'success')).toMatchObject({ status: 'selected', traversalCount: 1 });
    expect(resumed.approvalRecords[0]).toMatchObject({ resumedBy: actor, resumedAt: '2026-09-03T10:04:00.000Z' });
    expect(resumed.events.map((event) => event.type)).toEqual(expect.arrayContaining(['node.waiting-approval', 'approval.approved', 'approval.resumed', 'route.selected']));
  });

  it('requires feedback for rejection and terminates only when the decision is resumed', () => {
    const waiting = waitingRun();
    expect(() => decideRuntimeApproval(waiting, 'approve', 'rejected', actor)).toThrow('Feedback is required');
    const rejected = decideRuntimeApproval(waiting, 'approve', 'rejected', actor, 'Security review failed.', '2026-09-03T10:03:00.000Z');
    expect(rejected.status).toBe('paused');
    const resumed = resumeRuntimeApproval(rejected, 'approve', actor, '2026-09-03T10:04:00.000Z');
    expect(resumed.status).toBe('failed');
    expect(resumed.nodeRuns.find((node) => node.nodeId === 'approve')).toMatchObject({ status: 'failed', failureKind: 'human-rejection', error: 'Security review failed.' });
  });

  it('routes revision feedback through the bounded approval loop', () => {
    const waiting = waitingRun();
    const decided = decideRuntimeApproval(waiting, 'approve', 'revision-requested', actor, 'Add rollback evidence.', '2026-09-03T10:03:00.000Z');
    const resumed = resumeRuntimeApproval(decided, 'approve', actor, '2026-09-03T10:04:00.000Z');
    expect(resumed.edgeRuns.find((edge) => edge.from === 'approve' && edge.to === 'revise')).toMatchObject({ status: 'selected' });
    const revision = startNextNode(resumed, '2026-09-03T10:05:00.000Z');
    const looped = completeNode(revision.run, 'revise', { revisionNotes: 'Rollback evidence added.' }, 'retry', '2026-09-03T10:06:00.000Z');
    expect(looped.kind).toBe('looped');
    const requestedAgain = startNextNode(looped.run, '2026-09-03T10:07:00.000Z');
    expect(requestedAgain).toMatchObject({ kind: 'waiting-approval', nodeRun: { nodeId: 'approve', iteration: 1 } });
    expect(requestedAgain.run.approvalRecords).toHaveLength(2);
  });

  it('renders lifecycle, live status, node inspection, activity, and approval controls together', () => {
    const html = renderToStaticMarkup(<RunSummaryPage run={waitingRun()} />);
    expect(html).toContain('Lifecycle timeline');
    expect(html).toContain('Unresolved context retained');
    expect(html).toContain('not a graph failure');
    expect(html).toContain('Approval Waiting');
    expect(html).toContain('Resolved inputs');
    expect(html).toContain('Codex activity');
    expect(html).toContain('Human decision required');
    expect(html).toContain('Request revision');
    expect(html).toContain('Approve');
  });
});
