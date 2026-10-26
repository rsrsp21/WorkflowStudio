import type { Metadata } from 'next';
import { requirePageUser } from '@/src/auth/auth';
import WorkflowDashboard from '@/src/components/workflow-dashboard';

export const metadata: Metadata = { title: 'Studio' };

export default async function StudioPage() {
  const user = await requirePageUser();
  return <WorkflowDashboard user={user} />;
}
