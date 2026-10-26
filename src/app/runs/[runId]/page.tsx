import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageUser } from '@/src/auth/auth';
import RunSummaryPage from '@/src/components/run-summary-page';
import { RunRepository } from '@/src/storage/run-repository';

export const metadata: Metadata = { title: 'Run details' };

export default async function RunRoute({ params }: { params: Promise<{ runId: string }> }) {
  const user = await requirePageUser();
  const { runId } = await params;
  const run = await new RunRepository().read(user.id, runId);
  if (!run) notFound();
  return <RunSummaryPage run={run} />;
}
