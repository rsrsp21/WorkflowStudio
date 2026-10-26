import { appendRunEvent, type CompiledWorkflowNode, type EdgeRun, type NodeRun, type RunArtifact, type RuntimeApprovalDecision, type RuntimeApprovalRecord, type RuntimeFailureKind, type WorkflowRun } from './runtime';
import { assertRuntimeWorkspaceBoundary, isWithinWorkspaceRoot, resolveArtifactPath } from './workspace-boundary';
import { executionHarness, executionModelSettings } from './run-execution-settings';
import { isRuntimeUnavailable } from './runtime-unavailable';
import { failedStepForRetry } from './failed-step-retry';
import { revisionBudgetBlocker } from './approval-revision-budget';
import { workflowEntryNodeIds } from './models';
import { rejectedValidationForRecheck } from './rejected-validation';
import { assertNodeAttempt, RunStateConflictError, type NodeAttemptFence } from './run-transition-service';

export interface FocusedNodeTask {
  runId: string;
  taskId: string;
  attempt?: number;
  iteration?: number;
  node: CompiledWorkflowNode;
  input: Record<string, unknown>;
  edgeConditions: string[];
  approvedAdaptations?: Array<{ id: string; scope: 'project' | 'user'; summary: string; sourceRunId: string }>;
  harness: WorkflowRun['compiledWorkflow']['harness'];
  context: {
    userId: string;
    projectId: string;
    workflowId: string;
    workflowVersion: number;
    assignmentId: string;
    sourcePlanId: string;
    rootPath: string;
  };
}

export interface NodeExecutionResult {
  output: Record<string, unknown>;
  selectedCondition?: string;
  summary?: string;
  artifacts?: Array<Pick<RunArtifact, 'path' | 'description' | 'rootPath' | 'sandboxMode' | 'writeAllowed'>>;
  providerThreadId?: string;
  runtimeJobId?: string;
  runtimeConnectionId?: string;
}

export interface NodeTaskExecutor {
  execute(task: FocusedNodeTask): Promise<NodeExecutionResult>;
}

export interface RuntimeTransition {
  run: WorkflowRun;
  nodeRun?: NodeRun;
  task?: FocusedNodeTask;
  kind: 'started' | 'waiting-runtime' | 'waiting-approval' | 'retried' | 'completed' | 'branched' | 'looped' | 'run-completed' | 'run-failed' | 'run-cancelled';
}

export interface RunStateStore {
  read(userId: string, id: string): Promise<WorkflowRun | null>;
  upsert(userId: string, run: WorkflowRun): Promise<WorkflowRun>;
}

const finishedNodeStatuses = new Set<NodeRun['status']>(['completed', 'failed', 'skipped']);
export const DEFAULT_EDGE_CONDITION = '__default__';

class RuntimeContractError extends Error {
  readonly failureKind: RuntimeFailureKind = 'validation';
}

export function classifyExecutionError(error: unknown): RuntimeFailureKind {
  if (error instanceof RuntimeContractError) return error.failureKind;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('missing context') || message.includes('context is missing')) return 'missing-context';
  if (message.includes('outside the approved') || message.includes('permission') || message.includes('workspace boundary') || message.includes('blocked action')) return 'blocked-action';
  if (message.includes('focused node output') || message.includes('codex returned invalid json') || message.includes('schema') || message.includes('verification failed')) return 'validation';
  if (message.includes('rejected by human') || message.includes('human rejection')) return 'human-rejection';
  return 'tool';
}

function copyRun(run: WorkflowRun): WorkflowRun {
  const copy = structuredClone(run);
  copy.edgeRuns ??= copy.compiledWorkflow.edges.map((edge, edgeIndex) => ({ edgeIndex, from: edge.from, to: edge.to, condition: edge.condition?.trim() ?? '', status: 'pending', traversalCount: 0 }));
  copy.loopIterations ??= {};
  copy.nodeRuns = copy.nodeRuns.map((node) => ({ ...node, iteration: node.iteration ?? 0, approvalGranted: node.approvalGranted ?? false }));
  copy.approvalRecords ??= [];
  copy.verificationResults ??= [];
  copy.adaptationCandidates ??= [];
  return copy;
}

function captureAdaptationCandidate(run: WorkflowRun, nodeId: string, sourceEventId: string, summary: string, timestamp: string) {
  if (!run.compiledWorkflow.harnessV2.adaptation.enabled || run.adaptationCandidates.length >= 1_000) return;
  run.adaptationCandidates.push({ id: `${run.id}:adaptation:${run.adaptationCandidates.length + 1}`, nodeId, sourceEventId, scope: run.compiledWorkflow.harnessV2.adaptation.allowedScopes[0] ?? 'run', summary: summary.slice(0, 2_000), status: 'proposed', createdAt: timestamp });
}

function recordVerification(run: WorkflowRun, node: CompiledWorkflowNode, state: NodeRun, status: 'passed' | 'failed', timestamp: string, message: string, failureKind?: RuntimeFailureKind) {
  run.verificationResults.push({
    id: `${run.id}:verification:${run.verificationResults.length + 1}`,
    nodeId: node.id,
    taskId: state.taskId,
    status,
    checks: [
      `Declared outputs: ${node.outputKeys.join(', ') || 'none'}`,
      `Required artifacts: ${(node.requiredArtifacts ?? []).join(', ') || 'none'}`,
      node.requiresApproval || node.type === 'approval' ? 'Human decision gate enforced' : 'Automated contract verification'
    ],
    evidenceArtifactIds: [...state.artifactIds],
    verifiedAt: timestamp,
    ...(failureKind ? { failureKind } : {}),
    message
  });
}

function at(run: WorkflowRun, timestamp: string) {
  run.updatedAt = timestamp;
  return run;
}

function nodeDefinition(run: WorkflowRun, nodeId: string) {
  const node = run.compiledWorkflow.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Compiled node was not found: ${nodeId}.`);
  return node;
}

function nodeState(run: WorkflowRun, nodeId: string) {
  const state = run.nodeRuns.find((candidate) => candidate.nodeId === nodeId);
  if (!state) throw new Error(`Node run was not found: ${nodeId}.`);
  return state;
}

function outgoing(run: WorkflowRun, nodeId: string) {
  return run.edgeRuns.filter((edge) => edge.from === nodeId);
}

function incoming(run: WorkflowRun, nodeId: string) {
  return run.edgeRuns.filter((edge) => edge.to === nodeId);
}

function graphPath(run: WorkflowRun, from: string, to: string): string[] | null {
  const queue: Array<{ id: string; path: string[] }> = [{ id: from, path: [from] }];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift() as { id: string; path: string[] };
    if (current.id === to) return current.path;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    for (const edge of run.compiledWorkflow.edges.filter((candidate) => candidate.from === current.id)) queue.push({ id: edge.to, path: [...current.path, edge.to] });
  }
  return null;
}

function isBackEdge(run: WorkflowRun, edge: Pick<EdgeRun, 'from' | 'to'>) {
  return graphPath(run, edge.to, edge.from) !== null;
}

function activeAncestorIds(run: WorkflowRun, nodeId: string) {
  const ancestors = new Set<string>();
  const queue = incoming(run, nodeId).filter((edge) => edge.status === 'selected').map((edge) => edge.from);
  while (queue.length) {
    const id = queue.shift() as string;
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    queue.push(...incoming(run, id).filter((edge) => edge.status === 'selected').map((edge) => edge.from));
  }
  return ancestors;
}

function availableNodeValues(run: WorkflowRun, nodeId: string): Map<string, unknown> {
  const ancestors = activeAncestorIds(run, nodeId);
  const available = new Map<string, unknown>([...Object.entries(run.compiledWorkflow.assignmentInputs ?? {}), ...Object.entries(run.runtimeInputs ?? {})]);
  const producers = run.compiledWorkflow.nodes.flatMap((compiledNode, order) => {
    if (!ancestors.has(compiledNode.id)) return [];
    const state = nodeState(run, compiledNode.id);
    return state.output || state.loopCarriedInput ? [{ state, order }] : [];
  }).sort((left, right) => left.state.iteration - right.state.iteration
    || (left.state.completedAt ?? '').localeCompare(right.state.completedAt ?? '')
    || left.order - right.order);
  for (const producer of producers) {
    for (const [key, value] of Object.entries(producer.state.loopCarriedInput ?? {})) available.set(key, value);
    for (const [key, value] of Object.entries(producer.state.output ?? {})) available.set(key, value);
  }
  return available;
}

export function resolveNodeInput(run: WorkflowRun, nodeId: string): Record<string, unknown> {
  const node = nodeDefinition(run, nodeId);
  const available = availableNodeValues(run, nodeId);
  const input: Record<string, unknown> = {};
  for (const key of node.inputKeys) if (available.has(key)) input[key] = available.get(key);
  return input;
}

function dependenciesResolved(run: WorkflowRun, nodeId: string) {
  const edges = incoming(run, nodeId);
  const node = nodeDefinition(run, nodeId);
  if (node.type === 'join' && node.joinMode === 'quorum') {
    return edges.filter((edge) => edge.status === 'selected' && nodeState(run, edge.from).status === 'completed').length >= (node.joinQuorum ?? 1)
      || edges.every((edge) => edge.status !== 'pending') && edges.some((edge) => edge.status === 'selected');
  }
  if (!edges.length) return true;
  if (!edges.some((edge) => edge.status === 'selected')) return false;
  return edges.filter((edge) => !isBackEdge(run, edge)).every((edge) => edge.status !== 'pending');
}

function rejectSkippedPaths(run: WorkflowRun) {
  // Incoming-edge counting cannot prune an unchosen cycle: its nodes keep
  // each other pending forever. Follow only paths that can still execute.
  const reachable = new Set<string>();
  const queue = workflowEntryNodeIds(run.compiledWorkflow);
  for (const edge of run.edgeRuns) {
    const from = nodeState(run, edge.from);
    if (edge.status === 'selected' && nodeDefinition(run, edge.from).type === 'loop' && from.iteration > 0) queue.push(edge.to);
  }
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id) || nodeState(run, id).status === 'skipped') continue;
    reachable.add(id);
    const state = nodeState(run, id);
    for (const edge of outgoing(run, id)) {
      if (edge.status === 'selected' || (edge.status === 'pending' && !finishedNodeStatuses.has(state.status))) queue.push(edge.to);
    }
  }
  for (const state of run.nodeRuns) {
    if (state.status !== 'pending' || reachable.has(state.nodeId)) continue;
    state.status = 'skipped';
    for (const edge of outgoing(run, state.nodeId)) if (edge.status === 'pending') edge.status = 'rejected';
  }
}

export function nextRunnableNode(source: WorkflowRun): CompiledWorkflowNode | null {
  const run = copyRun(source);
  rejectSkippedPaths(run);
  const active = run.nodeRuns.filter((node) => node.status === 'running');
  if (run.pendingInput || run.nodeRuns.some((node) => node.status === 'waiting-approval') || active.length >= executionHarness(run).maxConcurrentNodes) return null;
  const eligible = run.compiledWorkflow.nodes.filter((node) => nodeState(run, node.id).status === 'pending' && dependenciesResolved(run, node.id));
  const writes = (node: CompiledWorkflowNode) => !node.readOnly && !['fork', 'join'].includes(node.type) && executionHarness(run).sandboxMode === 'workspace';
  const cyclic = (node: CompiledWorkflowNode) => outgoing(run, node.id).some((edge) => graphPath(run, edge.to, node.id));
  if (active.some((state) => writes(nodeDefinition(run, state.nodeId)) || cyclic(nodeDefinition(run, state.nodeId)))) return null;
  return eligible.find((node) => {
    if (active.length && (writes(node) || cyclic(node) || node.requiresApproval || ['approval', 'loop', 'success', 'failure'].includes(node.type))) return false;
    if (['success', 'failure'].includes(node.type) && run.nodeRuns.some((state) => state.status === 'pending' && !['success', 'failure'].includes(nodeDefinition(run, state.nodeId).type))) return false;
    return true;
  }) ?? null;
}

function focusedTask(run: WorkflowRun, node: CompiledWorkflowNode, state: NodeRun): FocusedNodeTask {
  const edges = outgoing(run, node.id);
  const conditions = edges.map((edge) => edge.condition).filter(Boolean);
  if (conditions.length && edges.some((edge) => !edge.condition)) conditions.push(DEFAULT_EDGE_CONDITION);
  return {
    runId: run.id,
    taskId: state.taskId,
    attempt: state.attempt,
    iteration: state.iteration,
    node: { ...structuredClone(node), modelSettings: executionModelSettings(run, node) },
    input: structuredClone(state.input ?? {}),
    edgeConditions: conditions,
    approvedAdaptations: (run.compiledWorkflow.approvedAdaptations ?? []).filter((item) => item.nodeId === node.id).map(({ id, scope, summary, sourceRunId }) => ({ id, scope, summary, sourceRunId })),
    harness: structuredClone(state.executionSettings?.harness ?? executionHarness(run)),
    context: {
      userId: run.userId,
      projectId: run.projectId,
      workflowId: run.workflowId,
      workflowVersion: run.workflowVersion,
      assignmentId: run.assignmentId,
      sourcePlanId: run.sourcePlanId,
      rootPath: run.rootPath
    }
  };
}

export function focusedTaskForRun(run: WorkflowRun, nodeId: string): FocusedNodeTask {
  return focusedTask(run, nodeDefinition(run, nodeId), nodeState(run, nodeId));
}

export function startNextNode(source: WorkflowRun, timestamp = new Date().toISOString()): RuntimeTransition {
  if (!['compiled', 'running'].includes(source.status)) throw new Error(`Run cannot advance from ${source.status}.`);
  const run = copyRun(source);
  rejectSkippedPaths(run);
  const node = nextRunnableNode(run);
  if (!node) {
    const unresolved = run.nodeRuns.some((candidate) => !finishedNodeStatuses.has(candidate.status));
    if (unresolved) throw new Error('No node is runnable while unfinished nodes remain.');
    run.status = run.nodeRuns.some((candidate) => candidate.status === 'failed') ? 'failed' : 'completed';
    return { run: at(run, timestamp), kind: run.status === 'failed' ? 'run-failed' : 'run-completed' };
  }

  const state = nodeState(run, node.id);
  const approvalGranted = state.approvalGranted === true;
  state.attempt += 1;
  state.input = resolveNodeInput(run, node.id);
  state.startedAt = timestamp;
  state.completedAt = undefined;
  state.output = undefined;
  state.selectedCondition = undefined;
  state.summary = undefined;
  state.artifactIds = [];
  state.providerThreadId = undefined;
  state.runtimeJobId = undefined;
  state.deliveryStage = 'executing';
  state.runtimeConnectionId = undefined;
  state.error = undefined;
  state.failureKind = undefined;
  state.approvalGranted = false;
  state.executionSettings = { revision: run.executionConfiguration?.revision ?? 0, modelSettings: executionModelSettings(run, node), harness: structuredClone(executionHarness(run)) };
  if (node.readOnly || node.type === 'fork' || node.type === 'join') state.executionSettings.harness.sandboxMode = 'read-only';
  if ((node.requiresApproval || node.type === 'approval') && !approvalGranted) {
    state.status = 'waiting-approval';
    run.status = 'paused';
    const approval: RuntimeApprovalRecord = { id: `${run.id}:approval:${run.approvalRecords.length + 1}`, nodeId: node.id, taskId: state.taskId, attempt: state.attempt, iteration: state.iteration, requestedAt: timestamp };
    run.approvalRecords.push(approval);
    appendRunEvent(run, { type: 'node.waiting-approval', timestamp, nodeId: node.id, taskId: state.taskId, message: `${node.name} is waiting for human approval.`, data: { attempt: state.attempt, iteration: state.iteration, approvalId: approval.id } });
    return { run: at(run, timestamp), nodeRun: structuredClone(state), task: focusedTask(run, node, state), kind: 'waiting-approval' };
  }
  state.status = 'running';
  if (node.type === 'join' && node.joinMode === 'quorum') {
    const parents = incoming(run, node.id);
    const successes = parents.filter((edge) => edge.status === 'selected' && nodeState(run, edge.from).status === 'completed');
    for (const candidate of run.nodeRuns) {
      if (successes.length < (node.joinQuorum ?? 1)) break;
      if (candidate.nodeId === node.id || !['pending', 'running'].includes(candidate.status) || !graphPath(run, candidate.nodeId, node.id)) continue;
      candidate.status = 'skipped'; candidate.completedAt = timestamp;
      candidate.error = 'Branch not selected by the completed join quorum.';
      for (const edge of outgoing(run, candidate.nodeId)) if (edge.status === 'pending') edge.status = 'rejected';
    }
  }
  run.runtimeWaiting = undefined;
  run.status = 'running';
  const settings = state.executionSettings.modelSettings;
  appendRunEvent(run, { type: 'node.started', timestamp, nodeId: node.id, taskId: state.taskId, message: `${node.name} started with ${settings.model} (${settings.reasoningEffort}).`, data: { attempt: state.attempt, iteration: state.iteration, ...settings, executionSettingsRevision: state.executionSettings.revision, harness: state.executionSettings.harness } });
  return { run: at(run, timestamp), nodeRun: structuredClone(state), task: focusedTask(run, node, state), kind: 'started' };
}

/** Control nodes execute locally and deterministically, never through a model. */
export function nativeNodeResult(run: WorkflowRun, nodeId: string): NodeExecutionResult | undefined {
  const node = nodeDefinition(run, nodeId);
  if (node.type === 'fork') return { output: {}, summary: 'Parallel branches released.' };
  if (node.type !== 'join') return undefined;
  if (node.joinMode === 'quorum' && incoming(run, nodeId).filter((edge) => edge.status === 'selected' && nodeState(run, edge.from).status === 'completed').length < (node.joinQuorum ?? 1)) throw new RuntimeContractError('The required join quorum was not reached.');
  const parents = run.compiledWorkflow.nodes.filter((candidate) => candidate.id !== nodeId && graphPath(run, candidate.id, nodeId)
    && ['completed', 'failed', 'skipped'].includes(nodeState(run, candidate.id).status));
  const branches = Object.fromEntries(parents.map((parent) => {
    const state = nodeState(run, parent.id);
    return [parent.id, { status: state.status, output: state.output ?? {}, ...(state.error ? { error: state.error } : {}) }];
  }));
  return { output: { [node.outputKeys[0]]: branches }, summary: 'Branch results merged in definition order.' };
}

function finishRunAtTerminal(run: WorkflowRun, node: CompiledWorkflowNode) {
  if (node.type !== 'success' && node.type !== 'failure') return false;
  for (const state of run.nodeRuns) if (state.status === 'pending') state.status = 'skipped';
  for (const edge of run.edgeRuns) if (edge.status === 'pending') edge.status = 'rejected';
  run.status = node.type === 'success' ? 'completed' : 'failed';
  return true;
}

function validateOutput(node: CompiledWorkflowNode, output: Record<string, unknown>) {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(output); }
  catch { throw new RuntimeContractError('Node output must be JSON serializable.'); }
  if (serialized === undefined) throw new RuntimeContractError('Node output must be a JSON object.');
  if (Buffer.byteLength(serialized, 'utf8') > 1_000_000) throw new RuntimeContractError('Node output exceeds the 1 MB limit.');
  const missing = node.outputKeys.filter((key) => !Object.hasOwn(output, key));
  if (missing.length) throw new RuntimeContractError(`Node output is missing required keys: ${missing.join(', ')}.`);
  const unexpected = Object.keys(output).filter((key) => !node.outputKeys.includes(key));
  if (unexpected.length) throw new RuntimeContractError(`Node output contains undeclared keys: ${unexpected.join(', ')}.`);
  for (const [key, expected] of Object.entries(node.outputSchemas ?? {})) {
    const value = output[key];
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (actual !== expected) throw new RuntimeContractError(`Node output ${key} must be ${expected}; received ${actual}.`);
  }
}

function persistArtifacts(run: WorkflowRun, node: CompiledWorkflowNode, state: NodeRun, result: NodeExecutionResult, timestamp: string) {
  const artifacts = result.artifacts ?? [];
  if (artifacts.length > 50 || run.artifacts.length + artifacts.length > 1000) throw new RuntimeContractError('Artifact limit exceeded for this node or run.');
  const missing = (node.requiredArtifacts ?? []).filter((label) => !artifacts.some((artifact) => artifact.description.trim().toLowerCase() === label.trim().toLowerCase()));
  if (missing.length) throw new RuntimeContractError(`Node artifacts are missing required labels: ${missing.join(', ')}.`);
  if (!artifacts.length) return;
  const harness = state.executionSettings?.harness ?? executionHarness(run);
  const boundary = assertRuntimeWorkspaceBoundary(run.rootPath, harness);
  for (const artifact of artifacts) {
    if (!artifact.description.trim()) throw new RuntimeContractError('Focused node artifact description is required.');
    if (!isWithinWorkspaceRoot(artifact.rootPath, boundary.rootPath) || !isWithinWorkspaceRoot(boundary.rootPath, artifact.rootPath)) throw new Error('Focused node artifact root does not match the approved project root.');
    if (artifact.sandboxMode !== harness.sandboxMode || artifact.writeAllowed !== boundary.writeAllowed) throw new Error('Focused node artifact permissions do not match the execution harness.');
    const id = `${run.id}:artifact:${run.artifacts.length + 1}`;
    run.artifacts.push({ ...artifact, id, runId: run.id, nodeId: node.id, taskId: state.taskId, path: resolveArtifactPath(artifact.path, boundary.rootPath), rootPath: boundary.rootPath, createdAt: timestamp });
    state.artifactIds.push(id);
  }
}

function validateCompletionContract(run: WorkflowRun) {
  const contract = run.compiledWorkflow.completionContract ?? { requiredOutputKeys: [], requiredArtifacts: [] };
  const availableOutputs = new Set(run.nodeRuns.filter((state) => state.status === 'completed').flatMap((state) => Object.keys(state.output ?? {})));
  const missingOutputs = contract.requiredOutputKeys.filter((key) => !availableOutputs.has(key));
  if (missingOutputs.length) throw new RuntimeContractError(`Workflow completion is missing required outputs: ${missingOutputs.join(', ')}.`);
  const artifactLabels = new Set(run.artifacts.map((artifact) => artifact.description.trim().toLowerCase()));
  const missingArtifacts = contract.requiredArtifacts.filter((label) => !artifactLabels.has(label.trim().toLowerCase()));
  if (missingArtifacts.length) throw new RuntimeContractError(`Workflow completion is missing required artifacts: ${missingArtifacts.join(', ')}.`);
}

function selectOutgoingEdges(run: WorkflowRun, nodeId: string, selectedCondition: string) {
  const edges = outgoing(run, nodeId);
  const conditioned = edges.filter((edge) => edge.condition);
  const normalizedSelection = selectedCondition.trim().toLowerCase();
  const hasDefault = edges.some((edge) => !edge.condition);
  if (normalizedSelection && normalizedSelection !== DEFAULT_EDGE_CONDITION && !conditioned.some((edge) => edge.condition.toLowerCase() === normalizedSelection)) throw new Error(`Selected condition is not an outgoing edge: ${selectedCondition}.`);
  if (normalizedSelection === DEFAULT_EDGE_CONDITION && !hasDefault) throw new Error(`Selected condition is not an outgoing edge: ${selectedCondition}.`);
  if (!normalizedSelection && conditioned.length && !edges.some((edge) => !edge.condition)) throw new Error(`Node ${nodeId} must select one explicit outgoing condition.`);
  for (const edge of edges) {
    const selected = conditioned.length
      ? normalizedSelection ? normalizedSelection === DEFAULT_EDGE_CONDITION ? !edge.condition : edge.condition.toLowerCase() === normalizedSelection : !edge.condition
      : true;
    edge.status = selected ? 'selected' : 'rejected';
    if (selected) edge.traversalCount += 1;
  }
}

function resetLoop(run: WorkflowRun, triggeringEdge: EdgeRun, timestamp: string): 'looped' | 'exhausted' {
  const path = graphPath(run, triggeringEdge.to, triggeringEdge.from);
  if (!path) return 'looped';
  const loopNode = run.compiledWorkflow.nodes.find((node) => path.includes(node.id) && node.type === 'loop');
  if (!loopNode) throw new Error(`Selected edge closes a cycle without a loop node: ${triggeringEdge.from} -> ${triggeringEdge.to}.`);
  const currentCount = run.loopIterations[loopNode.id] ?? 0;
  if (currentCount >= executionHarness(run).maxLoopIterations) {
    const loopState = nodeState(run, loopNode.id);
    loopState.status = 'failed';
    loopState.error = `Loop limit exhausted after ${executionHarness(run).maxLoopIterations} iterations.`;
    loopState.completedAt = timestamp;
    for (const state of run.nodeRuns) if (state.status === 'pending') state.status = 'skipped';
    for (const edge of run.edgeRuns) if (edge.status === 'pending') edge.status = 'rejected';
    run.status = 'failed';
    return 'exhausted';
  }
  run.loopIterations[loopNode.id] = currentCount + 1;
  const loopState = nodeState(run, loopNode.id);
  loopState.loopCarriedInput = Object.fromEntries(availableNodeValues(run, loopNode.id));

  const cycleIds = new Set(path);
  const reopenedIds = new Set(cycleIds);
  const queue = [...cycleIds];
  while (queue.length) {
    const from = queue.shift()!;
    for (const edge of run.edgeRuns.filter((candidate) => candidate.from === from)) {
      if (reopenedIds.has(edge.to)) continue;
      reopenedIds.add(edge.to);
      queue.push(edge.to);
    }
  }
  for (const id of cycleIds) {
    const state = nodeState(run, id);
    state.status = 'pending';
    state.attempt = 0;
    state.iteration += 1;
    state.input = undefined;
    state.startedAt = undefined;
    state.completedAt = undefined;
    state.error = undefined;
    state.failureKind = undefined;
    state.selectedCondition = undefined;
    state.approvalGranted = false;
  }
  for (const id of reopenedIds) {
    if (cycleIds.has(id)) continue;
    const state = nodeState(run, id);
    if (state.status === 'skipped') {
      state.status = 'pending';
      state.error = undefined;
      state.completedAt = undefined;
    }
  }
  for (const edge of run.edgeRuns) {
    if (reopenedIds.has(edge.from)) edge.status = 'pending';
    else if (cycleIds.has(edge.to) && edge.status === 'selected') edge.status = 'rejected';
  }
  triggeringEdge.status = 'selected';
  return 'looped';
}

function routeCompletedNode(run: WorkflowRun, nodeId: string, selectedCondition: string, timestamp: string): 'completed' | 'branched' | 'looped' | 'exhausted' {
  const edges = outgoing(run, nodeId);
  if (!edges.length) return 'completed';
  selectOutgoingEdges(run, nodeId, selectedCondition);
  const selected = edges.filter((edge) => edge.status === 'selected');
  const backEdge = nodeDefinition(run, nodeId).type === 'loop' ? selected.find((edge) => isBackEdge(run, edge)) : undefined;
  if (backEdge) return resetLoop(run, backEdge, timestamp);
  rejectSkippedPaths(run);
  return edges.some((edge) => edge.status === 'rejected') ? 'branched' : 'completed';
}

export function completeNode(source: WorkflowRun, nodeId: string, output: Record<string, unknown>, selectedCondition = '', timestamp = new Date().toISOString(), execution: Omit<NodeExecutionResult, 'output' | 'selectedCondition'> = {}): RuntimeTransition {
  const run = copyRun(source);
  const node = nodeDefinition(run, nodeId);
  const state = nodeState(run, nodeId);
  if (state.status !== 'running' && state.status !== 'waiting-approval') throw new Error(`Node ${nodeId} is not active.`);
  validateOutput(node, output);
  state.status = 'completed';
  state.output = structuredClone(output);
  state.selectedCondition = selectedCondition.trim() || undefined;
  state.summary = execution.summary?.trim() || undefined;
  state.providerThreadId = execution.providerThreadId?.trim() || undefined;
  state.runtimeJobId = execution.runtimeJobId?.trim() || undefined;
  state.runtimeConnectionId = execution.runtimeConnectionId?.trim() || undefined;
  persistArtifacts(run, node, state, { output, selectedCondition, ...execution }, timestamp);
  state.error = undefined;
  state.failureKind = undefined;
  state.completedAt = timestamp;
  recordVerification(run, node, state, 'passed', timestamp, 'Output schema and required artifact checks passed.');
  appendRunEvent(run, { type: 'node.completed', timestamp, nodeId: node.id, taskId: state.taskId, message: `${node.name} completed.`, data: { outputKeys: Object.keys(output), artifactIds: [...state.artifactIds], ...(state.selectedCondition ? { selectedCondition: state.selectedCondition } : {}) } });
  if (finishRunAtTerminal(run, node)) {
    if (run.status === 'completed') validateCompletionContract(run);
    appendRunEvent(run, { type: run.status === 'completed' ? 'run.completed' : 'run.failed', timestamp, nodeId: node.id, taskId: state.taskId, message: run.status === 'completed' ? 'Workflow run completed successfully.' : 'Workflow run reached a failure outcome.' });
    return { run: at(run, timestamp), nodeRun: structuredClone(state), kind: run.status === 'completed' ? 'run-completed' : 'run-failed' };
  }
  const routed = routeCompletedNode(run, nodeId, selectedCondition, timestamp);
  const selectedRoutes = outgoing(run, nodeId).filter((edge) => edge.status === 'selected').map((edge) => ({ to: edge.to, condition: edge.condition || DEFAULT_EDGE_CONDITION }));
  if (selectedRoutes.length) appendRunEvent(run, { type: 'route.selected', timestamp, nodeId: node.id, taskId: state.taskId, message: `${node.name} selected ${selectedRoutes.length} outgoing route${selectedRoutes.length === 1 ? '' : 's'}.`, data: { routes: selectedRoutes } });
  if (routed === 'exhausted') {
    appendRunEvent(run, { type: 'loop.exhausted', timestamp, nodeId: node.id, taskId: state.taskId, message: `Loop limit exhausted after ${executionHarness(run).maxLoopIterations} iterations.` });
    appendRunEvent(run, { type: 'run.failed', timestamp, nodeId: node.id, taskId: state.taskId, message: 'Workflow run failed because its loop limit was exhausted.' });
    return { run: at(run, timestamp), nodeRun: structuredClone(nodeState(run, nodeId)), kind: 'run-failed' };
  }
  if (routed === 'looped') appendRunEvent(run, { type: 'loop.iterated', timestamp, nodeId: node.id, taskId: state.taskId, message: `${node.name} started revision iteration ${run.loopIterations[node.id] ?? 1}.`, data: { iteration: run.loopIterations[node.id] ?? 1 } });
  run.status = run.nodeRuns.every((candidate) => finishedNodeStatuses.has(candidate.status)) ? 'completed' : 'running';
  if (run.status === 'completed') appendRunEvent(run, { type: 'run.completed', timestamp, nodeId: node.id, taskId: state.taskId, message: 'Workflow run completed.' });
  const kind = routed === 'looped' ? 'looped' : routed === 'branched' ? 'branched' : run.status === 'completed' ? 'run-completed' : 'completed';
  return { run: at(run, timestamp), nodeRun: structuredClone(nodeState(run, nodeId)), kind };
}

export function waitForRuntime(source: WorkflowRun, nodeId: string, message: string, timestamp = new Date().toISOString()): RuntimeTransition {
  const run = copyRun(source);
  const state = nodeState(run, nodeId);
  if (state.status !== 'running') throw new Error(`Node ${nodeId} is not running.`);
  state.status = 'pending';
  state.attempt = Math.max(0, state.attempt - 1);
  state.startedAt = undefined;
  state.completedAt = undefined;
  state.error = undefined;
  state.failureKind = undefined;
  run.runtimeWaiting = { nodeId, since: run.runtimeWaiting?.since ?? timestamp, message };
  run.status = 'running';
  appendRunEvent(run, { type: 'node.runtime-waiting', timestamp, nodeId, taskId: state.taskId, message });
  return { run: at(run, timestamp), nodeRun: structuredClone(state), kind: 'waiting-runtime' };
}

export function failNode(source: WorkflowRun, nodeId: string, error: string, timestamp = new Date().toISOString(), failureKind: RuntimeFailureKind = 'tool'): RuntimeTransition {
  const run = copyRun(source);
  const node = nodeDefinition(run, nodeId);
  const state = nodeState(run, nodeId);
  if (state.status !== 'running') throw new Error(`Node ${nodeId} is not running.`);
  state.error = error.trim() || 'Node execution failed.';
  state.failureKind = failureKind;
  state.completedAt = timestamp;
  recordVerification(run, node, state, 'failed', timestamp, state.error, failureKind);
  if (state.attempt <= (run.executionConfiguration ? executionHarness(run).maxRetries : node.retryLimit)) {
    state.status = 'pending';
    run.status = 'running';
    const failureEvent = appendRunEvent(run, { type: 'node.retry-scheduled', timestamp, nodeId: node.id, taskId: state.taskId, message: `${node.name} failed and is ready to retry.`, data: { attempt: state.attempt, error: state.error, failureKind } });
    captureAdaptationCandidate(run, node.id, failureEvent.id, `Improve ${node.name}: ${state.error}`, timestamp);
    return { run: at(run, timestamp), nodeRun: structuredClone(state), kind: 'retried' };
  }
  state.status = 'failed';
  if (executionHarness(run).parallelFailureMode === 'collect-all' && failureKind === 'tool' && run.compiledWorkflow.nodes.some((candidate) => candidate.type === 'join' && graphPath(run, node.id, candidate.id))) {
    for (const edge of outgoing(run, node.id)) edge.status = nodeDefinition(run, edge.to).type === 'join' ? 'selected' : 'rejected';
    rejectSkippedPaths(run);
    appendRunEvent(run, { type: 'node.failed', timestamp, nodeId, taskId: state.taskId, message: `${node.name} failed; collecting remaining branches.`, data: { attempt: state.attempt } });
    return { run: at(run, timestamp), nodeRun: structuredClone(state), kind: 'completed' };
  }
  for (const candidate of run.nodeRuns) if (candidate.status === 'pending') candidate.status = 'skipped';
  for (const candidate of run.nodeRuns) if (candidate.status === 'running') { candidate.status = 'skipped'; candidate.error = 'Stopped after another branch failed.'; }
  for (const edge of run.edgeRuns) if (edge.status === 'pending') edge.status = 'rejected';
  run.status = 'failed';
  const failureEvent = appendRunEvent(run, { type: 'node.failed', timestamp, nodeId: node.id, taskId: state.taskId, message: `${node.name} failed.`, data: { attempt: state.attempt, error: state.error, failureKind } });
  captureAdaptationCandidate(run, node.id, failureEvent.id, `Improve ${node.name}: ${state.error}`, timestamp);
  appendRunEvent(run, { type: 'run.failed', timestamp, nodeId: node.id, taskId: state.taskId, message: 'Workflow run failed after node retries were exhausted.' });
  return { run: at(run, timestamp), nodeRun: structuredClone(state), kind: 'run-failed' };
}

export function recheckRejectedValidation(source: WorkflowRun, timestamp = new Date().toISOString()): RuntimeTransition {
  const validation = rejectedValidationForRecheck(source);
  if (!validation) throw new Error('This run has no rejected validation that can be rechecked.');
  const run = copyRun(source);
  const state = nodeState(run, validation.nodeId);
  const failureIds = new Set(run.edgeRuns.filter((edge) => edge.from === state.nodeId && edge.status === 'selected').map((edge) => edge.to));
  for (const candidate of run.nodeRuns) {
    if (candidate.status === 'skipped' || failureIds.has(candidate.nodeId) || candidate.nodeId === state.nodeId) {
      candidate.status = 'pending'; candidate.error = undefined; candidate.failureKind = undefined;
      candidate.completedAt = undefined;
    }
  }
  for (const edge of run.edgeRuns) if (nodeState(run, edge.from).status === 'pending') edge.status = 'pending';
  rejectSkippedPaths(run);
  run.status = 'running';
  if (run.mastra) run.mastra = { ...run.mastra, status: 'registered', updatedAt: timestamp };
  if (nextRunnableNode(run)?.id !== state.nodeId) throw new Error('Validation cannot be rechecked from the saved execution path.');
  appendRunEvent(run, { type: 'node.recovered', timestamp, nodeId: state.nodeId, taskId: state.taskId,
    message: `${nodeDefinition(run, state.nodeId).name} is ready to recheck corrected outputs. Earlier work and artifacts were preserved.`, data: { validationRecheck: true } });
  return { run: at(run, timestamp), nodeRun: structuredClone(state), kind: 'retried' };
}

export function retryFailedNode(source: WorkflowRun, timestamp = new Date().toISOString()): RuntimeTransition {
  const failure = failedStepForRetry(source);
  if (!failure) throw new Error('This run has no retryable failed execution step.');
  const run = copyRun(source);
  const state = nodeState(run, failure.nodeId);
  const reopened = new Set(run.nodeRuns.filter((node) => node.status === 'skipped').map((node) => node.nodeId));
  reopened.add(state.nodeId);
  for (const node of run.nodeRuns) if (reopened.has(node.nodeId)) node.status = 'pending';
  // Recompute unexecuted branches from the preserved decisions of completed nodes.
  for (const edge of run.edgeRuns) if (reopened.has(edge.from)) edge.status = 'pending';
  rejectSkippedPaths(run);
  run.status = 'running';
  run.runtimeWaiting = undefined;
  run.pendingInput = undefined;
  state.completedAt = undefined;
  state.error = undefined;
  state.failureKind = undefined;
  if (nextRunnableNode(run)?.id !== state.nodeId && !(executionHarness(run).maxConcurrentNodes > 1 && dependenciesResolved(run, state.nodeId))) throw new Error('The failed step cannot be retried from the saved execution path.');
  if (run.mastra) run.mastra = { ...run.mastra, status: 'registered', updatedAt: timestamp };
  appendRunEvent(run, { type: 'node.recovered', timestamp, nodeId: state.nodeId, taskId: state.taskId,
    message: `${nodeDefinition(run, state.nodeId).name} is ready for a manual retry; completed steps and approvals were preserved.`,
    data: { manualRetry: true, previousAttempt: state.attempt, previousError: failure.error } });
  return { run: at(run, timestamp), nodeRun: structuredClone(state), kind: 'retried' };
}

export function recoverInterruptedRun(source: WorkflowRun, timestamp = new Date().toISOString()): RuntimeTransition {
  const run = copyRun(source);
  const state = run.nodeRuns.find((node) => node.status === 'running');
  if (!state) throw new Error('Run has no interrupted node to recover.');
  const node = nodeDefinition(run, state.nodeId);
  state.status = 'pending';
  state.input = undefined;
  state.startedAt = undefined;
  state.completedAt = undefined;
  state.output = undefined;
  state.selectedCondition = undefined;
  state.summary = undefined;
  state.providerThreadId = undefined;
  state.runtimeJobId = undefined;
  state.runtimeConnectionId = undefined;
  state.artifactIds = [];
  state.error = 'Execution was interrupted before completion and is ready to resume.';
  state.failureKind = 'tool';
  run.status = 'running';
  appendRunEvent(run, { type: 'node.recovered', timestamp, nodeId: node.id, taskId: state.taskId, message: `${node.name} was recovered after an interrupted execution.`, data: { attempt: state.attempt } });
  return { run: at(run, timestamp), nodeRun: structuredClone(state), kind: 'retried' };
}

export function cancelWorkflowRun(source: WorkflowRun, actor: RuntimeApprovalActor, reason = '', timestamp = new Date().toISOString()): RuntimeTransition {
  if (!actor.id.trim() || !actor.name.trim() || !actor.role.trim()) throw new Error('Cancellation actor identity is required.');
  if (['completed', 'failed', 'cancelled'].includes(source.status)) throw new Error(`Run cannot be cancelled from ${source.status}.`);
  const run = copyRun(source);
  const note = reason.trim() || 'Cancelled by the user.';
  for (const state of run.nodeRuns) {
    if (state.status === 'pending' || state.status === 'running' || state.status === 'waiting-approval') {
      state.status = 'skipped';
      state.completedAt = timestamp;
      state.error = state.error || note;
    }
  }
  for (const edge of run.edgeRuns) if (edge.status === 'pending') edge.status = 'rejected';
  run.pendingInput = undefined;
  run.runtimeWaiting = undefined;
  run.status = 'cancelled';
  appendRunEvent(run, { type: 'run.cancelled', timestamp, message: `${actor.name} cancelled the workflow run.`, data: { actor: { id: actor.id.trim(), name: actor.name.trim(), role: actor.role.trim() }, reason: note } });
  return { run: at(run, timestamp), kind: 'run-cancelled' };
}

export interface RuntimeApprovalActor {
  id: string;
  name: string;
  role: string;
}

function pendingApproval(run: WorkflowRun, nodeId: string) {
  const state = nodeState(run, nodeId);
  if (state.status !== 'waiting-approval' || run.status !== 'paused') throw new Error(`Node ${nodeId} is not waiting for approval.`);
  const approval = [...run.approvalRecords].reverse().find((candidate) => candidate.nodeId === nodeId && candidate.attempt === state.attempt && candidate.iteration === state.iteration && !candidate.resumedAt);
  if (!approval) throw new Error(`Node ${nodeId} has no active approval request.`);
  return { state, approval };
}

export function decideRuntimeApproval(source: WorkflowRun, nodeId: string, decision: RuntimeApprovalDecision, actor: RuntimeApprovalActor, feedback = '', timestamp = new Date().toISOString()) {
  if (!actor.id.trim() || !actor.name.trim() || !actor.role.trim()) throw new Error('Approval actor identity is required.');
  const note = feedback.trim();
  if (decision !== 'approved' && !note) throw new Error('Feedback is required when rejecting or requesting revision.');
  if (decision === 'revision-requested') {
    const blocker = revisionBudgetBlocker(source, nodeId);
    if (blocker) throw new Error(blocker);
  }
  const run = copyRun(source);
  const { approval } = pendingApproval(run, nodeId);
  if (approval.decision) throw new Error('This approval request already has a decision. Resume it to continue.');
  approval.decision = decision;
  approval.decidedAt = timestamp;
  approval.decidedBy = { id: actor.id.trim(), name: actor.name.trim(), role: actor.role.trim() };
  approval.feedback = note || undefined;
  const eventType = decision === 'approved' ? 'approval.approved' : decision === 'rejected' ? 'approval.rejected' : 'approval.revision-requested';
  const message = decision === 'approved' ? 'Runtime approval granted.' : decision === 'rejected' ? 'Runtime approval rejected.' : 'Runtime revision requested.';
  const decisionEvent = appendRunEvent(run, { type: eventType, timestamp, nodeId, taskId: approval.taskId, message, data: { approvalId: approval.id, actor: approval.decidedBy, ...(note ? { feedback: note } : {}) } });
  if (decision === 'revision-requested') captureAdaptationCandidate(run, nodeId, decisionEvent.id, `Revision feedback for ${nodeDefinition(run, nodeId).name}: ${note}`, timestamp);
  return at(run, timestamp);
}

export function decideRuntimeApprovalByKeyword(source: WorkflowRun, nodeId: string, keyword: string, actor: RuntimeApprovalActor, feedback = '', timestamp = new Date().toISOString()) {
  if (!actor.id.trim() || !actor.name.trim() || !actor.role.trim()) throw new Error('Approval actor identity is required.');
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) throw new Error('Choose an approval outcome.');
  const run = copyRun(source);
  const node = nodeDefinition(run, nodeId);
  const option = node.approvalOptions?.find((candidate) => candidate.keyword.trim().toLowerCase() === normalizedKeyword);
  if (!option) throw new Error(`Approval keyword is not configured for ${node.name}: ${keyword}.`);
  if (option.action === 'revise') {
    const blocker = revisionBudgetBlocker(source, nodeId, option.keyword);
    if (blocker) throw new Error(blocker);
  }
  const note = feedback.trim();
  if (option.action !== 'continue' && !note) throw new Error('Feedback is required when revising or stopping a workflow.');
  const { approval } = pendingApproval(run, nodeId);
  if (approval.decision) throw new Error('This approval request already has a decision. Resume it to continue.');
  const decision: RuntimeApprovalDecision = option.action === 'continue' ? 'approved' : option.action === 'revise' ? 'revision-requested' : 'rejected';
  approval.decision = decision;
  approval.selectedOptionId = option.id;
  approval.keyword = option.keyword;
  approval.outcomeAction = option.action;
  approval.decidedAt = timestamp;
  approval.decidedBy = { id: actor.id.trim(), name: actor.name.trim(), role: actor.role.trim() };
  approval.feedback = note || undefined;
  const eventType = decision === 'approved' ? 'approval.approved' : decision === 'rejected' ? 'approval.rejected' : 'approval.revision-requested';
  const decisionEvent = appendRunEvent(run, { type: eventType, timestamp, nodeId, taskId: approval.taskId, message: `${option.label} selected at ${node.name}.`, data: { approvalId: approval.id, optionId: option.id, keyword: option.keyword, action: option.action, actor: approval.decidedBy, ...(note ? { feedback: note } : {}) } });
  if (option.action === 'revise') captureAdaptationCandidate(run, nodeId, decisionEvent.id, `Revision feedback for ${node.name}: ${note}`, timestamp);
  return at(run, timestamp);
}

export function decideAdaptationCandidate(source: WorkflowRun, candidateId: string, decision: 'approved' | 'rejected', actor: RuntimeApprovalActor, note = '', timestamp = new Date().toISOString()) {
  if (!actor.id.trim() || !actor.name.trim() || !actor.role.trim()) throw new Error('Adaptation decision actor identity is required.');
  const run = copyRun(source);
  const candidate = run.adaptationCandidates.find((item) => item.id === candidateId);
  if (!candidate || candidate.status !== 'proposed') throw new Error('Adaptation candidate is unavailable or already decided.');
  candidate.status = decision;
  candidate.decidedAt = timestamp;
  candidate.decidedBy = { id: actor.id.trim(), name: actor.name.trim(), role: actor.role.trim() };
  candidate.decisionNote = note.trim() || undefined;
  appendRunEvent(run, { type: decision === 'approved' ? 'adaptation.approved' : 'adaptation.rejected', timestamp, nodeId: candidate.nodeId, message: `${candidate.decidedBy.name} ${decision} an improvement candidate.`, data: { candidateId: candidate.id, scope: candidate.scope, note: candidate.decisionNote ?? '' } });
  return at(run, timestamp);
}

function decisionOutput(node: CompiledWorkflowNode, approval: RuntimeApprovalRecord) {
  const output: Record<string, unknown> = {};
  for (const key of node.outputKeys) {
    const type = node.outputSchemas?.[key] ?? 'string';
    if (type === 'boolean') output[key] = approval.decision === 'approved';
    else if (type === 'number') output[key] = approval.decision === 'approved' ? 1 : 0;
    else if (type === 'array') output[key] = approval.feedback ? [approval.feedback] : [];
    else if (type === 'object') output[key] = { decision: approval.decision, feedback: approval.feedback ?? '', actor: approval.decidedBy };
    else if (type === 'null') output[key] = null;
    else output[key] = approval.decision;
  }
  return output;
}

function approvalRoute(run: WorkflowRun, nodeId: string, decision: RuntimeApprovalDecision, keyword?: string) {
  const edges = outgoing(run, nodeId);
  if (!edges.length) return '';
  if (keyword) {
    const exact = edges.find((edge) => edge.condition.trim().toLowerCase() === keyword.trim().toLowerCase());
    if (exact) return exact.condition;
    throw new Error(`This approval node has no route for the configured keyword: ${keyword}.`);
  }
  const patterns = decision === 'approved'
    ? /approv|accept|proceed|pass|\byes\b|\btrue\b/i
    : /revis|change|feedback|rework|retry|loop/i;
  const matching = edges.find((edge) => patterns.test(edge.condition) || (decision === 'revision-requested' && nodeDefinition(run, edge.to).type === 'loop'));
  if (matching) return matching.condition || DEFAULT_EDGE_CONDITION;
  const fallback = edges.find((edge) => !edge.condition);
  if (decision === 'approved' && fallback) return DEFAULT_EDGE_CONDITION;
  if (decision === 'approved' && edges.length === 1) return edges[0].condition || DEFAULT_EDGE_CONDITION;
  throw new Error(decision === 'revision-requested' ? 'This approval node has no revision route. Add a revision connection before compiling a new run.' : 'This approval node has no route for an approved decision.');
}

export function resumeRuntimeApproval(source: WorkflowRun, nodeId: string, actor: RuntimeApprovalActor, timestamp = new Date().toISOString()) {
  if (!actor.id.trim() || !actor.name.trim() || !actor.role.trim()) throw new Error('Resume actor identity is required.');
  const run = copyRun(source);
  const { state, approval } = pendingApproval(run, nodeId);
  if (!approval.decision || !approval.decidedAt || !approval.decidedBy) throw new Error('Record an approval decision before resuming the run.');
  approval.resumedAt = timestamp;
  approval.resumedBy = { id: actor.id.trim(), name: actor.name.trim(), role: actor.role.trim() };
  appendRunEvent(run, { type: 'approval.resumed', timestamp, nodeId, taskId: approval.taskId, message: `${approval.resumedBy.name} resumed the approval checkpoint.`, data: { approvalId: approval.id, decision: approval.decision, actor: approval.resumedBy } });

  if (approval.decision === 'rejected') {
    state.status = 'failed';
    state.error = approval.feedback || 'Execution was rejected by a human reviewer.';
    state.failureKind = 'human-rejection';
    state.completedAt = timestamp;
    for (const candidate of run.nodeRuns) if (candidate.status === 'pending') candidate.status = 'skipped';
    for (const edge of run.edgeRuns) if (edge.status === 'pending') edge.status = 'rejected';
    run.status = 'failed';
    appendRunEvent(run, { type: 'node.failed', timestamp, nodeId, taskId: state.taskId, message: `${nodeDefinition(run, nodeId).name} was rejected.`, data: { feedback: state.error, failureKind: state.failureKind } });
    appendRunEvent(run, { type: 'run.failed', timestamp, nodeId, taskId: state.taskId, message: 'Workflow run stopped after human rejection.' });
    return at(run, timestamp);
  }

  const node = nodeDefinition(run, nodeId);
  if (node.type !== 'approval') {
    if (approval.decision === 'revision-requested') throw new Error('Revision routing is only supported by approval nodes in this compiled run.');
    state.status = 'pending';
    state.attempt = Math.max(0, state.attempt - 1);
    state.approvalGranted = true;
    run.status = 'running';
    return at(run, timestamp);
  }

  const selectedCondition = approvalRoute(run, nodeId, approval.decision, approval.keyword);
  return completeNode(run, nodeId, decisionOutput(node, approval), selectedCondition, timestamp, { summary: approval.feedback || `Human decision: ${approval.decision}.` }).run;
}

export class SequentialRuntime {
  constructor(private readonly store: RunStateStore) {}

  async startNext(userId: string, runId: string, timestamp = new Date().toISOString()) {
    const transition = startNextNode(await this.requireRun(userId, runId), timestamp);
    await this.store.upsert(userId, transition.run);
    return transition;
  }

  async complete(userId: string, runId: string, nodeId: string, result: NodeExecutionResult, timestamp = new Date().toISOString(), fence?: NodeAttemptFence) {
    const current = await this.requireRun(userId, runId);
    if (fence) assertNodeAttempt(current, fence);
    const transition = completeNode(current, nodeId, result.output, result.selectedCondition, timestamp, result);
    await this.store.upsert(userId, transition.run);
    return transition;
  }

  async recover(userId: string, runId: string, timestamp = new Date().toISOString()) {
    const transition = recoverInterruptedRun(await this.requireRun(userId, runId), timestamp);
    await this.store.upsert(userId, transition.run);
    return transition;
  }

  async cancel(userId: string, runId: string, actor: RuntimeApprovalActor, reason = '', timestamp = new Date().toISOString()) {
    const transition = cancelWorkflowRun(await this.requireRun(userId, runId), actor, reason, timestamp);
    await this.store.upsert(userId, transition.run);
    return transition;
  }

  async decideAdaptation(userId: string, runId: string, candidateId: string, decision: 'approved' | 'rejected', actor: RuntimeApprovalActor, note = '', timestamp = new Date().toISOString()) {
    const run = decideAdaptationCandidate(await this.requireRun(userId, runId), candidateId, decision, actor, note, timestamp);
    await this.store.upsert(userId, run);
    return run;
  }

  async decideApproval(userId: string, runId: string, nodeId: string, decision: RuntimeApprovalDecision, actor: RuntimeApprovalActor, feedback = '', timestamp = new Date().toISOString()) {
    const run = decideRuntimeApproval(await this.requireRun(userId, runId), nodeId, decision, actor, feedback, timestamp);
    await this.store.upsert(userId, run);
    return run;
  }

  async decideApprovalByKeyword(userId: string, runId: string, nodeId: string, keyword: string, actor: RuntimeApprovalActor, feedback = '', timestamp = new Date().toISOString()) {
    const run = decideRuntimeApprovalByKeyword(await this.requireRun(userId, runId), nodeId, keyword, actor, feedback, timestamp);
    await this.store.upsert(userId, run);
    return run;
  }

  async resumeApproval(userId: string, runId: string, nodeId: string, actor: RuntimeApprovalActor, timestamp = new Date().toISOString()) {
    const run = resumeRuntimeApproval(await this.requireRun(userId, runId), nodeId, actor, timestamp);
    await this.store.upsert(userId, run);
    return run;
  }

  async fail(userId: string, runId: string, nodeId: string, error: string, timestamp = new Date().toISOString(), failureKind: RuntimeFailureKind = 'tool', fence?: NodeAttemptFence) {
    const current = await this.requireRun(userId, runId);
    if (fence) assertNodeAttempt(current, fence);
    const transition = failNode(current, nodeId, error, timestamp, failureKind);
    await this.store.upsert(userId, transition.run);
    return transition;
  }

  async executeNext(userId: string, runId: string, executor: NodeTaskExecutor): Promise<RuntimeTransition> {
    const started = await this.startNext(userId, runId);
    if (started.kind !== 'started' || !started.task || !started.nodeRun) return started;
    try {
      const result = nativeNodeResult(started.run, started.nodeRun.nodeId) ?? await executor.execute(started.task);
      const latest = await this.requireRun(userId, runId);
      if (latest.status === 'cancelled') return { run: latest, kind: 'run-cancelled' };
      if (result.runtimeJobId && latest.nodeRuns.some((node) => node.nodeId === started.nodeRun!.nodeId && node.runtimeJobId === result.runtimeJobId && node.status === 'completed')) {
        return { run: latest, nodeRun: latest.nodeRuns.find((node) => node.nodeId === started.nodeRun!.nodeId), kind: latest.status === 'completed' ? 'run-completed' : 'completed' };
      }
      return await this.complete(userId, runId, started.nodeRun.nodeId, result, undefined, started.nodeRun);
    } catch (error) {
      if (error instanceof RunStateConflictError) throw error;
      const latest = await this.requireRun(userId, runId);
      if (latest.status === 'cancelled') return { run: latest, kind: 'run-cancelled' };
      const jobId = error && typeof error === 'object' && 'jobId' in error ? error.jobId : undefined;
      if (jobId && latest.nodeRuns.some((node) => node.nodeId === started.nodeRun!.nodeId && node.runtimeJobId === jobId && node.status !== 'running')) {
        return { run: latest, nodeRun: latest.nodeRuns.find((node) => node.nodeId === started.nodeRun!.nodeId), kind: latest.status === 'failed' ? 'run-failed' : 'retried' };
      }
      assertNodeAttempt(latest, started.nodeRun);
      if (isRuntimeUnavailable(error)) {
        const transition = waitForRuntime(latest, started.nodeRun.nodeId, (error as Error).message);
        await this.store.upsert(userId, transition.run);
        return transition;
      }
      return await this.fail(userId, runId, started.nodeRun.nodeId, error instanceof Error ? error.message : 'Node execution failed.', undefined, classifyExecutionError(error), started.nodeRun);
    }
  }

  private async requireRun(userId: string, runId: string) {
    const run = await this.store.read(userId, runId);
    if (!run) throw new Error('Run was not found.');
    return run;
  }
}
