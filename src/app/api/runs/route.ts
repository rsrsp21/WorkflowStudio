import { studioPaths } from '@/scripts/studio-home.cjs';
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { LocalMastraAdapter } from '@/src/adapters/mastra-adapter';
import { getRequestUser } from '@/src/auth/auth';
import { isWithinWorkspaceRoot } from '@/src/domain/workspace-boundary';
import { compileWorkflowRun, validateWorkflowRun } from '@/src/domain/runtime';
import { runtimeRolloutConfiguration } from '@/src/domain/runtime-rollout';
import { evaluateLifecycleTransition } from '@/src/domain/lifecycle-policy';
import { validateProjectWorkflow } from '@/src/domain/workspace';
import { RunRepository } from '@/src/storage/run-repository';
import { WorkflowRepository } from '@/src/storage/workflow-repository';
import { createWorkspaceStores } from '@/src/storage/workspace-stores';
import { requestFingerprint } from '@/src/server/request-fingerprint';
import { dispatchPairedRuntimeJob, shouldUsePairedRuntime } from '@/src/adapters/paired-runtime-adapter';
import type { ProjectFolderInspection } from '@/src/domain/workspace';
import { appendAuditEvent } from '@/src/storage/audit-repository';
import { checkWorkflowCapabilities } from '@/src/domain/capability-check';
import { getOnlineRuntimeConnection } from '@/src/storage/runtime-connection-repository';
import { listApplicableAdaptations } from '@/src/storage/adaptation-repository';
import { OrganizationRepository } from '@/src/storage/organization-repository';

export const dynamic = 'force-dynamic';
const dataDirectory = process.env.WORKFLOW_STUDIO_DATA_DIR ?? studioPaths().data;
const workflows = new WorkflowRepository();
const runs = new RunRepository();
const compiler = new LocalMastraAdapter();

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id')?.trim();
  if (id) {
    const run = await runs.read(user.id, id);
    return run ? NextResponse.json({ run }) : NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
  }
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '50');
  const offset = Number(request.nextUrl.searchParams.get('offset') ?? '0');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) return NextResponse.json({ errors: ['Run pagination is invalid.'] }, { status: 400 });
  return NextResponse.json({ runs: await runs.readPage(user.id, limit, offset), total: await runs.count(user.id) });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const stores = createWorkspaceStores(dataDirectory, user.id);
  const parsed = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NextResponse.json({ errors: ['Compile request body must be a JSON object.'] }, { status: 400 });
  const body = parsed as { assignmentId?: unknown; idempotencyKey?: unknown; organizationId?: unknown };
  if (typeof body.assignmentId !== 'string' || !body.assignmentId.trim()) return NextResponse.json({ errors: ['Assignment id is required.'] }, { status: 400 });
  if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim() || body.idempotencyKey.length > 128)) return NextResponse.json({ errors: ['Compile idempotency key is invalid.'] }, { status: 400 });

  const assignment = (await stores.projectWorkflows.readAll()).find((candidate) => candidate.id === body.assignmentId);
  if (!assignment || await workflows.ownerId(assignment.workflowId) !== user.id) return NextResponse.json({ error: 'Assignment was not found.' }, { status: 404 });
  const definitionPlan = (await workflows.readAll(user.id)).find((candidate) => candidate.id === assignment.workflowId);
  const sourcePlan = assignment.graphOverride ?? definitionPlan;
  if (!sourcePlan) return NextResponse.json({ errors: ['The approved workflow plan was not found.'] }, { status: 400 });
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;
  const idempotencyFingerprint = requestFingerprint({ assignmentId: assignment.id, workflowId: assignment.workflowId, workflowVersion: assignment.workflowVersion, configurationVersion: assignment.configurationVersion ?? 1, organizationId: typeof body.organizationId === 'string' ? body.organizationId.trim() : '', graph: sourcePlan, inputs: assignment.inputOverrides, permissions: assignment.permissions, selectedSkills: assignment.selectedSkills });
  const requestedRunId = idempotencyKey ? `run_${createHash('sha256').update(`${user.id}:${assignment.id}:${idempotencyKey}`).digest('hex').slice(0, 32)}` : undefined;
  if (requestedRunId) {
    const replay = await runs.read(user.id, requestedRunId);
    if (replay && replay.idempotencyKey === idempotencyKey) {
      if (replay.idempotencyFingerprint && replay.idempotencyFingerprint !== idempotencyFingerprint) return NextResponse.json({ errors: ['Compile idempotency key was already used for a different approved assignment state.'] }, { status: 409 });
      return NextResponse.json({ run: replay, warnings: [], idempotentReplay: true });
    }
  }

  const [projects, definitions, skills] = await Promise.all([stores.projects.readAll(), stores.workflows.readAll(), stores.skills.readAll()]);
  if (!definitionPlan) return NextResponse.json({ errors: ['The approved reusable workflow definition was not found.'] }, { status: 400 });
  const assignmentErrors = validateProjectWorkflow(assignment, { projects, workflows: definitions, skills });
  if (assignmentErrors.length) return NextResponse.json({ errors: assignmentErrors }, { status: 400 });
  const paired = shouldUsePairedRuntime();
  const runtimeConnection = paired ? await getOnlineRuntimeConnection(user.id) : null;
  const organizationId = typeof body.organizationId === 'string' && body.organizationId.trim() ? body.organizationId.trim() : undefined;
  const organizationSettings = organizationId ? await new OrganizationRepository().modelSettings(organizationId, user.id) : undefined;
  if (organizationId && !organizationSettings) return NextResponse.json({ errors: ['Organization was not found or is not available to this user.'] }, { status: 404 });
  const organizationModel = organizationId ? { organizationId, settings: organizationSettings ?? {} } : undefined;
  const capabilityIssues = checkWorkflowCapabilities(sourcePlan, assignment, skills, !paired || Boolean(runtimeConnection), runtimeConnection, organizationSettings ?? undefined);
  if (capabilityIssues.length) return NextResponse.json({ errors: capabilityIssues.map((issue) => issue.message), capabilityIssues }, { status: 409 });
  try {
    if (paired) {
      const result = await dispatchPairedRuntimeJob<{ inspection: ProjectFolderInspection }>(user.id, 'workspace-inspection', { operation: 'inspect', rootPath: assignment.rootPath });
      if (!isWithinWorkspaceRoot(result.inspection.rootPath, assignment.rootPath) || !isWithinWorkspaceRoot(assignment.rootPath, result.inspection.rootPath)) {
        throw new Error('Approved project root resolves to a different local folder.');
      }
    } else {
      const rootInfo = await stat(assignment.rootPath);
      if (!rootInfo.isDirectory()) throw new Error('Approved project root is not a directory.');
      const [resolvedRoot, resolvedAllowedRoot] = await Promise.all([realpath(assignment.rootPath), realpath(assignment.permissions.allowedWorkspacePaths[0])]);
      if (!isWithinWorkspaceRoot(resolvedRoot, resolvedAllowedRoot) || !isWithinWorkspaceRoot(resolvedAllowedRoot, resolvedRoot)) throw new Error('Approved workspace path resolves outside the project root.');
    }
  } catch (error) {
    return NextResponse.json({ errors: [error instanceof Error ? `Project root is unavailable: ${error.message}` : 'Project root is unavailable.'] }, { status: 409 });
  }
  const lifecycle = evaluateLifecycleTransition({ action: 'compile', workflow: definitionPlan, graph: sourcePlan, assignment, skills });
  if (!lifecycle.allowed) return NextResponse.json({ errors: lifecycle.errors, warnings: lifecycle.warnings }, { status: 400 });
  let rollout;
  try { rollout = runtimeRolloutConfiguration(); }
  catch (error) { return NextResponse.json({ errors: [error instanceof Error ? error.message : 'Runtime rollout configuration is invalid.'] }, { status: 503 }); }
  const approvedAdaptations = await listApplicableAdaptations(user.id, assignment.projectId, assignment.workflowId);
  const result = rollout.engineForNewRuns === 'mastra'
    ? await compiler.compile(user.id, sourcePlan, assignment, skills, requestedRunId, approvedAdaptations, organizationModel)
    : compileWorkflowRun(user.id, sourcePlan, assignment, skills, requestedRunId, approvedAdaptations, organizationModel);
  if (!result.run || result.errors.length) return NextResponse.json({ errors: result.errors, warnings: result.warnings }, { status: 400 });
  result.run.idempotencyKey = idempotencyKey;
  result.run.idempotencyFingerprint = idempotencyKey ? idempotencyFingerprint : undefined;
  const runErrors = validateWorkflowRun(result.run);
  if (runErrors.length) return NextResponse.json({ errors: runErrors }, { status: 400 });

  await runs.upsert(user.id, result.run);
  await appendAuditEvent({ userId: user.id, actor: user, action: 'run.model-settings.resolve', resourceType: 'run', resourceId: result.run.id, decision: 'allowed', correlationId: result.run.id, details: { organizationId, workflowSettings: result.run.compiledWorkflow.modelSettings, nodes: result.run.compiledWorkflow.nodes.map((node) => ({ nodeId: node.id, ...node.modelSettings })) } });
  await stores.projectWorkflows.upsert({ ...assignment, runIds: [...new Set([...assignment.runIds, result.run.id])], updatedAt: new Date().toISOString() });
  return NextResponse.json({ run: result.run, warnings: result.warnings, runtime: rollout }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const stores = createWorkspaceStores(dataDirectory, user.id);
  const id = request.nextUrl.searchParams.get('id')?.trim();
  if (!id) return NextResponse.json({ errors: ['Run id is required.'] }, { status: 400 });
  const run = await runs.read(user.id, id);
  if (!run) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
  if (run.status === 'running' || run.status === 'paused') return NextResponse.json({ errors: ['Finish or cancel the active run before deleting its history.'] }, { status: 409 });
  if (!await runs.delete(user.id, id)) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
  await appendAuditEvent({ userId: user.id, actor: { id: user.id, name: user.name, role: user.role }, action: 'run.delete', resourceType: 'run', resourceId: id, decision: 'deleted', correlationId: id, details: { workflowId: run.workflowId, assignmentId: run.assignmentId } });
  const assignment = (await stores.projectWorkflows.readAll()).find((candidate) => candidate.id === run.assignmentId);
  if (assignment) await stores.projectWorkflows.upsert({ ...assignment, runIds: assignment.runIds.filter((runId) => runId !== id), updatedAt: new Date().toISOString() });
  return NextResponse.json({ deleted: true, id });
}
