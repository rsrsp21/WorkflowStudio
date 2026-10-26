import { boundedLoopBackEdgeKeys, type WorkflowPlan } from './models';

export interface GraphPosition { x: number; y: number }
export interface GraphLayout { positions: Record<string, GraphPosition>; width: number; height: number }

export function layoutWorkflowGraph(plan: Pick<WorkflowPlan, 'nodes' | 'edges'>, nodeWidth = 210, nodeHeight = 116): GraphLayout {
  const backEdges = boundedLoopBackEdgeKeys(plan);
  const forwardEdges = plan.edges.filter((edge) => !backEdges.has(`${edge.from}->${edge.to}`));
  const incoming = new Map(plan.nodes.map((node) => [node.id, 0]));
  for (const edge of forwardEdges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const levels = new Map<string, number>();
  for (const node of plan.nodes) if ((incoming.get(node.id) ?? 0) === 0) levels.set(node.id, 0);
  for (let pass = 0; pass < plan.nodes.length; pass += 1) {
    let changed = false;
    for (const edge of forwardEdges) {
      const sourceLevel = levels.get(edge.from);
      if (sourceLevel === undefined) continue;
      const candidate = sourceLevel + 1;
      if (candidate > (levels.get(edge.to) ?? -1)) { levels.set(edge.to, candidate); changed = true; }
    }
    if (!changed) break;
  }
  const fallbackLevel = Math.max(0, ...levels.values()) + 1;
  for (const node of plan.nodes) if (!levels.has(node.id)) levels.set(node.id, fallbackLevel);

  const columns = new Map<number, string[]>();
  for (const node of plan.nodes) {
    const level = levels.get(node.id) ?? 0;
    columns.set(level, [...(columns.get(level) ?? []), node.id]);
  }
  const horizontalGap = 104;
  const verticalGap = 66;
  const paddingX = 42;
  const paddingY = 40;
  const rowStep = nodeHeight + verticalGap;
  const maxRows = Math.max(1, ...Array.from(columns.values(), (nodes) => nodes.length));
  const height = Math.max(520, paddingY * 2 + maxRows * nodeHeight + (maxRows - 1) * verticalGap);
  const positions: Record<string, GraphPosition> = {};
  for (const [level, nodeIds] of columns) {
    const columnHeight = nodeIds.length * nodeHeight + Math.max(0, nodeIds.length - 1) * verticalGap;
    const startY = Math.max(paddingY, (height - columnHeight) / 2);
    nodeIds.forEach((id, index) => { positions[id] = { x: paddingX + level * (nodeWidth + horizontalGap), y: startY + index * rowStep }; });
  }
  const maxLevel = Math.max(0, ...columns.keys());
  const width = Math.max(920, paddingX * 2 + (maxLevel + 1) * nodeWidth + maxLevel * horizontalGap);
  return { positions, width, height };
}

export function graphEdgePath(start: GraphPosition, end: GraphPosition, edgeIndex: number, canvasHeight: number, nodeWidth = 210, nodeHeight = 116) {
  const sourceX = start.x + nodeWidth;
  const sourceY = start.y + nodeHeight / 2;
  const targetX = end.x;
  const targetY = end.y + nodeHeight / 2;
  if (targetX > sourceX) {
    const bend = Math.max(42, Math.min(110, (targetX - sourceX) * 0.48));
    return `M ${sourceX} ${sourceY} C ${sourceX + bend} ${sourceY}, ${targetX - bend} ${targetY}, ${targetX} ${targetY}`;
  }
  const laneY = canvasHeight - 28 - (edgeIndex % 4) * 14;
  return `M ${sourceX} ${sourceY} C ${sourceX + 64} ${laneY}, ${targetX - 64} ${laneY}, ${targetX} ${targetY}`;
}
