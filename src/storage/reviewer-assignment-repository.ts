import { getDatabase } from './async-database';

export interface ReviewerAssignment {
  ownerUserId: string;
  reviewerUserId: string;
  assignedBy: string;
  createdAt: string;
}

type AssignmentRow = { owner_user_id: string; reviewer_user_id: string; assigned_by: string; created_at: string };

function publicAssignment(row: AssignmentRow): ReviewerAssignment {
  return { ownerUserId: row.owner_user_id, reviewerUserId: row.reviewer_user_id, assignedBy: row.assigned_by, createdAt: row.created_at };
}

export class ReviewerAssignmentRepository {
  async list() {
    const rows = await (await getDatabase()).all<AssignmentRow>('SELECT owner_user_id, reviewer_user_id, assigned_by, created_at FROM reviewer_assignments ORDER BY created_at DESC');
    return rows.map(publicAssignment);
  }

  async ownerIdsForReviewer(reviewerUserId: string) {
    const rows = await (await getDatabase()).all<{ owner_user_id: string }>('SELECT owner_user_id FROM reviewer_assignments WHERE reviewer_user_id = ? ORDER BY owner_user_id', [reviewerUserId]);
    return rows.map((row) => row.owner_user_id);
  }

  async canReview(reviewerUserId: string, ownerUserId: string) {
    return Boolean(await (await getDatabase()).get('SELECT owner_user_id FROM reviewer_assignments WHERE reviewer_user_id = ? AND owner_user_id = ?', [reviewerUserId, ownerUserId]));
  }

  async assign(ownerUserId: string, reviewerUserId: string, assignedBy: string) {
    if (ownerUserId === reviewerUserId) throw new Error('A reviewer cannot be assigned to review their own account.');
    const createdAt = new Date().toISOString();
    await (await getDatabase()).run('INSERT INTO reviewer_assignments (owner_user_id, reviewer_user_id, assigned_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_user_id, reviewer_user_id) DO UPDATE SET assigned_by = excluded.assigned_by, created_at = excluded.created_at', [ownerUserId, reviewerUserId, assignedBy, createdAt]);
    return { ownerUserId, reviewerUserId, assignedBy, createdAt } satisfies ReviewerAssignment;
  }

  async remove(ownerUserId: string, reviewerUserId: string) {
    return (await (await getDatabase()).run('DELETE FROM reviewer_assignments WHERE owner_user_id = ? AND reviewer_user_id = ?', [ownerUserId, reviewerUserId])).changes > 0;
  }
}
