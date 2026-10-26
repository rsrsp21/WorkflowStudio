import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProject,
  createProjectWorkflow,
  createSkill,
  createWorkflow,
  validateProject,
  validateProjectWorkflow,
  validateSkill,
  validateWorkflow,
  type WorkspaceCatalog
} from '@/src/domain/workspace';
import { createWorkspaceStores } from '@/src/storage/workspace-stores';
import { createUser } from '@/src/auth/auth';
import { resetDatabaseForTests } from '@/src/storage/async-database';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await resetDatabaseForTests();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function validCatalog() {
  const project = createProject({
    id: 'project-docs',
    name: 'Policy documents',
    rootPath: 'C:\\projects\\policy-docs',
    workspaceKind: 'workspace'
  });
  const skill = createSkill({
    id: 'skill-requirements-review',
    name: 'Requirements review',
    instructions: 'Review requirements and report gaps.',
    status: 'published',
    triggers: ['requirements review'],
    outputs: ['findings']
  });
  const workflow = createWorkflow({
    id: 'workflow-document-review',
    name: 'Document review',
    domain: 'documentation',
    status: 'published',
    requiredInputs: ['workspace'],
    outputs: ['review-report'],
    defaultSkillVersions: [{ skillId: skill.id, version: skill.version }]
  });
  return { project, skill, workflow };
}

describe('Phase 3 workspace models', () => {
  it('creates valid project, workflow, skill, and assignment records', () => {
    const { project, skill, workflow } = validCatalog();
    const assignment = createProjectWorkflow({
      id: 'assignment-policy-review',
      project,
      workflow,
      inputOverrides: { reportFormat: 'markdown' },
      selectedSkills: [skill],
      permissions: { allowedWorkspacePaths: [project.rootPath] }
    });
    const catalog: WorkspaceCatalog = { projects: [project], workflows: [workflow], skills: [skill] };

    expect(validateProject(project)).toEqual([]);
    expect(validateSkill(skill, catalog.projects)).toEqual([]);
    expect(validateWorkflow(workflow, catalog.skills)).toEqual([]);
    expect(validateProjectWorkflow(assignment, catalog)).toEqual([]);
    expect(assignment.workflowVersion).toBe(workflow.version);
    expect(assignment.selectedSkills).toEqual([{ skillId: skill.id, version: skill.version }]);
  });

  it('keeps assignment overrides and permissions isolated from reusable definitions', () => {
    const { project, skill, workflow } = validCatalog();
    const originalWorkflow = structuredClone(workflow);
    const originalSkill = structuredClone(skill);
    const inputOverrides = { reportFormat: 'markdown' };
    const allowedTools = ['read-files'];
    const assignment = createProjectWorkflow({
      project,
      workflow,
      selectedSkills: [skill],
      inputOverrides,
      permissions: { allowedTools }
    });

    inputOverrides.reportFormat = 'html';
    allowedTools.push('write-files');
    assignment.inputOverrides.reportFormat = 'pdf';
    assignment.permissions.allowedTools.push('publish-report');
    assignment.selectedSkills[0].version = 99;

    expect(workflow).toEqual(originalWorkflow);
    expect(skill).toEqual(originalSkill);
    expect(assignment.inputOverrides.reportFormat).toBe('pdf');
    expect(assignment.permissions.allowedTools).toEqual(['read-files', 'publish-report']);
  });

  it('rejects invalid paths, statuses, versions, and assignment relationships', () => {
    const { project, skill, workflow } = validCatalog();
    const assignment = createProjectWorkflow({
      project,
      workflow,
      selectedSkills: [skill],
      permissions: { allowedWorkspacePaths: ['C:\\projects\\another-project'] }
    });
    assignment.workflowVersion = 999;
    assignment.status = 'running' as never;
    assignment.projectId = 'missing-project';
    assignment.selectedSkills[0].version = 999;
    const errors = validateProjectWorkflow(assignment, {
      projects: [project],
      workflows: [workflow],
      skills: [skill]
    }).join(' ');

    expect(errors).toContain('status is invalid');
    expect(errors).toContain('unknown project');
    expect(errors).toContain('pin available workflow version');
    expect(errors).toContain('outside the project root');
    expect(errors).toContain('skill version is unavailable');
  });

  it('validates project-scoped skills and reusable workflow version references', () => {
    const { project, workflow } = validCatalog();
    const scopedSkill = createSkill({
      id: 'skill-project-only',
      name: 'Project-only review',
      instructions: 'Review this project.',
      status: 'published',
      scope: { kind: 'project', projectId: 'missing-project' }
    });
    workflow.defaultSkillVersions = [{ skillId: scopedSkill.id, version: 2 }];

    expect(validateSkill(scopedSkill, [project]).join(' ')).toContain('unknown project');
    expect(validateWorkflow(workflow, [scopedSkill]).join(' ')).toContain('version is unavailable');
  });

  it('prevents a workflow-scoped skill from being assigned to another workflow', () => {
    const { project, workflow } = validCatalog();
    const scopedSkill = createSkill({
      id: 'skill-workflow-only',
      name: 'Workflow-only review',
      instructions: 'Review only for its owning workflow.',
      status: 'published',
      scope: { kind: 'workflow', workflowId: 'another-workflow' }
    });
    const assignment = createProjectWorkflow({ project, workflow, selectedSkills: [scopedSkill] });

    expect(validateProjectWorkflow(assignment, { projects: [project], workflows: [workflow], skills: [scopedSkill] }).join(' ')).toContain('scoped to another workflow');
  });
});

describe('Phase 3 workspace persistence', () => {
  it('persists each record type independently in PostgreSQL', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-p3-'));
    temporaryDirectories.push(directory);
    const user = await createUser({ name: 'Workspace owner', email: `workspace-${crypto.randomUUID()}@example.com`, password: 'password-123', role: 'builder' });
    if (!user) throw new Error('Could not create workspace owner.');
    const stores = createWorkspaceStores(directory, user.id);
    const { project, skill, workflow } = validCatalog();
    const assignment = createProjectWorkflow({ project, workflow, selectedSkills: [skill] });

    await Promise.all([
      stores.projects.upsert(project),
      stores.workflows.upsert(workflow),
      stores.skills.upsert(skill),
      stores.projectWorkflows.upsert(assignment)
    ]);

    expect(await stores.projects.readAll()).toEqual([project]);
    expect(await stores.workflows.readAll()).toEqual([workflow]);
    expect(await stores.skills.readAll()).toEqual([skill]);
    expect(await stores.projectWorkflows.readAll()).toEqual([assignment]);
  });
});
