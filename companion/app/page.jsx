'use client';
import { useEffect, useState } from 'react';

async function api(action, body) {
  const response = await fetch(`/api/${action}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-companion-request': '1' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || 'The companion could not complete this action.');
  return result.value;
}

const labels = { setup: 'Ready to set up', ready: 'Ready to connect', 'signing-in': 'Signing in', connecting: 'Connecting', online: 'Connected', working: 'Working', reconnecting: 'Reconnecting', paused: 'Paused', error: 'Needs attention', 'sign-in-required': 'Sign-in needed' };
export default function Companion() {
  const [state, setState] = useState({ status: 'setup' });
  const [home, setHome] = useState('');
  const [server, setServer] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(null);
  const [authUrl, setAuthUrl] = useState('');
  const [stopped, setStopped] = useState(false);
  const [theme, setTheme] = useState('system');
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const stored = window.localStorage.getItem('workflow-studio-companion-theme');
    const preference = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    setTheme(preference); setThemeReady(true);
  }, []);
  useEffect(() => {
    if (!themeReady) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme; };
    window.localStorage.setItem('workflow-studio-companion-theme', theme);
    document.cookie = `workflow-studio-companion-theme=${theme}; Path=/; Max-Age=31536000; SameSite=Strict`;
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, themeReady]);
  useEffect(() => {
    if (stopped) return;
    const events = new EventSource('/api/events');
    events.addEventListener('state', (event) => { const value = JSON.parse(event.data); setState(value); if (value.home) setHome((previous) => previous || value.home); if (value.server) setServer((previous) => previous || value.server); if (value.status === 'online') setCode(''); });
    events.onopen = () => setError('');
    events.onerror = () => setError('Companion status stream is reconnecting…');
    return () => events.close();
  }, [stopped]);
  const running = ['connecting', 'online', 'working', 'reconnecting', 'sign-in-required'].includes(state.status);
  async function act(action) { setBusy(true); setError(''); try { await action(); const next = await api('state'); setState(next); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }
  const browse = (folder) => {
    const requested = folder || home;
    return act(async () => setListing(await api(`browse${requested ? `?path=${encodeURIComponent(requested)}` : ''}`)));
  };
  const select = (folder) => act(async () => { await api('folder', { home: folder }); setHome(folder); setListing(null); });
  async function signIn() {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    await act(async () => { try { const result = await api('signin', {}); setAuthUrl(result.authUrl); if (tab) tab.location.href = result.authUrl; } catch (failure) { tab?.close(); throw failure; } });
  }
  return <div className="dash-app routed-page companion-app">
    <header className="dash-header"><div className="dash-brand"><img src="/workflow-studio-logo.png" alt="" width="46" height="28" /><span><strong>Workflow Studio</strong><small>Local companion</small></span></div><div className="dash-header-actions"><select aria-label="Appearance" value={theme} onChange={(event) => setTheme(event.target.value)}><option value="system">System theme</option><option value="light">Light theme</option><option value="dark">Dark theme</option></select><div className={`status ${state.status}`}>{labels[state.status] || state.status}</div><button className="stop-companion" type="button" disabled={stopped || busy} onClick={() => { setStopped(true); void api('shutdown', {}).then(() => setError('Companion stopped. You can close this tab.')).catch((failure) => { setStopped(false); setError(failure.message); }); }}>Stop companion</button></div></header>
    <main className="dash-main routed-main">
      <div className="dash-intro intro"><div><h1>Connect your computer</h1><p>Choose a workspace folder and connect this computer to your account on Workflow Studio.</p></div></div>
      <section className="step"><div className="step-number">1</div><div className="step-content"><h2>Choose your Workflow Studio folder</h2><p>Projects, skills, agents, and your private runtime live here.</p><form onSubmit={(event) => { event.preventDefault(); void select(home); }}><div className="folder-row"><input aria-label="Workflow Studio folder" value={home} onChange={(event) => setHome(event.target.value)} placeholder="D:\WorkflowStudio" disabled={running || busy || state.status === 'signing-in'} /><button className="secondary" type="button" disabled={running || busy || state.status === 'signing-in'} onClick={() => void browse()}>Browse…</button><button type="submit" disabled={running || busy || !home || state.status === 'signing-in'}>Use folder</button></div></form><p className="hint">A new folder is created automatically. Existing project files are not moved.</p></div></section>
      <section className="step"><div className="step-number">2</div><div className="step-content"><h2>Sign in to Codex</h2><p>{state.signedIn ? `Signed in · ${state.accountLabel}` : 'Use your ChatGPT-backed Codex account. No API key needed.'}</p><div className="actions"><button className="secondary" disabled={!state.home || running || busy || state.status === 'signing-in'} onClick={() => void signIn()}>{state.signedIn ? 'Change Codex account' : 'Sign in with Codex'}</button>{state.status === 'signing-in' && <><button className="text-button" onClick={() => void act(() => api('cancel-signin', {}))}>Cancel sign-in</button>{authUrl && <a href={authUrl} target="_blank" rel="noopener noreferrer">Open sign-in tab</a>}</>}</div></div></section>
      <section className="step"><div className="step-number">3</div><div className="step-content"><h2>Enter your pairing code</h2><p>Sign in to <strong>Workflow Studio</strong> in your browser. Open <strong>Profile → Local runtime</strong> and click <strong>Generate pairing code</strong>. Copy the code shown in your profile and paste it here.</p><form onSubmit={(event) => { event.preventDefault(); void act(() => api('connect', { server, code })); }}><label htmlFor="website-address">Workflow Studio address</label><input id="website-address" type="url" placeholder="Paste the Workflow Studio website address" value={server} onChange={(event) => setServer(event.target.value)} required disabled={running || busy} /><div className="pair-row"><div><label htmlFor="pairing-code">One-time pairing code</label><input id="pairing-code" placeholder="Paste code from your website" value={code} onChange={(event) => setCode(event.target.value)} required maxLength={64} autoComplete="off" spellCheck={false} disabled={running || busy} /></div><button type="submit" disabled={busy || running || !state.signedIn}>Connect</button></div></form><p className="hint">The code expires after 10 minutes. You normally pair only once.</p>{state.paired && <div className="actions"><a className="button-link" href={state.server} target="_blank" rel="noopener noreferrer">Open Workflow Studio</a>{running ? <button className="text-button" onClick={() => void act(() => api('pause', {}))} disabled={busy}>Pause runtime</button> : <button className="secondary" disabled={busy || !state.signedIn} onClick={() => void act(() => api('resume', {}))}>Reconnect</button>}</div>}</div></section>
      <div id="message" role="status" aria-live="polite">{error || state.message || 'Open this page through start.cjs.'}</div>
      <footer><span>Keep the launcher window open. You may close this browser tab.</span></footer>
    </main>
    {listing && <div className="modal-backdrop"><section className="folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-heading"><h2 id="folder-heading">Choose a dedicated folder</h2><p className="current-folder">{listing.path}</p><div className="actions">{listing.drives.map((drive) => <button key={drive} className="secondary" onClick={() => void browse(drive)}>{drive}</button>)}{listing.parent && <button className="secondary" onClick={() => void browse(listing.parent)}>Up one folder</button>}</div><div className="folder-list">{listing.directories.map((directory) => <button key={directory.path} onClick={() => void browse(directory.path)}>{directory.name}<span>›</span></button>)}{!listing.directories.length && <p>No subfolders.</p>}</div><div className="actions"><button onClick={() => void select(`${listing.path.replace(/[\\/]$/, '')}${listing.path.includes('\\') ? '\\' : '/'}WorkflowStudio`)} disabled={busy}>Create WorkflowStudio here</button><button className="secondary" onClick={() => void select(listing.path)} disabled={busy}>Use this folder</button><button className="text-button" onClick={() => setListing(null)}>Cancel</button></div>{error && <p role="alert">{error}</p>}</section></div>}
  </div>;
}
