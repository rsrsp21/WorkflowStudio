import { validateWorkflowPlan, type HarnessPolicy, type WorkflowPlan, type WorkflowQuestionResponse } from './models';
import { CODEX_MODELS, REASONING_EFFORTS, supportsModelReasoning, type ReasoningEffort } from './model-settings';

export interface PlanningSkillSummary {
  id: string;
  name: string;
  description: string;
  source: 'installed-codex' | 'workspace-registry';
  skillPath?: string;
}

/** Settings that affect a future run, without authorizing that run to start. */
export interface PlanningExecutionSettings {
  approvalPolicy: 'always' | 'destructive-actions' | 'never';
  sandboxMode: HarnessPolicy['sandboxMode'];
  maxRetries: number;
  maxConcurrentNodes: number;
  /** Model used to generate and repair the workflow definition. */
  planningModel: string;
  planningReasoningEffort: ReasoningEffort;
}

/** The only input accepted by the planning boundary. */
export interface PlanningRequest {
  workflowName: string;
  planningPrompt: string;
  workspacePath: string;
  constraints: string[];
  outputRequirements: string[];
  executionSettings: PlanningExecutionSettings;
  questionResponses?: WorkflowQuestionResponse[];
  previousPlan?: WorkflowPlan;
  previousPlanningThreadId?: string;
  /** Server-generated contract feedback used only for an automatic graph repair pass. */
  graphRepairFeedback?: string[];
  /** Added by the server. Browser-provided catalogs are ignored. */
  availableSkills?: PlanningSkillSummary[];
}

export interface PlanningTraceIdentifiers {
  planningRequestId: string;
  planningThreadId: string;
  planId: string;
}

/** Structured output returned by a planning provider after parsing. */
export interface PlanningResponse {
  plan: WorkflowPlan;
  warnings: string[];
  openQuestions: string[];
  trace: PlanningTraceIdentifiers;
}

export type PlanningErrorCode =
  | 'INVALID_REQUEST'
  | 'PROVIDER_FAILURE'
  | 'TIMEOUT'
  | 'MALFORMED_RESPONSE'
  | 'INVALID_PLAN';

export interface PlanningError {
  code: PlanningErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
  trace?: Partial<PlanningTraceIdentifiers>;
}

export type PlanningResult =
  | { ok: true; value: PlanningResponse }
  | { ok: false; error: PlanningError };

export const DEFAULT_PLANNING_EXECUTION_SETTINGS: PlanningExecutionSettings = {
  approvalPolicy: 'destructive-actions',
  sandboxMode: 'read-only',
  maxRetries: 2,
  maxConcurrentNodes: 1,
  planningModel: 'gpt-5.6-sol',
  planningReasoningEffort: 'medium'
};

export function validatePlanningRequest(request: unknown): Record<string, string[]> {
  const value = request as Partial<PlanningRequest> | null;
  const errors: Record<string, string[]> = {};

  if (!value || typeof value !== 'object') {
    return { request: ['Planning request must be an object.'] };
  }
  if (!value.workflowName?.trim()) errors.workflowName = ['Workflow name is required.'];
  if (!value.planningPrompt?.trim()) errors.planningPrompt = ['Planning prompt is required.'];
  if (!value.workspacePath?.trim()) errors.workspacePath = ['Workspace path is required.'];
  if (!Array.isArray(value.constraints)) errors.constraints = ['Constraints must be an array.'];
  if (!Array.isArray(value.outputRequirements)) {
    errors.outputRequirements = ['Output requirements must be an array.'];
  }
  if (!value.executionSettings || typeof value.executionSettings !== 'object') {
    errors.executionSettings = ['Execution settings are required.'];
  } else {
    const settings = value.executionSettings;
    if (settings.maxRetries === undefined || settings.maxRetries < 0) {
      errors['executionSettings.maxRetries'] = ['Maximum retries cannot be negative.'];
    }
    if (settings.maxConcurrentNodes === undefined || settings.maxConcurrentNodes < 1) {
      errors['executionSettings.maxConcurrentNodes'] = ['Concurrency must be at least 1.'];
    }
    if (!CODEX_MODELS.includes(settings.planningModel as typeof CODEX_MODELS[number])) errors['executionSettings.planningModel'] = ['Select a supported model for workflow creation.'];
    if (!REASONING_EFFORTS.includes(settings.planningReasoningEffort as ReasoningEffort) || (settings.planningModel && !supportsModelReasoning(settings.planningModel, settings.planningReasoningEffort as ReasoningEffort))) errors['executionSettings.planningReasoningEffort'] = ['Select a reasoning effort supported by the workflow-creation model.'];
  }
  if (value.questionResponses !== undefined && (!Array.isArray(value.questionResponses) || value.questionResponses.some((response) => !response?.question?.trim() || !response.answer?.trim()))) {
    errors.questionResponses = ['Every submitted planning question requires a non-empty question and answer.'];
  }
  if (value.previousPlan !== undefined) {
    const planErrors = validateWorkflowPlan(value.previousPlan);
    if (planErrors.length) errors.previousPlan = planErrors;
  }
  if (value.previousPlanningThreadId !== undefined && !value.previousPlanningThreadId.trim()) {
    errors.previousPlanningThreadId = ['Previous planning thread id cannot be empty.'];
  }

  return errors;
}
