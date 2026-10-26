import type { NodeType, WorkflowNode } from '@/src/domain/models';

const NODE_TYPE_LABELS: Record<NodeType, string> = {
  agent: 'Agent',
  codex: 'Codex',
  tool: 'Tool',
  validation: 'Validation',
  approval: 'Human approval',
  loop: 'Loop',
  fork: 'Parallel fork',
  join: 'Branch join',
  success: 'Success',
  failure: 'Failure'
};

export function WorkflowNodeIcon({ type }: { type: NodeType }) {
  return <svg className="workflow-node-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none">
    {type === 'agent' ? <><path d="M8 9.5h8a3 3 0 0 1 3 3V18H5v-5.5a3 3 0 0 1 3-3Z" /><path d="M12 9.5V6m-2.5 0h5M8.5 13h.01m6.99 0h.01M9 18v2m6-2v2" /></>
      : type === 'codex' ? <><path d="m12 3 1.45 4.05L17.5 8.5l-4.05 1.45L12 14l-1.45-4.05L6.5 8.5l4.05-1.45L12 3Z" /><path d="m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z" /></>
      : type === 'tool' ? <><path d="M14.5 6.5a4 4 0 0 0-5.2 5.2L4 17l3 3 5.3-5.3a4 4 0 0 0 5.2-5.2L15 12l-3-3 2.5-2.5Z" /></>
      : type === 'validation' ? <><path d="M12 3 21 12 12 21 3 12 12 3Z" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></>
      : type === 'approval' ? <><path d="M7 11V7a2 2 0 0 1 4 0v3-5a2 2 0 0 1 4 0v5-3a2 2 0 0 1 4 0v7c0 4-2.7 7-7 7h-1.5a6 6 0 0 1-5.2-3L3 14.2A2 2 0 0 1 6.2 12L8 14" /></>
      : type === 'loop' ? <><path d="M18.5 8A7 7 0 0 0 6 7l-2 2" /><path d="M4 5v4h4M5.5 16A7 7 0 0 0 18 17l2-2" /><path d="M20 19v-4h-4" /></>
      : type === 'fork' || type === 'join' ? <><path d="M12 3v6M5 21v-6h14v6M12 15V9M5 9h14" /><circle cx="12" cy="12" r="2" /></>
      : type === 'success' ? <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16.5 8.5" /></>
      : <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></>}
  </svg>;
}

export function WorkflowNodeVisual({ node, detail }: { node: WorkflowNode; detail: string }) {
  const label = NODE_TYPE_LABELS[node.type];
  return <>
    <span className="canvas-node-heading">
      <span className="canvas-node-icon"><WorkflowNodeIcon type={node.type} /></span>
      <span className="canvas-node-type">{label}</span>
    </span>
    <strong>{node.name}</strong>
    <small>{detail}</small>
  </>;
}

export function workflowNodeTypeLabel(type: NodeType) {
  return NODE_TYPE_LABELS[type];
}
