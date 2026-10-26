import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
import { GET } from '@/src/app/api/runtime/companion-download/route';

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => vi.mocked(existsSync).mockReturnValue(false));
it('advertises the packaged ZIP served by this website', async () => {
  vi.stubEnv('WORKFLOW_STUDIO_COMPANION_DOWNLOAD_URL', '');
  vi.mocked(existsSync).mockImplementation((file) => !String(file).endsWith('.sig.json'));
  expect(await GET().json()).toEqual({ available: true, url: '/downloads/workflow-studio-companion.zip', checksumUrl: '/downloads/workflow-studio-companion.zip.sha256' });
});
it('does not advertise an unpublished or unsafe installer URL', async () => {
  for (const value of ['', 'file:///tmp/installer.exe', 'http://example.com/setup.exe', 'https://user:secret@example.com/setup.exe']) {
    vi.stubEnv('WORKFLOW_STUDIO_COMPANION_DOWNLOAD_URL', value);
    expect(await GET().json()).toMatchObject({ available: false });
  }
});
it('advertises the administrator-published HTTPS companion package', async () => {
  vi.stubEnv('WORKFLOW_STUDIO_COMPANION_DOWNLOAD_URL', 'https://downloads.example.com/companion.zip');
  vi.stubEnv('WORKFLOW_STUDIO_COMPANION_CHECKSUM_URL', 'https://downloads.example.com/companion.zip.sha256');
  vi.stubEnv('WORKFLOW_STUDIO_COMPANION_SIGNATURE_URL', 'https://downloads.example.com/companion.sig.json');
  vi.stubEnv('WORKFLOW_STUDIO_COMPANION_PUBLIC_KEY_URL', 'https://downloads.example.com/companion.pem');
  expect(await GET().json()).toEqual({ available: true, url: 'https://downloads.example.com/companion.zip', checksumUrl: 'https://downloads.example.com/companion.zip.sha256', signatureUrl: 'https://downloads.example.com/companion.sig.json', publicKeyUrl: 'https://downloads.example.com/companion.pem' });
});
