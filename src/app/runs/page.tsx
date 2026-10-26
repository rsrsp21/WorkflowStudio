import type { Metadata } from 'next';
import { requirePageUser } from '@/src/auth/auth';
import RunHistoryPage from '@/src/components/run-history-page';
import { RunRepository } from '@/src/storage/run-repository';
import { WorkflowRepository } from '@/src/storage/workflow-repository';

export const metadata: Metadata = { title: 'Runs and monitoring' };

export default async function RunsPage() {
  const user = await requirePageUser();
  const repository = new RunRepository();
  const runs = await repository.readPage(user.id, 50, 0);
  const workflowNames = Object.fromEntries((await new WorkflowRepository().readAll(user.id)).map((workflow) => [workflow.id, workflow.name]));
  return <RunHistoryPage initialRuns={runs} initialTotal={await repository.count(user.id)} workflowNames={workflowNames} />;
}
