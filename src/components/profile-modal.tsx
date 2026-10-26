'use client';

import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import type { AuthUser } from '@/src/auth/auth';
import UiIcon from './ui-icon';
import RuntimeConnectionPanel from './runtime-connection-panel';
import AdminUserManagement from './admin-user-management';
import ReviewQueue from './review-queue';
import OperationsOverview from './operations-overview';
import OrganizationManagement from './organization-management';

export const THEME_STORAGE_KEY = 'workflow-studio-theme';
export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; description: string; icon: 'system' | 'sun' | 'moon' }> = [
  { value: 'system', label: 'System', description: 'Follow this device', icon: 'system' },
  { value: 'light', label: 'Light', description: 'Always use light', icon: 'sun' },
  { value: 'dark', label: 'Dark', description: 'Always use dark', icon: 'moon' }
];

export function applyThemePreference(preference: ThemePreference) {
  const resolved = preference === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
  window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  document.cookie = `${THEME_STORAGE_KEY}=${preference}; Path=/; Max-Age=31536000; SameSite=Lax`;
  document.documentElement.dataset.theme = resolved;
}

function storedThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'WS';
}

function PasswordField({ id, label, value, autoComplete, onChange }: { id: string; label: string; value: string; autoComplete: string; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  return <label htmlFor={id}>{label}<span className="profile-password-field"><input id={id} type={visible ? 'text' : 'password'} value={value} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} /><button type="button" aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} onClick={() => setVisible((current) => !current)}><UiIcon name={visible ? 'eye-off' : 'eye'} /></button></span></label>;
}

export default function ProfileModal({ user, onClose, onUserUpdated }: { user: AuthUser; onClose: () => void; onUserUpdated: (user: AuthUser) => void }) {
  const [name, setName] = useState(user.name);
  const [position, setPosition] = useState(user.position);
  const [theme, setTheme] = useState<ThemePreference>(storedThemePreference);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [dataMessage, setDataMessage] = useState('');
  const [restoreBusy, setRestoreBusy] = useState(false);
  const restoreInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setProfileBusy(true); setProfileMessage('');
    try {
      const response = await fetch('/api/auth/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'profile', name, position }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.[0] || 'Profile could not be updated.');
      onUserUpdated(result.user as AuthUser);
      setProfileMessage('Profile updated.');
    } catch (error) { setProfileMessage(error instanceof Error ? error.message : 'Profile could not be updated.'); }
    finally { setProfileBusy(false); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPasswordMessage('');
    if (newPassword !== confirmPassword) { setPasswordMessage('New passwords do not match.'); return; }
    setPasswordBusy(true);
    try {
      const response = await fetch('/api/auth/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'password', currentPassword, newPassword }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.[0] || 'Password could not be changed.');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setPasswordMessage('Password changed.');
    } catch (error) { setPasswordMessage(error instanceof Error ? error.message : 'Password could not be changed.'); }
    finally { setPasswordBusy(false); }
  }

  function chooseTheme(preference: ThemePreference) { setTheme(preference); applyThemePreference(preference); }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setRestoreBusy(true); setDataMessage('');
    try {
      const response = await fetch('/api/account/backup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: await file.text() });
      const result = await response.json() as { restored?: Record<string, number>; errors?: string[] };
      if (!response.ok || !result.restored) throw new Error(result.errors?.join(' ') || 'Backup could not be restored.');
      setDataMessage(`Restored ${result.restored.workflows ?? 0} workflows and ${result.restored.runs ?? 0} runs. Refresh Studio to see them.`);
    } catch (error) { setDataMessage(error instanceof Error ? error.message : 'Backup could not be restored.'); }
    finally { setRestoreBusy(false); }
  }

  return <div className="profile-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
      <header><div className="profile-modal-avatar" aria-hidden="true">{initials(name)}</div><div><h2 id="profile-modal-title">Profile and settings</h2><p>{name} · {position}</p></div><button className="dash-icon-button" type="button" aria-label="Close profile" onClick={onClose}><UiIcon name="close" /></button></header>
      <div className="profile-modal-grid">
        <form className="profile-settings-section" onSubmit={saveProfile}>
          <div className="profile-section-heading"><UiIcon name="user" /><div><h3>Account</h3><p>Identity shown across Workflow Studio.</p></div></div>
          <label htmlFor="profile-name">Name<input id="profile-name" value={name} minLength={2} maxLength={100} onChange={(event) => setName(event.target.value)} required /></label>
          <label htmlFor="profile-email">Email<input id="profile-email" value={user.email} readOnly aria-readonly="true" /></label>
          <div className="profile-two-fields"><label htmlFor="profile-role">Role<input id="profile-role" value={user.role} readOnly aria-readonly="true" /></label><label htmlFor="profile-position">Position<input id="profile-position" value={position} minLength={2} maxLength={80} placeholder="e.g. Software Developer" onChange={(event) => setPosition(event.target.value)} required /></label></div>
          <div className="profile-form-actions"><span className="profile-form-message" role="status">{profileMessage}</span><button className="dash-button primary" type="submit" disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save profile'}</button></div>
        </form>
        <div className="profile-settings-stack">
          <OrganizationManagement />
          {(user.role === 'reviewer' || user.role === 'administrator') && <ReviewQueue />}
          {user.role === 'administrator' && <OperationsOverview />}
          {user.role === 'administrator' && <AdminUserManagement />}
          <section className="profile-settings-section">
            <div className="profile-section-heading"><UiIcon name="system" /><div><h3>Appearance</h3><p>Theme preference for this browser.</p></div></div>
            <div className="profile-theme-options" role="radiogroup" aria-label="Theme preference">{THEME_OPTIONS.map((option) => <button className={theme === option.value ? 'selected' : ''} type="button" role="radio" aria-checked={theme === option.value} key={option.value} onClick={() => chooseTheme(option.value)}><UiIcon name={option.icon} /><span><strong>{option.label}</strong><small>{option.description}</small></span></button>)}</div>
          </section>
          <RuntimeConnectionPanel />
          <section className="profile-settings-section">
            <div className="profile-section-heading"><UiIcon name="file" /><div><h3>Data and diagnostics</h3><p>Keep a portable account backup or create a redacted support bundle.</p></div></div>
            <div className="profile-data-actions"><a className="dash-button secondary" href="/api/account/backup">Download backup</a><button className="dash-button secondary" type="button" disabled={restoreBusy} onClick={() => restoreInput.current?.click()}>{restoreBusy ? 'Restoring…' : 'Restore backup'}</button><a className="dash-button secondary" href="/api/account/support-bundle">Support bundle</a></div>
            <input ref={restoreInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void restoreBackup(event)} />
            {dataMessage && <p className="profile-form-message" role="status">{dataMessage}</p>}
          </section>
          <form className="profile-settings-section" onSubmit={changePassword}>
            <div className="profile-section-heading"><UiIcon name="lock" /><div><h3>Change password</h3><p>Confirm your current password before updating it.</p></div></div>
            <PasswordField id="profile-current-password" label="Current password" value={currentPassword} autoComplete="current-password" onChange={setCurrentPassword} />
            <div className="profile-two-fields"><PasswordField id="profile-new-password" label="New password" value={newPassword} autoComplete="new-password" onChange={setNewPassword} /><PasswordField id="profile-confirm-password" label="Confirm password" value={confirmPassword} autoComplete="new-password" onChange={setConfirmPassword} /></div>
            <div className="profile-form-actions"><span className="profile-form-message" role="status">{passwordMessage}</span><button className="dash-button secondary" type="submit" disabled={passwordBusy || !currentPassword || newPassword.length < 8 || !confirmPassword}>{passwordBusy ? 'Updating…' : 'Change password'}</button></div>
          </form>
        </div>
      </div>
    </section>
  </div>;
}
