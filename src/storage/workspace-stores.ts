import type { Project, ProjectWorkflow, Skill, Workflow } from '@/src/domain/workspace';
import { PostgresStore } from './postgres-store';

type RecordStore<T extends { id: string }> = Pick<PostgresStore<T>, 'readAll' | 'writeAll' | 'upsert' | 'remove'>;

export interface WorkspaceStores {
  projects: RecordStore<Project>;
  workflows: RecordStore<Workflow>;
  projectWorkflows: RecordStore<ProjectWorkflow>;
  skills: RecordStore<Skill>;
}

export function createWorkspaceStores(_dataDirectory: string, userId?: string): WorkspaceStores {
  return {
    projects: new PostgresStore<Project>('projects', userId),
    workflows: new PostgresStore<Workflow>('workflow-definitions', userId),
    projectWorkflows: new PostgresStore<ProjectWorkflow>('project-workflows', userId),
    skills: new PostgresStore<Skill>('skills', userId)
  };
}

export async function migrateLegacyWorkspaceForSoleUser(dataDirectory?: string, userId?: string) {
  void dataDirectory;
  void userId;
  return 0;
}
