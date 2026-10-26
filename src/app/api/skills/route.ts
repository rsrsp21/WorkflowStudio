import { studioPaths } from '@/scripts/studio-home.cjs';
import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { materializeWorkflowSkillDrafts } from '@/src/domain/generated-skills';
import { createSkill, validateSkill, type Skill } from '@/src/domain/workspace';
import { WorkflowRepository } from '@/src/storage/workflow-repository';
import { RunRepository } from '@/src/storage/run-repository';
import { createWorkspaceStores } from '@/src/storage/workspace-stores';
import { appendAuditEvent } from '@/src/storage/audit-repository';

export const dynamic = 'force-dynamic';

const dataDirectory = process.env.WORKFLOW_STUDIO_DATA_DIR ?? studioPaths().data;
const workflowStore = new WorkflowRepository();

async function readSkills(userId: string): Promise<Skill[]> {
  const store = createWorkspaceStores(dataDirectory, userId).skills;
  const stored = await store.readAll();
  const normalized = stored.map((skill) => createSkill({ ...skill, updatedAt: skill.updatedAt }));
  const skills = [...normalized];
  const existingIds = new Set(skills.map((skill) => skill.id));

  const workflows = await workflowStore.readAll(userId);
  for (const workflow of workflows) {
    const referencedIds = new Set(workflow.nodes.flatMap((node) => node.skillIds));
    const recovered = materializeWorkflowSkillDrafts(workflow, skills).drafts
      .filter((skill) => referencedIds.has(skill.id) && !existingIds.has(skill.id))
      .map((skill) => createSkill(skill));
    skills.push(...recovered);
    recovered.forEach((skill) => existingIds.add(skill.id));
  }
  if (JSON.stringify(skills) !== JSON.stringify(stored)) await store.writeAll(skills);
  return skills;
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  return NextResponse.json({ skills: await readSkills(user.id) });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const store = createWorkspaceStores(dataDirectory, user.id).skills;
  const body = (await request.json()) as Partial<Skill> & { instructions?: unknown; name?: unknown };
  if (typeof body.name !== 'string' || typeof body.instructions !== 'string') {
    return NextResponse.json({ errors: ['Skill name and instructions are required.'] }, { status: 400 });
  }
  const existing = body.id ? (await readSkills(user.id)).find((skill) => skill.id === body.id) : undefined;
  const createsNewVersion = Boolean(existing && existing.status !== 'draft');
  const nextVersion = createsNewVersion ? (existing?.version ?? 0) + 1 : existing?.version ?? body.version ?? 1;
  const skill = createSkill({
    ...(existing ?? {}),
    ...body,
    id: createsNewVersion ? `${existing?.familyId}-v${nextVersion}-${crypto.randomUUID().slice(0, 8)}` : existing?.id ?? body.id,
    familyId: existing?.familyId ?? body.familyId,
    name: body.name,
    instructions: body.instructions,
    version: nextVersion,
    status: createsNewVersion ? 'draft' : body.status ?? existing?.status ?? 'draft',
    updatedAt: new Date().toISOString()
  });
  const errors = validateSkill(skill);
  if (errors.length) return NextResponse.json({ errors }, { status: 400 });
  await store.upsert(skill);
  return NextResponse.json({ skill, createdVersion: createsNewVersion }, { status: existing && !createsNewVersion ? 200 : 201 });
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const stores = createWorkspaceStores(dataDirectory, user.id);
  const store = stores.skills;
  const body = (await request.json()) as { id?: string; action?: 'publish' | 'archive' | 'restore' | 'duplicate' };
  if (!body.id || !body.action) return NextResponse.json({ errors: ['Skill id and lifecycle action are required.'] }, { status: 400 });
  const skills = await readSkills(user.id);
  const existing = skills.find((skill) => skill.id === body.id);
  if (!existing) return NextResponse.json({ error: 'Skill was not found.' }, { status: 404 });
  let skill: Skill;
  if (body.action === 'duplicate') {
    skill = createSkill({
      ...existing,
      id: undefined,
      familyId: undefined,
      name: `${existing.name} copy`,
      version: 1,
      status: 'draft',
      createdAt: undefined,
      updatedAt: undefined
    });
  } else {
    const nextStatus = body.action === 'publish' ? 'published' : body.action === 'archive' ? 'archived' : 'draft';
    if (body.action === 'publish' && existing.status !== 'draft') return NextResponse.json({ errors: ['Only draft skills can be published.'] }, { status: 400 });
    if (body.action === 'archive' && existing.status === 'archived') return NextResponse.json({ errors: ['Skill is already archived.'] }, { status: 400 });
    if (body.action === 'restore' && existing.status !== 'archived') return NextResponse.json({ errors: ['Only archived skills can be restored.'] }, { status: 400 });
    skill = createSkill({ ...existing, status: nextStatus, updatedAt: new Date().toISOString() });
  }
  const errors = validateSkill(skill);
  if (errors.length) return NextResponse.json({ errors }, { status: 400 });
  await store.upsert(skill);
  return NextResponse.json({ skill }, { status: body.action === 'duplicate' ? 201 : 200 });
}

export async function DELETE(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const stores = createWorkspaceStores(dataDirectory, user.id);
  const store = stores.skills;
  const id = request.nextUrl.searchParams.get('id')?.trim();
  if (!id) return NextResponse.json({ error: 'Skill id is required.' }, { status: 400 });
  const activeRun = (await new RunRepository().readAll(user.id)).find((run) =>
    ['compiled', 'running', 'paused'].includes(run.status)
    && run.compiledWorkflow.nodes.some((node) => node.skillVersions.some((reference) => reference.skillId === id))
  );
  if (activeRun) return NextResponse.json({ errors: [`Cancel or finish active run ${activeRun.id} before deleting this skill.`] }, { status: 409 });
  const skill = await store.remove(id);
  if (!skill) return NextResponse.json({ error: 'Skill was not found.' }, { status: 404 });
  const updatedWorkflowIds = workflowStore.removeSkillReference(user.id, id);
  const reusableWorkflows = await stores.workflows.readAll();
  const updatedReusableWorkflowIds: string[] = [];
  const updatedReusableWorkflows = reusableWorkflows.map((workflow) => {
    if (!workflow.defaultSkillVersions.some((reference) => reference.skillId === id)) return workflow;
    updatedReusableWorkflowIds.push(workflow.id);
    return { ...workflow, defaultSkillVersions: workflow.defaultSkillVersions.filter((reference) => reference.skillId !== id), updatedAt: new Date().toISOString() };
  });
  if (updatedReusableWorkflowIds.length) await stores.workflows.writeAll(updatedReusableWorkflows);
  const assignments = await stores.projectWorkflows.readAll();
  const updatedAssignmentIds: string[] = [];
  const updatedAssignments = assignments.map((assignment) => {
    if (!assignment.selectedSkills.some((reference) => reference.skillId === id)) return assignment;
    updatedAssignmentIds.push(assignment.id);
    return { ...assignment, selectedSkills: assignment.selectedSkills.filter((reference) => reference.skillId !== id), updatedAt: new Date().toISOString() };
  });
  if (updatedAssignmentIds.length) await stores.projectWorkflows.writeAll(updatedAssignments);
  await appendAuditEvent({ userId: user.id, actor: { id: user.id, name: user.name, role: user.role }, action: 'skill.delete', resourceType: 'skill', resourceId: id, decision: 'deleted', correlationId: id, details: { updatedWorkflowIds, updatedReusableWorkflowIds, updatedAssignmentIds } });
  return NextResponse.json({ skill, updatedWorkflowIds, updatedReusableWorkflowIds, updatedAssignmentIds });
}
