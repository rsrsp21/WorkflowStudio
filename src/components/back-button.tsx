import Link from 'next/link';
import type { MouseEventHandler, ReactNode } from 'react';

function Chevron() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>;
}

export default function BackButton({ children, href, onClick }: { children: ReactNode; href?: string; onClick?: MouseEventHandler<HTMLButtonElement> }) {
  return href
    ? <Link className="app-back-button" href={href}><Chevron />{children}</Link>
    : <button className="app-back-button" type="button" onClick={onClick}><Chevron />{children}</button>;
}
