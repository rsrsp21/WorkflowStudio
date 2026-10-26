import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { getDatabase } from '@/src/storage/async-database';
import { WorkflowRepository } from '@/src/storage/workflow-repository';
import { RunRepository } from '@/src/storage/run-repository';
import { createWorkspaceStores } from '@/src/storage/workspace-stores';
import { appendAuditEvent } from '@/src/storage/audit-repository';
import { evaluateLifecycleTransition } from '@/src/domain/lifecycle-policy';
import { validateWorkflowPlan, workflowExternalInputKeys, type WorkflowPlan } from '@/src/domain/models';
import { createWorkflow, validateProjectWorkflow, type ProjectWorkflow } from '@/src/domain/workspace';
import { SequentialRuntime } from '@/src/domain/runtime-engine';
import type { RuntimeApprovalDecision, WorkflowRun } from '@/src/domain/runtime';
import { LocalMastraAdapter } from '@/src/adapters/mastra-adapter';
import { CodexNodeExecutor } from '@/src/adapters/codex-node-executor';
import { createCodexPlanningAdapter } from '@/src/adapters/codex-app-server-adapter';
import { studioPaths } from '@/scripts/studio-home.cjs';
import { ReviewerAssignmentRepository } from '@/src/storage/reviewer-assignment-repository';

export const dynamic = 'force-dynamic';
const dataDirectory = () => process.env.WORKFLOW_STUDIO_DATA_DIR ?? studioPaths().data;

async function reviewer(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return { response: NextResponse.json({ error: 'Authentication required.' }, { status: 401 }) };
  if (user.role !== 'reviewer' && user.role !== 'administrator') return { response: NextResponse.json({ error: 'Reviewer or administrator access is required.' }, { status: 403 }) };
  return { user };
}

function parse<T>(value: string): T | null { try { return JSON.parse(value) as T; } catch { return null; } }

export async function GET(request: Request) {
  const auth = await reviewer(request);
  if (auth.response) return auth.response;
  const db = await getDatabase();
  const permittedOwnerIds = auth.user?.role === 'administrator' ? null : await new ReviewerAssignmentRepository().ownerIdsForReviewer(auth.user!.id);
  if (permittedOwnerIds?.length === 0) return NextResponse.json({ reviews: [] }, { headers: { 'cache-control': 'no-store' } });
  const [users, workflows, records, runs] = await Promise.all([
    db.all<{ id: string; name: string; email: string }>('SELECT id, name, email FROM users'),
    db.all<{ id: string; user_id: string; payload: string }>("SELECT id, user_id, payload FROM workflows WHERE status = 'draft' ORDER BY updated_at ASC"),
    db.all<{ id: string; user_id: string; payload: string }>("SELECT id, user_id, payload FROM tenant_workspace_records WHERE kind = 'project-workflows' ORDER BY id"),
    db.all<{ id: string; user_id: string; payload: string }>("SELECT id, user_id, payload FROM runs WHERE status = 'paused' ORDER BY updated_at ASC")
  ]);
  const permitted = (userId: string) => permittedOwnerIds === null || permittedOwnerIds.includes(userId);
  const owner = new Map(users.map((user) => [user.id, { id: user.id, name: user.name, email: user.email }]));
  const definitions = workflows.flatMap((row) => {
    if (!permitted(row.user_id)) return [];
    const workflow = parse<WorkflowPlan>(row.payload);
    if (!workflow) return [];
    return [{ kind: 'definition' as const, id: row.id, owner: owner.get(row.user_id), name: workflow.name, version: workflow.version ?? 1, updatedAt: workflow.updatedAt, errors: validateWorkflowPlan(workflow), workflow }];
  });
  const assignments = records.flatMap((row) => {
    if (!permitted(row.user_id)) return [];
    const assignment = parse<ProjectWorkflow>(row.payload);
    if (!assignment || assignment.status !== 'draft') return [];
    return [{ kind: 'assignment' as const, id: row.id, owner: owner.get(row.user_id), name: assignment.id, version: assignment.configurationVersion ?? 1, updatedAt: assignment.updatedAt, assignment }];
  });
  const gates = runs.flatMap((row) => {
    if (!permitted(row.user_id)) return [];
    const run = parse<WorkflowRun>(row.payload);
    if (!run) return [];
    const approval = run.approvalRecords.findLast((record) => !record.decision && !record.resumedAt);
    const node = approval && run.compiledWorkflow.nodes.find((candidate) => candidate.id === approval.nodeId);
    if (!approval || !node) return [];
    return [{ kind: 'run-gate' as const, id: row.id, owner: owner.get(row.user_id), name: run.compiledWorkflow.workflowId, version: run.compiledWorkflow.workflowVersion, updatedAt: run.updatedAt, nodeId: node.id, nodeName: node.name, approvalId: approval.id, options: node.approvalOptions ?? [], artifacts: run.artifacts.filter((artifact) => artifact.nodeId === node.id || run.nodeRuns.find((candidate) => candidate.nodeId === node.id)?.artifactIds.includes(artifact.id)) }];
  });
  return NextResponse.json({ reviews: [...definitions, ...assignments, ...gates] }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  const auth = await reviewer(request);
  if (auth.response || !auth.user) return auth.response;
  const body = await request.json().catch(() => ({})) as { kind?: unknown; id?: unknown; ownerUserId?: unknown; expectedUpdatedAt?: unknown; nodeId?: unknown; approvalId?: unknown; keyword?: unknown; decision?: unknown; feedback?: unknown };
  if (!['definition', 'assignment', 'run-gate'].includes(String(body.kind)) || typeof body.id !== 'string' || typeof body.ownerUserId !== 'string') return NextResponse.json({ errors: ['Review kind, resource id, and owner are required.'] }, { status: 400 });
  if (process.env.WORKFLOW_STUDIO_REQUIRE_SEPARATE_REVIEWER === 'true' && body.ownerUserId === auth.user.id) return NextResponse.json({ errors: ['A different reviewer must make this decision.'] }, { status: 403 });
  if (auth.user.role !== 'administrator' && !(await new ReviewerAssignmentRepository().canReview(auth.user.id, body.ownerUserId))) return NextResponse.json({ errors: ['You are not assigned to review this account.'] }, { status: 403 });
  const actor = { id: auth.user.id, name: auth.user.name, role: auth.user.role };
  const now = new Date().toISOString();
  try {
    if (body.kind === 'definition') {
      const repository = new WorkflowRepository();
      const workflow = (await repository.readAll(body.ownerUserId)).find((candidate) => candidate.id === body.id);
      if (!workflow || workflow.status !== 'draft') return NextResponse.json({ error: 'Reviewable definition was not found.' }, { status: 404 });
      if (typeof body.expectedUpdatedAt === 'string' && workflow.updatedAt !== body.expectedUpdatedAt) return NextResponse.json({ errors: ['Definition changed after the review queue loaded.'] }, { status: 409 });
      const stores = createWorkspaceStores(dataDirectory(), body.ownerUserId);
      const skills = await stores.skills.readAll();
      const lifecycle = evaluateLifecycleTransition({ action: 'approve-definition', workflow, skills });
      if (!lifecycle.allowed) return NextResponse.json({ errors: lifecycle.errors }, { status: 400 });
      const approved: WorkflowPlan = { ...workflow, status: 'approved', definitionApproval: { approvedAt: now, approvedBy: actor, workflowVersion: workflow.version ?? 1 }, updatedAt: now };
      await repository.upsert(body.ownerUserId, approved, workflow.updatedAt);
      const existing = (await stores.workflows.readAll()).find((candidate) => candidate.id === workflow.id);
      await stores.workflows.upsert(createWorkflow({
        ...existing, id: workflow.id, name: workflow.name, description: workflow.description, domain: workflow.domain ?? 'General', version: workflow.version ?? 1,
        status: 'published', requiredInputs: workflowExternalInputKeys(workflow), outputs: Array.from(new Set(workflow.nodes.flatMap((node) => node.outputKeys))),
        defaultSkillVersions: Array.from(new Set(workflow.nodes.flatMap((node) => node.skillIds))).flatMap((skillId) => { const skill = skills.find((candidate) => candidate.id === skillId); return skill ? [{ skillId, version: skill.version }] : []; }),
        createdAt: workflow.createdAt
      }));
      await appendAuditEvent({ userId: body.ownerUserId, actor, action: 'definition.review', resourceType: 'workflow', resourceId: body.id, decision: 'approved', correlationId: `review:${body.id}:${now}`, details: { ownerUserId: body.ownerUserId, version: workflow.version ?? 1 } });
      return NextResponse.json({ review: { kind: body.kind, resource: approved, decision: 'approved' } });
    }
    if (body.kind === 'assignment') {
      const stores = createWorkspaceStores(dataDirectory(), body.ownerUserId);
      const [assignments, projects, workflows, skills, plans] = await Promise.all([stores.projectWorkflows.readAll(), stores.projects.readAll(), stores.workflows.readAll(), stores.skills.readAll(), new WorkflowRepository().readAll(body.ownerUserId)]);
      const assignment = assignments.find((candidate) => candidate.id === body.id);
      if (!assignment || assignment.status !== 'draft') return NextResponse.json({ error: 'Reviewable assignment was not found.' }, { status: 404 });
      if (typeof body.expectedUpdatedAt === 'string' && assignment.updatedAt !== body.expectedUpdatedAt) return NextResponse.json({ errors: ['Assignment changed after the review queue loaded.'] }, { status: 409 });
      const definition = plans.find((candidate) => candidate.id === assignment.workflowId);
      const graph = assignment.graphOverride ?? definition;
      if (!definition || !graph) return NextResponse.json({ errors: ['Assignment workflow graph was not found.'] }, { status: 400 });
      const updated: ProjectWorkflow = { ...assignment, status: 'ready', updatedAt: now, approval: { approvedAt: now, approvedBy: actor, workflowVersion: assignment.workflowVersion, configurationVersion: assignment.configurationVersion ?? 1 } };
      const errors = [...validateProjectWorkflow(updated, { projects, workflows, skills }), ...evaluateLifecycleTransition({ action: 'approve-assignment', workflow: definition, graph, skills, assignment: updated }).errors];
      if (errors.length) return NextResponse.json({ errors: Array.from(new Set(errors)) }, { status: 400 });
      await stores.projectWorkflows.upsert(updated);
      await appendAuditEvent({ userId: body.ownerUserId, actor, action: 'assignment.review', resourceType: 'assignment', resourceId: body.id, decision: 'approved', correlationId: `review:${body.id}:${now}`, details: { ownerUserId: body.ownerUserId, configurationVersion: updated.configurationVersion ?? 1 } });
      return NextResponse.json({ review: { kind: body.kind, resource: updated, decision: 'approved' } });
    }
    const { acquireRunExecutionLock, releaseRunExecutionLock, renewRunExecutionLock } = await import('@/src/storage/run-execution-lock');
    const executionOwner = body.ownerUserId;
    const executionRunId = body.id;
    if (!await new RunRepository().read(executionOwner, executionRunId)) return NextResponse.json({ error: 'Reviewable workflow gate was not found.' }, { status: 404 });
    const executionLock = await acquireRunExecutionLock(executionOwner, executionRunId);
    if (!executionLock) return NextResponse.json({ errors: ['The run is advancing. Reload its current gate before deciding.'] }, { status: 409 });
    const renewal = setInterval(() => { void renewRunExecutionLock(executionOwner, executionRunId, executionLock).catch(() => undefined); }, 30_000);
    renewal.unref?.();
    try {
    const repository = new RunRepository({ userId: body.ownerUserId, runId: body.id, token: executionLock });
    const run = await repository.read(body.ownerUserId, body.id);
    if (!run || run.status !== 'paused' || typeof body.nodeId !== 'string' || typeof body.approvalId !== 'string') return NextResponse.json({ error: 'Reviewable workflow gate was not found.' }, { status: 404 });
    const approval = run.approvalRecords.find((record) => record.id === body.approvalId && record.nodeId === body.nodeId && !record.decision && !record.resumedAt);
    if (!approval) return NextResponse.json({ errors: ['Approval request is stale or already decided.'] }, { status: 409 });
    const node = run.compiledWorkflow.nodes.find((candidate) => candidate.id === body.nodeId);
    if (!node) return NextResponse.json({ errors: ['Approval node was not found.'] }, { status: 400 });
    const feedback = typeof body.feedback === 'string' ? body.feedback : '';
    if (run.mastra) {
      const skills = await createWorkspaceStores(dataDirectory(), body.ownerUserId).skills.readAll();
      const codexExecutor = new CodexNodeExecutor(createCodexPlanningAdapter({ userId: body.ownerUserId }), skills);
      const adapter = new LocalMastraAdapter({ executor: { execute: async (task) => {
        await repository.assertExecutionOwnership();
        return codexExecutor.execute(task);
      } }, store: repository });
      try {
        await adapter.resume(body.ownerUserId, run.id, { nodeId: node.id, approvalId: approval.id, ...(node.approvalOptions?.length ? { keyword: String(body.keyword ?? '') } : { decision: body.decision as RuntimeApprovalDecision }), feedback, actor });
      } finally { await adapter.close(); }
    } else {
      const runtime = new SequentialRuntime(repository);
      if (node.approvalOptions?.length) await runtime.decideApprovalByKeyword(body.ownerUserId, run.id, node.id, String(body.keyword ?? ''), actor, feedback);
      else await runtime.decideApproval(body.ownerUserId, run.id, node.id, body.decision as RuntimeApprovalDecision, actor, feedback);
      await runtime.resumeApproval(body.ownerUserId, run.id, node.id, actor);
    }
    const updated = await repository.read(body.ownerUserId, run.id);
    await appendAuditEvent({ userId: body.ownerUserId, actor, action: 'workflow-gate.review', resourceType: 'run', resourceId: run.id, decision: 'approved', reason: feedback || undefined, correlationId: `review:${run.id}:${approval.id}`, details: { ownerUserId: body.ownerUserId, nodeId: node.id, keyword: body.keyword } });
    return NextResponse.json({ review: { kind: body.kind, resource: updated, decision: 'approved' } });
    } finally { clearInterval(renewal); await releaseRunExecutionLock(body.ownerUserId, body.id, executionLock); }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Review decision could not be completed.' }, { status: 409 });
  }
}
