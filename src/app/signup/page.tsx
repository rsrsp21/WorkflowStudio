import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/src/auth/auth';
import AuthForm from '@/src/components/auth-form';

export const metadata: Metadata = { title: 'Sign up' };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect('/studio');
  return <AuthForm mode="signup" />;
}
