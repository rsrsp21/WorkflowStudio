'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';

export default function SignOutButton({ className, children }: { className?: string; children?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.replace('/');
  }
  return <button className={className} type="button" onClick={() => void signOut()} disabled={busy}>{busy ? 'Signing out…' : children ?? 'Sign out'}</button>;
}
