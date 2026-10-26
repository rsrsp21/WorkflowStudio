import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function run(overrides: Record<string, string | undefined>) {
  const env: NodeJS.ProcessEnv = { ...process.env, WORKFLOW_STUDIO_LAUNCH_PROFILE: 'production', CODEX_RUNTIME_MODE: 'paired', WORKFLOW_STUDIO_RUNTIME_ENGINE: 'mastra', WORKFLOW_STUDIO_ENABLE_LEGACY_ROLLBACK: 'false', WORKFLOW_STUDIO_COMPANION_DOWNLOAD_URL: 'https://downloads.example.com/companion.zip', WORKFLOW_STUDIO_COMPANION_CHECKSUM_URL: 'https://downloads.example.com/companion.zip.sha256', WORKFLOW_STUDIO_COMPANION_SIGNATURE_URL: 'https://downloads.example.com/companion.zip.sig.json', WORKFLOW_STUDIO_COMPANION_PUBLIC_KEY_URL: 'https://downloads.example.com/companion.public.pem', PGHOST: 'postgres.example.com', PGPORT: '5432', PGUSER: 'workflow_studio', PGPASSWORD: 'test-only', PGDATABASE: 'workflow_studio', PGSSL_MODE: 'require', WORKFLOW_STUDIO_ENFORCE_ROLE_GATES: 'true', WORKFLOW_STUDIO_REQUIRE_SEPARATE_REVIEWER: 'true', WORKFLOW_STUDIO_BOOTSTRAP_ADMIN_EMAILS: 'admin@example.com', WORKFLOW_STUDIO_PUBLIC_ORIGIN: 'https://workflow-studio.example.com', WORKFLOW_STUDIO_RELEASE_ID: 'release-1', WORKFLOW_STUDIO_METRICS_TOKEN: '12345678901234567890123456789012', WORKFLOW_STUDIO_RUN_RETENTION_DAYS: '90', WORKFLOW_STUDIO_JOB_RETENTION_DAYS: '30', WORKFLOW_STUDIO_CONNECTION_RETENTION_DAYS: '30', ...overrides };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  const result = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'launch-preflight.mjs')], { env, encoding: 'utf8' });
  return { status: result.status, body: JSON.parse(result.stdout) as { ready: boolean; checks: string[] } };
}

describe('production launch preflight', () => {
  it('accepts a complete production configuration', () => {
    expect(run({})).toMatchObject({ status: 0, body: { ready: true } });
  });

  it('requires release identity, protected metrics, and bounded retention', () => {
    const result = run({ WORKFLOW_STUDIO_RELEASE_ID: undefined, WORKFLOW_STUDIO_METRICS_TOKEN: 'short', WORKFLOW_STUDIO_RUN_RETENTION_DAYS: '2' });
    expect(result.status).toBe(1);
    expect(result.body.checks.join(' ')).toContain('WORKFLOW_STUDIO_RELEASE_ID is required');
    expect(result.body.checks.join(' ')).toContain('at least 32 characters');
    expect(result.body.checks.join(' ')).toContain('WORKFLOW_STUDIO_RUN_RETENTION_DAYS must be between 30 and 3650');
  });

  it('requires TLS and every companion integrity artifact in production', () => {
    const result = run({ PGSSL_MODE: 'disable', WORKFLOW_STUDIO_COMPANION_CHECKSUM_URL: undefined });
    expect(result.status).toBe(1);
    expect(result.body.checks.join(' ')).toContain('Production launch requires PostgreSQL TLS');
    expect(result.body.checks.join(' ')).toContain('WORKFLOW_STUDIO_COMPANION_CHECKSUM_URL is required');
  });
});
