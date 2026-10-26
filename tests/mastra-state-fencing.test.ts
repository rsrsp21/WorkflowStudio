import { describe, expect, it } from 'vitest';
import { LocalMastraAdapter, reconcileMastraRunState } from '@/src/adapters/mastra-adapter';
import { prepareRunTransition } from '@/src/domain/run-transition-service';
import { recoverInterruptedRun, startNextNode, type RunStateStore } from '@/src/domain/runtime-engine';
import type { WorkflowRun } from '@/src/domain/runtime';
import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import { createProject, createWorkflow, createProjectWorkflow } from '@/src/domain/workspace';
import { testAssignmentApproval } from './test-helpers';

async function compile(adapter: LocalMastraAdapter) {
  const plan = structuredClone(STARTER_WORKFLOWS[0]);
  const project = createProject({ id: 'fenced-project', name: 'Fencing', rootPath: 'C:\\projects\\fencing', workspaceKind: 'workspace' });
  const workflow = createWorkflow({ id: plan.id, name: plan.name, domain: 'Tests', status: 'published' });
  const assignment = createProjectWorkflow({ id: 'fenced-assignment', project, workflow, status: 'ready', graphOverride: plan,
    inputOverrides: { project: project.rootPath }, approval: testAssignmentApproval(workflow.version),
    permissions: { sandboxMode: 'read-only', allowedWorkspacePaths: [project.rootPath] } });
  const result = await adapter.compile('fenced-user', plan, assignment, [], `run_fence-${crypto.randomUUID()}`);
  if (!result.run || !result.registration) throw new Error(result.errors.join(' '));
  return { run: result.run, registration: result.registration };
}

describe('Mastra authoritative state fencing', () => {
  it('uses the durable revision for same-journal updates and rejects an ahead checkpoint', async () => {
    const adapter = new LocalMastraAdapter({ storageSchema: ':memory:' });
    try {
      const { run } = await compile(adapter);
      const snapshot = { ...run, stateRevision: 1 };
      const durable = { ...run, stateRevision: 2, processedActionKeys: ['committed-action'] };
      expect(reconcileMastraRunState(snapshot, durable)).toEqual(durable);
      expect(() => reconcileMastraRunState({ ...snapshot, stateRevision: 3 }, durable)).toThrow('ahead');
    } finally { await adapter.close(); }
  });

  it.each(['result', 'error'] as const)('fences a delayed %s without failing a newer attempt', async (kind) => {
    let current: WorkflowRun | null = null;
    const store: RunStateStore = {
      read: async () => structuredClone(current),
      upsert: async (userId, proposed) => {
        current = prepareRunTransition(userId, proposed, current ?? undefined);
        proposed.stateRevision = current.stateRevision;
        return structuredClone(current);
      }
    };
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const executing = new Promise<void>((resolve) => { started = resolve; });
    const adapter = new LocalMastraAdapter({ store, storageSchema: `fence-${crypto.randomUUID()}`, executor: { execute: async () => {
      started(); await waiting;
      if (kind === 'error') throw new Error('Old provider failure.');
      return { output: { result: 'Old output.' } };
    } } });
    try {
      const { run, registration } = await compile(adapter);
      const execution = adapter.start(registration.registrationKey, run.id, { userId: run.userId, run });
      const rejected = expect(execution).rejects.toThrow('stale');
      await executing;
      const active = await store.read(run.userId, run.id);
      if (!active) throw new Error('Active run is missing.');
      const recovered = await store.upsert(run.userId, recoverInterruptedRun(active).run);
      const newer = await store.upsert(run.userId, startNextNode(recovered).run);
      release();
      await rejected;
      expect(await store.read(run.userId, run.id)).toEqual(newer);
      expect(newer.nodeRuns[0]).toMatchObject({ status: 'running', attempt: 2 });
    } finally { release(); await adapter.close(); }
  });
});
