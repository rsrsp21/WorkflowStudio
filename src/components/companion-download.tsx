'use client';

import { useEffect, useState } from 'react';
import styles from './companion-download.module.css';

export default function CompanionDownload() {
  const [download, setDownload] = useState<{ available: boolean; url?: string; checksumUrl?: string; signatureUrl?: string; publicKeyUrl?: string; message?: string }>({ available: false });
  useEffect(() => {
    let active = true;
    void fetch('/api/runtime/companion-download').then((response) => response.json()).then((value) => { if (active) setDownload(value); }).catch(() => { if (active) setDownload({ available: false, message: 'Download unavailable. Please contact your administrator.' }); });
    return () => { active = false; };
  }, []);
  return <div className={styles.root}>
    {download.available && download.url ? <a className={styles.button} href={download.url} download>Download companion</a> : <button className={styles.button} disabled>Download companion</button>}
    <details className={styles.help}><summary>Setup guide</summary><div className={styles.instructions}>
      <strong>Connect your computer</strong>
      <ol>
        <li>Download and extract the Windows ZIP.</li>
        <li>Open PowerShell inside the extracted <b>Workflow-Studio-Companion</b> folder.</li>
        <li>Run <code>&amp; &quot;.\app\tools\node\node.exe&quot; &quot;.\start.cjs&quot;</code>. It installs and builds automatically on the first run.</li>
        <li>In the companion, choose a workspace folder and click <b>Sign in with Codex</b>.</li>
        <li>Sign into Workflow Studio. Open your account menu → <b>Profile → Local runtime → Generate pairing code</b>.</li>
        <li>Enter this website’s address and the code in the companion, then click <b>Connect</b>.</li>
      </ol>
      <p>Keep PowerShell open while running workflows. Later launches use the same one command and skip completed setup. Use the red <b>Stop companion</b> button to stop. BAT files are optional.</p>
      {download.checksumUrl && <p><a href={download.checksumUrl}>Checksum</a>{download.signatureUrl && <> · <a href={download.signatureUrl}>Signature</a></>}{download.publicKeyUrl && <> · <a href={download.publicKeyUrl}>Public key</a></>}</p>}
      {!download.available && download.message && <p role="status">{download.message}</p>}
    </div></details>
  </div>;
}
