import { describe, expect, it } from 'vitest';
import { LocalMastraAdapter } from '@/src/adapters/mastra-adapter';
import type { WorkflowPlan, WorkflowNode } from '@/src/domain/models';
import type { WorkflowRun } from '@/src/domain/runtime';
import { prepareRunTransition } from '@/src/domain/run-transition-service';
import { completeNode, nativeNodeResult, retryFailedNode, startNextNode } from '@/src/domain/runtime-engine';
import { createProject, createProjectWorkflow, createWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

function plan(): WorkflowPlan {
  const node = (id: string, type: WorkflowNode['type'], outputs: string[]): WorkflowNode => ({ id, name: id, type, prompt: `Execute ${id}.`, skillIds: [], inputKeys: [], outputKeys: outputs, retryLimit: 0, requiresApproval: false, readOnly: true });
  return { id: 'parallel-test', schemaVersion: 1, name: 'Parallel test', description: 'Concurrent analysis and deterministic joins.', planningPrompt: 'Inspect.', workspacePath: 'C:\\projects\\parallel',
    constraints: [], openQuestions: [], completionCriteria: ['Joined results reviewed.'],
    nodes: [node('fork', 'fork', []), node('a', 'codex', ['a']), node('b', 'codex', ['b']), node('join', 'join', ['branches']), node('success', 'success', ['final']), node('failure', 'failure', ['reason'])],
    edges: [{ from: 'fork', to: 'a' }, { from: 'fork', to: 'b' }, { from: 'a', to: 'join', condition: 'accepted' }, { from: 'b', to: 'join' }, { from: 'join', to: 'success' }, { from: 'a', to: 'failure', condition: 'stop' }],
    harness: { sandboxMode: 'read-only', maxRetries: 0, maxLoopIterations: 2, maxConcurrentNodes: 2, allowedTools: [], allowedWorkspacePaths: ['C:\\projects\\parallel'], requireApprovalForDestructiveActions: true },
    status: 'approved', createdAt: '2026-10-26T00:00:00Z', updatedAt: '2026-10-26T00:00:00Z' };
}

async function execute(source: WorkflowPlan, work: (id: string, run: () => WorkflowRun) => Promise<unknown>, resumeActive = false) {
  let current: WorkflowRun | null = null;
  const store = { read: async () => structuredClone(current), upsert: async (userId: string, proposed: WorkflowRun) => {
    current = prepareRunTransition(userId, proposed, current ?? undefined); proposed.stateRevision = current.stateRevision; return structuredClone(current);
  } };
  const adapter = new LocalMastraAdapter({ store, storageSchema: `parallel-${crypto.randomUUID()}`, executor: { execute: async (task) => {
    const value = await work(task.node.id, () => current!);
    return { output: Object.fromEntries(task.node.outputKeys.map((key) => [key, value])), selectedCondition: task.edgeConditions.includes('accepted') ? 'accepted' : '' };
  } } });
  const project = createProject({ id: 'parallel-project', name: 'Parallel', rootPath: source.workspacePath, workspaceKind: 'workspace' });
  const workflow = createWorkflow({ id: source.id, name: source.name, domain: 'Tests', status: 'published' });
  const assignment = createProjectWorkflow({ id: 'parallel-assignment', project, workflow, graphOverride: source, status: 'ready', approval: testAssignmentApproval(workflow.version),
    permissions: { sandboxMode: source.harness.sandboxMode, allowedWorkspacePaths: [source.workspacePath] } });
  try {
    const compiled = await adapter.compile('parallel-user', source, assignment, [], `run_parallel-${crypto.randomUUID()}`);
    if (!compiled.run || !compiled.registration) throw new Error(compiled.errors.join(' '));
    if (resumeActive) {
      const fork = startNextNode(compiled.run);
      let active = completeNode(fork.run, 'fork', nativeNodeResult(fork.run, 'fork')!.output).run;
      active = startNextNode(active).run; active = startNextNode(active).run;
      compiled.run = await store.upsert('parallel-user', active);
      compiled.run.executionRequested = true;
    }
    await adapter.start(compiled.registration.registrationKey, compiled.run.id, { userId: 'parallel-user', run: compiled.run });
    return current!;
  } finally { await adapter.close(); }
}

describe('parallel scheduling and joins', () => {
  it('manually retries a failed later branch even when an earlier sibling was interrupted', async () => {
    const run = await execute(plan(), async (id) => {
      if (id === 'b') throw new Error('Branch B failed.');
      if (id === 'a') await new Promise((resolve) => setTimeout(resolve, 20));
      return id;
    });
    expect(run.status).toBe('failed');
    const retried = retryFailedNode(run).run;
    expect(retried.nodeRuns.find((node) => node.nodeId === 'fork')?.status).toBe('completed');
    expect(retried.nodeRuns.find((node) => node.nodeId === 'b')?.status).toBe('pending');
    const first = startNextNode(retried).run;
    const both = startNextNode(first).run;
    expect(both.nodeRuns.filter((node) => node.status === 'running').map((node) => [node.nodeId, node.attempt])).toEqual([['a', 2], ['b', 2]]);
    expect(both.events.slice(0, run.events.length)).toEqual(run.events);
  });

  it('resumes both durable active branch identities without incrementing attempts', async () => {
    const attempts: number[] = [];
    const run = await execute(plan(), async (id, current) => {
      if (id === 'a' || id === 'b') attempts.push(current().nodeRuns.find((node) => node.nodeId === id)!.attempt);
      return id;
    }, true);
    expect(attempts).toEqual([1, 1]);
    expect(run.status).toBe('completed');
  });

  it('waits for active siblings before presenting a human gate', async () => {
    const source = plan();
    source.nodes.splice(3, 0, { id: 'gate', name: 'Review branch', type: 'approval', prompt: 'Review.', skillIds: [], inputKeys: ['a'], outputKeys: ['decision'], retryLimit: 0, requiresApproval: true,
      approvalOptions: [{ id: 'continue', label: 'Continue', keyword: 'continue', action: 'continue' }] });
    source.edges = source.edges.map((edge) => edge.from === 'a' && edge.to === 'join' ? { ...edge, to: 'gate' } : edge);
    source.edges.push({ from: 'gate', to: 'join', condition: 'continue' });
    const run = await execute(source, async (id) => { if (id === 'b') await new Promise((resolve) => setTimeout(resolve, 20)); return id; });
    expect(run.status).toBe('paused');
    expect(run.nodeRuns.filter((node) => node.status === 'running')).toHaveLength(0);
    expect(run.nodeRuns.find((node) => node.nodeId === 'b')?.status).toBe('completed');
  });

  it('requests missing branch inputs without dispatching that node', async () => {
    const source = plan(); source.nodes.find((node) => node.id === 'a')!.inputKeys = ['middle_input'];
    let called = false;
    const run = await execute(source, async () => { called = true; return 'unexpected'; });
    expect(run.pendingInput).toMatchObject({ nodeId: 'a', keys: ['middle_input'] });
    expect(called).toBe(false);
  });

  it('overlaps branches within the budget and merges results deterministically', async () => {
    let active = 0; let peak = 0;
    const run = await execute(plan(), async (id) => {
      if (id === 'a' || id === 'b') {
        active++; peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, id === 'a' ? 25 : 5)); active--;
      }
      return id;
    });
    expect(peak).toBe(2);
    expect(run.status).toBe('completed');
    expect(run.nodeRuns.find((node) => node.nodeId === 'join')?.output?.branches).toMatchObject({ a: { output: { a: 'a' } }, b: { output: { b: 'b' } } });
  });

  it('keeps shared-project writers exclusive', async () => {
    const source = plan(); source.harness.sandboxMode = 'workspace';
    source.nodes.find((node) => node.id === 'a')!.readOnly = false;
    let active = 0; let peak = 0;
    await execute(source, async () => { active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 5)); active--; return 'ok'; });
    expect(peak).toBe(1);
  });

  it('collects exhausted branch errors at the join without dropping successful siblings', async () => {
    const source = plan(); source.harness.parallelFailureMode = 'collect-all';
    const run = await execute(source, async (id) => { if (id === 'a') throw new Error('Branch A failed.'); return id; });
    expect(run.status).toBe('completed');
    expect(run.nodeRuns.find((node) => node.nodeId === 'join')?.output?.branches).toMatchObject({ a: { status: 'failed', error: 'Branch A failed.' }, b: { status: 'completed' } });
  });

  it('fails fast and rejects a late sibling result', async () => {
    const run = await execute(plan(), async (id) => {
      if (id === 'a') throw new Error('Branch A failed.');
      if (id === 'b') await new Promise((resolve) => setTimeout(resolve, 10));
      return id;
    });
    expect(run.status).toBe('failed');
    expect(run.nodeRuns.find((node) => node.nodeId === 'b')?.output).toBeUndefined();
  });

  it('runs a quorum join before a slow sibling finishes and discards that sibling', async () => {
    const source = plan(); source.nodes.find((node) => node.id === 'join')!.joinMode = 'quorum';
    source.nodes.find((node) => node.id === 'join')!.joinQuorum = 1;
    let skippedBeforeReturn = false;
    const run = await execute(source, async (id, state) => {
      if (id === 'b') { await new Promise((resolve) => setTimeout(resolve, 40)); skippedBeforeReturn = state().nodeRuns.find((node) => node.nodeId === 'b')?.status === 'skipped'; }
      return id;
    });
    expect(skippedBeforeReturn).toBe(true);
    expect(run.status).toBe('completed');
    expect(run.nodeRuns.find((node) => node.nodeId === 'b')?.status).toBe('skipped');
  });
});
