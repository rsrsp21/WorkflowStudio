import type { PlanningRequest, PlanningResult } from '@/src/domain/planning';
import type { HarnessPolicy, NodeType, WorkflowValueType } from '@/src/domain/models';
import type { ResolvedModelSettings } from '@/src/domain/model-settings';

export type CodexPlanningRequest = PlanningRequest;

/** Deliberately separate from planning so execution cannot consume planning input accidentally. */
export interface CodexFocusedTaskRequest {
  runId: string;
  taskId: string;
  attempt?: number;
  iteration?: number;
  sourcePlanId: string;
  workflowId: string;
  workflowVersion: number;
  assignmentId: string;
  projectId: string;
  nodeId: string;
  nodeName: string;
  nodeType: NodeType;
  prompt: string;
  workspacePath: string;
  input: Record<string, unknown>;
  outputKeys: string[];
  outputSchemas?: Record<string, WorkflowValueType>;
  requiredArtifacts?: string[];
  edgeConditions: string[];
  approvedAdaptations?: Array<{ id: string; scope: 'project' | 'user'; summary: string; sourceRunId: string }>;
  skills: CodexFocusedSkill[];
  harness: HarnessPolicy;
  modelSettings: ResolvedModelSettings;
}

export interface CodexFocusedSkill {
  id: string;
  name: string;
  version: number;
  instructions: string;
  requiredContext: string[];
  requiredPermissions: string[];
  validationCriteria: string[];
  source?: string;
}

export interface CodexFocusedTaskTrace {
  runId: string;
  taskId: string;
  sourcePlanId: string;
  workflowId: string;
  assignmentId: string;
  projectId: string;
  nodeId: string;
}

export interface CodexFocusedTaskResult {
  output: Record<string, unknown>;
  selectedCondition: string;
  summary: string;
  artifacts: CodexFocusedArtifact[];
  trace: CodexFocusedTaskTrace;
  providerThreadId?: string;
  runtimeJobId?: string;
  runtimeConnectionId?: string;
}

export interface CodexFocusedArtifact {
  path: string;
  description: string;
  rootPath: string;
  sandboxMode: HarnessPolicy['sandboxMode'];
  writeAllowed: boolean;
}

export interface CodexAdapter {
  createPlanningThread(request: CodexPlanningRequest, onEvent?: (event: CodexEvent) => void): Promise<PlanningResult>;
  runFocusedTask(request: CodexFocusedTaskRequest): Promise<CodexFocusedTaskResult>;
}

export interface CodexEvent {
  type: string;
  message?: string;
  threadId?: string;
  stream?: 'stdout' | 'stderr';
  raw?: string;
}

/** @deprecated Use CodexEvent. Kept for compatibility with the legacy CLI adapter. */
export type CodexCliEvent = CodexEvent;

/** Fallback used when the local Codex CLI is unavailable or not yet configured. */
export class LocalCodexAdapter implements CodexAdapter {
  async createPlanningThread(): Promise<PlanningResult> {
    return { ok: false, error: { code: 'PROVIDER_FAILURE', message: 'Codex CLI is not configured or could not be started.' } };
  }

  async runFocusedTask(): Promise<never> { throw new Error('Focused Codex execution is not configured in the planning adapter.'); }
}
