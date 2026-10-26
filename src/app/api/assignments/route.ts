import { studioPaths } from '@/scripts/studio-home.cjs';
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { validateWorkflowPlan, workflowExternalInputKeys } from '@/src/domain/models';
import { evaluateLifecycleTransition } from '@/src/domain/lifecycle-policy';
import {
  createProjectWorkflow,
  createWorkflow,
  validateProjectWorkflow,
  type AssignmentPermissions,
  type ProjectWorkflow
} from '@/src/domain/workspace';
import { WorkflowRepository } from '@/src/storage/workflow-repository';
import { createWorkspaceStores, type WorkspaceStores } from '@/src/storage/workspace-stores';
import { requestFingerprint } from '@/src/server/request-fingerprint';
import { projectOwnerId } from '@/src/storage/project-ownership-repository';
import { canPerformGovernedAction } from '@/src/domain/authorization';

export const dynamic = 'force-dynamic';

const dataDirectory = process.env.WORKFLOW_STUDIO_DATA_DIR ?? studioPaths().data;
const planStore = new WorkflowRepository();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameConfiguration(left: unknown, right: unknown) {
  return requestFingerprint(left) === requestFingerprint(right);
}

function appendMutationReceipt(receipts: Record<string, string> | undefined, key: string | undefined, fingerprint: string) {
  if (!key) return receipts;
  return Object.fromEntries([...Object.entries(receipts ?? {}).filter(([existingKey]) => existingKey !== key), [key, fingerprint]].slice(-100));
}

async function catalog(stores: WorkspaceStores) {
  const [projects, workflows, skills] = await Promise.all([stores.projects.readAll(), stores.workflows.readAll(), stores.skills.readAll()]);
  return { projects, workflows, skills };
}

async function ensureWorkflowDefinition(userId: string, workflowId: string, stores: WorkspaceStores) {
  if (await planStore.ownerId(workflowId) !== userId) return null;
  const existing = (await stores.workflows.readAll()).find((workflow) => workflow.id === workflowId);
  const plan = (await planStore.readAll(userId)).find((candidate) => candidate.id === workflowId);
  if (existing) return existing;
  if (!plan) return null;
  const skills = await stores.skills.readAll();
  const definition = createWorkflow({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    domain: plan.domain ?? 'General',
    version: plan.version ?? 1,
    status: plan.status === 'approved' ? 'published' : 'draft',
    requiredInputs: workflowExternalInputKeys(plan),
    outputs: Array.from(new Set(plan.nodes.flatMap((node) => node.outputKeys))),
    defaultSkillVersions: Array.from(new Set(plan.nodes.flatMap((node) => node.skillIds))).flatMap((skillId) => {
      const skill = skills.find((candidate) => candidate.id === skillId);
      return skill ? [{ skillId, version: skill.version }] : [];
    }),
    createdAt: plan.createdAt
  });
  await stores.workflows.upsert(definition);
  return definition;
}

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const stores = createWorkspaceStores(dataDirectory, user.id);
  const projectId = request.nextUrl.searchParams.get('projectId');
  const workflowId = request.nextUrl.searchParams.get('workflowId');
  const id = request.nextUrl.searchParams.get('id');
  const ownedWorkflowIds = new Set((await planStore.readAll(user.id)).map((workflow) => workflow.id));
  const assignments = (await stores.projectWorkflows.readAll()).filter((assignment) => ownedWorkflowIds.has(assignment.workflowId) &&
    (!id || assignment.id === id) && (!projectId || assignment.projectId === projectId) && (!workflowId || assignment.workflowId === workflowId)
  );
  return NextResponse.json({ assignments });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const stores = createWorkspaceStores(dataDirectory, user.id);
  const parsed = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NextResponse.json({ errors: ['Assignment request body must be a JSON object.'] }, { status: 400 });
  const body = parsed as {
    projectId?: string;
    workflowId?: string;
    selectedSkillIds?: string[];
    inputOverrides?: Record<string, string>;
    permissions?: Partial<AssignmentPermissions>;
    confirmWorkspaceWrite?: boolean;
    confirmDestructiveBypass?: boolean;
    idempotencyKey?: string;
  };
  if (!body.projectId || !body.workflowId) return NextResponse.json({ errors: ['Project and workflow are required.'] }, { status: 400 });
  if (typeof body.projectId !== 'string' || typeof body.workflowId !== 'string') return NextResponse.json({ errors: ['Project and workflow ids must be strings.'] }, { status: 400 });
  if (body.selectedSkillIds !== undefined && (!Array.isArray(body.selectedSkillIds) || body.selectedSkillIds.some((id) => typeof id !== 'string' || !id.trim()))) return NextResponse.json({ errors: ['Selected skill ids must contain non-empty strings.'] }, { status: 400 });
  if (body.inputOverrides !== undefined && (!isRecord(body.inputOverrides) || Object.values(body.inputOverrides).some((value) => typeof value !== 'string'))) return NextResponse.json({ errors: ['Assignment inputs must be string values.'] }, { status: 400 });
  if (body.permissions !== undefined && !isRecord(body.permissions)) return NextResponse.json({ errors: ['Assignment permissions must be an object.'] }, { status: 400 });
  if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim() || body.idempotencyKey.length > 128)) return NextResponse.json({ errors: ['Assignment idempotency key is invalid.'] }, { status: 400 });
  if (body.permissions?.sandboxMode === 'workspace' && body.confirmWorkspaceWrite !== true) return NextResponse.json({ errors: ['Confirm workspace write access before creating this assignment.'] }, { status: 400 });
  if (body.permissions?.requireApprovalForDestructiveActions === false && body.confirmDestructiveBypass !== true) return NextResponse.json({ errors: ['Confirm the destructive-action approval bypass before creating this assignment.'] }, { status: 400 });
  if (body.selectedSkillIds && new Set(body.selectedSkillIds).size !== body.selectedSkillIds.length) return NextResponse.json({ errors: ['Selected skills cannot contain duplicates.'] }, { status: 400 });
  const workflow = await ensureWorkflowDefinition(user.id, body.workflowId, stores);
  const currentCatalog = await catalog(stores);
  const idempotencyKey = body.idempotencyKey?.trim();
  const idempotencyFingerprint = requestFingerprint({ ...body, idempotencyKey: undefined });
  const operationId = idempotencyKey ? `project_workflow_${createHash('sha256').update(`${user.id}:${body.workflowId}:${body.projectId}:${idempotencyKey}`).digest('hex').slice(0, 24)}` : undefined;
  if (operationId) {
    const replay = (await stores.projectWorkflows.readAll()).find((assignment) => assignment.id === operationId && assignment.idempotencyKey === idempotencyKey);
    if (replay) {
      if (replay.idempotencyFingerprint && replay.idempotencyFingerprint !== idempotencyFingerprint) return NextResponse.json({ errors: ['Idempotency key was already used for a different assignment creation request.'] }, { status: 409 });
      return NextResponse.json({ assignment: replay, idempotentReplay: true }, { status: 200 });
    }
  }
  const project = currentCatalog.projects.find((candidate) => candidate.id === body.projectId);
  if (!project || !workflow) return NextResponse.json({ errors: ['Project or reusable workflow was not found.'] }, { status: 404 });
  const ownerId = await projectOwnerId(project.id);
  if (ownerId && ownerId !== user.id) return NextResponse.json({ errors: ['Project or reusable workflow was not found.'] }, { status: 404 });
  const sourcePlan = (await planStore.readAll(user.id)).find((plan) => plan.id === workflow.id);
  if (!sourcePlan) return NextResponse.json({ errors: ['The reusable workflow graph was not found.'] }, { status: 404 });
  const lifecycle = evaluateLifecycleTransition({ action: 'create-assignment', workflow: sourcePlan, skills: currentCatalog.skills });
  if (!lifecycle.allowed) return NextResponse.json({ errors: lifecycle.errors }, { status: 400 });
  const selectedSkills = (body.selectedSkillIds ?? []).flatMap((id) => {
    const skill = currentCatalog.skills.find((candidate) => candidate.id === id && candidate.status === 'published');
    return skill ? [skill] : [];
  });
  if (selectedSkills.length !== (body.selectedSkillIds ?? []).length) {
    return NextResponse.json({ errors: ['Only active published skill versions can be selected.'] }, { status: 400 });
  }
  const assignment = createProjectWorkflow({
    id: operationId,
    project,
    workflow,
    selectedSkills,
    inputOverrides: { ...(body.inputOverrides ?? {}) },
    permissions: { ...body.permissions, allowedWorkspacePaths: body.permissions?.allowedWorkspacePaths ?? [project.rootPath] },
    idempotencyKey,
    idempotencyFingerprint: idempotencyKey ? idempotencyFingerprint : undefined
  });
  const errors = validateProjectWorkflow(assignment, currentCatalog);
  if (errors.length) return NextResponse.json({ errors }, { status: 400 });
  await stores.projectWorkflows.upsert(assignment);
  return NextResponse.json({ assignment }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const stores = createWorkspaceStores(dataDirectory, user.id);
  const parsed = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NextResponse.json({ errors: ['Assignment request body must be a JSON object.'] }, { status: 400 });
  const body = parsed as Partial<ProjectWorkflow> & { id?: string; selectedSkillIds?: string[]; expectedConfigurationVersion?: number; confirmWorkspaceWrite?: boolean; confirmDestructiveBypass?: boolean; idempotencyKey?: string };
  if (!body.id) return NextResponse.json({ errors: ['Assignment id is required.'] }, { status: 400 });
  if (typeof body.id !== 'string') return NextResponse.json({ errors: ['Assignment id must be a string.'] }, { status: 400 });
  if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim() || body.idempotencyKey.length > 128)) return NextResponse.json({ errors: ['Assignment idempotency key is invalid.'] }, { status: 400 });
  if (body.expectedConfigurationVersion !== undefined && (!Number.isInteger(body.expectedConfigurationVersion) || body.expectedConfigurationVersion < 1)) return NextResponse.json({ errors: ['Expected assignment configuration version is invalid.'] }, { status: 400 });
  if (body.status !== undefined && !['draft', 'ready', 'archived'].includes(body.status)) return NextResponse.json({ errors: ['Assignment status is invalid.'] }, { status: 400 });
  if (body.status === 'ready' && !canPerformGovernedAction(user, 'approve-assignment')) return NextResponse.json({ errors: ['Reviewer or administrator role is required to approve a project assignment.'] }, { status: 403 });
  if (body.selectedSkillIds !== undefined && (!Array.isArray(body.selectedSkillIds) || body.selectedSkillIds.some((id) => typeof id !== 'string' || !id.trim()))) return NextResponse.json({ errors: ['Selected skill ids must contain non-empty strings.'] }, { status: 400 });
  if (body.inputOverrides !== undefined && (!isRecord(body.inputOverrides) || Object.values(body.inputOverrides).some((value) => typeof value !== 'string'))) return NextResponse.json({ errors: ['Assignment inputs must be string values.'] }, { status: 400 });
  if (body.permissions !== undefined && !isRecord(body.permissions)) return NextResponse.json({ errors: ['Assignment permissions must be an object.'] }, { status: 400 });
  if (body.graphOverride !== undefined && (!isRecord(body.graphOverride) || validateWorkflowPlan(body.graphOverride).length)) return NextResponse.json({ errors: validateWorkflowPlan(body.graphOverride) }, { status: 400 });
  const mutationFingerprint = requestFingerprint({ id: body.id, status: body.status, inputOverrides: body.inputOverrides, permissions: body.permissions, selectedSkillIds: body.selectedSkillIds, graphOverride: body.graphOverride });
  const current = (await stores.projectWorkflows.readAll()).find((assignment) => assignment.id === body.id);
  if (!current || await planStore.ownerId(current.workflowId) !== user.id) return NextResponse.json({ error: 'Assignment was not found.' }, { status: 404 });
  const idempotencyKey = body.idempotencyKey?.trim();
  const existingReceipt = idempotencyKey ? current.mutationReceipts?.[idempotencyKey] ?? (current.lastMutationKey === idempotencyKey ? current.lastMutationFingerprint : undefined) : undefined;
  if (idempotencyKey && (existingReceipt || current.lastMutationKey === idempotencyKey)) {
    if (existingReceipt && existingReceipt !== mutationFingerprint) return NextResponse.json({ errors: ['Idempotency key was already used for a different assignment mutation.'] }, { status: 409 });
    return NextResponse.json({ assignment: current, idempotentReplay: true });
  }
  if (body.expectedConfigurationVersion !== undefined && body.expectedConfigurationVersion !== (current.configurationVersion ?? 1)) return NextResponse.json({ errors: ['Assignment configuration changed after this editor loaded. Reload before saving or approving.'], currentConfigurationVersion: current.configurationVersion ?? 1 }, { status: 409 });
  const effectivePermissions = body.permissions ? { ...current.permissions, ...body.permissions } : current.permissions;
  if (effectivePermissions.sandboxMode === 'workspace' && current.permissions.sandboxMode !== 'workspace' && body.confirmWorkspaceWrite !== true) return NextResponse.json({ errors: ['Confirm workspace write access before changing assignment permissions.'] }, { status: 400 });
  if (!effectivePermissions.requireApprovalForDestructiveActions && current.permissions.requireApprovalForDestructiveActions && body.confirmDestructiveBypass !== true) return NextResponse.json({ errors: ['Confirm the destructive-action approval bypass before changing assignment permissions.'] }, { status: 400 });
  if (body.selectedSkillIds && new Set(body.selectedSkillIds).size !== body.selectedSkillIds.length) return NextResponse.json({ errors: ['Selected skills cannot contain duplicates.'] }, { status: 400 });
  const currentCatalog = await catalog(stores);
  const selectedSkills = body.selectedSkillIds
    ? body.selectedSkillIds.flatMap((id) => currentCatalog.skills.find((skill) => skill.id === id && skill.status === 'published') ?? [])
    : null;
  if (body.selectedSkillIds && selectedSkills?.length !== body.selectedSkillIds.length) {
    return NextResponse.json({ errors: ['Only active published skill versions can be selected.'] }, { status: 400 });
  }
  const nextInputOverrides = body.inputOverrides !== undefined ? { ...body.inputOverrides } : current.inputOverrides;
  const nextPermissions = body.permissions !== undefined ? { ...current.permissions, ...body.permissions } : current.permissions;
  const nextSelectedSkills = selectedSkills ? selectedSkills.map((skill) => ({ skillId: skill.id, version: skill.version })) : current.selectedSkills;
  const nextGraphOverride = body.graphOverride !== undefined ? structuredClone(body.graphOverride) : current.graphOverride;
  const configurationChanged = !sameConfiguration(nextInputOverrides, current.inputOverrides) || !sameConfiguration(nextPermissions, current.permissions) || !sameConfiguration(nextSelectedSkills, current.selectedSkills) || !sameConfiguration(nextGraphOverride, current.graphOverride);
  const updated: ProjectWorkflow = {
    ...current,
    status: body.status ?? current.status,
    inputOverrides: nextInputOverrides,
    permissions: nextPermissions,
    selectedSkills: nextSelectedSkills,
    graphOverride: nextGraphOverride,
    lastMutationKey: idempotencyKey,
    lastMutationFingerprint: idempotencyKey ? mutationFingerprint : undefined,
    mutationReceipts: appendMutationReceipt(current.mutationReceipts, idempotencyKey, mutationFingerprint),
    updatedAt: new Date().toISOString()
  };
  updated.configurationVersion = (current.configurationVersion ?? 1) + (configurationChanged ? 1 : 0);
  if (configurationChanged || updated.status !== 'ready') updated.approval = undefined;
  if (configurationChanged && body.status !== 'ready') {
    updated.status = 'draft';
  }
  const errors = validateProjectWorkflow(updated, currentCatalog);
  if (updated.graphOverride) errors.push(...validateWorkflowPlan(updated.graphOverride));
  if (updated.status === 'ready') {
    const definitionPlan = (await planStore.readAll(user.id)).find((candidate) => candidate.id === updated.workflowId);
    const graph = updated.graphOverride ?? definitionPlan;
    if (!definitionPlan || !graph) errors.push('The workflow graph was not found.');
    else {
      const decision = evaluateLifecycleTransition({ action: 'approve-assignment', workflow: definitionPlan, graph, skills: currentCatalog.skills, assignment: updated });
      errors.push(...decision.errors);
      if (!errors.length) updated.approval = { approvedAt: updated.updatedAt, approvedBy: { id: user.id, name: user.name, role: user.role }, workflowVersion: updated.workflowVersion, configurationVersion: updated.configurationVersion };
    }
  }
  if (errors.length) return NextResponse.json({ errors: Array.from(new Set(errors)) }, { status: 400 });
  await stores.projectWorkflows.upsert(updated);
  return NextResponse.json({ assignment: updated });
}

export async function DELETE(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const stores = createWorkspaceStores(dataDirectory, user.id);
  const id = request.nextUrl.searchParams.get('id')?.trim();
  if (!id) return NextResponse.json({ error: 'Assignment id is required.' }, { status: 400 });
  const existing = (await stores.projectWorkflows.readAll()).find((assignment) => assignment.id === id);
  if (!existing || await planStore.ownerId(existing.workflowId) !== user.id) return NextResponse.json({ error: 'Assignment was not found.' }, { status: 404 });
  const assignment = await stores.projectWorkflows.remove(id);
  return NextResponse.json({ assignment });
}
