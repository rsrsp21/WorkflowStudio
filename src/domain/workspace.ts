import type { HarnessPolicy, WorkflowPlan } from './models';

export const PROJECT_SCHEMA_VERSION = 1;
export const REUSABLE_WORKFLOW_SCHEMA_VERSION = 1;
export const PROJECT_WORKFLOW_SCHEMA_VERSION = 1;
export const SKILL_SCHEMA_VERSION = 1;

export type ProjectStatus = 'active' | 'archived';
export type WorkspaceKind = 'empty' | 'repository' | 'workspace';
export type ReusableWorkflowStatus = 'draft' | 'published' | 'archived';
export type ProjectWorkflowStatus = 'draft' | 'ready' | 'archived';
export type SkillStatus = 'draft' | 'published' | 'archived';

export interface Project {
  id: string;
  schemaVersion: number;
  name: string;
  description: string;
  rootPath: string;
  workspaceKind: WorkspaceKind;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFolderInspection {
  rootPath: string;
  workspaceKind: WorkspaceKind;
  entryCount: number;
  directoryCount: number;
  fileCount: number;
  hasGitMetadata: boolean;
  inspectionMode: 'read-only';
  inspectedAt: string;
}

export interface ProjectFolderListing {
  rootPath: string;
  parentPath: string | null;
  directories: Array<{ name: string; path: string }>;
  inspectionMode: 'read-only';
}

export interface SkillVersionReference {
  skillId: string;
  version: number;
}

export interface Workflow {
  id: string;
  schemaVersion: number;
  name: string;
  description: string;
  domain: string;
  version: number;
  status: ReusableWorkflowStatus;
  requiredInputs: string[];
  outputs: string[];
  defaultSkillVersions: SkillVersionReference[];
  createdAt: string;
  updatedAt: string;
}

export type SkillScope =
  | { kind: 'global' }
  | { kind: 'project'; projectId: string }
  | { kind: 'workflow'; workflowId: string };

export interface Skill {
  id: string;
  familyId: string;
  schemaVersion: number;
  name: string;
  description: string;
  version: number;
  status: SkillStatus;
  scope: SkillScope;
  instructions: string;
  triggers: string[];
  requiredContext: string[];
  inputs: string[];
  outputs: string[];
  requiredPermissions: string[];
  validationCriteria: string[];
  source: string;
  author: string;
  compatibility: string[];
  estimatedContextTokens: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentPermissions {
  sandboxMode: HarnessPolicy['sandboxMode'];
  allowedTools: string[];
  allowedWorkspacePaths: string[];
  requireApprovalForDestructiveActions: boolean;
}

export interface AssignmentApproval {
  approvedAt: string;
  approvedBy: { id: string; name: string; role: string };
  workflowVersion: number;
  configurationVersion: number;
}

export interface ProjectWorkflow {
  id: string;
  schemaVersion: number;
  projectId: string;
  workflowId: string;
  workflowVersion: number;
  rootPath: string;
  status: ProjectWorkflowStatus;
  inputOverrides: Record<string, string>;
  permissions: AssignmentPermissions;
  selectedSkills: SkillVersionReference[];
  graphOverride?: WorkflowPlan;
  configurationVersion?: number;
  approval?: AssignmentApproval;
  idempotencyKey?: string;
  idempotencyFingerprint?: string;
  lastMutationKey?: string;
  lastMutationFingerprint?: string;
  mutationReceipts?: Record<string, string>;
  runIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceCatalog {
  projects: Project[];
  workflows: Workflow[];
  skills: Skill[];
}

type ProjectInput = Pick<Project, 'name' | 'rootPath' | 'workspaceKind'> &
  Partial<Pick<Project, 'id' | 'description' | 'status' | 'createdAt'>>;

type WorkflowInput = Pick<Workflow, 'name' | 'domain'> &
  Partial<Omit<Workflow, 'schemaVersion' | 'name' | 'domain' | 'updatedAt'>>;

type SkillInput = Pick<Skill, 'name' | 'instructions'> &
  Partial<Omit<Skill, 'schemaVersion' | 'name' | 'instructions'>>;

export interface ProjectWorkflowInput {
  id?: string;
  project: Project;
  workflow: Workflow;
  status?: ProjectWorkflowStatus;
  inputOverrides?: Record<string, string>;
  permissions?: Partial<AssignmentPermissions>;
  selectedSkills?: Skill[];
  graphOverride?: WorkflowPlan;
  runIds?: string[];
  configurationVersion?: number;
  approval?: AssignmentApproval;
  idempotencyKey?: string;
  idempotencyFingerprint?: string;
  lastMutationKey?: string;
  lastMutationFingerprint?: string;
  mutationReceipts?: Record<string, string>;
  createdAt?: string;
}

const DEFAULT_ASSIGNMENT_PERMISSIONS: AssignmentPermissions = {
  sandboxMode: 'read-only',
  allowedTools: [],
  allowedWorkspacePaths: [],
  requireApprovalForDestructiveActions: true
};

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function now(): string {
  return new Date().toISOString();
}

export function createProject(input: ProjectInput): Project {
  const timestamp = now();
  return {
    id: input.id ?? newId('project'),
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    rootPath: input.rootPath.trim(),
    workspaceKind: input.workspaceKind,
    status: input.status ?? 'active',
    createdAt: input.createdAt ?? timestamp,
    updatedAt: timestamp
  };
}

export function createWorkflow(input: WorkflowInput): Workflow {
  const timestamp = now();
  return {
    id: input.id ?? newId('workflow_definition'),
    schemaVersion: REUSABLE_WORKFLOW_SCHEMA_VERSION,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    domain: input.domain.trim(),
    version: input.version ?? 1,
    status: input.status ?? 'draft',
    requiredInputs: [...(input.requiredInputs ?? [])],
    outputs: [...(input.outputs ?? [])],
    defaultSkillVersions: (input.defaultSkillVersions ?? []).map((reference) => ({ ...reference })),
    createdAt: input.createdAt ?? timestamp,
    updatedAt: timestamp
  };
}

export function createSkill(input: SkillInput): Skill {
  const timestamp = now();
  return {
    id: input.id ?? newId('skill'),
    familyId: input.familyId ?? input.id ?? newId('skill_family'),
    schemaVersion: SKILL_SCHEMA_VERSION,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    version: input.version ?? 1,
    status: input.status ?? 'draft',
    scope: input.scope ? { ...input.scope } : { kind: 'global' },
    instructions: input.instructions.trim(),
    triggers: [...(input.triggers ?? [])],
    requiredContext: [...(input.requiredContext ?? [])],
    inputs: [...(input.inputs ?? [])],
    outputs: [...(input.outputs ?? [])],
    requiredPermissions: [...(input.requiredPermissions ?? [])],
    validationCriteria: [...(input.validationCriteria ?? [])],
    source: input.source?.trim() || 'Local registry',
    author: input.author?.trim() || 'Workspace user',
    compatibility: [...(input.compatibility ?? ['Codex App Server'])],
    estimatedContextTokens: input.estimatedContextTokens ?? Math.max(1, Math.ceil(input.instructions.trim().length / 4)),
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp
  };
}

export function createProjectWorkflow(input: ProjectWorkflowInput): ProjectWorkflow {
  const timestamp = now();
  const permissions = input.permissions ?? {};
  return {
    id: input.id ?? newId('project_workflow'),
    schemaVersion: PROJECT_WORKFLOW_SCHEMA_VERSION,
    projectId: input.project.id,
    workflowId: input.workflow.id,
    workflowVersion: input.workflow.version,
    rootPath: input.project.rootPath,
    status: input.status ?? 'draft',
    inputOverrides: { ...(input.inputOverrides ?? {}) },
    permissions: {
      ...DEFAULT_ASSIGNMENT_PERMISSIONS,
      ...permissions,
      allowedTools: [...(permissions.allowedTools ?? DEFAULT_ASSIGNMENT_PERMISSIONS.allowedTools)],
      allowedWorkspacePaths: [...(permissions.allowedWorkspacePaths ?? DEFAULT_ASSIGNMENT_PERMISSIONS.allowedWorkspacePaths)]
    },
    selectedSkills: (input.selectedSkills ?? []).map((skill) => ({ skillId: skill.id, version: skill.version })),
    ...(input.graphOverride ? { graphOverride: structuredClone(input.graphOverride) } : {}),
    configurationVersion: input.configurationVersion ?? 1,
    ...(input.approval ? { approval: structuredClone(input.approval) } : {}),
    ...(input.idempotencyKey?.trim() ? { idempotencyKey: input.idempotencyKey.trim() } : {}),
    ...(input.idempotencyFingerprint?.trim() ? { idempotencyFingerprint: input.idempotencyFingerprint.trim() } : {}),
    ...(input.lastMutationKey?.trim() ? { lastMutationKey: input.lastMutationKey.trim() } : {}),
    ...(input.lastMutationFingerprint?.trim() ? { lastMutationFingerprint: input.lastMutationFingerprint.trim() } : {}),
    ...(input.mutationReceipts ? { mutationReceipts: { ...input.mutationReceipts } } : {}),
    runIds: [...(input.runIds ?? [])],
    createdAt: input.createdAt ?? timestamp,
    updatedAt: timestamp
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== '');
}

function hasValidId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function normalizeWorkspacePath(value: string): string | null {
  const trimmed = value.trim().replace(/\\/g, '/');
  const absolute = /^(?:[A-Za-z]:\/|\/\/[^/]+\/[^/]+|\/)/.test(trimmed);
  if (!absolute || trimmed.split('/').includes('..')) return null;
  const normalized = trimmed.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function isPathWithinRoot(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeWorkspacePath(candidate);
  const normalizedRoot = normalizeWorkspacePath(root);
  if (!normalizedCandidate || !normalizedRoot) return false;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

function validateCommonRecord(
  value: Record<string, unknown>,
  expectedSchemaVersion: number,
  label: string,
  errors: string[]
): void {
  if (!hasValidId(value.id)) errors.push(`${label} id is required and must be stable.`);
  if (value.schemaVersion !== expectedSchemaVersion) errors.push(`Unsupported ${label.toLowerCase()} schema version: ${String(value.schemaVersion)}.`);
  if (typeof value.name !== 'string' || !value.name.trim()) errors.push(`${label} name is required.`);
  if (!isIsoDate(value.createdAt)) errors.push(`${label} createdAt must be a valid date.`);
  if (!isIsoDate(value.updatedAt)) errors.push(`${label} updatedAt must be a valid date.`);
}

function validateSkillReferences(value: unknown, label: string, errors: string[]): value is SkillVersionReference[] {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array.`);
    return false;
  }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (!isRecord(item) || !hasValidId(item.skillId) || !isPositiveInteger(item.version)) {
      errors.push(`${label} item ${index + 1} must contain a skill id and positive version.`);
      return;
    }
    if (seen.has(item.skillId)) errors.push(`${label} contains duplicate skill id: ${item.skillId}.`);
    seen.add(item.skillId);
  });
  return true;
}

export function validateProject(project: unknown): string[] {
  if (!isRecord(project)) return ['Project must be an object.'];
  const errors: string[] = [];
  validateCommonRecord(project, PROJECT_SCHEMA_VERSION, 'Project', errors);
  if (typeof project.description !== 'string') errors.push('Project description must be a string.');
  if (!['empty', 'repository', 'workspace'].includes(project.workspaceKind as string)) errors.push('Project workspace kind is invalid.');
  if (!['active', 'archived'].includes(project.status as string)) errors.push('Project status is invalid.');
  if (typeof project.rootPath !== 'string' || !normalizeWorkspacePath(project.rootPath)) errors.push('Project root path must be an absolute path without parent traversal.');
  return errors;
}

export function validateWorkflow(workflow: unknown, skills?: Skill[]): string[] {
  if (!isRecord(workflow)) return ['Reusable workflow must be an object.'];
  const errors: string[] = [];
  validateCommonRecord(workflow, REUSABLE_WORKFLOW_SCHEMA_VERSION, 'Reusable workflow', errors);
  if (typeof workflow.description !== 'string') errors.push('Reusable workflow description must be a string.');
  if (typeof workflow.domain !== 'string' || !workflow.domain.trim()) errors.push('Reusable workflow domain is required.');
  if (!isPositiveInteger(workflow.version)) errors.push('Reusable workflow version must be a positive integer.');
  if (!['draft', 'published', 'archived'].includes(workflow.status as string)) errors.push('Reusable workflow status is invalid.');
  if (!isStringArray(workflow.requiredInputs)) errors.push('Reusable workflow required inputs must be non-empty strings.');
  if (!isStringArray(workflow.outputs)) errors.push('Reusable workflow outputs must be non-empty strings.');
  if (validateSkillReferences(workflow.defaultSkillVersions, 'Default skill versions', errors) && skills) {
    for (const reference of workflow.defaultSkillVersions) {
      const skill = skills.find((candidate) => candidate.id === reference.skillId && candidate.version === reference.version);
      if (!skill) errors.push(`Default skill version is unavailable: ${reference.skillId}@${reference.version}.`);
    }
  }
  return errors;
}

export function validateSkill(skill: unknown, projects?: Project[]): string[] {
  if (!isRecord(skill)) return ['Skill must be an object.'];
  const errors: string[] = [];
  validateCommonRecord(skill, SKILL_SCHEMA_VERSION, 'Skill', errors);
  if (typeof skill.description !== 'string') errors.push('Skill description must be a string.');
  if (!isPositiveInteger(skill.version)) errors.push('Skill version must be a positive integer.');
  if (!hasValidId(skill.familyId)) errors.push('Skill family id is required and must be stable.');
  if (!['draft', 'published', 'archived'].includes(skill.status as string)) errors.push('Skill status is invalid.');
  if (typeof skill.instructions !== 'string' || !skill.instructions.trim()) errors.push('Skill instructions are required.');
  else if (skill.instructions.length > 400_000) errors.push('Skill instructions exceed the supported size.');
  for (const field of ['triggers', 'requiredContext', 'inputs', 'outputs', 'requiredPermissions', 'validationCriteria'] as const) {
    if (!isStringArray(skill[field])) errors.push(`Skill ${field} must contain non-empty strings.`);
    else if (skill[field].length > 100 || new Set(skill[field]).size !== skill[field].length) errors.push(`Skill ${field} must be unique and cannot exceed 100 entries.`);
  }
  if (typeof skill.source !== 'string' || !skill.source.trim()) errors.push('Skill source is required.');
  if (typeof skill.author !== 'string' || !skill.author.trim()) errors.push('Skill author is required.');
  if (!isStringArray(skill.compatibility)) errors.push('Skill compatibility must contain non-empty strings.');
  if (!isPositiveInteger(skill.estimatedContextTokens) || skill.estimatedContextTokens > 100_000) errors.push('Skill estimated context tokens must be between 1 and 100,000.');
  if (!isRecord(skill.scope) || !['global', 'project', 'workflow'].includes(skill.scope.kind as string)) {
    errors.push('Skill scope is invalid.');
  } else if (skill.scope.kind === 'project') {
    const projectId = skill.scope.projectId;
    if (!hasValidId(projectId)) errors.push('Project-scoped skill must reference a project id.');
    else if (projects && !projects.some((project) => project.id === projectId)) errors.push(`Skill references an unknown project: ${projectId}.`);
  } else if (skill.scope.kind === 'workflow' && !hasValidId(skill.scope.workflowId)) errors.push('Workflow-scoped skill must reference a workflow id.');
  return errors;
}

export function validateProjectWorkflow(assignment: unknown, catalog: WorkspaceCatalog): string[] {
  if (!isRecord(assignment)) return ['Project workflow must be an object.'];
  const errors: string[] = [];
  if (!hasValidId(assignment.id)) errors.push('Project workflow id is required and must be stable.');
  if (assignment.schemaVersion !== PROJECT_WORKFLOW_SCHEMA_VERSION) errors.push(`Unsupported project workflow schema version: ${String(assignment.schemaVersion)}.`);
  if (!isIsoDate(assignment.createdAt)) errors.push('Project workflow createdAt must be a valid date.');
  if (!isIsoDate(assignment.updatedAt)) errors.push('Project workflow updatedAt must be a valid date.');
  if (!['draft', 'ready', 'archived'].includes(assignment.status as string)) errors.push('Project workflow status is invalid.');
  if (assignment.configurationVersion !== undefined && (!isPositiveInteger(assignment.configurationVersion))) errors.push('Project workflow configuration version must be a positive integer.');
  if (assignment.idempotencyKey !== undefined && (typeof assignment.idempotencyKey !== 'string' || !assignment.idempotencyKey.trim() || assignment.idempotencyKey.length > 128)) errors.push('Project workflow idempotency key is invalid.');
  if (assignment.idempotencyFingerprint !== undefined && (typeof assignment.idempotencyFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(assignment.idempotencyFingerprint))) errors.push('Project workflow idempotency fingerprint is invalid.');
  if (assignment.lastMutationKey !== undefined && (typeof assignment.lastMutationKey !== 'string' || !assignment.lastMutationKey.trim() || assignment.lastMutationKey.length > 128)) errors.push('Project workflow mutation key is invalid.');
  if (assignment.lastMutationFingerprint !== undefined && (typeof assignment.lastMutationFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(assignment.lastMutationFingerprint))) errors.push('Project workflow mutation fingerprint is invalid.');
  if (assignment.mutationReceipts !== undefined && (!isRecord(assignment.mutationReceipts) || Object.keys(assignment.mutationReceipts).length > 100 || Object.entries(assignment.mutationReceipts).some(([key, fingerprint]) => !key.trim() || key.length > 128 || typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)))) errors.push('Project workflow mutation receipts are invalid.');
  if (assignment.approval !== undefined) {
    if (!isRecord(assignment.approval) || !isIsoDate(assignment.approval.approvedAt) || !isRecord(assignment.approval.approvedBy) || !hasValidId(assignment.approval.approvedBy.id) || typeof assignment.approval.approvedBy.name !== 'string' || !assignment.approval.approvedBy.name.trim() || typeof assignment.approval.approvedBy.role !== 'string' || !assignment.approval.approvedBy.role.trim() || !isPositiveInteger(assignment.approval.workflowVersion) || !isPositiveInteger(assignment.approval.configurationVersion)) errors.push('Project workflow approval metadata is invalid.');
    else {
      if (assignment.status !== 'ready') errors.push('Only a ready project workflow may retain approval metadata.');
      if (assignment.approval.workflowVersion !== assignment.workflowVersion) errors.push('Project workflow approval references a stale workflow version.');
      if (assignment.approval.configurationVersion !== (assignment.configurationVersion ?? 1)) errors.push('Project workflow approval references a stale configuration version.');
    }
  }
  if (!isStringArray(assignment.runIds)) errors.push('Project workflow run ids must contain non-empty strings.');
  if (!isRecord(assignment.inputOverrides) || Object.values(assignment.inputOverrides).some((item) => typeof item !== 'string')) errors.push('Project workflow input overrides must be string values.');
  else if (Object.keys(assignment.inputOverrides).length > 200 || Object.entries(assignment.inputOverrides).some(([key, item]) => !key.trim() || String(item).length > 10_000)) errors.push('Project workflow inputs exceed the supported size or contain an empty key.');

  const project = catalog.projects.find((candidate) => candidate.id === assignment.projectId);
  if (!project) errors.push(`Project workflow references an unknown project: ${String(assignment.projectId)}.`);
  else if (assignment.status === 'ready' && project.status !== 'active') errors.push('Archived projects cannot have ready workflow assignments.');
  const workflow = catalog.workflows.find((candidate) => candidate.id === assignment.workflowId);
  if (!workflow) errors.push(`Project workflow references an unknown reusable workflow: ${String(assignment.workflowId)}.`);
  else if (assignment.workflowVersion !== workflow.version) errors.push(`Project workflow must pin available workflow version ${workflow.version}.`);
  if (project && assignment.rootPath !== project.rootPath) errors.push('Project workflow root path must match its project root path.');
  if (typeof assignment.rootPath !== 'string' || !normalizeWorkspacePath(assignment.rootPath)) errors.push('Project workflow root path must be an absolute path without parent traversal.');

  if (!isRecord(assignment.permissions)) {
    errors.push('Project workflow permissions are required.');
  } else {
    if (!['workspace', 'read-only', 'isolated'].includes(assignment.permissions.sandboxMode as string)) errors.push('Project workflow sandbox mode is invalid.');
    if (!isStringArray(assignment.permissions.allowedTools)) errors.push('Project workflow allowed tools must contain non-empty strings.');
    else if (assignment.permissions.allowedTools.length > 100 || new Set(assignment.permissions.allowedTools).size !== assignment.permissions.allowedTools.length) errors.push('Project workflow allowed tools must be unique and cannot exceed 100 entries.');
    if (!isStringArray(assignment.permissions.allowedWorkspacePaths)) errors.push('Project workflow allowed workspace paths must contain non-empty strings.');
    else if (typeof assignment.rootPath === 'string') {
      for (const allowedPath of assignment.permissions.allowedWorkspacePaths) {
        if (!isPathWithinRoot(allowedPath, assignment.rootPath)) errors.push(`Allowed workspace path is outside the project root: ${allowedPath}.`);
      }
      const onlyAllowedPath = assignment.permissions.allowedWorkspacePaths[0];
      const exactRoot = Boolean(onlyAllowedPath) && isPathWithinRoot(onlyAllowedPath, assignment.rootPath) && isPathWithinRoot(assignment.rootPath, onlyAllowedPath);
      if (assignment.permissions.allowedWorkspacePaths.length !== 1 || !exactRoot) errors.push('Project workflow workspace access must contain only its project root.');
    }
    if (typeof assignment.permissions.requireApprovalForDestructiveActions !== 'boolean') errors.push('Project workflow destructive-action approval policy must be a boolean.');
  }

  if (validateSkillReferences(assignment.selectedSkills, 'Selected skills', errors)) {
    let estimatedContextTokens = 0;
    for (const reference of assignment.selectedSkills) {
      const skill = catalog.skills.find((candidate) => candidate.id === reference.skillId && candidate.version === reference.version);
      if (!skill) {
        errors.push(`Selected skill version is unavailable: ${reference.skillId}@${reference.version}.`);
        continue;
      }
      estimatedContextTokens += skill.estimatedContextTokens;
      if (skill.status !== 'published') errors.push(`Selected skill is not active: ${skill.id}@${skill.version}.`);
      if (skill.scope.kind === 'project' && skill.scope.projectId !== assignment.projectId) errors.push(`Selected skill is scoped to another project: ${skill.id}.`);
      if (skill.scope.kind === 'workflow' && skill.scope.workflowId !== assignment.workflowId) errors.push(`Selected skill is scoped to another workflow: ${skill.id}.`);
    }
    if (estimatedContextTokens > 100_000) errors.push('Selected skill context exceeds the 100,000 token assignment limit.');
  }
  return errors;
}
