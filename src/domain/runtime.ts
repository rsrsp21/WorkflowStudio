import { workflowEntryNodeIds, validateWorkflowGraph, type ApprovalOutcomeAction, type HarnessPolicy, type NodeType, type WorkflowApprovalOption, type WorkflowCompletionContract, type WorkflowEdge, type WorkflowPlan, type WorkflowValueType } from './models';
import { resolveModelSettings, validModelSettings, type ModelSettings, type ResolvedModelSettings } from './model-settings';
import type { ProjectWorkflow, Skill, SkillVersionReference } from './workspace';
import { assertRuntimeWorkspaceBoundary, canonicalWorkspacePath, isWithinWorkspaceRoot } from './workspace-boundary';
import { WORKFLOW_RUNTIME_VERSION, type WorkflowRuntimeEngine } from './runtime-rollout';

export const RUN_SCHEMA_VERSION = 2;
export const COMPILED_WORKFLOW_SCHEMA_VERSION = 2;

export type WorkflowRunStatus = 'compiled' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type NodeRunStatus = 'pending' | 'running' | 'waiting-approval' | 'completed' | 'failed' | 'skipped';
export type RuntimeFailureKind = 'validation' | 'tool' | 'human-rejection' | 'missing-context' | 'blocked-action';
export type EdgeRunStatus = 'pending' | 'selected' | 'rejected';
export type RuntimeApprovalDecision = 'approved' | 'rejected' | 'revision-requested';
export type RunEventType =
  | 'node.delivery-progress'
  | 'node.runtime-waiting'
  | 'run.compiled'
  | 'run.settings-updated'
  | 'node.started'
  | 'node.waiting-approval'
  | 'node.input-requested'
  | 'node.input-provided'
  | 'node.completed'
  | 'node.retry-scheduled'
  | 'node.failed'
  | 'node.recovered'
  | 'approval.approved'
  | 'approval.rejected'
  | 'approval.revision-requested'
  | 'approval.resumed'
  | 'adaptation.approved'
  | 'adaptation.rejected'
  | 'route.selected'
  | 'loop.iterated'
  | 'loop.exhausted'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled';

export interface HarnessV2Contract {
  schemaVersion: 2;
  identityAndBehavior: {
    purpose: string;
    agentRole: string;
    skills: Array<{ skillId: string; version: number; source: string; integrity: string }>;
    contextManifest: Array<{ key: string; source: 'assignment'; inclusionReason: string }>;
    contextBudgetTokens: number;
    adaptationAllowed: boolean;
  };
  runtime: {
    engine: 'Mastra';
    taskExecutor: 'Codex App Server';
    sandboxMode: HarnessPolicy['sandboxMode'];
    allowedTools: string[];
    allowedWorkspacePaths: string[];
    maxRetries: number;
    maxLoopIterations: number;
    maxConcurrentNodes: number;
    nodeTimeoutMs: number;
    cancellationMode: 'checkpoint-and-provider-interrupt';
  };
  observability: {
    correlation: { runId: string; workflowId: string; assignmentId: string; projectId: string };
    capturedMetrics: string[];
    unavailableMetrics: string[];
    redactionPolicyVersion: 1;
  };
  verification: {
    completionCriteria: string[];
    requiredOutputKeys: string[];
    requiredArtifacts: string[];
    humanGateNodeIds: string[];
    agentOutputAloneCanComplete: false;
  };
  adaptation: {
    enabled: boolean;
    promotionRequiresHumanApproval: true;
    prohibitedSelfModification: true;
    allowedScopes: Array<'run' | 'project' | 'user'>;
  };
  governanceAndSecurity: {
    policyVersion: 1;
    ownerUserId: string;
    projectId: string;
    workflowId: string;
    assignmentId: string;
    leastPrivilege: true;
    requireApprovalForDestructiveActions: boolean;
    auditJournal: 'append-only';
    retentionDays: number;
  };
  compiledAt: string;
}

export interface NodeVerificationResult {
  id: string;
  nodeId: string;
  taskId: string;
  status: 'passed' | 'failed';
  checks: string[];
  evidenceArtifactIds: string[];
  verifiedAt: string;
  failureKind?: RuntimeFailureKind;
  message: string;
}

export interface AdaptationCandidate {
  id: string;
  nodeId: string;
  sourceEventId: string;
  scope: 'run' | 'project' | 'user';
  summary: string;
  status: 'proposed' | 'approved' | 'rejected';
  createdAt: string;
  decidedAt?: string;
  decidedBy?: { id: string; name: string; role: string };
  decisionNote?: string;
}

export interface ApprovedAdaptationReference {
  id: string;
  scope: 'project' | 'user';
  projectId: string;
  workflowId: string;
  nodeId: string;
  sourceRunId: string;
  summary: string;
  approvedAt: string;
}

export interface CompiledWorkflowNode {
  readOnly?: boolean;
  joinMode?: 'all' | 'quorum';
  joinQuorum?: number;
  id: string;
  name: string;
  type: NodeType;
  focusedPrompt: string;
  skillVersions: SkillVersionReference[];
  skillSnapshots?: Array<{
    id: string;
    name: string;
    version: number;
    instructions: string;
    requiredContext: string[];
    requiredPermissions: string[];
    validationCriteria: string[];
    source: string;
    integrity: string;
  }>;
  inputKeys: string[];
  outputKeys: string[];
  outputSchemas?: Record<string, WorkflowValueType>;
  requiredArtifacts?: string[];
  retryLimit: number;
  requiresApproval: boolean;
  approvalOptions?: WorkflowApprovalOption[];
  modelSettings: ResolvedModelSettings;
}

export interface CompiledWorkflow {
  schemaVersion: number;
  sourcePlanId: string;
  workflowId: string;
  workflowVersion: number;
  assignmentId: string;
  assignmentConfigurationVersion: number;
  projectId: string;
  rootPath: string;
  assignmentInputs: Record<string, string>;
  entryNodeIds: string[];
  nodes: CompiledWorkflowNode[];
  edges: WorkflowEdge[];
  harness: HarnessPolicy;
  harnessV2: HarnessV2Contract;
  maxLoopIterations: number;
  completionContract?: WorkflowCompletionContract;
  approvedAdaptations?: ApprovedAdaptationReference[];
  organizationId?: string;
  modelSettings: ModelSettings;
  compiledAt: string;
}

export interface NodeRun {
  deliveryStage?: 'executing' | 'verifying' | 'uploading' | 'blocked' | 'applied';
  nodeId: string;
  taskId: string;
  status: NodeRunStatus;
  attempt: number;
  iteration: number;
  input?: Record<string, unknown>;
  /** Selected-path context captured before a bounded revision resets its edges. */
  loopCarriedInput?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  output?: Record<string, unknown>;
  selectedCondition?: string;
  summary?: string;
  artifactIds: string[];
  providerThreadId?: string;
  runtimeJobId?: string;
  runtimeConnectionId?: string;
  error?: string;
  failureKind?: RuntimeFailureKind;
  approvalGranted?: boolean;
  executionSettings?: { revision: number; modelSettings: ResolvedModelSettings; harness: HarnessPolicy };
}

export interface RuntimeApprovalRecord {
  id: string;
  nodeId: string;
  taskId: string;
  attempt: number;
  iteration: number;
  requestedAt: string;
  decision?: RuntimeApprovalDecision;
  decidedAt?: string;
  decidedBy?: { id: string; name: string; role: string };
  feedback?: string;
  selectedOptionId?: string;
  keyword?: string;
  outcomeAction?: ApprovalOutcomeAction;
  resumedAt?: string;
  resumedBy?: { id: string; name: string; role: string };
}

export interface RunLifecycleContext {
  planning: {
    createdAt: string;
    unresolvedQuestions: string[];
    answeredQuestionCount: number;
  };
  definitionApproval?: {
    approvedAt: string;
    approvedBy: { id: string; name: string; role: string };
    workflowVersion: number;
  };
  assignmentApproval?: {
    approvedAt: string;
    approvedBy: { id: string; name: string; role: string };
    workflowVersion: number;
    configurationVersion: number;
  };
}

export interface EdgeRun {
  edgeIndex: number;
  from: string;
  to: string;
  condition: string;
  status: EdgeRunStatus;
  traversalCount: number;
}

export interface RunArtifact {
  id: string;
  runId: string;
  nodeId: string;
  taskId: string;
  path: string;
  description: string;
  rootPath: string;
  sandboxMode: HarnessPolicy['sandboxMode'];
  writeAllowed: boolean;
  createdAt: string;
}

export interface RunEvent {
  id: string;
  sequence: number;
  runId: string;
  type: RunEventType;
  timestamp: string;
  nodeId?: string;
  taskId?: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface WorkflowRun {
  /** Optimistic concurrency revision; legacy persisted runs begin at zero. */
  stateRevision?: number;
  /** Set only after an authorized execution request; background workers never auto-start historical runs. */
  executionRequested?: boolean;
  actionReceipts?: Record<string, string>;
  runtimeWaiting?: { nodeId: string; since: string; message: string };
  id: string;
  schemaVersion: number;
  userId: string;
  projectId: string;
  workflowId: string;
  workflowVersion: number;
  assignmentId: string;
  assignmentConfigurationVersion: number;
  sourcePlanId: string;
  rootPath: string;
  status: WorkflowRunStatus;
  compiledWorkflow: CompiledWorkflow;
  runtimeInputs?: Record<string, string>;
  pendingInput?: { nodeId: string; keys: string[] };
  executionConfiguration?: { revision: number; modelSettings: ModelSettings; harness: HarnessPolicy; updatedAt: string; updatedBy: { id: string; name: string; role: string } };
  nodeRuns: NodeRun[];
  edgeRuns: EdgeRun[];
  loopIterations: Record<string, number>;
  artifacts: RunArtifact[];
  events: RunEvent[];
  approvalRecords: RuntimeApprovalRecord[];
  verificationResults: NodeVerificationResult[];
  adaptationCandidates: AdaptationCandidate[];
  lifecycleContext: RunLifecycleContext;
  idempotencyKey?: string;
  idempotencyFingerprint?: string;
  processedActionKeys?: string[];
  runtimeEngine?: { name: WorkflowRuntimeEngine; version: number };
  mastra?: {
    schemaVersion: 1;
    engineVersion: string;
    workflowId: string;
    runId: string;
    definitionFingerprint: string;
    activeStepId?: string;
    status: 'registered' | 'running' | 'suspended' | 'completed' | 'failed' | 'cancelled';
    updatedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

function stableIntegrity(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function buildHarnessV2(userId: string, runId: string, plan: WorkflowPlan, assignment: ProjectWorkflow, skills: Skill[], harness: HarnessPolicy, compiledAt: string): HarnessV2Contract {
  const selected = new Map(assignment.selectedSkills.map((reference) => [`${reference.skillId}@${reference.version}`, reference]));
  const selectedSkills = skills.filter((skill) => selected.has(`${skill.id}@${skill.version}`));
  const completion = plan.completionContract ?? { requiredOutputKeys: [], requiredArtifacts: [] };
  return {
    schemaVersion: 2,
    identityAndBehavior: {
      purpose: plan.description || plan.name,
      agentRole: `Execute the approved ${plan.name} workflow within its explicit graph, skills, and decision gates.`,
      skills: selectedSkills.map((skill) => ({ skillId: skill.id, version: skill.version, source: skill.source, integrity: stableIntegrity(`${skill.id}:${skill.version}:${skill.instructions}`) })),
      contextManifest: Object.keys(assignment.inputOverrides).sort().map((key) => ({ key, source: 'assignment' as const, inclusionReason: 'Approved input required by the compiled workflow.' })),
      contextBudgetTokens: Math.min(200_000, Math.max(4_000, selectedSkills.reduce((total, skill) => total + skill.estimatedContextTokens, 0) + 4_000)),
      adaptationAllowed: Boolean(harness.adaptationEnabled)
    },
    runtime: {
      engine: 'Mastra', taskExecutor: 'Codex App Server', sandboxMode: harness.sandboxMode, allowedTools: [...harness.allowedTools], allowedWorkspacePaths: [...harness.allowedWorkspacePaths],
      maxRetries: harness.maxRetries, maxLoopIterations: harness.maxLoopIterations, maxConcurrentNodes: harness.maxConcurrentNodes,
      nodeTimeoutMs: 15 * 60 * 1000, cancellationMode: 'checkpoint-and-provider-interrupt'
    },
    observability: {
      correlation: { runId, workflowId: assignment.workflowId, assignmentId: assignment.id, projectId: assignment.projectId },
      capturedMetrics: ['queue time', 'node latency', 'run duration', 'retries', 'loop iterations', 'failure category'],
      unavailableMetrics: ['token usage and cost when the provider does not report them'], redactionPolicyVersion: 1
    },
    verification: {
      completionCriteria: [...plan.completionCriteria], requiredOutputKeys: [...completion.requiredOutputKeys], requiredArtifacts: [...completion.requiredArtifacts],
      humanGateNodeIds: plan.nodes.filter((node) => node.requiresApproval || node.type === 'approval').map((node) => node.id), agentOutputAloneCanComplete: false
    },
    adaptation: { enabled: Boolean(harness.adaptationEnabled), promotionRequiresHumanApproval: true, prohibitedSelfModification: true, allowedScopes: [harness.adaptationScope ?? 'run'] },
    governanceAndSecurity: {
      policyVersion: 1, ownerUserId: userId, projectId: assignment.projectId, workflowId: assignment.workflowId, assignmentId: assignment.id,
      leastPrivilege: true, requireApprovalForDestructiveActions: harness.requireApprovalForDestructiveActions, auditJournal: 'append-only', retentionDays: 90
    },
    compiledAt
  };
}

export interface CompilationResult { run?: WorkflowRun; errors: string[]; warnings: string[] }

export function appendRunEvent(run: WorkflowRun, event: Omit<RunEvent, 'id' | 'sequence' | 'runId'>): RunEvent {
  const sequence = run.events.length + 1;
  const record: RunEvent = { ...event, id: `${run.id}:event:${sequence}`, sequence, runId: run.id };
  run.events.push(record);
  return record;
}

export function hydrateWorkflowRun(value: WorkflowRun): WorkflowRun {
  const run = structuredClone(value);
  run.stateRevision ??= 0;
  run.schemaVersion = RUN_SCHEMA_VERSION;
  run.compiledWorkflow.schemaVersion = COMPILED_WORKFLOW_SCHEMA_VERSION;
  run.nodeRuns = run.nodeRuns.map((node) => ({ ...node, iteration: node.iteration ?? 0, artifactIds: node.artifactIds ?? [], approvalGranted: node.approvalGranted ?? false }));
  run.edgeRuns ??= run.compiledWorkflow.edges.map((edge, edgeIndex) => ({ edgeIndex, from: edge.from, to: edge.to, condition: edge.condition?.trim() ?? '', status: 'pending', traversalCount: 0 }));
  run.loopIterations ??= {};
  run.compiledWorkflow.assignmentInputs ??= {};
  run.runtimeInputs ??= {};
  run.compiledWorkflow.assignmentConfigurationVersion ??= run.assignmentConfigurationVersion ?? 1;
  run.assignmentConfigurationVersion ??= run.compiledWorkflow.assignmentConfigurationVersion;
  run.compiledWorkflow.completionContract ??= { requiredOutputKeys: [], requiredArtifacts: [] };
  run.compiledWorkflow.approvedAdaptations ??= [];
  run.compiledWorkflow.modelSettings ??= {};
  run.compiledWorkflow.nodes = run.compiledWorkflow.nodes.map((node) => ({ ...node, outputSchemas: node.outputSchemas ?? {}, requiredArtifacts: node.requiredArtifacts ?? [], approvalOptions: node.approvalOptions ?? [], skillSnapshots: node.skillSnapshots ?? [], modelSettings: node.modelSettings ?? resolveModelSettings(undefined, run.compiledWorkflow.modelSettings, undefined) }));
  run.artifacts ??= [];
  run.events ??= [{ id: `${run.id}:event:1`, sequence: 1, runId: run.id, type: 'run.compiled', timestamp: run.createdAt, message: 'Approved assignment compiled into a durable run.' }];
  run.approvalRecords ??= [];
  run.verificationResults ??= [];
  run.adaptationCandidates ??= [];
  run.lifecycleContext ??= {
    planning: { createdAt: run.createdAt, unresolvedQuestions: [], answeredQuestionCount: 0 }
  };
  run.processedActionKeys ??= [];
  run.runtimeEngine ??= { name: run.mastra ? 'mastra' : 'legacy', version: WORKFLOW_RUNTIME_VERSION };
  if (run.mastra && run.mastra.schemaVersion !== 1) throw new Error(`Unsupported Mastra correlation schema version: ${run.mastra.schemaVersion}.`);
  run.compiledWorkflow.harnessV2 ??= buildHarnessV2(run.userId, run.id, {
    id: run.sourcePlanId, schemaVersion: 1, name: run.workflowId, description: '', planningPrompt: 'Historical workflow', workspacePath: run.rootPath,
    constraints: [], openQuestions: [], completionCriteria: [], nodes: run.compiledWorkflow.nodes.map((node) => ({ id: node.id, name: node.name, type: node.type, prompt: node.focusedPrompt, skillIds: node.skillVersions.map((skill) => skill.skillId), inputKeys: node.inputKeys, outputKeys: node.outputKeys, outputSchemas: node.outputSchemas, requiredArtifacts: node.requiredArtifacts, retryLimit: node.retryLimit, requiresApproval: node.requiresApproval, approvalOptions: node.approvalOptions })), edges: run.compiledWorkflow.edges, harness: run.compiledWorkflow.harness, status: 'approved', createdAt: run.createdAt, updatedAt: run.updatedAt
  }, {
    id: run.assignmentId, schemaVersion: 1, projectId: run.projectId, workflowId: run.workflowId, workflowVersion: run.workflowVersion, rootPath: run.rootPath, status: 'ready', inputOverrides: run.compiledWorkflow.assignmentInputs, permissions: { sandboxMode: run.compiledWorkflow.harness.sandboxMode, allowedTools: run.compiledWorkflow.harness.allowedTools, allowedWorkspacePaths: run.compiledWorkflow.harness.allowedWorkspacePaths, requireApprovalForDestructiveActions: run.compiledWorkflow.harness.requireApprovalForDestructiveActions }, selectedSkills: run.compiledWorkflow.nodes.flatMap((node) => node.skillVersions), runIds: [run.id], createdAt: run.createdAt, updatedAt: run.updatedAt
  }, [], run.compiledWorkflow.harness, run.compiledWorkflow.compiledAt);
  return run;
}

export function compileWorkflowRun(userId: string, plan: WorkflowPlan, assignment: ProjectWorkflow, skills: Skill[], requestedRunId?: string, approvedAdaptations: ApprovedAdaptationReference[] = [], organizationModel?: { organizationId: string; settings: ModelSettings }): CompilationResult {
  const errors: string[] = [];
  if (assignment.status !== 'ready') errors.push('Only a ready project assignment can be compiled.');
  if (!assignment.approval) errors.push('Only an explicitly approved project assignment can be compiled.');
  if (assignment.workflowId !== plan.id) errors.push('Assignment workflow does not match the source plan.');
  if (!assignment.permissions.allowedWorkspacePaths.length) errors.push('At least one approved workspace path is required.');
  for (const allowedPath of assignment.permissions.allowedWorkspacePaths) if (!isWithinWorkspaceRoot(allowedPath, assignment.rootPath)) errors.push(`Runtime workspace path is outside the approved root: ${allowedPath}.`);
  try {
    const approvedRoot = canonicalWorkspacePath(assignment.rootPath);
    const onlyAllowedPath = assignment.permissions.allowedWorkspacePaths[0] ?? '';
    const exactRoot = isWithinWorkspaceRoot(onlyAllowedPath, approvedRoot) && isWithinWorkspaceRoot(approvedRoot, onlyAllowedPath);
    if (assignment.permissions.allowedWorkspacePaths.length !== 1 || !exactRoot) {
      errors.push('Runtime workspace access must contain only the approved project root.');
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Runtime workspace path is invalid.');
  }
  const graph = validateWorkflowGraph(plan, skills, assignment);
  errors.push(...graph.errors);
  if (errors.length) return { errors: Array.from(new Set(errors)), warnings: graph.warnings };

  const selected = new Map(assignment.selectedSkills.map((reference) => [reference.skillId, reference]));
  const timestamp = new Date().toISOString();
  const runId = requestedRunId ?? `run_${crypto.randomUUID()}`;
  const approvedRoot = canonicalWorkspacePath(assignment.rootPath);
  const compiledHarness: HarnessPolicy = {
    ...structuredClone(plan.harness),
    sandboxMode: assignment.permissions.sandboxMode,
    allowedTools: [...assignment.permissions.allowedTools],
    allowedWorkspacePaths: [approvedRoot],
    requireApprovalForDestructiveActions: assignment.permissions.requireApprovalForDestructiveActions
  };
  const compiledWorkflow: CompiledWorkflow = {
    schemaVersion: COMPILED_WORKFLOW_SCHEMA_VERSION,
    sourcePlanId: plan.id,
    workflowId: assignment.workflowId,
    workflowVersion: assignment.workflowVersion,
    assignmentId: assignment.id,
    assignmentConfigurationVersion: assignment.configurationVersion ?? 1,
    projectId: assignment.projectId,
    rootPath: approvedRoot,
    assignmentInputs: structuredClone(assignment.inputOverrides),
    entryNodeIds: workflowEntryNodeIds(plan),
    nodes: plan.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      focusedPrompt: node.prompt,
      skillVersions: node.skillIds.flatMap((skillId) => selected.get(skillId) ? [{ ...selected.get(skillId) as SkillVersionReference }] : []),
      skillSnapshots: node.skillIds.flatMap((skillId) => {
        const reference = selected.get(skillId);
        const skill = reference ? skills.find((candidate) => candidate.id === reference.skillId && candidate.version === reference.version) : undefined;
        return skill ? [{ id: skill.id, name: skill.name, version: skill.version, instructions: skill.instructions, requiredContext: [...skill.requiredContext], requiredPermissions: [...skill.requiredPermissions], validationCriteria: [...skill.validationCriteria], source: skill.source, integrity: stableIntegrity(`${skill.id}:${skill.version}:${skill.instructions}`) }] : [];
      }),
      inputKeys: [...node.inputKeys],
      readOnly: node.readOnly, joinMode: node.joinMode, joinQuorum: node.joinQuorum,
      outputKeys: [...node.outputKeys],
      outputSchemas: structuredClone(node.outputSchemas ?? {}),
      requiredArtifacts: [...(node.requiredArtifacts ?? [])],
      retryLimit: node.retryLimit,
      requiresApproval: node.requiresApproval,
      approvalOptions: structuredClone(node.approvalOptions ?? []),
      modelSettings: resolveModelSettings(node.modelSettings, plan.modelSettings, organizationModel?.settings)
    })),
    edges: plan.edges.map((edge) => ({ ...edge })),
    harness: compiledHarness,
    harnessV2: buildHarnessV2(userId, runId, plan, assignment, skills, compiledHarness, timestamp),
    maxLoopIterations: plan.harness.maxLoopIterations,
    completionContract: structuredClone(plan.completionContract ?? { requiredOutputKeys: [], requiredArtifacts: [] }),
    approvedAdaptations: structuredClone(approvedAdaptations.filter((item) => item.workflowId === assignment.workflowId && (item.scope === 'user' || item.projectId === assignment.projectId))),
    ...(organizationModel ? { organizationId: organizationModel.organizationId } : {}),
    modelSettings: structuredClone(plan.modelSettings ?? {}),
    compiledAt: timestamp
  };
  const run: WorkflowRun = {
      id: runId,
      schemaVersion: RUN_SCHEMA_VERSION,
      userId,
      projectId: assignment.projectId,
      workflowId: assignment.workflowId,
      workflowVersion: assignment.workflowVersion,
      assignmentId: assignment.id,
      assignmentConfigurationVersion: assignment.configurationVersion ?? 1,
      sourcePlanId: plan.id,
      rootPath: approvedRoot,
      status: 'compiled',
      compiledWorkflow,
      nodeRuns: compiledWorkflow.nodes.map((node) => ({ nodeId: node.id, taskId: `${runId}:${node.id}`, status: 'pending', attempt: 0, iteration: 0, artifactIds: [], approvalGranted: false })),
      edgeRuns: compiledWorkflow.edges.map((edge, edgeIndex) => ({ edgeIndex, from: edge.from, to: edge.to, condition: edge.condition?.trim() ?? '', status: 'pending', traversalCount: 0 })),
      loopIterations: {},
      artifacts: [],
      events: [],
      approvalRecords: [],
      verificationResults: [],
      adaptationCandidates: [],
      lifecycleContext: {
        planning: {
          createdAt: plan.createdAt,
          unresolvedQuestions: plan.openQuestions.filter((question) => !plan.questionResponses?.some((response) => response.question === question && response.answer.trim())),
          answeredQuestionCount: plan.questionResponses?.filter((response) => response.answer.trim()).length ?? 0
        },
        ...(plan.definitionApproval ? { definitionApproval: structuredClone(plan.definitionApproval) } : {}),
        ...(assignment.approval ? { assignmentApproval: structuredClone(assignment.approval) } : {})
      },
      processedActionKeys: [],
      runtimeEngine: { name: 'legacy', version: WORKFLOW_RUNTIME_VERSION },
      createdAt: timestamp,
      updatedAt: timestamp
  };
  appendRunEvent(run, { type: 'run.compiled', timestamp, message: `Approved assignment compiled into a durable run with ${compiledWorkflow.nodes.length} resolved model configuration${compiledWorkflow.nodes.length === 1 ? '' : 's'}.` });
  return {
    errors: [],
    warnings: graph.warnings,
    run
  };
}

export function validateWorkflowRun(value: WorkflowRun): string[] {
  const errors: string[] = [];
  if (value.stateRevision !== undefined && (!Number.isSafeInteger(value.stateRevision) || value.stateRevision < 0)) errors.push('Run state revision is invalid.');
  if (value.actionReceipts !== undefined && (!value.actionReceipts || typeof value.actionReceipts !== 'object' || Array.isArray(value.actionReceipts) || Object.keys(value.actionReceipts).length > 10000 || Object.entries(value.actionReceipts).some(([key, digest]) => !key.trim() || key.length > 128 || !/^[a-f0-9]{64}$/.test(digest)))) errors.push('Run action receipts are invalid.');
  const compiledIds = new Set(value.compiledWorkflow.nodes.map((node) => node.id));
  if (!value.id?.startsWith('run_')) errors.push('Run id is invalid.');
  if (value.schemaVersion !== RUN_SCHEMA_VERSION) errors.push('Run schema version is invalid.');
  if (!value.userId || !value.projectId || !value.workflowId || !value.assignmentId || !value.sourcePlanId) errors.push('Run identity is incomplete.');
  if (!Number.isInteger(value.assignmentConfigurationVersion) || value.assignmentConfigurationVersion < 1 || value.compiledWorkflow.assignmentConfigurationVersion !== value.assignmentConfigurationVersion) errors.push('Run assignment configuration version is invalid.');
  if (!isWithinWorkspaceRoot(value.rootPath, value.compiledWorkflow.rootPath) || !isWithinWorkspaceRoot(value.compiledWorkflow.rootPath, value.rootPath)) errors.push('Run root does not match its compiled project root.');
  try { assertRuntimeWorkspaceBoundary(value.compiledWorkflow.rootPath, value.compiledWorkflow.harness); }
  catch (error) { errors.push(error instanceof Error ? error.message : 'Compiled runtime workspace boundary is invalid.'); }
  if (!['compiled', 'running', 'paused', 'completed', 'failed', 'cancelled'].includes(value.status)) errors.push('Run status is invalid.');
  if (value.compiledWorkflow.nodes.length !== value.nodeRuns.length) errors.push('Every compiled node requires a node-run record.');
  if (value.compiledWorkflow.nodes.some((node) => !Array.isArray(node.skillSnapshots) || node.skillSnapshots.some((skill) => !skill.id || !Number.isInteger(skill.version) || !skill.instructions || skill.integrity !== stableIntegrity(`${skill.id}:${skill.version}:${skill.instructions}`)))) errors.push('Compiled skill snapshots are invalid.');
  if (!value.compiledWorkflow.assignmentInputs || typeof value.compiledWorkflow.assignmentInputs !== 'object' || Array.isArray(value.compiledWorkflow.assignmentInputs)) errors.push('Compiled assignment inputs are invalid.');
  if (value.runtimeInputs !== undefined && (typeof value.runtimeInputs !== 'object' || Array.isArray(value.runtimeInputs) || Object.keys(value.runtimeInputs).length > 200 || Object.values(value.runtimeInputs).some((item) => typeof item !== 'string' || item.length > 10_000))) errors.push('Runtime user inputs are invalid.');
  if (value.pendingInput && (!compiledIds.has(value.pendingInput.nodeId) || !Array.isArray(value.pendingInput.keys) || value.pendingInput.keys.length === 0 || value.pendingInput.keys.some((key) => typeof key !== 'string' || !key.trim()))) errors.push('Pending user input request is invalid.');
  if (value.compiledWorkflow.edges.length !== value.edgeRuns.length) errors.push('Every compiled edge requires an edge-run record.');
  if (value.compiledWorkflow.maxLoopIterations < 1) errors.push('Compiled loop limit must be positive.');
  if (!value.compiledWorkflow.completionContract || !Array.isArray(value.compiledWorkflow.completionContract.requiredOutputKeys) || !Array.isArray(value.compiledWorkflow.completionContract.requiredArtifacts)) errors.push('Compiled completion contract is invalid.');
  if (!Array.isArray(value.compiledWorkflow.approvedAdaptations) || value.compiledWorkflow.approvedAdaptations.some((item) => !item.id || !['project', 'user'].includes(item.scope) || item.workflowId !== value.workflowId || (item.scope === 'project' && item.projectId !== value.projectId) || !compiledIds.has(item.nodeId) || !item.sourceRunId || !item.summary || !item.approvedAt)) errors.push('Compiled approved adaptations are invalid.');
  if (value.compiledWorkflow.nodes.some((node) => !node.modelSettings?.model || !node.modelSettings.reasoningEffort || !validModelSettings(node.modelSettings))) errors.push('Every executable node requires valid resolved model settings.');
  if (value.executionConfiguration) {
    const configuration = value.executionConfiguration;
    if (!Number.isInteger(configuration.revision) || configuration.revision < 1 || !configuration.updatedBy?.id || !configuration.updatedBy.name || !configuration.updatedBy.role || !configuration.updatedAt || !validModelSettings(configuration.modelSettings)) errors.push('Runtime execution configuration is invalid.');
    const harness = configuration.harness;
    if (!harness || !Number.isInteger(harness.maxRetries) || harness.maxRetries < 0 || harness.maxRetries > 10 || !Number.isInteger(harness.maxLoopIterations) || harness.maxLoopIterations < 1 || harness.maxLoopIterations > 100 || !Number.isInteger(harness.maxConcurrentNodes) || harness.maxConcurrentNodes < 1 || harness.maxConcurrentNodes > 10 || !Array.isArray(harness.allowedTools) || harness.allowedTools.some((tool) => typeof tool !== 'string' || !tool.trim()) || typeof harness.requireApprovalForDestructiveActions !== 'boolean') errors.push('Runtime execution harness is invalid.');
    try { assertRuntimeWorkspaceBoundary(value.rootPath, configuration.harness); } catch { errors.push('Runtime harness workspace boundary is invalid.'); }
  }
  if (!value.compiledWorkflow.harnessV2 || value.compiledWorkflow.harnessV2.schemaVersion !== 2 || value.compiledWorkflow.harnessV2.governanceAndSecurity.ownerUserId !== value.userId || value.compiledWorkflow.harnessV2.observability.correlation.runId !== value.id) errors.push('Compiled six-layer harness contract is invalid.');
  if (value.mastra && (
    value.mastra.schemaVersion !== 1
    || !value.mastra.engineVersion
    || !value.mastra.workflowId
    || value.mastra.runId !== value.id
    || !/^[a-f0-9]{64}$/.test(value.mastra.definitionFingerprint)
    || !['registered', 'running', 'suspended', 'completed', 'failed', 'cancelled'].includes(value.mastra.status)
    || !value.mastra.updatedAt
  )) errors.push('Mastra run correlation metadata is invalid or incompatible.');
  const nodeRunIds = new Set(value.nodeRuns.map((node) => node.nodeId));
  if (compiledIds.size !== value.compiledWorkflow.nodes.length || nodeRunIds.size !== value.nodeRuns.length) errors.push('Run node identities must be unique.');
  if ([...compiledIds].some((id) => !nodeRunIds.has(id))) errors.push('Every compiled node must have a matching node run.');
  if (value.nodeRuns.some((node) => !['pending', 'running', 'waiting-approval', 'completed', 'failed', 'skipped'].includes(node.status))) errors.push('Node run status is invalid.');
  if (value.nodeRuns.some((node) => !Number.isInteger(node.attempt) || node.attempt < 0)) errors.push('Node attempts must be non-negative integers.');
  if (value.nodeRuns.some((node) => !Number.isInteger(node.iteration) || node.iteration < 0)) errors.push('Node iterations must be non-negative integers.');
  if (value.nodeRuns.some((node) => (node.runtimeJobId !== undefined && !node.runtimeJobId.startsWith('runtime_job_')) || (node.runtimeConnectionId !== undefined && !node.runtimeConnectionId.startsWith('runtime_')))) errors.push('Node runtime correlation is invalid.');
  if (value.nodeRuns.some((node) => node.approvalGranted !== undefined && typeof node.approvalGranted !== 'boolean')) errors.push('Node approval state is invalid.');
  if (value.nodeRuns.some((node) => !Array.isArray(node.artifactIds))) errors.push('Node artifact references are invalid.');
  if (value.nodeRuns.some((node) => node.failureKind !== undefined && !['validation', 'tool', 'human-rejection', 'missing-context', 'blocked-action'].includes(node.failureKind))) errors.push('Node failure classification is invalid.');
  if (value.edgeRuns.some((edge) => !['pending', 'selected', 'rejected'].includes(edge.status) || !Number.isInteger(edge.traversalCount) || edge.traversalCount < 0)) errors.push('Edge run state is invalid.');
  if (Object.values(value.loopIterations).some((count) => !Number.isInteger(count) || count < 0 || count > (value.executionConfiguration?.harness.maxLoopIterations ?? value.compiledWorkflow.maxLoopIterations))) errors.push('Loop iteration state is invalid.');
  if (!Array.isArray(value.artifacts) || value.artifacts.length > 1000 || value.artifacts.some((artifact) => artifact.runId !== value.id || !compiledIds.has(artifact.nodeId) || !artifact.id || !artifact.path || artifact.rootPath !== value.rootPath)) errors.push('Run artifacts are invalid.');
  if (!Array.isArray(value.events) || value.events.length > 100_000 || value.events.some((event, index) => event.runId !== value.id || event.sequence !== index + 1 || event.id !== `${value.id}:event:${index + 1}` || !event.timestamp || !event.message)) errors.push('Run event journal is invalid.');
  if (!Array.isArray(value.approvalRecords) || value.approvalRecords.length > 10_000 || value.approvalRecords.some((approval) => !approval.id || !compiledIds.has(approval.nodeId) || !approval.taskId || !Number.isInteger(approval.attempt) || approval.attempt < 1 || !Number.isInteger(approval.iteration) || approval.iteration < 0 || !approval.requestedAt || (approval.decision !== undefined && !['approved', 'rejected', 'revision-requested'].includes(approval.decision)) || (approval.decision !== undefined && (!approval.decidedAt || !approval.decidedBy?.id || !approval.decidedBy.name || !approval.decidedBy.role)) || (approval.keyword !== undefined && !approval.keyword.trim()) || (approval.outcomeAction !== undefined && !['continue', 'revise', 'stop'].includes(approval.outcomeAction)))) errors.push('Runtime approval records are invalid.');
  if (!Array.isArray(value.verificationResults) || value.verificationResults.length > 10_000 || value.verificationResults.some((result) => !result.id || !compiledIds.has(result.nodeId) || !result.taskId || !['passed', 'failed'].includes(result.status) || !Array.isArray(result.checks) || !Array.isArray(result.evidenceArtifactIds) || !result.verifiedAt || !result.message)) errors.push('Runtime verification results are invalid.');
  if (!Array.isArray(value.adaptationCandidates) || value.adaptationCandidates.length > 1_000 || value.adaptationCandidates.some((candidate) => !candidate.id || !compiledIds.has(candidate.nodeId) || !candidate.sourceEventId || !['run', 'project', 'user'].includes(candidate.scope) || !['proposed', 'approved', 'rejected'].includes(candidate.status) || !candidate.summary || !candidate.createdAt || (candidate.status !== 'proposed' && (!candidate.decidedAt || !candidate.decidedBy?.id)))) errors.push('Runtime adaptation candidates are invalid.');
  if (!value.lifecycleContext || !value.lifecycleContext.planning || !value.lifecycleContext.planning.createdAt || !Array.isArray(value.lifecycleContext.planning.unresolvedQuestions) || !Number.isInteger(value.lifecycleContext.planning.answeredQuestionCount) || value.lifecycleContext.planning.answeredQuestionCount < 0) errors.push('Run lifecycle context is invalid.');
  if (value.idempotencyKey !== undefined && (typeof value.idempotencyKey !== 'string' || !value.idempotencyKey.trim() || value.idempotencyKey.length > 128)) errors.push('Run idempotency key is invalid.');
  if (value.idempotencyFingerprint !== undefined && (typeof value.idempotencyFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.idempotencyFingerprint))) errors.push('Run idempotency fingerprint is invalid.');
  if (value.processedActionKeys !== undefined && (!Array.isArray(value.processedActionKeys) || value.processedActionKeys.length > 10_000 || new Set(value.processedActionKeys).size !== value.processedActionKeys.length || value.processedActionKeys.some((key) => typeof key !== 'string' || !key.trim() || key.length > 128))) errors.push('Run action idempotency keys are invalid.');
  if (!value.runtimeEngine || !['mastra', 'legacy'].includes(value.runtimeEngine.name) || value.runtimeEngine.version !== WORKFLOW_RUNTIME_VERSION || (value.runtimeEngine.name === 'mastra') !== Boolean(value.mastra)) errors.push('Run runtime engine metadata is invalid.');
  const artifactIds = new Set(value.artifacts.map((artifact) => artifact.id));
  if (value.nodeRuns.some((node) => node.artifactIds.some((id) => !artifactIds.has(id)))) errors.push('Node references an unavailable run artifact.');
  const activeNodes = value.nodeRuns.filter((node) => node.status === 'running' || node.status === 'waiting-approval');
  const budget = value.executionConfiguration?.harness.maxConcurrentNodes ?? value.compiledWorkflow.harness.maxConcurrentNodes;
  if (activeNodes.length > budget) errors.push('Active nodes exceed the approved concurrency limit.');
  if (activeNodes.length > 1 && activeNodes.some((node) => node.status === 'waiting-approval')) errors.push('Approval gates are execution barriers.');
  if (activeNodes.length > 1 && activeNodes.some((node) => (node.executionSettings?.harness.sandboxMode ?? value.compiledWorkflow.harness.sandboxMode) === 'workspace')) errors.push('Workspace write tasks must execute exclusively.');
  return errors;
}
