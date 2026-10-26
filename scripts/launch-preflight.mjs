import { existsSync } from 'node:fs';

const profile = (process.env.WORKFLOW_STUDIO_LAUNCH_PROFILE || 'demo').toLowerCase();
const errors = [];
const required = (name) => { if (!process.env[name]?.trim()) errors.push(`${name} is required.`); };
if (!['demo', 'production'].includes(profile)) errors.push('WORKFLOW_STUDIO_LAUNCH_PROFILE must be demo or production.');
if ((process.env.CODEX_RUNTIME_MODE || 'local') !== 'paired') errors.push('CODEX_RUNTIME_MODE must be paired.');
if ((process.env.WORKFLOW_STUDIO_RUNTIME_ENGINE || 'mastra') !== 'mastra') errors.push('WORKFLOW_STUDIO_RUNTIME_ENGINE must be mastra.');
if (process.env.WORKFLOW_STUDIO_ENABLE_LEGACY_ROLLBACK === 'true') errors.push('Disable legacy rollback before launch.');
required('WORKFLOW_STUDIO_COMPANION_DOWNLOAD_URL');
for (const name of ['WORKFLOW_STUDIO_COMPANION_DOWNLOAD_URL', 'WORKFLOW_STUDIO_COMPANION_CHECKSUM_URL']) {
  if (profile === 'production') required(name);
}
if (process.env.WORKFLOW_STUDIO_COMPANION_DOWNLOAD_URL) {
  try {
    const url = new URL(process.env.WORKFLOW_STUDIO_COMPANION_DOWNLOAD_URL);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) errors.push('Companion download URL must use HTTPS outside local development.');
  } catch { errors.push('Companion download URL must be valid.'); }
}

if (!process.env.DATABASE_URL) {
  for (const name of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) required(name);
}
const sslMode = (process.env.PGSSL_MODE || 'disable').toLowerCase();
if (!['disable', 'require', 'verify-ca'].includes(sslMode)) errors.push('PGSSL_MODE must be disable, require, or verify-ca.');
if (sslMode === 'verify-ca') {
  required('PGSSL_CA_FILE');
  if (process.env.PGSSL_CA_FILE && !existsSync(process.env.PGSSL_CA_FILE)) errors.push('PGSSL_CA_FILE does not exist.');
}

if (profile === 'production') {
  if (process.env.WORKFLOW_STUDIO_ENFORCE_ROLE_GATES !== 'true') errors.push('Production launch requires WORKFLOW_STUDIO_ENFORCE_ROLE_GATES=true.');
  if (process.env.WORKFLOW_STUDIO_REQUIRE_SEPARATE_REVIEWER !== 'true') errors.push('Production launch requires WORKFLOW_STUDIO_REQUIRE_SEPARATE_REVIEWER=true.');
  required('WORKFLOW_STUDIO_BOOTSTRAP_ADMIN_EMAILS');
  required('WORKFLOW_STUDIO_PUBLIC_ORIGIN');
  required('WORKFLOW_STUDIO_RELEASE_ID');
  required('WORKFLOW_STUDIO_METRICS_TOKEN');
  required('WORKFLOW_STUDIO_COMPANION_SIGNATURE_URL');
  required('WORKFLOW_STUDIO_COMPANION_PUBLIC_KEY_URL');
  if (sslMode === 'disable') errors.push('Production launch requires PostgreSQL TLS; set PGSSL_MODE=require or verify-ca.');
  if (process.env.WORKFLOW_STUDIO_METRICS_TOKEN && process.env.WORKFLOW_STUDIO_METRICS_TOKEN.trim().length < 32) errors.push('WORKFLOW_STUDIO_METRICS_TOKEN must contain at least 32 characters.');
  for (const [name, minimum, maximum] of [['WORKFLOW_STUDIO_RUN_RETENTION_DAYS', 30, 3650], ['WORKFLOW_STUDIO_JOB_RETENTION_DAYS', 7, 3650], ['WORKFLOW_STUDIO_CONNECTION_RETENTION_DAYS', 7, 3650]]) {
    const value = Number(process.env[name]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) errors.push(`${name} must be between ${minimum} and ${maximum}.`);
  }
  if (process.env.WORKFLOW_STUDIO_PUBLIC_ORIGIN && !/^https:\/\/[^/]+\/?$/i.test(process.env.WORKFLOW_STUDIO_PUBLIC_ORIGIN)) errors.push('WORKFLOW_STUDIO_PUBLIC_ORIGIN must be an HTTPS origin without a path.');
  for (const name of ['WORKFLOW_STUDIO_COMPANION_DOWNLOAD_URL', 'WORKFLOW_STUDIO_COMPANION_CHECKSUM_URL', 'WORKFLOW_STUDIO_COMPANION_SIGNATURE_URL', 'WORKFLOW_STUDIO_COMPANION_PUBLIC_KEY_URL']) {
    if (process.env[name] && !/^https:\/\/[^\s]+$/i.test(process.env[name])) errors.push(`${name} must be an HTTPS URL.`);
  }
}

const result = { profile, ready: errors.length === 0, checks: errors.length ? errors : ['Runtime pairing, Mastra, download, database, and governance settings are present.'] };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (errors.length) process.exitCode = 1;
