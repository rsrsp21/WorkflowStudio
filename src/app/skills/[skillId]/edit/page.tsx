import type { Metadata } from 'next';
import { requirePageUser } from '@/src/auth/auth';
import SkillEditorPage from '@/src/components/skill-editor-page';

export const metadata: Metadata = { title: 'Edit skill' };

export default async function EditSkillRoute({ params, searchParams }: { params: Promise<{ skillId: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  await requirePageUser();
  const { skillId } = await params;
  const { returnTo } = await searchParams;
  return <SkillEditorPage skillId={skillId} returnTo={returnTo ?? '/skills'} />;
}
