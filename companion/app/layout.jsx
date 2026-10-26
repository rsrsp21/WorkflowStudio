import '../studio-theme.css';
import '../styles.css';
import { cookies } from 'next/headers';
export const metadata = { title: 'Workflow Studio Companion', description: 'Connect your private local workspace.', icons: { icon: '/workflow-studio-favicon.png' } };
export default async function Layout({ children }) { const preference = (await cookies()).get('workflow-studio-companion-theme')?.value; const initialTheme = preference === 'light' || preference === 'dark' ? preference : undefined; return <html lang="en" data-theme={initialTheme} suppressHydrationWarning><head><meta name="color-scheme" content="dark light" /><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#08090a" /><meta name="theme-color" media="(prefers-color-scheme: light)" content="#f7f7f8" /></head><body>{children}</body></html>; }
