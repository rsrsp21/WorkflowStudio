import { studioPaths } from '@/scripts/studio-home.cjs';
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { materializeWorkflowSkillDrafts } from '@/src/domain/generated-skills';
import { createWorkflowDraft, workflowExternalInputKeys, type WorkflowDraftInput, type WorkflowPlan } from '@/src/domain/models';
import { evaluateLifecycleTransition, isWorkflowLifecycleAction, type WorkflowLifecycleAction } from '@/src/domain/lifecycle-policy';
import { createSkill, createWorkflow, validateSkill } from '@/src/domain/workspace';
import { discoverUserCodexSkills, installedSkillAsWorkspaceSkill } from '@/src/storage/codex-skill-catalog';
import { WorkflowRepository } from '@/src/storage/workflow-repository';
import { RunRepository } from '@/src/storage/run-repository';
import { createWorkspaceStores } from '@/src/storage/workspace-stores';
import { requestFingerprint } from '@/src/server/request-fingerprint';
import { appendAuditEvent } from '@/src/storage/audit-repository';
import { canPerformGovernedAction } from '@/src/domain/authorization';

export const dynamic = 'force-dynamic';
const dataDirectory = process.env.WORKFLOW_STUDIO_DATA_DIR ?? studioPaths().data;
const store = new WorkflowRepository();

function revisionFingerprint(plan: Partial<WorkflowPlan>) {
  return requestFingerprint({
    name: plan.name,
    description: plan.description,
    domain: plan.domain,
    planningPrompt: plan.planningPrompt,
    workspacePath: plan.workspacePath,
    constraints: plan.constraints,
    openQuestions: plan.openQuestions,
    questionResponses: plan.questionResponses,
    completionCriteria: plan.completionCriteria,
    completionContract: plan.completionContract,
    nodes: plan.nodes,
    edges: plan.edges,
    harness: plan.harness
  });
}

function appendMutationReceipt(receipts: Record<string, string> | undefined, key: string | undefined, fingerprint: string) {
  if (!key) return receipts;
  return Object.fromEntries([...Object.entries(receipts ?? {}).filter(([existingKey]) => existingKey !== key), [key, fingerprint]].slice(-100));
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const saved = await store.readAll(user.id);
  return NextResponse.json({ workflows: saved });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const workspaceStores = createWorkspaceStores(dataDirectory, user.id);
  const skillStore = workspaceStores.skills;
  const parsed = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NextResponse.json({ errors: ['Workflow request body must be a JSON object.'] }, { status: 400 });
  const body = parsed as WorkflowDraftInput & { lifecycleAction?: WorkflowLifecycleAction; idempotencyKey?: string; expectedUpdatedAt?: string };
  if (typeof body.planningPrompt !== 'string' || typeof body.workspacePath !== 'string') return NextResponse.json({ errors: ['Planning prompt and workspace path must be strings.'] }, { status: 400 });
  if (body.id !== undefined && typeof body.id !== 'string') return NextResponse.json({ errors: ['Workflow id must be a string.'] }, { status: 400 });
  if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim() || body.idempotencyKey.length > 128)) return NextResponse.json({ errors: ['Workflow idempotency key is invalid.'] }, { status: 400 });
  if (body.expectedUpdatedAt !== undefined && (typeof body.expectedUpdatedAt !== 'string' || Number.isNaN(Date.parse(body.expectedUpdatedAt)))) return NextResponse.json({ errors: ['Expected workflow update time is invalid.'] }, { status: 400 });
  if (body.lifecycleAction !== undefined && !isWorkflowLifecycleAction(body.lifecycleAction)) return NextResponse.json({ errors: ['Workflow lifecycle action is invalid.'] }, { status: 400 });
  const action: WorkflowLifecycleAction = body.lifecycleAction ?? 'save-draft';
  if (action === 'approve-definition' && !canPerformGovernedAction(user, 'approve-definition')) return NextResponse.json({ errors: ['Reviewer or administrator role is required to approve a workflow definition.'] }, { status: 403 });
  const mutationFingerprint = requestFingerprint({ ...body, lifecycleAction: action, idempotencyKey: undefined, expectedUpdatedAt: undefined });
  const workflowId = body.id ?? (body.idempotencyKey ? `workflow_${createHash('sha256').update(`${user.id}:${body.idempotencyKey.trim()}`).digest('hex').slice(0, 32)}` : undefined);
  const now = new Date().toISOString();
  const existing = workflowId ? (await store.readAll(user.id)).find((candidate) => candidate.id === workflowId) : undefined;
  const idempotencyKey = body.idempotencyKey?.trim();
  const existingReceipt = existing && idempotencyKey ? existing.mutationReceipts?.[idempotencyKey] ?? (existing.lastMutationKey === idempotencyKey ? existing.lastMutationFingerprint : undefined) : undefined;
  if (existing && idempotencyKey && (existingReceipt || existing.lastMutationKey === idempotencyKey)) {
    if (existingReceipt && existingReceipt !== mutationFingerprint) return NextResponse.json({ errors: ['Idempotency key was already used for a different workflow mutation.'] }, { status: 409 });
    return NextResponse.json({ workflow: existing, createdSkills: [], attachedSkills: [], idempotentReplay: true }, { status: 200 });
  }
  if (existing && body.expectedUpdatedAt && existing.updatedAt !== body.expectedUpdatedAt) return NextResponse.json({ errors: ['Workflow changed after this editor loaded. Reload before saving or approving.'], currentUpdatedAt: existing.updatedAt }, { status: 409 });
  const revisedApprovedDefinition = Boolean(existing?.status === 'approved' && revisionFingerprint(existing) !== revisionFingerprint(body));
  const version = revisedApprovedDefinition ? (existing?.version ?? 1) + 1 : body.version ?? existing?.version ?? 1;
  let draft: WorkflowPlan;
  try {
    draft = createWorkflowDraft({
      ...body,
      id: workflowId,
      version,
      status: action === 'approve-definition' ? 'approved' : 'draft',
      definitionApproval: action === 'approve-definition' ? {
        approvedAt: now,
        approvedBy: { id: user.id, name: user.name, role: user.role },
        workflowVersion: version
      } : undefined,
      lastMutationKey: idempotencyKey,
      lastMutationFingerprint: idempotencyKey ? mutationFingerprint : undefined,
      mutationReceipts: appendMutationReceipt(existing?.mutationReceipts, idempotencyKey, mutationFingerprint)
    });
  } catch {
    return NextResponse.json({ errors: ['Workflow payload contains malformed fields.'] }, { status: 400 });
  }
  const ownerId = await store.ownerId(draft.id);
  if (ownerId && ownerId !== user.id) return NextResponse.json({ error: 'Workflow was not found.' }, { status: 404 });
  const existingSkills = await skillStore.readAll();
  const referencedSkillIds = new Set(draft.nodes.flatMap((node) => node.skillIds));
  const existingSkillIds = new Set(existingSkills.map((skill) => skill.id));
  let installedSkills;
  try {
    installedSkills = await discoverUserCodexSkills(user.id);
  } catch (error) {
    return NextResponse.json({ errors: [error instanceof Error ? error.message : 'The paired Codex runtime could not provide its skill catalog.'] }, { status: 503 });
  }
  const attachedSkills = installedSkills
    .filter((skill) => referencedSkillIds.has(skill.id) && !existingSkillIds.has(skill.id))
    .map(installedSkillAsWorkspaceSkill);
  const availableSkills = [...existingSkills, ...attachedSkills];
  const decision = evaluateLifecycleTransition({ action, workflow: draft, skills: availableSkills });
  if (!decision.allowed) return NextResponse.json({ errors: decision.errors, warnings: decision.warnings }, { status: 400 });
  const materialized = materializeWorkflowSkillDrafts(draft, availableSkills);
  const createdSkills = materialized.drafts.map((skill) => createSkill(skill));
  const skillErrors = [...attachedSkills, ...createdSkills].flatMap((skill) => validateSkill(skill).map((error) => `${skill.name}: ${error}`));
  if (skillErrors.length) return NextResponse.json({ errors: skillErrors }, { status: 400 });
  if (attachedSkills.length || createdSkills.length) await skillStore.writeAll([...availableSkills, ...createdSkills]);
  try {
    await store.upsert(user.id, materialized.plan, body.expectedUpdatedAt);
    await workspaceStores.workflows.upsert(createWorkflow({
      id: materialized.plan.id,
      name: materialized.plan.name,
      description: materialized.plan.description,
      domain: materialized.plan.domain ?? 'General',
      version: materialized.plan.version ?? 1,
      status: materialized.plan.status === 'approved' ? 'published' : 'draft',
      requiredInputs: workflowExternalInputKeys(materialized.plan),
      outputs: Array.from(new Set(materialized.plan.nodes.flatMap((node) => node.outputKeys))),
      defaultSkillVersions: materialized.plan.nodes.flatMap((node) => node.skillIds).filter((id, index, all) => all.indexOf(id) === index).flatMap((skillId) => {
        const skill = [...availableSkills, ...createdSkills].find((candidate) => candidate.id === skillId);
        return skill ? [{ skillId, version: skill.version }] : [];
      }),
      createdAt: materialized.plan.createdAt
    }));
  } catch (error) {
    if (attachedSkills.length || createdSkills.length) await skillStore.writeAll(existingSkills);
    throw error;
  }
  return NextResponse.json({ workflow: materialized.plan, createdSkills, attachedSkills, lifecycle: decision }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const workspaceStores = createWorkspaceStores(dataDirectory, user.id);
  const id = request.nextUrl.searchParams.get('id')?.trim();
  if (!id) return NextResponse.json({ error: 'Workflow id is required.' }, { status: 400 });
  const activeRun = (await new RunRepository().readAll(user.id)).find((run) => run.workflowId === id && ['compiled', 'running', 'paused'].includes(run.status));
  if (activeRun) return NextResponse.json({ errors: [`Cancel or finish active run ${activeRun.id} before deleting this workflow.`] }, { status: 409 });
  const workflow = await store.remove(user.id, id);
  if (!workflow) return NextResponse.json({ error: 'Workflow was not found.' }, { status: 404 });
  await workspaceStores.workflows.remove(id);
  const assignments = await workspaceStores.projectWorkflows.readAll();
  const removedAssignmentIds = assignments.filter((assignment) => assignment.workflowId === id).map((assignment) => assignment.id);
  if (removedAssignmentIds.length) await workspaceStores.projectWorkflows.writeAll(assignments.filter((assignment) => assignment.workflowId !== id));
  await appendAuditEvent({ userId: user.id, actor: { id: user.id, name: user.name, role: user.role }, action: 'workflow.delete', resourceType: 'workflow', resourceId: id, decision: 'deleted', correlationId: id, details: { removedAssignmentIds } });
  return NextResponse.json({ workflow, removedAssignmentIds });
}
