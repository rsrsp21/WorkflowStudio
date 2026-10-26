import { validateWorkflowGraph, validateWorkflowPlan, type WorkflowPlan } from './models';
import type { ProjectWorkflow, Skill } from './workspace';

export type WorkflowLifecycleAction =
  | 'save-draft'
  | 'replan'
  | 'continue-unresolved'
  | 'approve-definition'
  | 'create-assignment'
  | 'approve-assignment'
  | 'compile'
  | 'execute';

export interface LifecycleDecision {
  allowed: boolean;
  errors: string[];
  warnings: string[];
}

export interface LifecycleContext {
  action: WorkflowLifecycleAction;
  workflow: WorkflowPlan;
  graph?: WorkflowPlan;
  skills?: Skill[];
  assignment?: ProjectWorkflow;
}

export function evaluateLifecycleTransition({ action, workflow, graph = workflow, skills = [], assignment }: LifecycleContext): LifecycleDecision {
  const errors = validateWorkflowPlan(workflow);
  const warnings: string[] = [];
  const workflowVersion = workflow.version ?? 1;

  if (!errors.length && action === 'approve-definition') {
    const validation = validateWorkflowGraph(graph, skills);
    errors.push(...validation.errors);
    warnings.push(...validation.warnings.filter((warning) => !warning.includes('project') && !warning.includes('assignment')));
  }

  if (action === 'create-assignment' && workflow.status !== 'approved') {
    errors.push('Approve the reusable workflow graph before creating a project assignment.');
  }
  if (action === 'approve-assignment' && assignment) {
    if (workflow.status !== 'approved') errors.push('Approve the reusable workflow graph before approving its project assignment.');
    const validation = validateWorkflowGraph(graph, skills, assignment);
    errors.push(...validation.errors);
    warnings.push(...validation.warnings);
  }

  if (['approve-assignment', 'compile', 'execute'].includes(action) && !assignment) {
    errors.push('Create a project assignment before continuing.');
  }
  if (assignment && assignment.workflowId !== workflow.id) {
    errors.push('Project assignment belongs to a different reusable workflow.');
  }
  if (assignment && assignment.workflowVersion !== workflowVersion) {
    errors.push(`Project assignment pins workflow version ${assignment.workflowVersion}, but version ${workflowVersion} is current. Create or update the assignment before continuing.`);
  }
  if (['compile', 'execute'].includes(action) && workflow.status !== 'approved') {
    errors.push('Approve the reusable workflow graph before compilation or execution.');
  }
  if (['compile', 'execute'].includes(action) && assignment?.status !== 'ready') {
    errors.push('Approve the project assignment before compilation or execution.');
  }
  if (['compile', 'execute'].includes(action) && assignment?.status === 'ready' && !assignment.approval) {
    errors.push('Project assignment approval metadata is missing. Approve the assignment again before compilation or execution.');
  }
  if (['compile', 'execute'].includes(action) && assignment) {
    const validation = validateWorkflowGraph(graph, skills, assignment);
    errors.push(...validation.errors);
    warnings.push(...validation.warnings);
  }
  if (['compile', 'execute'].includes(action) && assignment?.approval && assignment.approval.configurationVersion !== (assignment.configurationVersion ?? 1)) {
    errors.push('Project assignment approval is stale because its configuration changed. Approve the assignment again.');
  }
  if (['compile', 'execute'].includes(action) && assignment?.approval && assignment.approval.workflowVersion !== workflowVersion) {
    errors.push('Project assignment approval is stale because the reusable workflow version changed. Approve an assignment for the current version.');
  }

  return { allowed: errors.length === 0, errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)) };
}

export function isWorkflowLifecycleAction(value: unknown): value is WorkflowLifecycleAction {
  return typeof value === 'string' && ['save-draft', 'replan', 'continue-unresolved', 'approve-definition', 'create-assignment', 'approve-assignment', 'compile', 'execute'].includes(value);
}
