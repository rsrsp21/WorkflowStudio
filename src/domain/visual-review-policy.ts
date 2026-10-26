import type { WorkflowPlan } from './models';

/** Planning-time policy only; never rewrites an approved definition or active run. */
export function visualReviewPolicyIssues(plan: WorkflowPlan): string[] {
  const issues: string[] = [];
  const nodes = new Map(plan.nodes.map((node) => [node.id, node]));
  for (const review of plan.nodes) {
    if (!['agent', 'codex', 'validation'].includes(review.type)
      || !/consistency|continuity|visual quality/i.test(review.name)
      || !/\bui\b|screen|visual|mockup/i.test(`${plan.name} ${review.name}`)) continue;
    function reachesReviewGate(id: string, visited: Set<string>): boolean {
      if (visited.has(id)) return false;
      const node = nodes.get(id);
      if (!node) return false;
      if (node.type === 'approval') return ['continue', 'revise', 'stop'].every((action) => node.approvalOptions?.some((option) => option.action === action));
      if (['loop', 'failure', 'success', 'validation'].includes(node.type)
        || /regenerat|revis|rework|repair|consistency|continuity/i.test(node.name)) return false;
      const next = new Set(visited).add(id);
      const edges = plan.edges.filter((edge) => edge.from === id);
      return edges.length > 0 && edges.every((edge) => reachesReviewGate(edge.to, next));
    }
    const edges = plan.edges.filter((edge) => edge.from === review.id);
    if (!edges.length || !edges.every((edge) => reachesReviewGate(edge.to, new Set([review.id])))) {
      issues.push(`Node ${review.name}: report material visual consistency findings once, then route every outcome to a human review gate offering continue with current screens, revise selected screens, and stop. Do not automatically regenerate, repeat consistency checks, or fail for subjective findings. Keep continue available at the revision limit; only a human revise decision may enter the bounded loop.`);
    }
  }
  return issues;
}
