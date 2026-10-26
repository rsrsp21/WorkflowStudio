import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = ''; });

describe('companion package signature verification', () => {
  it('accepts the published bytes and rejects a modified archive', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'workflow-studio-signature-'));
    const archive = path.join(directory, 'companion.zip');
    const signatureFile = path.join(directory, 'companion.zip.sig.json');
    const publicKeyFile = path.join(directory, 'companion.public.pem');
    const bytes = Buffer.from('qualification companion archive');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    await writeFile(archive, bytes);
    await writeFile(publicKeyFile, publicKey.export({ type: 'spki', format: 'pem' }));
    await writeFile(signatureFile, JSON.stringify({ schemaVersion: 1, algorithm: 'Ed25519', artifact: path.basename(archive), sha256: createHash('sha256').update(bytes).digest('hex'), signature: sign(null, bytes, privateKey).toString('base64') }));
    const verify = () => spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'verify-companion-package.cjs'), archive, signatureFile, publicKeyFile], { encoding: 'utf8' });
    expect(verify()).toMatchObject({ status: 0 });
    await writeFile(archive, Buffer.concat([bytes, Buffer.from('tampered')]));
    const tampered = verify();
    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toContain('checksum does not match');
  });
});
