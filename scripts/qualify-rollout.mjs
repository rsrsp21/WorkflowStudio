import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = (process.env.WORKFLOW_STUDIO_ROLLOUT_URL || '').replace(/\/$/, '');
const expectedReleaseId = process.env.WORKFLOW_STUDIO_EXPECTED_RELEASE_ID || '';
const expectedDatabaseSchema = Number(process.env.WORKFLOW_STUDIO_EXPECTED_DATABASE_SCHEMA || 0);
const metricsToken = process.env.WORKFLOW_STUDIO_METRICS_TOKEN || '';
const reportPath = process.env.WORKFLOW_STUDIO_ROLLOUT_REPORT;
const failures = [];
const checks = [];

function pass(message) { checks.push(message); }
function fail(message) { failures.push(message); }
async function get(url, init) { return await fetch(new URL(url, `${baseUrl}/`), { redirect: 'error', ...init }); }
async function json(response, label) {
  try { return await response.json(); }
  catch { fail(`${label} did not return JSON.`); return {}; }
}

if (!baseUrl) fail('WORKFLOW_STUDIO_ROLLOUT_URL is required.');
else {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) fail('Rollout URL must use HTTPS outside localhost qualification.');
  } catch { fail('WORKFLOW_STUDIO_ROLLOUT_URL is invalid.'); }
}
if (!expectedReleaseId) fail('WORKFLOW_STUDIO_EXPECTED_RELEASE_ID is required.');
if (!Number.isInteger(expectedDatabaseSchema) || expectedDatabaseSchema < 1) fail('WORKFLOW_STUDIO_EXPECTED_DATABASE_SCHEMA must be a positive integer.');
if (metricsToken.length < 32) fail('WORKFLOW_STUDIO_METRICS_TOKEN must contain at least 32 characters.');

if (!failures.length) {
  try {
    const [versionResponse, healthResponse, homeResponse, anonymousMetrics, downloadResponse] = await Promise.all([
      get('/api/version'), get('/api/health'), get('/'), get('/api/metrics'), get('/api/runtime/companion-download')
    ]);
    const version = await json(versionResponse, 'Version endpoint');
    const health = await json(healthResponse, 'Health endpoint');
    const download = await json(downloadResponse, 'Companion download endpoint');
    if (versionResponse.ok && version.releaseId === expectedReleaseId && version.databaseSchemaVersion === expectedDatabaseSchema && version.runtimeEngine === 'mastra') pass('Release, database schema, and Mastra runtime identity match the promotion target.');
    else fail('Release compatibility manifest does not match the promotion target.');
    if (healthResponse.ok && health.status === 'ready' && health.database?.provider === 'postgres' && health.database?.migrationCount === expectedDatabaseSchema) pass('PostgreSQL-backed readiness matches the expected schema.');
    else fail('Database-backed readiness failed or reported an unexpected schema.');
    const expectedHeaders = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin', 'cross-origin-opener-policy': 'same-origin' };
    const missingHeaders = Object.entries(expectedHeaders).filter(([name, value]) => homeResponse.headers.get(name) !== value).map(([name]) => name);
    if (!missingHeaders.length && homeResponse.headers.get('content-security-policy')?.includes("frame-ancestors 'none'")) pass('Browser security headers and anti-framing policy are active.');
    else fail(`Security headers are missing or invalid: ${missingHeaders.join(', ') || 'content-security-policy'}.`);
    if (anonymousMetrics.status === 401) pass('Prometheus metrics reject unauthenticated requests.');
    else fail('Prometheus metrics did not reject an unauthenticated request.');
    const metricsResponse = await get('/api/metrics', { headers: { authorization: `Bearer ${metricsToken}` } });
    const metrics = await metricsResponse.text();
    if (metricsResponse.ok && metrics.includes('workflow_studio_database_probe_milliseconds') && !metrics.includes(metricsToken)) pass('Authenticated aggregate Prometheus metrics are available without token disclosure.');
    else fail('Authenticated Prometheus metrics qualification failed.');
    if (!downloadResponse.ok || !download.available || !download.url || !download.checksumUrl || !download.signatureUrl || !download.publicKeyUrl) fail('Companion download, checksum, signature, and public key are not all published.');
    else {
      const [archiveResponse, checksumResponse, signatureResponse, publicKeyResponse] = await Promise.all([get(download.url), get(download.checksumUrl), get(download.signatureUrl), get(download.publicKeyUrl)]);
      if (!archiveResponse.ok || !checksumResponse.ok || !signatureResponse.ok || !publicKeyResponse.ok) fail('One or more companion integrity artifacts could not be downloaded.');
      else {
        const archive = Buffer.from(await archiveResponse.arrayBuffer());
        const checksum = (await checksumResponse.text()).trim().split(/\s+/)[0]?.toLowerCase();
        const signature = await signatureResponse.json();
        const publicKey = createPublicKey(await publicKeyResponse.text());
        const hash = createHash('sha256').update(archive).digest('hex');
        const valid = checksum === hash && signature.schemaVersion === 1 && signature.algorithm === 'Ed25519' && signature.sha256 === hash && publicKey.asymmetricKeyType === 'ed25519' && verify(null, archive, publicKey, Buffer.from(signature.signature, 'base64'));
        if (valid) pass(`Published companion signature is valid (${hash}).`); else fail('Published companion signature verification failed.');
      }
    }
  } catch (error) { fail(error instanceof Error ? error.message : 'Rollout qualification failed unexpectedly.'); }
}

const report = { ready: failures.length === 0, checkedAt: new Date().toISOString(), baseUrl, expectedReleaseId, expectedDatabaseSchema, checks, failures };
const output = `${JSON.stringify(report, null, 2)}\n`;
process.stdout.write(output);
if (reportPath) { const absolute = path.resolve(reportPath); await mkdir(path.dirname(absolute), { recursive: true }); await writeFile(absolute, output); }
if (failures.length) process.exitCode = 1;
