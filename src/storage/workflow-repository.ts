import type { WorkflowPlan } from '@/src/domain/models';
import { getDatabase } from './async-database';

type WorkflowRow = { id: string; user_id: string; payload: string };

export class WorkflowRepository {
  async readAll(userId: string): Promise<WorkflowPlan[]> {
    const rows = await (await getDatabase()).all<Pick<WorkflowRow, 'payload'>>('SELECT payload FROM workflows WHERE user_id = ? ORDER BY updated_at ASC', [userId]);
    return rows.flatMap((row) => { try { return [JSON.parse(row.payload) as WorkflowPlan]; } catch { return []; } });
  }

  async ownerId(id: string): Promise<string | null> {
    return (await (await getDatabase()).get<Pick<WorkflowRow, 'user_id'>>('SELECT user_id FROM workflows WHERE id = ?', [id]))?.user_id ?? null;
  }

  async upsert(userId: string, workflow: WorkflowPlan, expectedUpdatedAt?: string): Promise<boolean> {
    return await (await getDatabase()).transaction(async (db) => {
      const existing = await db.get<{ user_id: string; updated_at: string }>('SELECT user_id, updated_at FROM workflows WHERE id = ? FOR UPDATE', [workflow.id]);
      if (existing?.user_id && existing.user_id !== userId) return false;
      if (expectedUpdatedAt && (!existing || existing.updated_at !== expectedUpdatedAt)) throw new Error('Workflow changed after this editor loaded.');
      if (existing) {
        await db.run('UPDATE workflows SET payload = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?', [JSON.stringify(workflow), workflow.status, workflow.updatedAt, workflow.id, userId]);
      } else {
        await db.run('INSERT INTO workflows (id, user_id, payload, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [workflow.id, userId, JSON.stringify(workflow), workflow.status, workflow.createdAt, workflow.updatedAt]);
      }
      return true;
    });
  }

  async remove(userId: string, id: string): Promise<WorkflowPlan | null> {
    const db = await getDatabase();
    const row = await db.get<Pick<WorkflowRow, 'payload'>>('SELECT payload FROM workflows WHERE id = ? AND user_id = ?', [id, userId]);
    if (!row) return null;
    await db.run('DELETE FROM workflows WHERE id = ? AND user_id = ?', [id, userId]);
    try { return JSON.parse(row.payload) as WorkflowPlan; } catch { return null; }
  }

  async removeSkillReference(userId: string, skillId: string): Promise<string[]> {
    const workflows = await this.readAll(userId);
    const updatedIds: string[] = [];
    for (const workflow of workflows) {
      if (!workflow.nodes.some((node) => node.skillIds.includes(skillId))) continue;
      updatedIds.push(workflow.id);
      await this.upsert(userId, { ...workflow, nodes: workflow.nodes.map((node) => ({ ...node, skillIds: node.skillIds.filter((id) => id !== skillId) })), updatedAt: new Date().toISOString() });
    }
    return updatedIds;
  }
}

export async function importLegacyWorkflowsForFirstUser() { return 0; }
