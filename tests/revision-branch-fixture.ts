import { STARTER_WORKFLOWS } from '@/src/domain/starter-workflows';
import type { WorkflowNode, WorkflowPlan } from '@/src/domain/models';

/** A revision-only branch entered from a loop, not on the initial path. */
export function revisionBranchPlan(): WorkflowPlan {
  const node = (id: string, type: WorkflowNode['type'], inputKeys: string[], outputKeys: string[]): WorkflowNode => ({
    id, name: id, type, inputKeys, outputKeys, skillIds: [], prompt: `Perform ${id}.`, retryLimit: 0, requiresApproval: type === 'approval'
  });
  return { ...structuredClone(STARTER_WORKFLOWS[0]), name: 'Document revision review', nodes: [
    node('context', 'agent', [], ['sources']),
    node('initial', 'agent', ['sources'], ['initialDocument']),
    node('review', 'validation', ['initialDocument'], ['findings']),
    { ...node('gate', 'approval', ['findings'], ['feedback']), approvalOptions: [
      { id: 'accept', keyword: 'ACCEPT', label: 'Accept current results', action: 'continue' },
      { id: 'revise', keyword: 'REVISE', label: 'Revise selected items', action: 'revise' },
      { id: 'stop', keyword: 'STOP', label: 'Stop', action: 'stop' }
    ] },
    node('loop', 'loop', ['feedback'], ['revisionNumber']),
    node('prepareRevision', 'agent', ['sources', 'initialDocument', 'feedback'], ['revisionPlan']),
    node('revise', 'agent', ['sources', 'revisionPlan'], ['revisedDocument']),
    node('merge', 'agent', ['sources', 'initialDocument', 'revisedDocument'], ['findings']),
    node('success', 'success', ['findings'], ['accepted']),
    node('failure', 'failure', [], ['reason'])
  ], edges: [
    { from: 'context', to: 'initial' }, { from: 'initial', to: 'review' }, { from: 'review', to: 'gate' },
    { from: 'gate', to: 'success', condition: 'ACCEPT' }, { from: 'gate', to: 'loop', condition: 'REVISE' }, { from: 'gate', to: 'failure', condition: 'STOP' },
    { from: 'loop', to: 'prepareRevision', condition: 'budget available' }, { from: 'loop', to: 'gate', condition: 'return to review' },
    { from: 'prepareRevision', to: 'revise' }, { from: 'revise', to: 'merge' }, { from: 'merge', to: 'gate' }
  ] };
}
