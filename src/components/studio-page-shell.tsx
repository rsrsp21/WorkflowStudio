'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { AuthUser } from '@/src/auth/auth';
import ProfileMenu from './profile-menu';
import ProductFooter from './product-footer';

export default function StudioPageShell({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch('/api/auth/me').then((response) => response.ok ? response.json() : null).then((result) => setUser(result?.user ?? null)).catch(() => setUser(null));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return <div className="dash-app routed-page">
    <header className="dash-header">
      <Link className="dash-brand" href="/studio" aria-label="Workflow Studio dashboard"><Image src="/workflow-studio-logo.png" alt="" width={48} height={30} priority /><span><strong>Workflow Studio</strong></span></Link>
      <div className="dash-header-actions">{user && <ProfileMenu user={user} />}</div>
    </header>
    <main id="main-content" tabIndex={-1} className="dash-main routed-main">{children}</main>
    <ProductFooter />
  </div>;
}
