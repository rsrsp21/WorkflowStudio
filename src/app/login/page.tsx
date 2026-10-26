import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/src/auth/auth';
import AuthForm from '@/src/components/auth-form';

export const metadata: Metadata = { title: 'Log in' };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/studio');
  return <AuthForm mode="login" />;
}
