import type { Metadata } from 'next';
import { requirePageUser } from '@/src/auth/auth';
import WorkflowDashboard from '@/src/components/workflow-dashboard';

export const metadata: Metadata = { title: 'Create workflow' };

export default async function CreateWorkflowPage() {
  const user = await requirePageUser();
  return <WorkflowDashboard user={user} creationPage />;
}
