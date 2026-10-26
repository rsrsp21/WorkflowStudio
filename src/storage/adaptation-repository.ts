import type { AdaptationCandidate, WorkflowRun } from '@/src/domain/runtime';
import type { AuthUser } from '@/src/auth/auth';
import { getDatabase } from './async-database';

export interface ApprovedAdaptation {
  id: string;
  scope: 'project' | 'user';
  projectId: string;
  workflowId: string;
  nodeId: string;
  sourceRunId: string;
  summary: string;
  approvedAt: string;
}

type Row = { id: string; scope: 'project' | 'user'; project_id: string; workflow_id: string; node_id: string; source_run_id: string; summary: string; approved_at: string };

function publicRecord(row: Row): ApprovedAdaptation {
  return { id: row.id, scope: row.scope, projectId: row.project_id, workflowId: row.workflow_id, nodeId: row.node_id, sourceRunId: row.source_run_id, summary: row.summary, approvedAt: row.approved_at };
}

export async function promoteApprovedAdaptation(user: AuthUser, run: WorkflowRun, candidate: AdaptationCandidate): Promise<ApprovedAdaptation | null> {
  if (candidate.status !== 'approved' || candidate.scope === 'run' || !candidate.decidedAt || !candidate.decidedBy || candidate.decidedBy.id !== user.id) return null;
  await (await getDatabase()).run(`INSERT INTO approved_adaptations (id, user_id, scope, project_id, workflow_id, node_id, source_run_id, summary, approved_at, approved_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    [candidate.id, user.id, candidate.scope, run.projectId, run.workflowId, candidate.nodeId, run.id, candidate.summary, candidate.decidedAt, JSON.stringify(candidate.decidedBy)]);
  return { id: candidate.id, scope: candidate.scope, projectId: run.projectId, workflowId: run.workflowId, nodeId: candidate.nodeId, sourceRunId: run.id, summary: candidate.summary, approvedAt: candidate.decidedAt };
}

export async function listApplicableAdaptations(userId: string, projectId: string, workflowId: string): Promise<ApprovedAdaptation[]> {
  return (await (await getDatabase()).all<Row>(`SELECT id, scope, project_id, workflow_id, node_id, source_run_id, summary, approved_at FROM approved_adaptations
    WHERE user_id = ? AND workflow_id = ? AND (scope = 'user' OR (scope = 'project' AND project_id = ?)) ORDER BY approved_at ASC`, [userId, workflowId, projectId])
    ).map(publicRecord);
}
