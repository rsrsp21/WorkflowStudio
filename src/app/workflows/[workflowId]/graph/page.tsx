import type { Metadata } from 'next';
import { requirePageUser } from '@/src/auth/auth';
import WorkflowGraphPage from '@/src/components/workflow-graph-page';

export const metadata: Metadata = { title: 'Workflow graph' };

export default async function GraphRoute({ params, searchParams }: { params: Promise<{ workflowId: string }>; searchParams: Promise<{ assignmentId?: string }> }) {
  await requirePageUser();
  const { workflowId } = await params;
  const { assignmentId } = await searchParams;
  return <WorkflowGraphPage workflowId={workflowId} assignmentId={assignmentId} />;
}
