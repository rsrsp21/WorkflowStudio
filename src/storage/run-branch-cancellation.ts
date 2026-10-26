import { getDatabase } from './async-database';
import type { WorkflowRun } from '@/src/domain/runtime';
import { cancelRuntimeJob } from './runtime-connection-repository';

export async function cancelObsoleteBranchJobs(run: WorkflowRun) {
  const stopped = new Set(run.nodeRuns.filter((node) => node.status === 'skipped' || run.status === 'failed' || run.status === 'cancelled').map((node) => node.nodeId));
  if (!stopped.size) return;
  const jobs = await (await getDatabase()).all<{ id: string; node_id: string }>("SELECT id, node_id FROM runtime_jobs WHERE user_id = ? AND run_id = ? AND status IN ('queued', 'leased')", [run.userId, run.id]);
  for (const job of jobs) if (stopped.has(job.node_id)) await cancelRuntimeJob(run.userId, job.id);
}
