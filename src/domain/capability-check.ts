import type { WorkflowPlan } from './models';
import type { ProjectWorkflow, Skill } from './workspace';
import type { RuntimeConnection } from './runtime-connection';
import { companionSupportsVerbosity } from './runtime-connection';
import { resolveModelSettings, supportsModelReasoning } from './model-settings';

export type CapabilityIssueKind = 'skill' | 'tool' | 'credential' | 'companion' | 'model' | 'reasoning' | 'model-settings';
export interface CapabilityIssue { kind: CapabilityIssueKind; key: string; message: string; }

/** Returns blocking capability gaps before a run is compiled or dispatched. */
export function checkWorkflowCapabilities(plan: WorkflowPlan, assignment: ProjectWorkflow, skills: Skill[], companionOnline: boolean, runtime?: RuntimeConnection | null, organizationSettings?: Parameters<typeof resolveModelSettings>[2]): CapabilityIssue[] {
  const issues: CapabilityIssue[] = [];
  const selected = new Map(assignment.selectedSkills.map((reference) => [reference.skillId, reference]));
  const available = new Map(skills.map((skill) => [`${skill.id}@${skill.version}`, skill]));
  const requiredSkillIds = new Set(plan.nodes.flatMap((node) => node.skillIds));
  for (const skillId of requiredSkillIds) {
    const reference = selected.get(skillId);
    if (!reference) {
      issues.push({ kind: 'skill', key: skillId, message: `Missing skill: ${skillId} is required by the workflow but is not selected for this project.` });
      continue;
    }
    const skill = available.get(`${reference.skillId}@${reference.version}`);
    if (!skill || skill.status !== 'published') issues.push({ kind: 'skill', key: skillId, message: `Missing skill: ${skillId}@${reference.version} is unavailable or unpublished.` });
    for (const permission of skill?.requiredPermissions ?? []) {
      if (permission.startsWith('credential:')) {
        issues.push({ kind: 'credential', key: permission, message: `Missing credential: ${permission.slice('credential:'.length)} must be connected before this workflow can run.` });
      } else if (!assignment.permissions.allowedTools.includes(permission)) {
        issues.push({ kind: 'tool', key: permission, message: `Missing tool permission: ${permission} is required by skill ${skillId} but is not allowed for this project.` });
      }
    }
  }
  if (!companionOnline) issues.push({ kind: 'companion', key: 'companion', message: 'Companion is disconnected. Pair the local Workflow Studio companion before running this workflow.' });
  for (const node of plan.nodes.filter((candidate) => ['agent', 'codex', 'tool', 'validation'].includes(candidate.type))) {
    const resolved = resolveModelSettings(node.modelSettings, plan.modelSettings, organizationSettings);
    if (resolved.verbosity && runtime && !companionSupportsVerbosity(runtime.companionVersion)) issues.push({ kind: 'model-settings', key: `${node.id}:verbosity`, message: `Update the companion to version 0.1.1 or later to apply output verbosity for ${node.name}.` });
    if (companionOnline && runtime && (!runtime.supportedModels?.length || !runtime.supportedModels.includes(resolved.model))) issues.push({ kind: 'model', key: `${node.id}:${resolved.model}`, message: `Model ${resolved.model} is unavailable in the paired runtime for node ${node.name}.` });
    if (companionOnline && runtime && (!runtime.supportedReasoningEfforts?.length || !runtime.supportedReasoningEfforts.includes(resolved.reasoningEffort))) issues.push({ kind: 'reasoning', key: `${node.id}:${resolved.reasoningEffort}`, message: `Reasoning effort ${resolved.reasoningEffort} is unavailable for model ${resolved.model} on node ${node.name}.` });
    if (!supportsModelReasoning(resolved.model, resolved.reasoningEffort)) issues.push({ kind: 'reasoning', key: `${node.id}:${resolved.model}:${resolved.reasoningEffort}`, message: `Model ${resolved.model} does not support ${resolved.reasoningEffort} reasoning on node ${node.name}.` });
  }
  return issues.filter((issue, index, all) => all.findIndex((candidate) => candidate.kind === issue.kind && candidate.key === issue.key) === index);
}
