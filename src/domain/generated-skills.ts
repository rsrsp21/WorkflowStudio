import type { WorkflowNode, WorkflowPlan } from './models';
import type { Skill } from './workspace';

export type GeneratedSkillDraft = Omit<Skill, 'schemaVersion' | 'createdAt' | 'updatedAt'>;

const SKILL_NODE_TYPES = new Set(['agent', 'codex', 'tool', 'validation']);

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52) || 'workflow-skill';
}

function title(value: string): string {
  return value.replace(/[-_.]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function nodesForSkill(nodes: WorkflowNode[], skillId: string): WorkflowNode[] {
  return nodes.filter((node) => node.skillIds.includes(skillId));
}

function nodeValidationCriteria(nodes: WorkflowNode[]): string[] {
  return unique(nodes.flatMap((node) => [
    `For "${node.name}", verify only this stage's instructions: ${node.prompt}`,
    `For "${node.name}", use the declared inputs (${node.inputKeys.join(', ') || 'none'}) and produce the declared outputs (${node.outputKeys.join(', ') || 'none'}).`,
    ...(node.requiredArtifacts ?? []).map((artifact) => `For "${node.name}", produce the required artifact: ${artifact}.`),
    `For "${node.name}", do not require downstream deliverables or later human approvals unless explicitly required by this node's instructions or declared inputs.`
  ]));
}

export function materializeWorkflowSkillDrafts(plan: WorkflowPlan, existingSkills: Skill[]): { plan: WorkflowPlan; drafts: GeneratedSkillDraft[] } {
  const workflowSlug = slug(plan.name);
  const workflowKey = slug(plan.id).slice(-10);
  const normalizedNodes = plan.nodes.map((node) => {
    if (node.skillIds.length || !SKILL_NODE_TYPES.has(node.type)) return { ...node, skillIds: [...node.skillIds] };
    return { ...node, skillIds: [`${workflowSlug}-${slug(node.name)}-${workflowKey}`] };
  });
  const normalizedPlan = { ...plan, nodes: normalizedNodes, updatedAt: new Date().toISOString() };
  const skillIds = unique(normalizedNodes.flatMap((node) => node.skillIds));
  const existingIds = new Set(existingSkills.map((skill) => skill.id));
  const drafts = skillIds.filter((skillId) => !existingIds.has(skillId)).map((skillId) => {
    const nodes = nodesForSkill(normalizedNodes, skillId);
    const generatedFromOneNode = nodes.length === 1;
    return {
      id: skillId,
      name: generatedFromOneNode ? `${nodes[0].name} skill` : title(skillId),
      description: `Generated for ${plan.name} and used by ${nodes.map((node) => node.name).join(', ') || 'workflow nodes'}.`,
      version: 1,
      status: 'draft' as const,
      scope: { kind: 'workflow' as const, workflowId: plan.id },
      instructions: unique(nodes.map((node) => node.prompt)).join('\n\n') || `Perform the ${title(skillId)} capability for ${plan.name}.`,
      triggers: unique(nodes.map((node) => node.name)),
      requiredContext: unique(nodes.flatMap((node) => node.inputKeys)),
      inputs: unique(nodes.flatMap((node) => node.inputKeys)),
      outputs: unique(nodes.flatMap((node) => node.outputKeys)),
      requiredPermissions: [],
      validationCriteria: nodeValidationCriteria(nodes),
      familyId: skillId,
      source: `Generated from ${plan.name}`,
      author: 'Codex planner',
      compatibility: ['Codex App Server'],
      estimatedContextTokens: Math.max(1, Math.ceil((unique(nodes.map((node) => node.prompt)).join('\n\n').length || 200) / 4))
    };
  });
  return { plan: normalizedPlan, drafts };
}
