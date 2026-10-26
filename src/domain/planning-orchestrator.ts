import type { CodexAdapter, CodexEvent } from '@/src/adapters/codex-adapter';
import { unboundedWorkflowCycle, validateWorkflowGraph } from './models';
import type { PlanningError, PlanningRequest, PlanningResponse } from './planning';
import { attachMatchingSkills } from './skill-matching';
import { visualReviewPolicyIssues } from './visual-review-policy';

const MAX_GRAPH_REPAIR_ATTEMPTS = 2;

export function normalizeGeneratedGraph(plan: PlanningResponse['plan']): PlanningResponse['plan'] {
  const reaches = (from: string, to: string, edges: typeof plan.edges, excluded?: typeof plan.edges[number]) => {
    const visited = new Set<string>();
    const queue = [from];
    while (queue.length) {
      const current = queue.shift() as string;
      if (current === to) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      queue.push(...edges.filter((edge) => edge !== excluded && edge.from === current).map((edge) => edge.to));
    }
    return false;
  };
  const nodeTypes = new Map(plan.nodes.map((node) => [node.id, node.type]));
  const boundedBackEdges = plan.edges.filter((edge) => nodeTypes.get(edge.from) === 'loop' && reaches(edge.to, edge.from, plan.edges, edge));
  const boundedKeys = new Set(boundedBackEdges.map((edge) => `${edge.from}\u0000${edge.to}\u0000${edge.condition ?? ''}`));
  const forwardEdges = plan.edges.filter((edge) => !boundedKeys.has(`${edge.from}\u0000${edge.to}\u0000${edge.condition ?? ''}`));
  const rewrittenEntries = new Map<string, string>();
  for (const backEdge of boundedBackEdges) {
    const loopInputs = plan.edges.filter((edge) => edge.to === backEdge.from);
    if (loopInputs.length < 2) continue;
    for (const incoming of loopInputs) {
      // A generated loop often receives both the initial result and revised results.
      // Route only the initial result directly to the review target; revised results
      // continue through the loop counter and use the bounded back edge.
      if (!reaches(backEdge.to, incoming.from, forwardEdges)) rewrittenEntries.set(`${incoming.from}\u0000${incoming.to}\u0000${incoming.condition ?? ''}`, backEdge.to);
    }
  }
  const seen = new Set<string>();
  return {
    ...plan,
    edges: plan.edges.map((edge) => {
      const target = rewrittenEntries.get(`${edge.from}\u0000${edge.to}\u0000${edge.condition ?? ''}`);
      return target ? { ...edge, to: target } : edge;
    }).filter((edge) => {
      const key = `${edge.from}\u0000${edge.to}\u0000${edge.condition?.trim() ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
  };
}

export type OrchestratedPlanningResult =
  | { ok: true; value: PlanningResponse; skillMatches: Array<{ nodeId: string; skillId: string }>; repairAttempts: number }
  | { ok: false; error: PlanningError; repairAttempts: number };

function repairableGraphIssues(plan: PlanningResponse['plan']): { errors: string[]; advisories: string[]; details: string[] } {
  const validation = validateWorkflowGraph(plan, [], undefined, { allowUnavailableSkills: true });
  const cycle = unboundedWorkflowCycle(plan);
  const details: string[] = [];
  if (cycle) details.push(`Unbounded cycle path (node ids): ${cycle.join(' -> ')}. This path still exists after all bounded loop return edges are removed. Break this exact path or route its revision return through a bounded loop; adding a loop elsewhere does not bound this cycle. Keep the accepted/continue route forward-only to success and return revised candidates to the human gate before acceptance.`);
  const pairs = new Map<string, typeof plan.edges>();
  for (const edge of plan.edges) {
    const key = `${edge.from}->${edge.to}`;
    pairs.set(key, [...(pairs.get(key) ?? []), edge]);
  }
  for (const [pair, edges] of pairs) {
    if (edges.length > 1) details.push(`Duplicate route ${pair} has conditions ${JSON.stringify(edges.map((edge) => edge.condition ?? ''))}. Only one edge per source/target pair is supported, even with different conditions. Preserve every intended outcome using distinct route steps or one shared decision result; update the source instructions and approval keywords consistently. Do not silently discard an outcome.`);
  }
  return {
    errors: [...validation.errors, ...visualReviewPolicyIssues(plan)],
    // Diagnostics enrich the repair request without inflating the issue count.
    details,
    advisories: validation.warnings.filter((warning) => warning.includes('only after a loop'))
  };
}

export async function createValidatedPlanningPlan(adapter: CodexAdapter, request: PlanningRequest, onEvent?: (event: CodexEvent) => void): Promise<OrchestratedPlanningResult> {
  let attemptRequest = request;
  for (let repairAttempts = 0; repairAttempts <= MAX_GRAPH_REPAIR_ATTEMPTS; repairAttempts += 1) {
    const result = await adapter.createPlanningThread(attemptRequest, onEvent);
    if (!result.ok) return { ...result, repairAttempts };

    const matched = attachMatchingSkills(result.value.plan, request.availableSkills ?? []);
    const plan = normalizeGeneratedGraph({
      ...matched.plan,
      openQuestions: result.value.openQuestions,
      questionResponses: request.questionResponses ?? matched.plan.questionResponses ?? []
    });
    const issues = repairableGraphIssues(plan);
    const needsRepair = issues.errors.length > 0 || issues.advisories.length > 0;
    if (!needsRepair || (repairAttempts === MAX_GRAPH_REPAIR_ATTEMPTS && issues.errors.length === 0)) {
      return { ok: true, value: { ...result.value, plan }, skillMatches: matched.attached, repairAttempts };
    }
    if (repairAttempts === MAX_GRAPH_REPAIR_ATTEMPTS) {
      return {
        ok: false,
        repairAttempts,
        error: {
          code: 'INVALID_PLAN',
          message: 'Codex could not repair the generated workflow graph. No workflow was saved.',
          fieldErrors: { graph: issues.errors },
          trace: result.value.trace
        }
      };
    }

    const feedback = [...issues.errors, ...issues.advisories, ...issues.details];
    const issueCount = issues.errors.length + issues.advisories.length;
    onEvent?.({ type: 'planning.repairing', message: `Checking and repairing ${issueCount} graph contract issue${issueCount === 1 ? '' : 's'} before review.` });
    attemptRequest = {
      ...request,
      previousPlan: plan,
      previousPlanningThreadId: result.value.trace.planningThreadId,
      graphRepairFeedback: feedback
    };
  }

  return { ok: false, repairAttempts: MAX_GRAPH_REPAIR_ATTEMPTS, error: { code: 'INVALID_PLAN', message: 'Workflow graph repair ended unexpectedly.' } };
}
