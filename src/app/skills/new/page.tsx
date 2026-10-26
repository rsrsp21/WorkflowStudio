import type { Metadata } from 'next';
import { requirePageUser } from '@/src/auth/auth';
import SkillEditorPage from '@/src/components/skill-editor-page';

export const metadata: Metadata = { title: 'Create skill' };

export default async function NewSkillRoute({ searchParams }: { searchParams: Promise<{ name?: string; returnTo?: string }> }) {
  await requirePageUser();
  const query = await searchParams;
  return <SkillEditorPage suggestedName={query.name ?? ''} returnTo={query.returnTo ?? '/skills'} />;
}
