import { NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

export function GET() {
  const configured = process.env.WORKFLOW_STUDIO_COMPANION_DOWNLOAD_URL;
  if (!configured) {
    if (existsSync(path.join(process.cwd(), 'public', 'downloads', 'workflow-studio-companion.zip'))) return NextResponse.json({ available: true, url: '/downloads/workflow-studio-companion.zip', checksumUrl: '/downloads/workflow-studio-companion.zip.sha256', ...(existsSync(path.join(process.cwd(), 'public', 'downloads', 'workflow-studio-companion.zip.sig.json')) ? { signatureUrl: '/downloads/workflow-studio-companion.zip.sig.json', publicKeyUrl: '/downloads/workflow-studio-companion.public.pem' } : {}) });
    return NextResponse.json({ available: false, message: 'Your administrator has not published the companion download yet.' });
  }
  try {
    const url = new URL(configured);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password) throw new Error('Invalid download URL');
    const integrityUrl = (name: string) => { const value = process.env[name]; if (!value) return undefined; try { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : undefined; } catch { return undefined; } };
    return NextResponse.json({ available: true, url: url.href, checksumUrl: integrityUrl('WORKFLOW_STUDIO_COMPANION_CHECKSUM_URL'), signatureUrl: integrityUrl('WORKFLOW_STUDIO_COMPANION_SIGNATURE_URL'), publicKeyUrl: integrityUrl('WORKFLOW_STUDIO_COMPANION_PUBLIC_KEY_URL') });
  } catch { return NextResponse.json({ available: false, message: 'Ask your administrator to configure a valid HTTPS companion download.' }); }
}
