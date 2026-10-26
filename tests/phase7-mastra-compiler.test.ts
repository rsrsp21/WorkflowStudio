import { describe, expect, it } from 'vitest';
import { LocalMastraAdapter, MASTRA_ENGINE, MASTRA_VERSION, MastraCapabilityError, type MastraExecutionInput } from '@/src/adapters/mastra-adapter';
import type { WorkflowPlan } from '@/src/domain/models';
import { hydrateWorkflowRun, validateWorkflowRun } from '@/src/domain/runtime';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

const rootPath = 'C:\\projects\\mastra-compiler';

function plan(): WorkflowPlan {
  return {
    id: 'mastra-plan', schemaVersion: 1, name: 'Mastra compilation', description: 'Compile a routed definition.',
    planningPrompt: 'Compile the approved graph.', workspacePath: rootPath, constraints: [], openQuestions: [], completionCriteria: ['A terminal outcome is recorded.'],
    nodes: [
      { id: 'inspect', name: 'Inspect', type: 'codex', prompt: 'Inspect the project.', skillIds: [], inputKeys: ['project'], outputKeys: ['inventory'], outputSchemas: { inventory: 'array' }, requiredArtifacts: ['Inventory'], retryLimit: 2, requiresApproval: false },
      { id: 'decision', name: 'Decision', type: 'validation', prompt: 'Choose a route.', skillIds: [], inputKeys: ['inventory'], outputKeys: ['decision'], outputSchemas: { decision: 'string' }, retryLimit: 0, requiresApproval: false },
      { id: 'success', name: 'Accepted', type: 'success', prompt: 'Record success.', skillIds: [], inputKeys: ['decision'], outputKeys: ['result'], retryLimit: 0, requiresApproval: false },
      { id: 'failure', name: 'Blocked', type: 'failure', prompt: 'Record failure.', skillIds: [], inputKeys: ['decision'], outputKeys: ['reason'], retryLimit: 0, requiresApproval: false }
    ],
    edges: [
      { from: 'inspect', to: 'decision' },
      { from: 'decision', to: 'success', condition: 'accepted' },
      { from: 'decision', to: 'failure', condition: 'blocked' }
    ],
    harness: { sandboxMode: 'read-only', maxRetries: 2, maxLoopIterations: 3, maxConcurrentNodes: 1, allowedTools: [], allowedWorkspacePaths: [rootPath], requireApprovalForDestructiveActions: true },
    status: 'approved', createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z'
  };
}

function assignmentFor(source: WorkflowPlan) {
  const project = createProject({ id: 'mastra-project', name: 'Mastra project', rootPath, workspaceKind: 'workspace' });
  const workflow = createWorkflow({ id: source.id, name: source.name, domain: 'Testing', status: 'published' });
  return createProjectWorkflow({
    id: 'mastra-assignment', project, workflow, status: 'ready', graphOverride: source,
    approval: testAssignmentApproval(workflow.version), inputOverrides: { project: rootPath },
    permissions: { sandboxMode: 'read-only', allowedWorkspacePaths: [rootPath], requireApprovalForDestructiveActions: true }
  });
}

describe('Phase 7 Mastra definition compiler', () => {
  it('registers a validated workflow with stable traceable identifiers', async () => {
    const source = plan();
    const assignment = assignmentFor(source);
    const adapter = new LocalMastraAdapter();
    const first = await adapter.compile('owner', source, assignment, [], 'run_mastra-one');
    const second = await adapter.compile('owner', { ...source, nodes: [...source.nodes].reverse(), edges: [...source.edges].reverse() }, assignment, [], 'run_mastra-two');

    expect(first.errors).toEqual([]);
    expect(first.registration).toBeDefined();
    expect(second.registration?.fingerprint).toBe(first.registration?.fingerprint);
    expect(first.registration).toMatchObject({
      engine: MASTRA_ENGINE,
      engineVersion: MASTRA_VERSION,
      definitionId: 'mastra-plan-v1',
      assignmentId: assignment.id,
      registrationKey: 'mastra-plan-v1-mastra-assignment-c1',
      entryStepIds: ['mastra-plan-v1--inspect']
    });
    expect(first.registration?.steps.find((step) => step.nodeId === 'inspect')).toMatchObject({
      stepId: 'mastra-plan-v1--inspect', retryLimit: 2, outputSchemas: { inventory: 'array' }, requiredArtifacts: ['Inventory']
    });
    expect(first.registration?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromStepId: 'mastra-plan-v1--decision', toStepId: 'mastra-plan-v1--success', condition: 'accepted', loopBack: false })
    ]));
    expect(adapter.inspect(first.registration!.registrationKey)).toEqual(first.registration);
    expect(adapter.diagnostics()).toMatchObject({ engine: 'mastra', engineVersion: '1.65.0', registeredWorkflowCount: 1 });
    const historical = structuredClone(first.run!);
    delete historical.runtimeEngine;
    const hydrated = hydrateWorkflowRun(historical);
    expect(hydrated.runtimeEngine).toEqual({ name: 'mastra', version: 1 });
    expect(validateWorkflowRun(hydrated)).toEqual([]);
  });

  it('rejects an invalid graph before registering it', async () => {
    const source = plan();
    source.edges.push({ from: 'success', to: 'inspect' });
    const adapter = new LocalMastraAdapter();
    const result = await adapter.compile('owner', source, assignmentFor(source), []);
    expect(result.run).toBeUndefined();
    expect(result.registration).toBeUndefined();
    expect(result.errors.join(' ')).toContain('Terminal node cannot have a continuation');
    expect(adapter.diagnostics().registeredWorkflowCount).toBe(0);
  });

  it('exposes an explicit fail-closed start boundary when no node executor is installed', async () => {
    const adapter = new LocalMastraAdapter();
    await expect(adapter.start('definition', 'run', {} as MastraExecutionInput)).rejects.toMatchObject({
      name: 'MastraCapabilityError', code: 'MASTRA_CAPABILITY_UNAVAILABLE', operation: 'start', phaseTask: 'P7-T03'
    } satisfies Partial<MastraCapabilityError>);
    await expect(adapter.cancel('owner', 'run')).rejects.toThrow('Run was not found');
    expect(adapter.diagnostics().operations).toMatchObject({ start: 'phase-pending', suspend: 'available', resume: 'available', cancel: 'available', recover: 'available' });
  });
});
