'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RuntimeConnection, RuntimePairing } from '@/src/domain/runtime-connection';
import UiIcon from './ui-icon';

type RuntimeResponse = { connections?: RuntimeConnection[]; mode?: 'local' | 'paired'; errors?: string[] };

export default function RuntimeConnectionPanel() {
  const [connections, setConnections] = useState<RuntimeConnection[]>([]);
  const [pairing, setPairing] = useState<RuntimePairing | null>(null);
  const [download, setDownload] = useState<{ available: boolean; url?: string; message?: string }>({ available: false });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/runtime/connections', { cache: 'no-store' });
    const result = await response.json() as RuntimeResponse;
    if (!response.ok) throw new Error(result.errors?.[0] || 'Runtime status is unavailable.');
    setConnections(result.connections ?? []);
  }, []);

  useEffect(() => {
    void fetch('/api/runtime/companion-download').then((response) => response.json()).then(setDownload).catch(() => setDownload({ available: false, message: 'The companion download is unavailable. Contact your administrator.' }));
    const events = new EventSource('/api/runtime/connections/events');
    let offlineTimer: number | undefined;
    events.addEventListener('update', (event) => { const result = JSON.parse((event as MessageEvent).data) as RuntimeResponse; const next = result.connections ?? []; setConnections(next); if (offlineTimer) window.clearTimeout(offlineTimer); if (next.some((connection) => connection.status === 'online')) offlineTimer = window.setTimeout(() => setConnections((current) => current.map((connection) => connection.status === 'online' ? { ...connection, status: 'offline' } : connection)), 46_000); });
    events.onerror = () => setMessage('Runtime status stream is reconnecting…');
    return () => { if (offlineTimer) window.clearTimeout(offlineTimer); events.close(); };
  }, [refresh]);

  const active = connections.find((connection) => connection.status === 'online' && connection.authMode === 'chatgpt')
    ?? connections.find((connection) => connection.status !== 'revoked');
  async function createPairing() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/runtime/connections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'My local Codex runtime' }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.[0] || 'Pairing could not start.');
      setPairing(result.pairing as RuntimePairing);
      setMessage('Paste this code into Workflow Studio Companion. It expires in 10 minutes.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Pairing could not start.'); }
    finally { setBusy(false); }
  }

  async function disconnect(connectionId: string) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/runtime/connections?id=${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.[0] || 'Runtime could not be disconnected.');
      setPairing(null); setMessage('Local runtime disconnected.'); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Runtime could not be disconnected.'); }
    finally { setBusy(false); }
  }

  async function copyCode() {
    if (!pairing) return;
    try { await navigator.clipboard.writeText(pairing.pairingCode); setMessage('Pairing code copied.'); }
    catch { setMessage('Select and copy the pairing code shown above.'); }
  }

  return <section className="profile-settings-section runtime-connection-panel">
    <div className="profile-section-heading"><UiIcon name="link" /><div><h3>Local runtime</h3><p>Connect a private runtime inside your Workflow Studio folder.</p></div></div>
    <div className="runtime-companion-setup">
      <p>Extract the ZIP, open PowerShell inside the Workflow-Studio-Companion folder, and run <code>&amp; &quot;.\app\tools\node\node.exe&quot; &quot;.\start.cjs&quot;</code>. First-time setup runs automatically. Choose your folder, sign in to Codex, and enter the pairing code there.</p>
      {download.available && download.url ? <a className="dash-button secondary" href={download.url} target="_blank" rel="noopener noreferrer">Download companion for Windows</a> : <p>{download.message || 'Ask your administrator for the Workflow Studio Companion package.'}</p>}
      <small>Keep PowerShell open while using workflows. BAT launchers are optional.</small>
    </div>
    {active && active.status !== 'pairing' ? <div className={`runtime-connection-state ${active.status}`}>
      <span aria-hidden="true" /><div><strong>{active.status === 'online' && active.authMode === 'chatgpt' ? 'Connected to your Codex' : active.status === 'online' ? 'Codex sign-in needed' : 'Runtime offline'}</strong><small>{active.hostname || active.name}{active.codexAccountLabel ? ` · ${active.codexAccountLabel}` : ''}</small></div>
      <button className="danger-text" type="button" disabled={busy} onClick={() => void disconnect(active.id)}>Disconnect</button>
    </div> : <>
      <p>Open the companion, choose a dedicated folder, and sign in. Then generate a code here.</p>
      <button className="dash-button secondary runtime-pair-button" type="button" disabled={busy} onClick={() => void createPairing()}><UiIcon name="link" />{busy ? 'Preparing…' : 'Generate pairing code'}</button>
    </>}
    {pairing && <div className="runtime-pairing-command"><div><span>One-time pairing code</span><strong>{pairing.pairingCode}</strong></div><p>In the companion, enter this website address and paste the code:</p><code>{typeof window !== 'undefined' ? window.location.origin : ''}</code><button className="dash-button secondary" type="button" onClick={() => void copyCode()}><UiIcon name="copy" />Copy pairing code</button></div>}
    <p className="runtime-privacy-note"><UiIcon name="lock" />No OpenAI API key is collected. Global Codex skills and agents are not imported. Codex authentication stays in the private local runtime and tasks are tied to this Workflow Studio account.</p>
    <span className="profile-form-message" role="status">{message}</span>
  </section>;
}
