export type WorkflowStatus = 'draft' | 'approved' | 'running' | 'paused' | 'completed' | 'failed';
import type { ProjectWorkflow, Skill } from './workspace';
import type { ModelSettings } from './model-settings';
import { modelSettingsErrors } from './model-settings';

export type NodeType = 'agent' | 'codex' | 'tool' | 'validation' | 'approval' | 'loop' | 'fork' | 'join' | 'success' | 'failure';
export type WorkflowValueType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
export type ApprovalOutcomeAction = 'continue' | 'revise' | 'stop';

export interface WorkflowApprovalOption {
  id: string;
  label: string;
  keyword: string;
  action: ApprovalOutcomeAction;
}

export interface WorkflowCompletionContract {
  requiredOutputKeys: string[];
  requiredArtifacts: string[];
}

export interface HarnessPolicy {
  sandboxMode: 'workspace' | 'read-only' | 'isolated';
  maxRetries: number;
  maxLoopIterations: number;
  maxConcurrentNodes: number;
  allowedTools: string[];
  allowedWorkspacePaths: string[];
  requireApprovalForDestructiveActions: boolean;
  adaptationEnabled?: boolean;
  adaptationScope?: 'run' | 'project' | 'user';
  parallelFailureMode?: 'fail-fast' | 'collect-all';
}

export interface WorkflowNode {
  id: string;
  name: string;
  type: NodeType;
  prompt: string;
  skillIds: string[];
  inputKeys: string[];
  outputKeys: string[];
  outputSchemas?: Record<string, WorkflowValueType>;
  requiredArtifacts?: string[];
  retryLimit: number;
  requiresApproval: boolean;
  /** User-facing outcomes for an approval gate. Route conditions use the exact keyword. */
  approvalOptions?: WorkflowApprovalOption[];
  modelSettings?: ModelSettings;
  /** A per-node downgrade, never an expansion of assignment permissions. */
  readOnly?: boolean;
  joinMode?: 'all' | 'quorum';
  joinQuorum?: number;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface WorkflowQuestionResponse {
  question: string;
  answer: string;
}

export interface WorkflowDefinitionApproval {
  approvedAt: string;
  approvedBy: { id: string; name: string; role: string };
  workflowVersion: number;
}

export interface WorkflowPlan {
  id: string;
  schemaVersion: number;
  name: string;
  description: string;
  domain?: string;
  version?: number;
  starter?: boolean;
  planningPrompt: string;
  workspacePath: string;
  constraints: string[];
  openQuestions: string[];
  questionResponses?: WorkflowQuestionResponse[];
  planningLogs?: string[];
  definitionApproval?: WorkflowDefinitionApproval;
  lastMutationKey?: string;
  lastMutationFingerprint?: string;
  mutationReceipts?: Record<string, string>;
  completionCriteria: string[];
  completionContract?: WorkflowCompletionContract;
  modelSettings?: ModelSettings;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  harness: HarnessPolicy;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
}

export const WORKFLOW_SCHEMA_VERSION = 1;

export const DEFAULT_HARNESS_POLICY: HarnessPolicy = {
  sandboxMode: 'read-only',
  maxRetries: 2,
  maxLoopIterations: 3,
  maxConcurrentNodes: 1,
  allowedTools: [],
  allowedWorkspacePaths: [],
  requireApprovalForDestructiveActions: true,
  adaptationEnabled: false,
  adaptationScope: 'run'
};

export type WorkflowDraftInput = Partial<WorkflowPlan> & Pick<WorkflowPlan, 'planningPrompt' | 'workspacePath'>;

export function createWorkflowDraft(input: WorkflowDraftInput): WorkflowPlan {
  const now = new Date().toISOString();
  return {
    id: input.id ?? `workflow_${crypto.randomUUID()}`,
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    name: input.name?.trim() || 'Untitled workflow',
    description: input.description?.trim() || '',
    domain: input.domain?.trim() || 'General',
    version: input.version ?? 1,
    starter: input.starter,
    planningPrompt: input.planningPrompt.trim(),
    workspacePath: input.workspacePath.trim(),
    constraints: input.constraints ?? [],
    openQuestions: input.openQuestions ?? [],
    questionResponses: input.questionResponses?.map((response) => ({ question: response.question.trim(), answer: response.answer.trim() })) ?? [],
    planningLogs: input.planningLogs?.map((entry) => entry.trim()).filter(Boolean) ?? [],
    definitionApproval: input.definitionApproval ? structuredClone(input.definitionApproval) : undefined,
    lastMutationKey: input.lastMutationKey?.trim() || undefined,
    lastMutationFingerprint: input.lastMutationFingerprint?.trim() || undefined,
    mutationReceipts: input.mutationReceipts ? { ...input.mutationReceipts } : undefined,
    completionCriteria: input.completionCriteria ?? [],
    completionContract: input.completionContract ? structuredClone(input.completionContract) : undefined,
    modelSettings: input.modelSettings ? structuredClone(input.modelSettings) : undefined,
    nodes: input.nodes ?? [],
    edges: input.edges ?? [],
    harness: { ...DEFAULT_HARNESS_POLICY, ...(input.harness ?? {}) },
    status: input.status ?? 'draft',
    createdAt: input.createdAt ?? now,
    updatedAt: now
  };
}

/** Editing a reviewed definition invalidates its approval, not its graph contracts. */
export function draftWorkflowPlan(plan: WorkflowPlan): WorkflowPlan {
  return { ...plan, status: 'draft', definitionApproval: undefined, updatedAt: new Date().toISOString() };
}

export function validateWorkflowPlan(plan: unknown): string[] {
  const value = plan as Partial<WorkflowPlan> | null;
  const errors: string[] = [];
  const nodeTypes: NodeType[] = ['agent', 'codex', 'tool', 'validation', 'approval', 'loop', 'fork', 'join', 'success', 'failure'];
  const statuses: WorkflowStatus[] = ['draft', 'approved', 'running', 'paused', 'completed', 'failed'];
  if (!value || typeof value !== 'object') return ['Workflow plan must be an object.'];
  const validStringArray = (candidate: unknown): candidate is string[] => Array.isArray(candidate) && candidate.every((item) => typeof item === 'string' && item.trim());
  const hasDuplicates = (items: string[]) => new Set(items).size !== items.length;
  if (typeof value.id !== 'string' || !value.id.trim()) errors.push('Workflow plan is missing an id.');
  if (value.schemaVersion !== WORKFLOW_SCHEMA_VERSION) errors.push(`Unsupported workflow schema version: ${value.schemaVersion}.`);
  if (typeof value.name !== 'string' || !value.name.trim()) errors.push('Workflow name is required.');
  if (typeof value.description !== 'string') errors.push('Workflow description must be a string.');
  if (value.domain !== undefined && (typeof value.domain !== 'string' || !value.domain.trim())) errors.push('Workflow domain cannot be empty.');
  if (value.version !== undefined && (!Number.isInteger(value.version) || value.version < 1)) errors.push('Workflow version must be a positive integer.');
  if (typeof value.planningPrompt !== 'string' || !value.planningPrompt.trim()) errors.push('Planning prompt is required.');
  if (typeof value.workspacePath !== 'string' || !value.workspacePath.trim()) errors.push('Workspace path is required.');
  if (!validStringArray(value.constraints)) errors.push('Workflow constraints must contain non-empty strings.');
  if (!Array.isArray(value.openQuestions) || value.openQuestions.some((question) => typeof question !== 'string' || !question.trim())) errors.push('Open questions must contain non-empty strings.');
  if (value.planningLogs !== undefined && (!Array.isArray(value.planningLogs) || value.planningLogs.some((entry) => typeof entry !== 'string' || !entry.trim()))) errors.push('Planning logs must contain non-empty strings.');
  errors.push(...modelSettingsErrors(value.modelSettings).map((error) => `Workflow: ${error}`));
  if (Array.isArray(value.nodes)) for (const node of value.nodes) errors.push(...modelSettingsErrors(node?.modelSettings).map((error) => `Node ${node?.name ?? 'unknown'}: ${error}`));
  if (!validStringArray(value.completionCriteria)) errors.push('Completion criteria must contain non-empty strings.');
  if (!Array.isArray(value.nodes)) errors.push('Nodes must be an array.');
  if (!Array.isArray(value.edges)) errors.push('Edges must be an array.');
  if (Array.isArray(value.nodes) && value.nodes.length > 500) errors.push('Workflow cannot contain more than 500 nodes.');
  if (Array.isArray(value.edges) && value.edges.length > 2000) errors.push('Workflow cannot contain more than 2000 connections.');
  if (value.lastMutationKey !== undefined && (typeof value.lastMutationKey !== 'string' || !value.lastMutationKey.trim() || value.lastMutationKey.length > 128)) errors.push('Workflow mutation key is invalid.');
  if (value.lastMutationFingerprint !== undefined && (typeof value.lastMutationFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.lastMutationFingerprint))) errors.push('Workflow mutation fingerprint is invalid.');
  if (value.mutationReceipts !== undefined && (!value.mutationReceipts || typeof value.mutationReceipts !== 'object' || Array.isArray(value.mutationReceipts) || Object.keys(value.mutationReceipts).length > 100 || Object.entries(value.mutationReceipts).some(([key, fingerprint]) => !key.trim() || key.length > 128 || !/^[a-f0-9]{64}$/.test(fingerprint)))) errors.push('Workflow mutation receipts are invalid.');
  if (value.completionContract !== undefined) {
    if (!value.completionContract || !validStringArray(value.completionContract.requiredOutputKeys) || !validStringArray(value.completionContract.requiredArtifacts) || hasDuplicates(value.completionContract.requiredOutputKeys ?? []) || hasDuplicates(value.completionContract.requiredArtifacts ?? [])) errors.push('Workflow completion contract is invalid.');
  }
  if (value.questionResponses !== undefined && (!Array.isArray(value.questionResponses) || value.questionResponses.some((response) => !response || typeof response.question !== 'string' || !response.question.trim() || typeof response.answer !== 'string'))) errors.push('Question responses must contain a question and answer string.');
  if (value.definitionApproval !== undefined) {
    const approval = value.definitionApproval;
    if (!approval || typeof approval !== 'object' || typeof approval.approvedAt !== 'string' || Number.isNaN(Date.parse(approval.approvedAt)) || typeof approval.approvedBy?.id !== 'string' || !approval.approvedBy.id.trim() || typeof approval.approvedBy.name !== 'string' || !approval.approvedBy.name.trim() || typeof approval.approvedBy.role !== 'string' || !approval.approvedBy.role.trim() || !Number.isInteger(approval.workflowVersion) || approval.workflowVersion < 1) errors.push('Workflow definition approval metadata is invalid.');
    if (value.status !== 'approved') errors.push('Only an approved workflow may retain definition approval metadata.');
    if (approval?.workflowVersion !== value.version) errors.push('Workflow definition approval references a stale workflow version.');
  }
  if (!value.harness || typeof value.harness !== 'object') errors.push('Harness policy is required.');
  if (typeof value.status !== 'string' || !statuses.includes(value.status as WorkflowStatus)) errors.push(`Unsupported workflow status: ${String(value.status)}.`);
  if (value.harness && typeof value.harness === 'object') {
    if (!['workspace', 'read-only', 'isolated'].includes(value.harness.sandboxMode)) errors.push('Harness sandbox mode is invalid.');
    if (!Number.isInteger(value.harness.maxRetries) || value.harness.maxRetries < 0 || value.harness.maxRetries > 10) errors.push('Maximum retries must be between 0 and 10.');
    if (!Number.isInteger(value.harness.maxLoopIterations) || value.harness.maxLoopIterations < 1 || value.harness.maxLoopIterations > 100) errors.push('Maximum loop iterations must be between 1 and 100.');
    if (!Number.isInteger(value.harness.maxConcurrentNodes) || value.harness.maxConcurrentNodes < 1 || value.harness.maxConcurrentNodes > 10) errors.push('Maximum concurrency must be between 1 and 10.');
    if (!validStringArray(value.harness.allowedTools)) errors.push('Allowed tools must contain non-empty strings.');
    else if (value.harness.allowedTools.length > 100 || hasDuplicates(value.harness.allowedTools)) errors.push('Allowed tools must be unique and cannot contain more than 100 entries.');
    if (!Array.isArray(value.harness.allowedWorkspacePaths) || value.harness.allowedWorkspacePaths.some((item) => typeof item !== 'string' || !item.trim())) errors.push('Allowed workspace paths must contain strings.');
    else if (hasDuplicates(value.harness.allowedWorkspacePaths)) errors.push('Allowed workspace paths must be unique.');
    if (typeof value.harness.requireApprovalForDestructiveActions !== 'boolean') errors.push('Destructive-action approval policy must be a boolean.');
    if (value.harness.parallelFailureMode !== undefined && !['fail-fast', 'collect-all'].includes(value.harness.parallelFailureMode)) errors.push('Parallel failure mode is invalid.');
    if (value.harness.adaptationEnabled !== undefined && typeof value.harness.adaptationEnabled !== 'boolean') errors.push('Harness adaptation setting must be a boolean.');
    if (value.harness.adaptationScope !== undefined && !['run', 'project', 'user'].includes(value.harness.adaptationScope)) errors.push('Harness adaptation scope is invalid.');
  }
  if (Array.isArray(value.nodes)) {
    const ids = new Set<string>();
    value.nodes.forEach((node, index) => {
      if (!node || typeof node !== 'object') { errors.push(`Node ${index + 1} must be an object.`); return; }
      const candidate = node as Partial<WorkflowNode>;
      if (typeof candidate.id !== 'string' || !candidate.id.trim()) errors.push(`Node ${index + 1} is missing an id.`);
      else if (ids.has(candidate.id)) errors.push(`Node id is duplicated: ${candidate.id}.`);
      else ids.add(candidate.id);
      if (typeof candidate.name !== 'string' || !candidate.name.trim()) errors.push(`Node ${candidate.id ?? index + 1} is missing a name.`);
      if (!nodeTypes.includes(candidate.type as NodeType)) errors.push(`Node ${candidate.id ?? index + 1} has an invalid type.`);
      if (candidate.readOnly !== undefined && typeof candidate.readOnly !== 'boolean') errors.push(`Node ${candidate.id} read-only flag is invalid.`);
      if (candidate.joinMode !== undefined && !['all', 'quorum'].includes(candidate.joinMode)) errors.push(`Node ${candidate.id} join mode is invalid.`);
      if (candidate.joinQuorum !== undefined && (!Number.isInteger(candidate.joinQuorum) || candidate.joinQuorum < 1 || candidate.joinQuorum > 100)) errors.push(`Node ${candidate.id} quorum is invalid.`);
      if (typeof candidate.prompt !== 'string') errors.push(`Node ${candidate.id ?? index + 1} is missing a prompt.`);
      if (!validStringArray(candidate.skillIds) || !validStringArray(candidate.inputKeys) || !validStringArray(candidate.outputKeys)) errors.push(`Node ${candidate.id ?? index + 1} has invalid key or skill arrays.`);
      else if (hasDuplicates(candidate.skillIds) || hasDuplicates(candidate.inputKeys) || hasDuplicates(candidate.outputKeys)) errors.push(`Node ${candidate.id ?? index + 1} has duplicate keys or skills.`);
      if (candidate.outputSchemas !== undefined) {
        const allowedTypes: WorkflowValueType[] = ['string', 'number', 'boolean', 'object', 'array', 'null'];
        if (!candidate.outputSchemas || typeof candidate.outputSchemas !== 'object' || Array.isArray(candidate.outputSchemas) || Object.entries(candidate.outputSchemas).some(([key, type]) => !candidate.outputKeys?.includes(key) || !allowedTypes.includes(type))) errors.push(`Node ${candidate.id ?? index + 1} has invalid output schemas.`);
      }
      if (candidate.requiredArtifacts !== undefined && (!validStringArray(candidate.requiredArtifacts) || hasDuplicates(candidate.requiredArtifacts))) errors.push(`Node ${candidate.id ?? index + 1} has invalid required artifact labels.`);
      if (!Number.isInteger(candidate.retryLimit) || (candidate.retryLimit as number) < 0 || (candidate.retryLimit as number) > 10) errors.push(`Node ${candidate.id ?? index + 1} retry limit must be between 0 and 10.`);
      if (typeof candidate.requiresApproval !== 'boolean') errors.push(`Node ${candidate.id ?? index + 1} has an invalid approval flag.`);
      if (candidate.approvalOptions !== undefined) {
        const options = candidate.approvalOptions;
        const validActions: ApprovalOutcomeAction[] = ['continue', 'revise', 'stop'];
        if (!Array.isArray(options) || options.some((option) => !option || typeof option.id !== 'string' || !option.id.trim() || typeof option.label !== 'string' || !option.label.trim() || typeof option.keyword !== 'string' || !option.keyword.trim() || !validActions.includes(option.action))) {
          errors.push(`Node ${candidate.id ?? index + 1} has invalid approval outcomes.`);
        } else {
          const ids = options.map((option) => option.id.trim().toLowerCase());
          const keywords = options.map((option) => option.keyword.trim().toLowerCase());
          if (hasDuplicates(ids) || hasDuplicates(keywords)) errors.push(`Node ${candidate.id ?? index + 1} approval outcomes must use unique ids and keywords.`);
          if (options.length > 8) errors.push(`Node ${candidate.id ?? index + 1} cannot have more than 8 approval outcomes.`);
          if (candidate.type !== 'approval' && options.length) errors.push(`Node ${candidate.id ?? index + 1} can define approval outcomes only when its type is approval.`);
        }
      }
    });
    if (Array.isArray(value.edges)) value.edges.forEach((edge, index) => {
      if (!edge || typeof edge !== 'object') { errors.push(`Edge ${index + 1} must be an object.`); return; }
      const candidate = edge as Partial<WorkflowEdge>;
      if (typeof candidate.from !== 'string' || !ids.has(candidate.from)) errors.push(`Edge ${index + 1} references an unknown source node.`);
      if (typeof candidate.to !== 'string' || !ids.has(candidate.to)) errors.push(`Edge ${index + 1} references an unknown target node.`);
      if (candidate.condition !== undefined && typeof candidate.condition !== 'string') errors.push(`Edge ${index + 1} has an invalid condition.`);
    });
    if (Array.isArray(value.edges)) {
      for (const node of value.nodes as WorkflowNode[]) {
        if (node.type !== 'approval' || !node.approvalOptions?.length) continue;
        const routeConditions = new Set(value.edges.filter((edge) => edge.from === node.id).map((edge) => edge.condition?.trim().toLowerCase()).filter(Boolean));
        for (const option of node.approvalOptions) {
          if (option.action !== 'stop' && !routeConditions.has(option.keyword.trim().toLowerCase())) {
            errors.push(`Approval outcome ${option.label} on ${node.name} needs an outgoing route whose condition is exactly "${option.keyword}".`);
          }
        }
      }
    }
  }
  return errors;
}

export function validateWorkflowQuestionsResolved(plan: Pick<WorkflowPlan, 'openQuestions' | 'questionResponses'>): string[] {
  const errors: string[] = [];
  if (plan.openQuestions.some((question) => question.trim())) errors.push('Answer every open question before adding the workflow to the library.');
  const incompleteResponses = (plan.questionResponses ?? []).filter((response) => !response.question.trim() || !response.answer.trim());
  if (incompleteResponses.length) errors.push('Every planning question requires a non-empty answer.');
  return errors;
}

export interface GraphValidationResult {
  errors: string[];
  warnings: string[];
  reachableNodeIds: string[];
}

export interface GraphValidationOptions {
  /** Planning may reference a proposed skill that is materialized only when the workflow is saved. */
  allowUnavailableSkills?: boolean;
}

const TERMINAL_NODE_TYPES = new Set<NodeType>(['success', 'failure']);
const EXECUTABLE_NODE_TYPES = new Set<NodeType>(['agent', 'codex', 'tool', 'validation', 'loop']);

function reachableFrom(entryIds: string[], edges: WorkflowEdge[]): Set<string> {
  const reachable = new Set(entryIds);
  const queue = [...entryIds];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const edge of edges.filter((candidate) => candidate.from === current)) {
      if (reachable.has(edge.to)) continue;
      reachable.add(edge.to);
      queue.push(edge.to);
    }
  }
  return reachable;
}

function edgeKey(edge: Pick<WorkflowEdge, 'from' | 'to'>): string {
  return `${edge.from}->${edge.to}`;
}

function pathExists(from: string, to: string, edges: WorkflowEdge[], excluded?: WorkflowEdge): boolean {
  const queue = [from];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift() as string;
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...edges.filter((edge) => edge !== excluded && edge.from === current).map((edge) => edge.to));
  }
  return false;
}

export function boundedLoopBackEdgeKeys(plan: { nodes: Array<Pick<WorkflowNode, 'id' | 'type'>>; edges: WorkflowEdge[] }): Set<string> {
  const nodes = new Map(plan.nodes.map((node) => [node.id, node]));
  return new Set(plan.edges.filter((edge) => nodes.get(edge.from)?.type === 'loop' && pathExists(edge.to, edge.from, plan.edges, edge)).map(edgeKey));
}

/** Cutting bounded edges must not turn a revision-only branch into a new start. */
export function workflowEntryNodeIds(plan: { nodes: Array<Pick<WorkflowNode, 'id' | 'type'>>; edges: WorkflowEdge[] }): string[] {
  const bounded = boundedLoopBackEdgeKeys(plan);
  const incoming = new Set(plan.edges.filter((edge) => !bounded.has(edgeKey(edge))).map((edge) => edge.to));
  const candidates = plan.nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id);
  return candidates.filter((id, index) => !candidates.some((other, otherIndex) => other !== id
    && pathExists(other, id, plan.edges)
    && (!pathExists(id, other, plan.edges) || otherIndex < index)));
}

export function workflowExternalInputKeys(plan: Pick<WorkflowPlan, 'nodes'>): string[] {
  const producers = new Map<string, Set<string>>();
  for (const node of plan.nodes) for (const key of node.outputKeys) producers.set(key, new Set([...(producers.get(key) ?? []), node.id]));
  return Array.from(new Set(plan.nodes.flatMap((node) => node.inputKeys.filter((key) => {
    const producerIds = producers.get(key);
    return !producerIds?.size || Array.from(producerIds).every((producerId) => producerId === node.id);
  }))));
}

export function unboundedWorkflowCycle(plan: Pick<WorkflowPlan, 'nodes' | 'edges'>): string[] | undefined {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const boundedEdges = boundedLoopBackEdgeKeys(plan);
  const outgoing = new Map<string, string[]>();
  for (const edge of plan.edges) {
    if (boundedEdges.has(edgeKey(edge))) continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }

  function visit(id: string): string[] | undefined {
    if (visiting.has(id)) return [...stack.slice(stack.indexOf(id)), id];
    if (visited.has(id)) return undefined;
    visiting.add(id);
    stack.push(id);
    for (const target of outgoing.get(id) ?? []) {
      const cycle = visit(target);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(id); visited.add(id);
    return undefined;
  }
  for (const node of plan.nodes) {
    const cycle = visit(node.id);
    if (cycle) return cycle;
  }
  return undefined;
}

export function validateWorkflowGraph(plan: WorkflowPlan, skills: Skill[] = [], assignment?: ProjectWorkflow, options: GraphValidationOptions = {}): GraphValidationResult {
  const errors = validateWorkflowPlan(plan);
  const warnings: string[] = [];
  if (errors.length) return { errors, warnings, reachableNodeIds: [] };
  if (!plan.nodes.length) errors.push('Graph must contain at least one node.');
  if (!plan.completionCriteria.length || plan.completionCriteria.some((criterion) => !criterion.trim())) errors.push('At least one non-empty completion criterion is required before approval.');
  if (plan.completionContract) {
    const declaredOutputs = new Set(plan.nodes.flatMap((node) => node.outputKeys));
    const declaredArtifacts = new Set(plan.nodes.flatMap((node) => node.requiredArtifacts ?? []).map((label) => label.trim().toLowerCase()));
    for (const key of plan.completionContract.requiredOutputKeys) if (!declaredOutputs.has(key)) errors.push(`Completion contract references an undeclared output: ${key}.`);
    for (const label of plan.completionContract.requiredArtifacts) if (!declaredArtifacts.has(label.trim().toLowerCase())) errors.push(`Completion contract references an undeclared artifact: ${label}.`);
  }

  const outgoing = new Map(plan.nodes.map((node) => [node.id, 0]));
  const loopBackEdges = boundedLoopBackEdgeKeys(plan);
  const forwardEdges = plan.edges.filter((edge) => !loopBackEdges.has(edgeKey(edge)));
  const loopParticipantIds = new Set<string>();
  for (const edge of plan.edges.filter((candidate) => loopBackEdges.has(edgeKey(candidate)))) {
    for (const node of plan.nodes) {
      if (pathExists(edge.to, node.id, forwardEdges) && pathExists(node.id, edge.from, forwardEdges)) loopParticipantIds.add(node.id);
    }
  }
  const outputProducers = new Map<string, WorkflowNode[]>();
  for (const node of plan.nodes) {
    for (const key of node.outputKeys) outputProducers.set(key, [...(outputProducers.get(key) ?? []), node]);
  }
  for (const [key, producers] of outputProducers) {
    if (producers.length < 2) continue;
    const isBoundedRevisionState = producers.some((producer) => loopParticipantIds.has(producer.id))
      && producers.every((producer, index) => producers.slice(index + 1).every((candidate) => pathExists(producer.id, candidate.id, plan.edges) || pathExists(candidate.id, producer.id, plan.edges)));
    if (!isBoundedRevisionState) errors.push(`Output key has multiple producers: ${key} (${producers.map((producer) => producer.name).join(' and ')}).`);
  }
  const edgeKeys = new Set<string>();
  for (const edge of plan.edges) {
    const key = `${edge.from}->${edge.to}`;
    if (edge.from === edge.to) errors.push(`Self connection is not allowed: ${edge.from}.`);
    if (edgeKeys.has(key)) errors.push(`Connection is duplicated: ${key}.`);
    edgeKeys.add(key);
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  }

  const entries = workflowEntryNodeIds(plan);
  const initialPath = reachableFrom(entries, forwardEdges);
  if (!entries.length && plan.nodes.length) errors.push('Graph has no entry node.');
  if (entries.length > 1) warnings.push(`Graph has ${entries.length} entry nodes; confirm that parallel starts are intentional.`);
  const reachable = entries.length ? reachableFrom(entries, plan.edges) : new Set<string>();
  const externalInputs = new Set(workflowExternalInputKeys(plan));
  for (const node of plan.nodes) {
    if (node.type === 'fork' && (node.outputKeys.length || node.requiredArtifacts?.length || node.skillIds.length || node.requiresApproval || plan.edges.some((edge) => edge.from === node.id && edge.condition?.trim()))) errors.push(`Fork ${node.name} must have unconditional routes, no outputs, files or skills, and no approval.`);
    if (node.type === 'join') {
      if (node.outputKeys.length !== 1 || node.skillIds.length || node.requiresApproval) errors.push(`Join ${node.name} requires one object output, no skills, and no approval.`);
      if (node.inputKeys.length || node.requiredArtifacts?.length || plan.edges.some((edge) => edge.from === node.id && edge.condition?.trim())) errors.push(`Join ${node.name} receives branch state directly, emits no files, and requires unconditional continuation.`);
      if (node.outputSchemas?.[node.outputKeys[0]] && node.outputSchemas[node.outputKeys[0]] !== 'object') errors.push(`Join ${node.name} output must be an object.`);
      if (node.joinMode === 'quorum' && (node.joinQuorum ?? 1) > plan.edges.filter((edge) => edge.to === node.id).length) errors.push(`Join ${node.name} quorum exceeds its branch count.`);
    }
    if (entries.length && !reachable.has(node.id)) errors.push(`Node is unreachable: ${node.name}.`);
    if (EXECUTABLE_NODE_TYPES.has(node.type) && !node.prompt.trim()) errors.push(`Node instructions are required: ${node.name}.`);
    if (!TERMINAL_NODE_TYPES.has(node.type) && (outgoing.get(node.id) ?? 0) === 0) errors.push(`Workflow path is incomplete after: ${node.name}.`);
    if (TERMINAL_NODE_TYPES.has(node.type) && (outgoing.get(node.id) ?? 0) > 0) errors.push(`Terminal node cannot have a continuation: ${node.name}.`);
    const ancestors = new Set<string>();
    const queue = forwardEdges.filter((edge) => edge.to === node.id).map((edge) => edge.from);
    while (queue.length) {
      const ancestorId = queue.shift() as string;
      if (ancestors.has(ancestorId)) continue;
      ancestors.add(ancestorId);
      queue.push(...forwardEdges.filter((edge) => edge.to === ancestorId).map((edge) => edge.from));
    }
    const availableInputs = new Set(plan.nodes.filter((candidate) => ancestors.has(candidate.id)).flatMap((candidate) => candidate.outputKeys));
    const carriedInputs = new Set<string>();
    const initializedCarriedInputs = new Set<string>();
    const conditionallyCarriedInputs = new Set<string>();
    for (const edge of plan.edges.filter((candidate) => loopBackEdges.has(edgeKey(candidate)))) {
      if (edge.to !== node.id && !pathExists(edge.to, node.id, forwardEdges)) continue;
      const cycleReachable = reachableFrom([edge.to], forwardEdges);
      if (!initialPath.has(node.id)) {
        for (const output of plan.nodes.filter((candidate) => initialPath.has(candidate.id) && pathExists(candidate.id, edge.from, forwardEdges)).flatMap((candidate) => candidate.outputKeys)) initializedCarriedInputs.add(output);
      }
      const valuesEnteringLoop = plan.nodes
        .filter((candidate) => candidate.id === edge.to || pathExists(candidate.id, edge.to, forwardEdges)
          // Context produced on the initial path remains available when the
          // loop enters a revision-only branch for the first time.
          || (initialPath.has(candidate.id) && pathExists(candidate.id, edge.from, forwardEdges)))
        .flatMap((candidate) => candidate.outputKeys);
      for (const output of valuesEnteringLoop) carriedInputs.add(output);
      for (const output of plan.nodes.filter((candidate) => cycleReachable.has(candidate.id) && pathExists(candidate.id, edge.from, forwardEdges)).flatMap((candidate) => candidate.outputKeys)) {
        carriedInputs.add(output);
        if (edge.to !== node.id) conditionallyCarriedInputs.add(output);
      }
    }
    for (const inputKey of node.inputKeys) {
      if (!availableInputs.has(inputKey) && !externalInputs.has(inputKey) && !carriedInputs.has(inputKey)) errors.push(`Node ${node.name} is missing input: ${inputKey}.`);
      else if (!availableInputs.has(inputKey) && !initializedCarriedInputs.has(inputKey) && conditionallyCarriedInputs.has(inputKey)) warnings.push(`Node ${node.name} receives ${inputKey} only after a loop; its instructions must handle the value being absent on the first pass.`);
    }
  }
  if (entries.length && !plan.nodes.some((node) => node.type === 'success' && reachable.has(node.id))) errors.push('Graph needs a reachable success node.');
  if (entries.length && !plan.nodes.some((node) => node.type === 'failure' && reachable.has(node.id))) errors.push('Graph needs a reachable failure node.');
  if (unboundedWorkflowCycle(plan)) errors.push('Graph contains a cycle outside a bounded loop node.');

  const selectedReferences = assignment?.selectedSkills ?? [];
  const selectedIds = new Set(selectedReferences.map((reference) => reference.skillId));
  for (const node of plan.nodes) {
    for (const skillId of node.skillIds) {
      const skill = skills.find((candidate) => candidate.id === skillId);
      if (!skill) {
        if (!options.allowUnavailableSkills) errors.push(`Node ${node.name} references an unavailable skill: ${skillId}.`);
        continue;
      }
      if (assignment && !selectedIds.has(skillId)) errors.push(`Node ${node.name} uses a skill not selected for this assignment: ${skill.name}.`);
    }
  }
  for (const reference of selectedReferences) {
    const skill = skills.find((candidate) => candidate.id === reference.skillId && candidate.version === reference.version);
    if (!skill) errors.push(`Pinned skill version is unavailable: ${reference.skillId}@${reference.version}.`);
    else {
      if (skill.status !== 'published') errors.push(`Pinned skill is not active: ${skill.name}@${skill.version}.`);
      const unavailablePermissions = skill.requiredPermissions.filter((permission) => !assignment?.permissions.allowedTools.includes(permission));
      if (unavailablePermissions.length) errors.push(`${skill.name} needs unavailable permissions: ${unavailablePermissions.join(', ')}.`);
      if (skill.estimatedContextTokens > 4000) warnings.push(`${skill.name} has a large context estimate (${skill.estimatedContextTokens.toLocaleString()} tokens).`);
      if (Date.now() - Date.parse(skill.updatedAt) > 180 * 24 * 60 * 60 * 1000) warnings.push(`${skill.name} has not been updated in more than 180 days.`);
    }
  }
  const selectedContextTokens = selectedReferences.reduce((total, reference) => total + (skills.find((skill) => skill.id === reference.skillId && skill.version === reference.version)?.estimatedContextTokens ?? 0), 0);
  if (selectedContextTokens > 100000) errors.push(`Selected skills exceed the 100,000-token context limit (${selectedContextTokens.toLocaleString()} tokens).`);
  const instructionOwners = new Map<string, string>();
  for (const skill of skills.filter((candidate) => selectedIds.has(candidate.id))) {
    const normalized = skill.instructions.toLowerCase().replace(/\s+/g, ' ').trim();
    const owner = instructionOwners.get(normalized);
    if (owner) warnings.push(`${skill.name} overlaps substantially with ${owner}.`);
    else instructionOwners.set(normalized, skill.name);
  }
  if (!assignment) warnings.push('Choose a project and create an assignment before execution.');
  return { errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)), reachableNodeIds: Array.from(reachable) };
}
