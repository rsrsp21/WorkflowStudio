import { describe, expect, it } from 'vitest';
import { resolveNodeInput } from '@/src/domain/runtime-engine';
import type { WorkflowRun } from '@/src/domain/runtime';

describe('runtime loop state resolution', () => {
  it('uses the latest completed producer when a bounded revision updates a state key', () => {
    const run = {
      compiledWorkflow: {
        assignmentInputs: {},
        nodes: [
          { id: 'revision', inputKeys: [], outputKeys: ['draft'] },
          { id: 'initial', inputKeys: [], outputKeys: ['draft'] },
          { id: 'consumer', inputKeys: ['draft'], outputKeys: [] }
        ]
      },
      edgeRuns: [
        { from: 'initial', to: 'revision', status: 'selected' },
        { from: 'revision', to: 'consumer', status: 'selected' }
      ],
      nodeRuns: [
        { nodeId: 'revision', iteration: 1, completedAt: '2026-09-02T10:01:00.000Z', output: { draft: 'revised' } },
        { nodeId: 'initial', iteration: 0, completedAt: '2026-09-02T10:00:00.000Z', output: { draft: 'initial' } },
        { nodeId: 'consumer', iteration: 1 }
      ]
    } as unknown as WorkflowRun;

    expect(resolveNodeInput(run, 'consumer')).toEqual({ draft: 'revised' });
  });
});
