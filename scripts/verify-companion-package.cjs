const fs = require('node:fs');
const path = require('node:path');
const { createHash, createPublicKey, verify } = require('node:crypto');

const supplied = process.argv.slice(2);
const packageVersion = require('../companion/package.json').version;
const defaultArchive = path.join('release', 'companion-next', `Workflow-Studio-Companion-${packageVersion}-win-x64.zip`);
const [archiveArgument, signatureArgument, publicKeyArgument] = supplied.length === 0
  ? [defaultArchive, `${defaultArchive}.sig.json`, `${defaultArchive}.public.pem`]
  : supplied;
if (!archiveArgument || !signatureArgument || !publicKeyArgument) {
  console.error('Usage: node scripts/verify-companion-package.cjs <archive.zip> <signature.json> <public.pem>');
  process.exitCode = 2;
} else {
  try {
    const archivePath = path.resolve(archiveArgument);
    const bytes = fs.readFileSync(archivePath);
    const document = JSON.parse(fs.readFileSync(path.resolve(signatureArgument), 'utf8'));
    if (document.schemaVersion !== 1 || document.algorithm !== 'Ed25519' || document.artifact !== path.basename(archivePath) || typeof document.sha256 !== 'string' || typeof document.signature !== 'string') throw new Error('Signature document is invalid.');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== document.sha256) throw new Error('Archive checksum does not match the signed checksum.');
    const publicKey = createPublicKey(fs.readFileSync(path.resolve(publicKeyArgument)));
    if (publicKey.asymmetricKeyType !== 'ed25519' || !verify(null, bytes, publicKey, Buffer.from(document.signature, 'base64'))) throw new Error('Companion signature is invalid.');
    process.stdout.write(`${JSON.stringify({ ready: true, artifact: document.artifact, sha256, algorithm: document.algorithm }, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Companion signature verification failed.');
    process.exitCode = 1;
  }
}
