import { describe, expect, it } from 'vitest';
import { validateWorkflowGraph, workflowExternalInputKeys, type WorkflowPlan } from '@/src/domain/models';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';

function graph(): WorkflowPlan {
  return structuredClone(STARTER_WORKFLOWS[0]);
}

describe('Phase 3 graph approval validation', () => {
  it('accepts a reachable graph with explicit success and failure outcomes', () => {
    expect(validateWorkflowGraph(graph()).errors).toEqual([]);
  });

  it('catches missing inputs, unreachable nodes, and incomplete paths', () => {
    const plan = graph();
    plan.nodes[1].inputKeys = ['missing-report'];
    plan.edges = plan.edges.filter((edge) => edge.to !== plan.nodes[2].id);
    plan.nodes.push({ id: 'orphan', name: 'Orphan step', type: 'agent', prompt: 'Do work.', skillIds: [], inputKeys: [], outputKeys: ['missing-report'], retryLimit: 1, requiresApproval: false });
    plan.nodes.push({ id: 'dead-end', name: 'Dead end', type: 'agent', prompt: 'Stop too early.', skillIds: [], inputKeys: [], outputKeys: [], retryLimit: 1, requiresApproval: false });
    plan.edges.push({ from: 'orphan', to: plan.nodes[2].id }, { from: plan.nodes[2].id, to: 'orphan' }, { from: plan.nodes[0].id, to: 'dead-end' });
    const errors = validateWorkflowGraph(plan).errors.join(' ');
    expect(errors).toContain('missing input');
    expect(errors).toContain('unreachable');
    expect(errors).toContain('incomplete');
    expect(errors).toContain('reachable failure node');
  });

  it('rejects cycles outside a bounded loop node', () => {
    const plan = graph();
    plan.edges.push({ from: plan.nodes[1].id, to: plan.nodes[0].id, condition: 'retry' });
    const unboundedErrors = validateWorkflowGraph(plan).errors.join(' ');
    expect(unboundedErrors).toContain('cycle outside a bounded loop');
    expect(unboundedErrors).not.toContain('Node is unreachable');
    plan.nodes[1].type = 'loop';
    expect(validateWorkflowGraph(plan).errors.join(' ')).not.toContain('cycle outside a bounded loop');
  });

  it('treats bounded revision edges as backedges and validates only true assignment inputs', () => {
    const timestamp = '2026-09-01T00:00:00.000Z';
    const plan: WorkflowPlan = {
      id: 'loop-aware-review', schemaVersion: 1, name: 'Loop-aware review', description: 'Review with supplied context.', planningPrompt: 'Review requirements.', workspacePath: 'C:\\projects\\review', constraints: [], openQuestions: [], completionCriteria: ['Approved.'],
      nodes: [
        { id: 'inspect', name: 'Inspect requirements', type: 'agent', prompt: 'Inspect.', skillIds: [], inputKeys: ['requirementsSources', 'contextResponse'], outputKeys: ['review'], retryLimit: 0, requiresApproval: false },
        { id: 'context', name: 'Receive context', type: 'approval', prompt: 'Receive context.', skillIds: [], inputKeys: ['review'], outputKeys: ['contextResponse'], retryLimit: 0, requiresApproval: true },
        { id: 'decision', name: 'Reassess', type: 'loop', prompt: 'Choose a route.', skillIds: [], inputKeys: ['review', 'contextResponse'], outputKeys: ['decision'], retryLimit: 0, requiresApproval: false },
        { id: 'success', name: 'Approved', type: 'success', prompt: 'Finish.', skillIds: [], inputKeys: ['decision'], outputKeys: ['result'], retryLimit: 0, requiresApproval: false },
        { id: 'failure', name: 'Blocked', type: 'failure', prompt: 'Stop.', skillIds: [], inputKeys: ['decision'], outputKeys: ['reason'], retryLimit: 0, requiresApproval: false }
      ],
      edges: [
        { from: 'inspect', to: 'context' }, { from: 'context', to: 'decision' }, { from: 'decision', to: 'inspect', condition: 'revise' },
        { from: 'decision', to: 'success', condition: 'accepted' }, { from: 'decision', to: 'failure', condition: 'blocked' }
      ],
      harness: { sandboxMode: 'read-only', maxRetries: 0, maxLoopIterations: 2, maxConcurrentNodes: 1, allowedTools: [], allowedWorkspacePaths: ['C:\\projects\\review'], requireApprovalForDestructiveActions: true },
      status: 'approved', createdAt: timestamp, updatedAt: timestamp
    };
    expect(workflowExternalInputKeys(plan)).toEqual(['requirementsSources']);
    expect(validateWorkflowGraph(plan).errors).toEqual([]);

    const project = createProject({ id: 'review-project', name: 'Review', rootPath: plan.workspacePath, workspaceKind: 'workspace' });
    const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: 'Review', status: 'published' });
    const missingInput = createProjectWorkflow({ project, workflow, graphOverride: plan, permissions: { allowedWorkspacePaths: [project.rootPath] } });
    expect(validateWorkflowGraph(plan, [], missingInput).errors).toEqual([]);

    const ready = createProjectWorkflow({ project, workflow, graphOverride: plan, inputOverrides: { requirementsSources: project.rootPath }, permissions: { allowedWorkspacePaths: [project.rootPath] } });
    expect(validateWorkflowGraph(plan, [], ready).errors).toEqual([]);
  });

  it('treats an entry value normalized by the same node as an external assignment input', () => {
    const plan = graph();
    plan.nodes[0].inputKeys = ['traceabilityTargets'];
    plan.nodes[0].outputKeys = ['traceabilityTargets', ...plan.nodes[0].outputKeys];
    expect(workflowExternalInputKeys(plan)).toContain('traceabilityTargets');
    expect(validateWorkflowGraph(plan).errors.join(' ')).not.toContain('traceabilityTargets');
  });

  it('allows downstream loop-carried context as conditional data and warns about the first pass', () => {
    const plan = graph();
    const entry = plan.nodes[0];
    const decision = { id: 'context-decision', name: 'Check context', type: 'validation' as const, prompt: 'Check context.', skillIds: [], inputKeys: [...entry.outputKeys], outputKeys: ['contextDecision'], retryLimit: 0, requiresApproval: false };
    const success = { ...plan.nodes.find((node) => node.type === 'success')!, inputKeys: ['inspection'] };
    const failure = plan.nodes.find((node) => node.type === 'failure')!;
    const contextLoop = { id: 'context-loop', name: 'Request context', type: 'loop' as const, prompt: 'Request missing context.', skillIds: [], inputKeys: [...decision.outputKeys], outputKeys: ['contextResponses'], retryLimit: 0, requiresApproval: false };
    const inspect = { id: 'inspect-context', name: 'Inspect with context', type: 'agent' as const, prompt: 'Inspect with optional supplied context.', skillIds: [], inputKeys: [...decision.outputKeys, 'contextResponses'], outputKeys: ['inspection'], retryLimit: 0, requiresApproval: false };
    plan.nodes = [entry, decision, contextLoop, inspect, success, failure];
    plan.edges = [
      { from: entry.id, to: decision.id },
      { from: decision.id, to: inspect.id, condition: 'sufficient' },
      { from: decision.id, to: contextLoop.id, condition: 'missing' },
      { from: contextLoop.id, to: decision.id, condition: 'supplied' },
      { from: contextLoop.id, to: failure.id, condition: 'unresolved' },
      { from: inspect.id, to: success.id, condition: 'accepted' },
      { from: inspect.id, to: failure.id, condition: 'blocked' }
    ];
    const validation = validateWorkflowGraph(plan);
    expect(validation.errors.join(' ')).not.toContain('contextResponses');
    expect(validation.warnings.join(' ')).toContain('contextResponses only after a loop');
  });

  it('allows a bounded revision cycle to update state without reporting duplicate producers or false first-pass warnings', () => {
    const plan = graph();
    const work = plan.nodes[0];
    const success = { ...plan.nodes[1], inputKeys: ['result'] };
    const failure = plan.nodes[2];
    const revision = { id: 'revision-loop', name: 'Revise result', type: 'loop' as const, prompt: 'Revise the result or choose an outcome.', skillIds: [], inputKeys: ['result'], outputKeys: ['result', 'decision'], retryLimit: 0, requiresApproval: false };
    plan.nodes = [work, revision, success, failure];
    plan.edges = [
      { from: work.id, to: revision.id },
      { from: revision.id, to: work.id, condition: 'revise' },
      { from: revision.id, to: success.id, condition: 'accepted' },
      { from: revision.id, to: failure.id, condition: 'blocked' }
    ];

    const validation = validateWorkflowGraph(plan);
    expect(validation.errors.join(' ')).not.toContain('multiple producers');
    expect(validation.warnings.join(' ')).not.toContain('result only after a loop');
  });

  it('supports canonical state updates across consecutive bounded revision cycles', () => {
    const plan = graph();
    const initial = plan.nodes[0];
    const success = { ...plan.nodes[1], inputKeys: ['artifact'] };
    const failure = plan.nodes[2];
    const revise = { id: 'revise', name: 'Revise prompts', type: 'loop' as const, prompt: 'Revise prompts.', skillIds: [], inputKeys: ['result'], outputKeys: ['result'], retryLimit: 0, requiresApproval: false };
    const generate = { id: 'generate', name: 'Generate screens', type: 'agent' as const, prompt: 'Generate screens.', skillIds: [], inputKeys: ['result'], outputKeys: ['artifact'], retryLimit: 0, requiresApproval: false };
    const regenerate = { id: 'regenerate', name: 'Regenerate screens', type: 'loop' as const, prompt: 'Regenerate screens.', skillIds: [], inputKeys: ['result', 'artifact'], outputKeys: ['result', 'artifact'], retryLimit: 0, requiresApproval: false };
    plan.nodes = [initial, revise, generate, regenerate, success, failure];
    plan.edges = [
      { from: initial.id, to: revise.id },
      { from: revise.id, to: initial.id, condition: 'revise prompts' },
      { from: revise.id, to: generate.id, condition: 'prompts accepted' },
      { from: generate.id, to: regenerate.id },
      { from: regenerate.id, to: generate.id, condition: 'regenerate' },
      { from: regenerate.id, to: success.id, condition: 'accepted' },
      { from: regenerate.id, to: failure.id, condition: 'blocked' }
    ];

    expect(validateWorkflowGraph(plan).errors.join(' ')).not.toContain('multiple producers');
  });
});
