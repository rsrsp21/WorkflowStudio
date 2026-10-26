import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { cookies } from 'next/headers';
import ScreenTransition from '@/src/components/screen-transition';
import './globals.css';
import './dashboard.css';

const davaSans = localFont({
  src: '../../DavaSans/DavaSans-Regular.ttf',
  display: 'swap',
  variable: '--font-dava',
  weight: '400'
});

export const metadata: Metadata = {
  title: { default: 'Workflow Studio', template: '%s | Workflow Studio' },
  description: 'Design, govern, and run traceable Codex agent workflows on real projects.',
  icons: {
    icon: [{ url: '/workflow-studio-favicon.png', type: 'image/png' }],
    shortcut: '/workflow-studio-favicon.png'
  }
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const preference = (await cookies()).get('workflow-studio-theme')?.value;
  const initialTheme = preference === 'light' || preference === 'dark' ? preference : undefined;
  return <html lang="en" data-theme={initialTheme} suppressHydrationWarning><head><meta name="color-scheme" content="dark light" /></head><body className={davaSans.variable}>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <ScreenTransition />{children}
  </body></html>;
}
