import type { WorkflowPlan } from './models';
import type { PlanningSkillSummary } from './planning';

const STOP_WORDS = new Set(['about', 'after', 'also', 'and', 'any', 'app', 'based', 'build', 'codex', 'create', 'for', 'from', 'into', 'local', 'needed', 'skill', 'skills', 'that', 'the', 'this', 'tool', 'use', 'using', 'when', 'with', 'workflow']);
const STRONG_CAPABILITY_WORDS = new Set(['architecture', 'diagram', 'document', 'figma', 'image', 'mockup', 'pdf', 'presentation', 'requirements', 'screen', 'spreadsheet', 'ui', 'visual']);

function roots(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.map((word) => word.length > 5 ? word.slice(0, 5) : word).filter((word) => word.length > 2 && !STOP_WORDS.has(word)) ?? []);
}

function shouldAttach(nodeText: string, skill: PlanningSkillSummary): boolean {
  const nodeTokens = roots(nodeText);
  const identityTokens = roots(`${skill.id} ${skill.name}`);
  const skillTokens = roots(`${skill.id} ${skill.name} ${skill.description}`);
  const shared = Array.from(skillTokens).filter((token) => nodeTokens.has(token));
  const identityShared = Array.from(identityTokens).filter((token) => nodeTokens.has(token));
  const hasStrongCapability = shared.some((token) => Array.from(STRONG_CAPABILITY_WORDS).some((word) => word.startsWith(token) || token.startsWith(word.slice(0, 5))));
  return hasStrongCapability && shared.length >= 2 && identityShared.length >= 1;
}

export function attachMatchingSkills(plan: WorkflowPlan, availableSkills: PlanningSkillSummary[]): { plan: WorkflowPlan; attached: Array<{ nodeId: string; skillId: string }> } {
  const attached: Array<{ nodeId: string; skillId: string }> = [];
  const availableById = new Map(availableSkills.map((skill) => [skill.id, skill]));
  const nodes = plan.nodes.map((node) => {
    if (!['agent', 'codex', 'tool', 'validation'].includes(node.type)) return node;
    const text = `${node.name} ${node.prompt} ${node.inputKeys.join(' ')} ${node.outputKeys.join(' ')}`;
    const matched = availableSkills.filter((skill) => shouldAttach(text, skill)).map((skill) => skill.id);
    const compatibleProposals = node.skillIds.filter((skillId) => {
      const available = availableById.get(skillId);
      return !available || shouldAttach(text, available);
    });
    const skillIds = Array.from(new Set([...compatibleProposals, ...matched]));
    for (const skillId of matched) if (!node.skillIds.includes(skillId)) attached.push({ nodeId: node.id, skillId });
    return { ...node, skillIds };
  });
  return { plan: { ...plan, nodes }, attached };
}
