'use client';

import { useEffect, useState } from 'react';

const THEME_STORAGE_KEY = 'workflow-studio-theme';

export default function LandingThemeToggle({ className }: { className?: string }) {
  const [darkMode, setDarkMode] = useState<boolean | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      setDarkMode(stored === 'dark' || ((stored === 'system' || !stored) && window.matchMedia('(prefers-color-scheme: dark)').matches));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function toggleTheme() {
    setDarkMode((current) => {
      const next = !(current ?? document.documentElement.dataset.theme === 'dark');
      document.documentElement.dataset.theme = next ? 'dark' : 'light';
      window.localStorage.setItem(THEME_STORAGE_KEY, next ? 'dark' : 'light');
      document.cookie = `${THEME_STORAGE_KEY}=${next ? 'dark' : 'light'}; Path=/; Max-Age=31536000; SameSite=Lax`;
      return next;
    });
  }

  return <button className={className} type="button" aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`} aria-pressed={Boolean(darkMode)} onClick={toggleTheme}>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {darkMode ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></> : <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />}
    </svg>
  </button>;
}
