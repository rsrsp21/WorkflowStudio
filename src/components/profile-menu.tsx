'use client';

import type { AuthUser } from '@/src/auth/auth';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ProfileModal from './profile-modal';
import SignOutButton from './sign-out-button';
import UiIcon from './ui-icon';

export default function ProfileMenu({ user }: { user: AuthUser }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [displayUser, setDisplayUser] = useState(user);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    function closeOutside(event: PointerEvent) { if (menuRef.current?.open && !menuRef.current.contains(event.target as Node)) menuRef.current.removeAttribute('open'); }
    function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') menuRef.current?.removeAttribute('open'); }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, []);

  return <>
    <details className="dash-profile-menu" ref={menuRef}>
      <summary aria-label="Open account menu">
        <span className="dash-user"><strong>{displayUser.name}</strong><small>{displayUser.position}</small></span>
        <svg className="dash-profile-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>
      </summary>
      <div className="dash-profile-popover">
        <button type="button" onClick={() => { menuRef.current?.removeAttribute('open'); setProfileOpen(true); }}><UiIcon name="user" /><span>Profile</span></button>
        <SignOutButton className="dash-profile-signout"><UiIcon name="sign-out" /><span>Sign out</span></SignOutButton>
      </div>
    </details>
    {profileOpen && typeof document !== 'undefined' ? createPortal(<ProfileModal user={displayUser} onClose={() => setProfileOpen(false)} onUserUpdated={setDisplayUser} />, document.body) : null}
  </>;
}
