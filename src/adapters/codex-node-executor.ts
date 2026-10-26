import type { Skill } from '@/src/domain/workspace';
import type { FocusedNodeTask, NodeTaskExecutor } from '@/src/domain/runtime-engine';
import type { CodexAdapter, CodexFocusedSkill, CodexFocusedTaskRequest } from './codex-adapter';

function selectedSkills(task: FocusedNodeTask, skills: Skill[]): CodexFocusedSkill[] {
  if (task.node.skillSnapshots?.length) return task.node.skillSnapshots.map((skill) => ({ id: skill.id, name: skill.name, version: skill.version, instructions: skill.instructions, requiredContext: [...skill.requiredContext], requiredPermissions: [...skill.requiredPermissions], validationCriteria: [...skill.validationCriteria], source: skill.source }));
  return task.node.skillVersions.map((reference) => {
    const skill = skills.find((candidate) => candidate.id === reference.skillId && candidate.version === reference.version && candidate.status === 'published');
    if (!skill) throw new Error(`Pinned skill is unavailable for execution: ${reference.skillId}@${reference.version}.`);
    return {
      id: skill.id,
      name: skill.name,
      version: skill.version,
      instructions: skill.instructions,
      requiredContext: [...skill.requiredContext],
      requiredPermissions: [...skill.requiredPermissions],
      validationCriteria: [...skill.validationCriteria],
      source: skill.source
    };
  });
}

export function buildCodexFocusedTaskRequest(task: FocusedNodeTask, skills: Skill[]): CodexFocusedTaskRequest {
  return {
    runId: task.runId,
    taskId: task.taskId,
    attempt: task.attempt,
    iteration: task.iteration,
    sourcePlanId: task.context.sourcePlanId,
    workflowId: task.context.workflowId,
    workflowVersion: task.context.workflowVersion,
    assignmentId: task.context.assignmentId,
    projectId: task.context.projectId,
    nodeId: task.node.id,
    nodeName: task.node.name,
    nodeType: task.node.type,
    prompt: task.node.focusedPrompt,
    workspacePath: task.context.rootPath,
    input: structuredClone(task.input),
    outputKeys: [...task.node.outputKeys],
    outputSchemas: structuredClone(task.node.outputSchemas ?? {}),
    requiredArtifacts: [...(task.node.requiredArtifacts ?? [])],
    edgeConditions: [...task.edgeConditions],
    approvedAdaptations: structuredClone(task.approvedAdaptations ?? []),
    skills: selectedSkills(task, skills),
    harness: {
      ...structuredClone(task.harness),
      allowedWorkspacePaths: [task.context.rootPath]
    },
    modelSettings: structuredClone(task.node.modelSettings)
  };
}

export class CodexNodeExecutor implements NodeTaskExecutor {
  constructor(private readonly adapter: CodexAdapter, private readonly skills: Skill[]) {}

  async execute(task: FocusedNodeTask) {
    const result = await this.adapter.runFocusedTask(buildCodexFocusedTaskRequest(task, this.skills));
    return {
      output: result.output,
      selectedCondition: result.selectedCondition,
      summary: result.summary,
      artifacts: result.artifacts,
      ...(result.providerThreadId ? { providerThreadId: result.providerThreadId } : {}),
      ...(result.runtimeJobId ? { runtimeJobId: result.runtimeJobId } : {}),
      ...(result.runtimeConnectionId ? { runtimeConnectionId: result.runtimeConnectionId } : {})
    };
  }
}
