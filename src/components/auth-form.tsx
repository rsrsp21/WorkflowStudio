'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import styles from '@/src/app/auth.module.css';
import LandingThemeToggle from './landing-theme-toggle';
import { BRAND_TRANSITION_EVENT } from './screen-transition';

export default function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const isSignup = mode === 'signup';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.[0] ?? 'Authentication failed.');
      const requested = searchParams.get('next');
      if (mode === 'login') window.dispatchEvent(new Event(BRAND_TRANSITION_EVENT));
      router.replace(requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/studio');
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Authentication failed.'); }
    finally { setBusy(false); }
  }

  return <div className={styles.shell}>
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="Workflow Studio landing page"><Image src="/workflow-studio-logo.png" alt="" width={64} height={34} priority /><span><strong>Workflow Studio</strong></span></Link>
      <nav aria-label="Public navigation"><Link href="/#capabilities">Capabilities</Link><Link href="/#how-it-works">How it works</Link><Link className={styles.loginLink} href="/login">Log in</Link><LandingThemeToggle className={styles.themeToggle} /></nav>
    </header>
    <main id="main-content" tabIndex={-1} className={styles.page}>
      <section className={styles.intro}>
        <h1>{isSignup ? 'Build agent workflows with control from day one.' : 'Return to work you can see, shape, and trust.'}</h1>
        <p>Plan reusable agent systems, inspect every path, bind them to real projects, and keep human approval where it matters.</p>
        <ul><li>Visible workflow graphs</li><li>Scoped project access</li><li>Traceable execution and recovery</li></ul>
      </section>
      <section className={styles.card}>
        <div><h2>{isSignup ? 'Create your account' : 'Welcome back'}</h2><p>{isSignup ? 'Start designing governed agent workflows.' : 'Sign in to open your workflow studio.'}</p></div>
        <form onSubmit={submit}>
          {isSignup && <label>Name<input name="name" autoComplete="name" minLength={2} placeholder="e.g. Alex Morgan" required /></label>}
          <label>Email<input name="email" type="email" autoComplete="email" placeholder="you@company.com" required /></label>
          <label>Password<span className={styles.passwordField}><input name="password" type={showPassword ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} minLength={8} placeholder={isSignup ? 'At least 8 characters' : 'Enter your password'} required /><button className={styles.passwordToggle} type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}><svg viewBox="0 0 24 24" aria-hidden="true">{showPassword ? <><path d="M3 3l18 18" /><path d="M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.2A10.9 10.9 0 0 1 12 4c6.5 0 10 8 10 8a18.7 18.7 0 0 1-2.1 3.2M6.2 6.2C3.5 8 2 12 2 12s3.5 8 10 8a9.8 9.8 0 0 0 4.1-.9" /></> : <><path d="M2 12s3.5-8 10-8 10 8 10 8-3.5 8-10 8S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>}</svg></button></span></label>
          {isSignup && <input type="hidden" name="role" value="builder" />}
          {isSignup && <label>Position<input name="position" autoComplete="organization-title" minLength={2} maxLength={80} placeholder="e.g. Software Developer" required /></label>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}</button>
        </form>
        <p className={styles.switch}>{isSignup ? 'Already have an account?' : 'New to Workflow Studio?'} <Link href={isSignup ? '/login' : '/signup'}>{isSignup ? 'Sign in' : 'Create account'}</Link></p>
      </section>
    </main>
    <footer className={styles.footer}><Link className={styles.footerBrand} href="/">Workflow Studio</Link><p>© Workflow Studio. All Rights Reserved.</p></footer>
  </div>;
}
