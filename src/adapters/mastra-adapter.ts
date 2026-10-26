import { createHash } from 'node:crypto';
import { Mastra } from '@mastra/core/mastra';
import { createStep, createWorkflow, type AnyWorkflow } from '@mastra/core/workflows';
import type { PostgresStore } from '@mastra/pg';
import { z } from 'zod';
import { isRuntimeUnavailable } from '@/src/domain/runtime-unavailable';
import { postgresConfig } from '@/scripts/postgres-config.cjs';
import type { WorkflowPlan, WorkflowValueType } from '@/src/domain/models';
import { compileWorkflowRun, type ApprovedAdaptationReference, type CompilationResult, type CompiledWorkflow, type WorkflowRun } from '@/src/domain/runtime';
import {
  cancelWorkflowRun, completeNode, decideRuntimeApproval, decideRuntimeApprovalByKeyword, failNode, focusedTaskForRun, nextRunnableNode, waitForRuntime, recoverInterruptedRun, resumeRuntimeApproval, startNextNode,
  type NodeTaskExecutor, type RunStateStore, type RuntimeApprovalActor
} from '@/src/domain/runtime-engine';
import { RunRepository } from '@/src/storage/run-repository';
import { requestFingerprint } from '@/src/server/request-fingerprint';
import { assertNodeAttempt, RunStateConflictError } from '@/src/domain/run-transition-service';
import { requestMissingNodeInput, runActiveBranches } from '@/src/domain/parallel-runner';
import type { ProjectWorkflow, Skill } from '@/src/domain/workspace';

export const MASTRA_ENGINE = 'mastra' as const;
export const MASTRA_VERSION = '1.65.0' as const;
export const MASTRA_RUNTIME_BOUNDARY_VERSION = 1 as const;
export const MASTRA_SNAPSHOT_SCHEMA_VERSION = 1 as const;

const testRuntimeHolder = globalThis as typeof globalThis & { __workflowStudioMastraRuntimes?: Map<string, Mastra> };
function sharedTestRuntime(schema: string) {
  const runtimes = testRuntimeHolder.__workflowStudioMastraRuntimes ??= new Map<string, Mastra>();
  let runtime = runtimes.get(schema);
  if (!runtime) {
    runtime = new Mastra({ logger: false });
    runtimes.set(schema, runtime);
  }
  return runtime;
}

export type MastraOperation = 'start' | 'suspend' | 'resume' | 'cancel' | 'recover';

export class MastraCapabilityError extends Error {
  readonly code = 'MASTRA_CAPABILITY_UNAVAILABLE';
  constructor(readonly operation: MastraOperation, readonly phaseTask: string) {
    super(`Mastra ${operation} is unavailable until ${phaseTask} is complete.`);
    this.name = 'MastraCapabilityError';
  }
}

export interface MastraStepDefinition {
  readOnly?: boolean;
  joinMode?: 'all' | 'quorum';
  joinQuorum?: number;
  nodeId: string;
  stepId: string;
  name: string;
  type: string;
  focusedPrompt: string;
  skillVersions: Array<{ skillId: string; version: number }>;
  inputKeys: string[];
  outputKeys: string[];
  outputSchemas: Record<string, WorkflowValueType>;
  requiredArtifacts: string[];
  retryLimit: number;
  requiresApproval: boolean;
  approvalOptions: Array<{ id: string; keyword: string; action: string }>;
}

export interface MastraEdgeDefinition {
  fromStepId: string;
  toStepId: string;
  condition: string;
  loopBack: boolean;
  maxLoopIterations?: number;
}

export interface MastraWorkflowRegistration {
  engine: typeof MASTRA_ENGINE;
  engineVersion: typeof MASTRA_VERSION;
  boundaryVersion: typeof MASTRA_RUNTIME_BOUNDARY_VERSION;
  definitionId: string;
  assignmentId: string;
  workflowVersion: number;
  registrationKey: string;
  runnerStepId: string;
  fingerprint: string;
  entryStepIds: string[];
  steps: MastraStepDefinition[];
  edges: MastraEdgeDefinition[];
}

export interface MastraCompilationResult extends CompilationResult { registration?: MastraWorkflowRegistration }

export interface MastraRuntimeDiagnostics {
  engine: typeof MASTRA_ENGINE;
  engineVersion: typeof MASTRA_VERSION;
  boundaryVersion: typeof MASTRA_RUNTIME_BOUNDARY_VERSION;
  snapshotSchemaVersion: typeof MASTRA_SNAPSHOT_SCHEMA_VERSION;
  nodeRequirement: string;
  storage: 'postgresql';
  registeredWorkflowCount: number;
  operations: Record<'compile' | 'inspect' | MastraOperation, 'available' | 'phase-pending'>;
}

export interface MastraExecutionInput { userId: string; run: WorkflowRun }
export interface MastraCancellation { actor: RuntimeApprovalActor; reason?: string }
export interface MastraApprovalResume {
  actionKey?: string;
  actionFingerprint?: string;
  nodeId: string;
  approvalId: string;
  keyword?: string;
  decision?: 'approved' | 'rejected' | 'revision-requested';
  feedback?: string;
  actor: RuntimeApprovalActor;
}

export interface MastraAdapter {
  compile(userId: string, plan: WorkflowPlan, assignment: ProjectWorkflow, skills: Skill[], requestedRunId?: string, approvedAdaptations?: ApprovedAdaptationReference[]): Promise<MastraCompilationResult>;
  start(registrationKey: string, runId: string, input: MastraExecutionInput): Promise<unknown>;
  suspend(userId: string, runId: string): Promise<unknown>;
  resume(userId: string, runId: string, payload: MastraApprovalResume): Promise<unknown>;
  cancel(userId: string, runId: string, payload?: MastraCancellation): Promise<unknown>;
  inspect(registrationKey?: string): MastraWorkflowRegistration | MastraRuntimeDiagnostics | undefined;
  recover(userId: string, runId: string): Promise<unknown>;
  diagnostics(): MastraRuntimeDiagnostics;
}

const runSchema = z.custom<WorkflowRun>((value) => Boolean(value && typeof value === 'object' && 'id' in value));
const envelopeSchema = z.object({ userId: z.string(), run: runSchema });
const actorSchema = z.object({ id: z.string(), name: z.string(), role: z.string() });
const resumeSchema = z.object({
  actionKey: z.string().optional(), actionFingerprint: z.string().optional(),
  nodeId: z.string(), approvalId: z.string(), keyword: z.string().optional(),
  decision: z.enum(['approved', 'rejected', 'revision-requested']).optional(), feedback: z.string().optional(), actor: actorSchema
});
const suspendSchema = z.object({
  userId: z.string(), run: runSchema, nodeId: z.string(), approvalId: z.string(), allowedKeywords: z.array(z.string()), artifactIds: z.array(z.string())
});

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'workflow';
}

function pathExists(from: string, to: string, edges: CompiledWorkflow['edges'], excluded: CompiledWorkflow['edges'][number]): boolean {
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

function compiledLoopEdges(workflow: CompiledWorkflow): Set<string> {
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  return new Set(workflow.edges.filter((edge) => nodes.get(edge.from)?.type === 'loop' && pathExists(edge.to, edge.from, workflow.edges, edge)).map((edge) => `${edge.from}->${edge.to}`));
}

function deterministicNodeOrder(workflow: CompiledWorkflow, loopEdges: Set<string>): string[] {
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  const indegree = new Map(workflow.nodes.map((node) => [node.id, 0]));
  for (const edge of workflow.edges) if (!loopEdges.has(`${edge.from}->${edge.to}`)) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  const ready = [...nodeIds].filter((id) => indegree.get(id) === 0).sort();
  const ordered: string[] = [];
  while (ready.length) {
    const current = ready.shift() as string;
    ordered.push(current);
    for (const edge of workflow.edges.filter((candidate) => candidate.from === current && !loopEdges.has(`${candidate.from}->${candidate.to}`)).sort((a, b) => a.to.localeCompare(b.to))) {
      const remaining = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, remaining);
      if (remaining === 0) { ready.push(edge.to); ready.sort(); }
    }
  }
  if (ordered.length !== nodeIds.size) throw new Error('Mastra compilation found an unsupported cycle outside a bounded loop.');
  return ordered;
}

function definitionFor(workflow: CompiledWorkflow): MastraWorkflowRegistration {
  const loopEdges = compiledLoopEdges(workflow);
  const orderedNodeIds = deterministicNodeOrder(workflow, loopEdges);
  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const definitionId = `${safeId(workflow.workflowId)}-v${workflow.workflowVersion}`;
  const registrationKey = `${definitionId}-${safeId(workflow.assignmentId)}-c${workflow.assignmentConfigurationVersion}`;
  const stepId = (nodeId: string) => `${definitionId}--${safeId(nodeId)}`;
  const steps = orderedNodeIds.map((nodeId) => {
    const node = nodeById.get(nodeId);
    if (!node) throw new Error(`Mastra compilation could not resolve node ${nodeId}.`);
    return {
      nodeId, stepId: stepId(nodeId), name: node.name, type: node.type, focusedPrompt: node.focusedPrompt,
      ...(node.readOnly !== undefined ? { readOnly: node.readOnly } : {}),
      ...(node.joinMode !== undefined ? { joinMode: node.joinMode } : {}),
      ...(node.joinQuorum !== undefined ? { joinQuorum: node.joinQuorum } : {}),
      skillVersions: [...node.skillVersions].sort((a, b) => `${a.skillId}:${a.version}`.localeCompare(`${b.skillId}:${b.version}`)),
      inputKeys: [...node.inputKeys].sort(), outputKeys: [...node.outputKeys].sort(),
      outputSchemas: Object.fromEntries(Object.entries(node.outputSchemas ?? {}).sort(([a], [b]) => a.localeCompare(b))),
      requiredArtifacts: [...(node.requiredArtifacts ?? [])].sort(), retryLimit: node.retryLimit, requiresApproval: node.requiresApproval,
      approvalOptions: (node.approvalOptions ?? []).map((option) => ({ id: option.id, keyword: option.keyword, action: option.action })).sort((a, b) => a.id.localeCompare(b.id))
    } satisfies MastraStepDefinition;
  });
  const edges = workflow.edges.map((edge) => ({
    fromStepId: stepId(edge.from), toStepId: stepId(edge.to), condition: edge.condition?.trim() ?? '',
    loopBack: loopEdges.has(`${edge.from}->${edge.to}`), ...(loopEdges.has(`${edge.from}->${edge.to}`) ? { maxLoopIterations: workflow.maxLoopIterations } : {})
  })).sort((a, b) => `${a.fromStepId}:${a.toStepId}:${a.condition}`.localeCompare(`${b.fromStepId}:${b.toStepId}:${b.condition}`));
  const stableDefinition = {
    definitionId, assignmentId: workflow.assignmentId, workflowVersion: workflow.workflowVersion, registrationKey,
    runnerStepId: `${definitionId}--graph-runner`, entryStepIds: workflow.entryNodeIds.map(stepId).sort(), steps, edges
  };
  return { engine: MASTRA_ENGINE, engineVersion: MASTRA_VERSION, boundaryVersion: MASTRA_RUNTIME_BOUNDARY_VERSION, ...stableDefinition, fingerprint: createHash('sha256').update(stableStringify(stableDefinition)).digest('hex') };
}

function correlated(run: WorkflowRun, registration: MastraWorkflowRegistration, status: NonNullable<WorkflowRun['mastra']>['status'], activeStepId?: string): WorkflowRun {
  const copy = structuredClone(run);
  copy.runtimeEngine = { name: 'mastra', version: MASTRA_RUNTIME_BOUNDARY_VERSION };
  copy.mastra = {
    schemaVersion: MASTRA_SNAPSHOT_SCHEMA_VERSION, engineVersion: MASTRA_VERSION, workflowId: registration.registrationKey,
    runId: run.id, definitionFingerprint: registration.fingerprint, ...(activeStepId ? { activeStepId } : {}), status, updatedAt: new Date().toISOString()
  };
  return copy;
}

function terminalStatus(run: WorkflowRun) { return ['completed', 'failed', 'cancelled'].includes(run.status); }

export function reconcileMastraRunState(snapshotRun: WorkflowRun, durableRun: WorkflowRun | null): WorkflowRun {
  if (!durableRun) return snapshotRun;
  if (durableRun.id !== snapshotRun.id || durableRun.userId !== snapshotRun.userId || durableRun.mastra?.definitionFingerprint !== snapshotRun.mastra?.definitionFingerprint) {
    throw new Error('Mastra snapshot correlation does not match the durable Workflow Studio run.');
  }
  const sharedEventsMatch = snapshotRun.events.slice(0, Math.min(snapshotRun.events.length, durableRun.events.length))
    .every((event, index) => requestFingerprint(durableRun.events[index]) === requestFingerprint(event));
  if (!sharedEventsMatch) throw new Error('Mastra snapshot and durable run event journals have diverged.');
  if ((durableRun.stateRevision ?? 0) > 0 || (snapshotRun.stateRevision ?? 0) > 0) {
    if ((snapshotRun.stateRevision ?? 0) > (durableRun.stateRevision ?? 0)) throw new RunStateConflictError('Mastra checkpoint is ahead of the authoritative run revision.');
    return structuredClone(durableRun);
  }
  return durableRun.events.length >= snapshotRun.events.length ? structuredClone(durableRun) : snapshotRun;
}

function mastraWorkflowFor(registration: MastraWorkflowRegistration, executor: NodeTaskExecutor | undefined, store: RunStateStore): AnyWorkflow {
  const runner = createStep({
    id: registration.runnerStepId,
    description: `Advance one validated node in ${registration.definitionId}`,
    metadata: { workflowStudio: registration }, inputSchema: envelopeSchema, outputSchema: envelopeSchema, resumeSchema, suspendSchema,
    execute: async ({ inputData, resumeData, suspendData, suspend }) => {
      const userId = inputData.userId;
      let run = structuredClone(suspendData?.run ?? inputData.run);
      run = reconcileMastraRunState(run, await store.read(userId, run.id));
      if (resumeData) {
        run = resumeData.keyword
          ? decideRuntimeApprovalByKeyword(run, resumeData.nodeId, resumeData.keyword, resumeData.actor, resumeData.feedback)
          : decideRuntimeApproval(run, resumeData.nodeId, resumeData.decision ?? 'approved', resumeData.actor, resumeData.feedback);
        run = resumeRuntimeApproval(run, resumeData.nodeId, resumeData.actor);
        if (resumeData.actionKey && resumeData.actionFingerprint) {
          run.processedActionKeys = [...new Set([...(run.processedActionKeys ?? []), resumeData.actionKey])];
          run.actionReceipts = { ...run.actionReceipts, [resumeData.actionKey]: resumeData.actionFingerprint };
        }
        run = await store.upsert(userId, correlated(run, registration, terminalStatus(run) ? (run.status === 'completed' ? 'completed' : 'failed') : 'running', resumeData.nodeId));
      }
      if (terminalStatus(run)) return { userId, run };
      if (run.pendingInput) return { userId, run };
      const inputRequest = requestMissingNodeInput(run);
      if (inputRequest) return { userId, run: await store.upsert(userId, inputRequest) };
      // Recreate a lost engine suspension from the durable gate without replaying completed nodes.
      if (run.status === 'paused') {
        const approval = run.approvalRecords.findLast((record) => !record.decision && !record.resumedAt);
        const waiting = run.nodeRuns.find((node) => node.nodeId === approval?.nodeId && node.status === 'waiting-approval');
        if (!approval || !waiting || run.nodeRuns.some((node) => node.status === 'running')) throw new Error('Paused run has no consistent pending approval gate.');
        const suspendedRun = correlated(run, registration, 'suspended', approval.nodeId);
        await store.upsert(userId, suspendedRun);
        return await suspend({ userId, run: suspendedRun, nodeId: approval.nodeId, approvalId: approval.id,
          allowedKeywords: run.compiledWorkflow.nodes.find((node) => node.id === approval.nodeId)?.approvalOptions?.map((option) => option.keyword) ?? [],
          artifactIds: suspendedRun.artifacts.map((artifact) => artifact.id) });
      }
      const inFlight = run.nodeRuns.find((node) => node.status === 'running');
      const transition = inFlight
        ? { kind: 'started' as const, run, nodeRun: structuredClone(inFlight), task: focusedTaskForRun(run, inFlight.nodeId) }
        : startNextNode(run);
      run = transition.run;
      const activeNodeId = transition.nodeRun?.nodeId;
      if (transition.kind === 'waiting-approval' && transition.nodeRun) {
        const approval = run.approvalRecords.at(-1);
        if (!approval) throw new Error('Mastra approval suspension is missing its durable approval record.');
        const suspendedRun = correlated(run, registration, 'suspended', transition.nodeRun.nodeId);
        await store.upsert(userId, suspendedRun);
        return await suspend({
          userId, run: suspendedRun, nodeId: transition.nodeRun.nodeId, approvalId: approval.id,
          allowedKeywords: transition.task?.node.approvalOptions?.map((option) => option.keyword) ?? [], artifactIds: [...suspendedRun.artifacts.map((artifact) => artifact.id)]
        });
      }
      if (transition.kind === 'run-completed' || transition.kind === 'run-failed') {
        const finalRun = correlated(run, registration, transition.kind === 'run-completed' ? 'completed' : 'failed');
        await store.upsert(userId, finalRun);
        return { userId, run: finalRun };
      }
      if (transition.kind !== 'started' || !transition.task || !transition.nodeRun) throw new Error(`Mastra cannot advance transition ${transition.kind}.`);
      if (!executor) throw new MastraCapabilityError('start', 'P7-T03');
      run = await store.upsert(userId, correlated(run, registration, 'running', activeNodeId));
      if ((run.executionConfiguration?.harness ?? run.compiledWorkflow.harness).maxConcurrentNodes > 1 || ['fork', 'join'].includes(transition.task.node.type)) {
        while (nextRunnableNode(run)) {
          const next = nextRunnableNode(run)!;
          if (next.requiresApproval || ['approval', 'loop', 'success', 'failure'].includes(next.type)) break;
          const missing = requestMissingNodeInput(run);
          if (missing) { run = await store.upsert(userId, missing); break; }
          run = await store.upsert(userId, startNextNode(run).run);
        }
        run = await runActiveBranches(userId, run.id, store, executor);
        return { userId, run };
      }
      try {
        const result = await executor.execute(transition.task);
        const durable = await store.read(userId, run.id);
        if (!durable) throw new RunStateConflictError('Run no longer exists.');
        if (durable.status === 'cancelled') return { userId, run: durable };
        if (result.runtimeJobId && durable.nodeRuns.some((node) => node.nodeId === transition.nodeRun!.nodeId && node.runtimeJobId === result.runtimeJobId && node.status === 'completed')) {
          return { userId, run: durable };
        }
        assertNodeAttempt(durable, transition.nodeRun);
        run = durable;
        run = completeNode(run, transition.nodeRun.nodeId, result.output, result.selectedCondition, undefined, result).run;
      } catch (error) {
        if (error instanceof RunStateConflictError) throw error;
        const durable = await store.read(userId, run.id);
        if (durable?.status === 'cancelled') return { userId, run: durable };
        if (!durable) throw new RunStateConflictError('Run no longer exists.');
        const jobId = error && typeof error === 'object' && 'jobId' in error ? error.jobId : undefined;
        if (jobId && durable.nodeRuns.some((node) => node.nodeId === transition.nodeRun!.nodeId && node.runtimeJobId === jobId && node.status !== 'running')) return { userId, run: durable };
        assertNodeAttempt(durable, transition.nodeRun);
        run = isRuntimeUnavailable(error)
          ? waitForRuntime(durable ?? run, transition.nodeRun.nodeId, (error as Error).message).run
          : failNode(durable ?? run, transition.nodeRun.nodeId, error instanceof Error ? error.message : 'Node execution failed.').run;
      }
      const status = terminalStatus(run) ? (run.status === 'completed' ? 'completed' : 'failed') : 'running';
      const saved = correlated(run, registration, status, activeNodeId);
      await store.upsert(userId, saved);
      return { userId, run: saved };
    }
  });
  return createWorkflow({
    id: registration.registrationKey, description: `Workflow Studio runtime ${registration.definitionId}`,
    metadata: { workflowStudio: registration }, inputSchema: envelopeSchema, outputSchema: envelopeSchema
  }).dountil(runner, async ({ inputData }) => terminalStatus(inputData.run) || Boolean(inputData.run.runtimeWaiting) || Boolean(inputData.run.pendingInput)).commit();
}

export class LocalMastraAdapter implements MastraAdapter {
  private storage?: PostgresStore;
  private persistentRuntime?: Mastra;
  private readonly runtime = new Mastra({ logger: false });
  private readonly registrations = new Map<string, MastraWorkflowRegistration>();
  private readonly executor?: NodeTaskExecutor;
  private readonly store: RunStateStore;
  private readonly storageSchema: string;
  private storageReady?: Promise<void>;

  constructor(options: { executor?: NodeTaskExecutor; store?: RunStateStore; storageSchema?: string } = {}) {
    this.executor = options.executor;
    this.store = options.store ?? new RunRepository();
    this.storageSchema = options.storageSchema ?? 'workflow_studio_mastra';
  }

  private initializeStorage() {
    return this.storageReady ??= (async () => {
      if (process.env.NODE_ENV === 'test' && process.env.WORKFLOW_STUDIO_TEST_MASTRA_POSTGRES !== 'true') {
        this.persistentRuntime = sharedTestRuntime(this.storageSchema);
      } else {
        const { PostgresStore } = await import('@mastra/pg');
        this.storage = new PostgresStore({ id: 'workflow-studio-mastra', schemaName: this.storageSchema, ...postgresConfig() });
        await this.storage.init();
        this.persistentRuntime = new Mastra({ storage: this.storage, logger: false });
      }
      for (const registration of this.registrations.values()) {
        this.persistentRuntime.removeWorkflow(registration.registrationKey);
        this.persistentRuntime.addWorkflow(mastraWorkflowFor(registration, this.executor, this.store), registration.registrationKey);
      }
    })();
  }

  private register(registration: MastraWorkflowRegistration) {
    this.runtime.removeWorkflow(registration.registrationKey);
    this.runtime.addWorkflow(mastraWorkflowFor(registration, this.executor, this.store), registration.registrationKey);
    if (this.persistentRuntime) {
      this.persistentRuntime.removeWorkflow(registration.registrationKey);
      this.persistentRuntime.addWorkflow(mastraWorkflowFor(registration, this.executor, this.store), registration.registrationKey);
    }
    this.registrations.set(registration.registrationKey, registration);
  }

  private ensureForRun(run: WorkflowRun) {
    if (!run.mastra) throw new Error('Run has no Mastra correlation metadata.');
    if (run.mastra.schemaVersion !== MASTRA_SNAPSHOT_SCHEMA_VERSION) throw new Error(`Unsupported Mastra snapshot schema version: ${run.mastra.schemaVersion}.`);
    if (run.mastra.engineVersion !== MASTRA_VERSION) throw new Error(`Mastra snapshot version ${run.mastra.engineVersion} is incompatible with runtime ${MASTRA_VERSION}.`);
    const registration = definitionFor(run.compiledWorkflow);
    if (registration.fingerprint !== run.mastra.definitionFingerprint || registration.registrationKey !== run.mastra.workflowId) throw new Error('Mastra snapshot definition does not match the compiled workflow.');
    if (!this.registrations.has(registration.registrationKey)) this.register(registration);
    return registration;
  }

  async compile(userId: string, plan: WorkflowPlan, assignment: ProjectWorkflow, skills: Skill[], requestedRunId?: string, approvedAdaptations: ApprovedAdaptationReference[] = [], organizationModel?: Parameters<typeof compileWorkflowRun>[6]): Promise<MastraCompilationResult> {
    const compiled = compileWorkflowRun(userId, plan, assignment, skills, requestedRunId, approvedAdaptations, organizationModel);
    if (!compiled.run || compiled.errors.length) return compiled;
    try {
      const registration = definitionFor(compiled.run.compiledWorkflow);
      this.register(registration);
      compiled.run = correlated(compiled.run, registration, 'registered');
      return { ...compiled, registration };
    } catch (error) {
      return { errors: [error instanceof Error ? error.message : 'Mastra workflow compilation failed.'], warnings: compiled.warnings };
    }
  }

  async start(registrationKey: string, runId: string, input: MastraExecutionInput) {
    if (!this.executor) throw new MastraCapabilityError('start', 'P7-T03');
    if (input.run.id !== runId || input.userId !== input.run.userId) throw new Error('Mastra start correlation does not match the Workflow Studio run.');
    const registration = this.ensureForRun(input.run);
    if (registration.registrationKey !== registrationKey) throw new Error('Mastra workflow registration does not match this run.');
    await this.initializeStorage();
    const initialRun = correlated(input.run, registration, 'running');
    await this.store.upsert(input.userId, initialRun);
    const workflow = this.persistentRuntime!.getWorkflow(registrationKey);
    const run = await workflow.createRun({ runId, resourceId: input.userId });
    const result = await run.start({ inputData: { userId: input.userId, run: initialRun } });
    if (result.status === 'failed') throw new Error(result.error?.message || 'Mastra could not advance the workflow. Completed work is saved.');
    return result;
  }

  async suspend(userId: string, runId: string) {
    const run = await this.store.read(userId, runId);
    if (!run || run.status !== 'paused' || run.mastra?.status !== 'suspended') throw new Error('Run is not suspended at a Mastra approval gate.');
    const registration = this.ensureForRun(run);
    await this.initializeStorage();
    return await this.persistentRuntime!.getWorkflow(registration.registrationKey).getWorkflowRunById(runId, { fields: ['suspendedPaths', 'steps'] });
  }

  async resume(userId: string, runId: string, payload: MastraApprovalResume) {
    const current = await this.store.read(userId, runId);
    if (!current || current.status !== 'paused' || current.mastra?.status !== 'suspended') throw new Error('Run is not waiting at an active Mastra approval gate.');
    const approval = current.approvalRecords.find((record) => record.id === payload.approvalId && record.nodeId === payload.nodeId && !record.decision && !record.resumedAt);
    if (!approval) throw new Error('Approval request is stale, already decided, or does not match this run.');
    const node = current.compiledWorkflow.nodes.find((candidate) => candidate.id === payload.nodeId);
    if (!node) throw new Error('Approval node was not found in the compiled workflow.');
    if (node.approvalOptions?.length) {
      if (!payload.keyword || payload.decision) throw new Error('Choose one configured approval keyword.');
      decideRuntimeApprovalByKeyword(current, payload.nodeId, payload.keyword, payload.actor, payload.feedback);
    } else {
      if (!payload.decision || payload.keyword) throw new Error('Choose a supported approval decision.');
      decideRuntimeApproval(current, payload.nodeId, payload.decision, payload.actor, payload.feedback);
    }
    const registration = this.ensureForRun(current);
    await this.initializeStorage();
    const workflow = this.persistentRuntime!.getWorkflow(registration.registrationKey);
    const mastraRun = await workflow.createRun({ runId, resourceId: userId });
    const workflowsStore = await this.persistentRuntime!.getStorage()?.getStore('workflows');
    const snapshot = await workflowsStore?.loadWorkflowSnapshot({ workflowName: registration.registrationKey, runId });
    if (current.executionRequested && snapshot?.status !== 'suspended') {
      const restored = await mastraRun.start({ inputData: { userId, run: current } });
      if (restored.status !== 'suspended') throw new Error('The authoritative approval checkpoint could not be reconstructed.');
    }
    if (snapshot?.status === 'failed' && snapshot.error?.message === 'Mastra snapshot and durable run event journals have diverged.') {
      const failedInput = snapshot.context[registration.runnerStepId]?.payload as { userId?: string; run?: WorkflowRun } | undefined;
      if (snapshot.runId !== runId || failedInput?.userId !== userId || !failedInput.run) throw new Error('Failed gate snapshot does not match the current run.');
      // Only repair the known JSON key-order failure when the event contents really match.
      reconcileMastraRunState(failedInput.run, current);
      const restored = await mastraRun.start({ inputData: { userId, run: current } });
      if (restored.status !== 'suspended') throw new Error('The pending approval checkpoint could not be restored.');
    }
    const result = await mastraRun.resume({ step: registration.runnerStepId, resumeData: payload });
    if (result.status === 'failed') throw new Error(result.error?.message || 'Mastra failed while applying the approval decision.');
    return result;
  }

  async cancel(userId: string, runId: string, payload?: MastraCancellation) {
    const current = await this.store.read(userId, runId);
    if (!current) throw new Error('Run was not found.');
    if (!current.mastra) throw new Error('Run has no Mastra correlation metadata.');
    const registration = this.ensureForRun(current);
    const actor = payload?.actor ?? { id: userId, name: 'Workflow Studio user', role: 'user' };
    const cancelled = correlated(cancelWorkflowRun(current, actor, payload?.reason).run, registration, 'cancelled', current.mastra.activeStepId);
    await this.store.upsert(userId, cancelled);
    await this.initializeStorage();
    const workflow = this.persistentRuntime!.getWorkflow(registration.registrationKey);
    const mastraRun = await workflow.createRun({ runId, resourceId: userId });
    await mastraRun.cancel();
    return cancelled;
  }

  inspect(registrationKey?: string): MastraWorkflowRegistration | MastraRuntimeDiagnostics | undefined {
    return registrationKey ? this.registrations.get(registrationKey) : this.diagnostics();
  }

  async recover(userId: string, runId: string) {
    const current = await this.store.read(userId, runId);
    if (!current) throw new Error('Run was not found.');
    const registration = this.ensureForRun(current);
    if (current.executionRequested && ['compiled', 'running', 'paused'].includes(current.status)) {
      // Resume the existing attempt/job identities. Resetting attempts here can
      // duplicate already-running or delivered provider work after a restart.
      return this.start(registration.registrationKey, runId, { userId, run: current });
    }
    await this.initializeStorage();
    const workflow = this.persistentRuntime!.getWorkflow(registration.registrationKey);
    const snapshot = await workflow.getWorkflowRunById(runId, { fields: ['suspendedPaths', 'activeStepsPath', 'steps', 'result', 'error'] });
    if (!snapshot) throw new Error('Mastra snapshot was not found for this correlated run.');
    if (current.status === 'paused') {
      if (snapshot.status !== 'suspended') throw new Error(`Mastra snapshot status ${snapshot.status} does not match paused Workflow Studio state.`);
      return snapshot;
    }
    if (['compiled', 'running'].includes(current.status)) {
      if (!this.executor) throw new MastraCapabilityError('recover', 'P7-T03');
      const activeStepId = current.mastra?.activeStepId;
      const restartable = current.nodeRuns.some((node) => node.status === 'running') ? recoverInterruptedRun(current).run : current;
      await this.store.upsert(userId, correlated(restartable, registration, 'running', activeStepId));
      const mastraRun = await workflow.createRun({ runId, resourceId: userId });
      return await mastraRun.restart();
    }
    return snapshot;
  }

  diagnostics(): MastraRuntimeDiagnostics {
    return {
      engine: MASTRA_ENGINE, engineVersion: MASTRA_VERSION, boundaryVersion: MASTRA_RUNTIME_BOUNDARY_VERSION,
      snapshotSchemaVersion: MASTRA_SNAPSHOT_SCHEMA_VERSION, nodeRequirement: '>=22.13.0', storage: 'postgresql',
      registeredWorkflowCount: Object.keys(this.runtime.listWorkflows()).length,
      operations: { compile: 'available', inspect: 'available', start: this.executor ? 'available' : 'phase-pending', suspend: 'available', resume: 'available', cancel: 'available', recover: 'available' }
    };
  }

  async close() { await this.storage?.close(); }
}

export function mastraRuntimeDiagnostics(): MastraRuntimeDiagnostics { return new LocalMastraAdapter().diagnostics(); }
