import { getDatabase } from './async-database';

export async function projectOwnerId(projectId: string): Promise<string | null> {
  const row = await (await getDatabase()).get<{ user_id: string }>('SELECT user_id FROM project_owners WHERE project_id = ?', [projectId]);
  return row?.user_id ?? null;
}

export async function claimProjectOwnership(userId: string, projectId: string, now = new Date()): Promise<boolean> {
  await (await getDatabase()).run('INSERT INTO project_owners (project_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [projectId, userId, now.toISOString()]);
  return await projectOwnerId(projectId) === userId;
}

export async function ownedProjectIds(userId: string): Promise<Set<string>> {
  const rows = await (await getDatabase()).all<{ project_id: string }>('SELECT project_id FROM project_owners WHERE user_id = ?', [userId]);
  return new Set(rows.map((row) => row.project_id));
}

export async function claimLegacyProjectsForSoleUser(userId: string, projectIds: string[]): Promise<void> {
  const userCount = Number((await (await getDatabase()).get<{ count: number | string }>('SELECT COUNT(*) AS count FROM users'))?.count ?? 0);
  if (userCount !== 1) return;
  for (const projectId of projectIds) if (!await projectOwnerId(projectId)) await claimProjectOwnership(userId, projectId);
}
