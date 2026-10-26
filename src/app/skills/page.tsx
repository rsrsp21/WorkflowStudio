import type { Metadata } from 'next';
import { requirePageUser } from '@/src/auth/auth';
import SkillsPage from '@/src/components/skills-page';

export const metadata: Metadata = { title: 'Skills' };

export default async function SkillsRoute() {
  await requirePageUser();
  return <SkillsPage />;
}
