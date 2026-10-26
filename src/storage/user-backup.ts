import { studioPaths } from '@/scripts/studio-home.cjs';
import type { WorkflowPlan } from '@/src/domain/models';
import { validateWorkflowPlan } from '@/src/domain/models';
import type { Project, ProjectWorkflow, Skill, Workflow } from '@/src/domain/workspace';
import { validateProject, validateProjectWorkflow, validateSkill, validateWorkflow } from '@/src/domain/workspace';
import type { WorkflowRun } from '@/src/domain/runtime';
import { hydrateWorkflowRun, validateWorkflowRun } from '@/src/domain/runtime';
import { ownedProjectIds, claimProjectOwnership, projectOwnerId } from './project-ownership-repository';
import { RunRepository } from './run-repository';
import { WorkflowRepository } from './workflow-repository';
import { createWorkspaceStores } from './workspace-stores';
import { requestFingerprint } from '@/src/server/request-fingerprint';

export const USER_BACKUP_SCHEMA_VERSION = 1;

export interface UserBackup {
  schemaVersion: 1;
  product: 'Workflow Studio';
  exportedAt: string;
  workflows: WorkflowPlan[];
  projects: Project[];
  definitions: Workflow[];
  assignments: ProjectWorkflow[];
  skills: Skill[];
  runs: WorkflowRun[];
}

const dataDirectory = () => process.env.WORKFLOW_STUDIO_DATA_DIR ?? studioPaths().data;

export async function createUserBackup(userId: string): Promise<UserBackup> {
  const stores = createWorkspaceStores(dataDirectory(), userId);
  const workflowPlans = await new WorkflowRepository().readAll(userId);
  const workflowIds = new Set(workflowPlans.map((workflow) => workflow.id));
  const projectIds = await ownedProjectIds(userId);
  const [allProjects, allDefinitions, allAssignments, allSkills] = await Promise.all([stores.projects.readAll(), stores.workflows.readAll(), stores.projectWorkflows.readAll(), stores.skills.readAll()]);
  const assignments = allAssignments.filter((assignment) => workflowIds.has(assignment.workflowId) && projectIds.has(assignment.projectId));
  const skillIds = new Set([...workflowPlans.flatMap((workflow) => workflow.nodes.flatMap((node) => node.skillIds)), ...assignments.flatMap((assignment) => assignment.selectedSkills.map((skill) => skill.skillId))]);
  return {
    schemaVersion: USER_BACKUP_SCHEMA_VERSION,
    product: 'Workflow Studio',
    exportedAt: new Date().toISOString(),
    workflows: workflowPlans,
    projects: allProjects.filter((project) => projectIds.has(project.id)),
    definitions: allDefinitions.filter((definition) => workflowIds.has(definition.id)),
    assignments,
    skills: allSkills.filter((skill) => skillIds.has(skill.id)),
    runs: await new RunRepository().readAll(userId)
  };
}

function isBackup(value: unknown): value is UserBackup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<UserBackup>;
  return candidate.schemaVersion === USER_BACKUP_SCHEMA_VERSION && candidate.product === 'Workflow Studio'
    && Array.isArray(candidate.workflows) && Array.isArray(candidate.projects) && Array.isArray(candidate.definitions)
    && Array.isArray(candidate.assignments) && Array.isArray(candidate.skills) && Array.isArray(candidate.runs);
}

export async function restoreUserBackup(userId: string, value: unknown) {
  if (!isBackup(value)) throw new Error('Backup file is missing the supported Workflow Studio schema.');
  const errors = [
    ...value.workflows.flatMap(validateWorkflowPlan),
    ...value.projects.flatMap(validateProject),
    ...value.skills.flatMap((skill) => validateSkill(skill, value.projects)),
    ...value.definitions.flatMap((workflow) => validateWorkflow(workflow, value.skills)),
    ...value.assignments.flatMap((assignment) => validateProjectWorkflow(assignment, { projects: value.projects, workflows: value.definitions, skills: value.skills })),
    ...value.runs.flatMap((run) => validateWorkflowRun(hydrateWorkflowRun(run)))
  ];
  if (errors.length) throw new Error(`Backup validation failed: ${[...new Set(errors)].slice(0, 10).join(' ')}`);
  const workflowRepository = new WorkflowRepository();
  for (const workflow of value.workflows) {
    const owner = await workflowRepository.ownerId(workflow.id);
    if (owner && owner !== userId) throw new Error('Backup contains a workflow id owned by another account.');
  }
  for (const project of value.projects) {
    const owner = await projectOwnerId(project.id);
    if (owner && owner !== userId) throw new Error('Backup contains a project id owned by another account.');
  }
  const stores = createWorkspaceStores(dataDirectory(), userId);
  for (const project of value.projects) { await claimProjectOwnership(userId, project.id); await stores.projects.upsert(project); }
  for (const skill of value.skills) await stores.skills.upsert(skill);
  for (const definition of value.definitions) await stores.workflows.upsert(definition);
  for (const workflow of value.workflows) await workflowRepository.upsert(userId, workflow);
  for (const assignment of value.assignments) await stores.projectWorkflows.upsert(assignment);
  const runs = new RunRepository();
  for (const storedRun of value.runs) {
    const run = hydrateWorkflowRun({ ...storedRun, userId });
    run.compiledWorkflow.harnessV2.governanceAndSecurity.ownerUserId = userId;
    const existing = await runs.read(userId, run.id);
    if (existing) {
      if (requestFingerprint({ ...existing, stateRevision: 0 }) !== requestFingerprint({ ...run, stateRevision: 0 })) throw new Error('Restore cannot overwrite an existing run with different retained evidence.');
      continue;
    }
    run.stateRevision = 0;
    run.executionRequested = false;
    await runs.upsert(userId, run);
  }
  return { workflows: value.workflows.length, projects: value.projects.length, skills: value.skills.length, assignments: value.assignments.length, runs: value.runs.length };
}
