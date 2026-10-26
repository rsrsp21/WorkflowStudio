# Launch qualification evidence — 2026-09-10

This report records repeatable qualification evidence for the PostgreSQL-only Workflow Studio control plane and source-based companion. It proves the release candidate on an isolated local production topology. Company staging, identity, network, monitoring, security, accessibility, and managed-database recovery gates remain release-owner actions before broad production promotion.

## Qualified release

- Release ID: `qualification-schema14`
- Database schema: 14 migrations, 20 required tables, and 9 required indexes
- Runtime: Mastra
- Application: optimized Next.js standalone server
- Database: PostgreSQL 17 on `127.0.0.1:55432`
- Companion: `0.1.0` Windows x64 source ZIP with bundled Node.js 24.15.0
- Companion SHA-256: `67a343a8cd4616b400fe76530b1512e87f61f56b6d91af46ad3b3473f0d6fc60`

## Automated verification

- Full application suite: 70 files and 214 tests passed.
- Type checking, lint, optimized web build, and companion build passed.
- Production dependency audit reported zero vulnerabilities.
- Accessibility contract checks cover a keyboard skip link, native form controls, labeled inputs, and dialog semantics. This is automated coverage, not the final human accessibility audit.

## PostgreSQL and tenant scale

`npm run db:verify` returned `ready: true` for schema 14, all required relations and indexes, migration checksums, and immutable audit enforcement.

The fixture contained 1,000 users, 100 organizations, 1,000 organization memberships, 100 approved shared workflows, 1,000 personal workflows, 3,000 tenant workspace records, 999 reviewer assignments, and 100 queued runtime jobs.

A custom-format backup restored into a clean PostgreSQL database. `npm run db:compare` compared 22 tables and reported zero count or content-fingerprint mismatches. Evidence is in `release-validation/scale-fixture-v14.json` and `release-validation/restore-comparison-v14.json`.

## Multi-instance coordination

Two optimized instances sharing PostgreSQL passed 15 checks for release compatibility, session sharing, atomic one-time pairing, cross-instance heartbeat visibility, immediate revocation, and shared connection state. Evidence is in `release-validation/multi-instance-v14.json`.

This test proves shared coordination paths. Active Codex work failover through real company companions remains a staging canary exercise.

## Load and rollout gate

The organization, workflow, and run-history load test sent 1,000 requests at concurrency 50 with zero failures: p50 373 ms, p95 688 ms, and p99 2,417 ms. Evidence is in `release-validation/load-smoke-v14.json`.

`npm run qualify:rollout` passed against the exact standalone deployment shape. It verified:

- release, API, database schema, and Mastra compatibility identity;
- PostgreSQL-backed readiness;
- CSP, anti-framing, and browser security headers;
- unauthenticated metrics rejection and authenticated aggregate Prometheus output;
- published companion download, signature, and public key;
- archive SHA-256 and Ed25519 signature validity.

Evidence is in `release-validation/rollout-standalone-v14.json`.

## Required company-environment gates

1. Build the exact release commit with the company-controlled Ed25519 signing key; publish the ZIP, checksum, signature, and public key through approved HTTPS channels.
2. Run `npm run launch:check` with the production secret store, HTTPS origin, PostgreSQL TLS, role gates, separate-reviewer policy, and retention settings.
3. Repeat database verification, backup/restore, multi-instance, load, heartbeat, and rollout qualification against the company staging topology.
4. Verify managed PostgreSQL point-in-time recovery and deployment rollback using the company backup policy.
5. Connect Prometheus metrics and readiness probes to company monitoring and validate alert delivery.
6. Complete the company security, privacy, penetration, and human accessibility reviews against the final deployed origin.
7. Run a canary with organization onboarding, delegated reviewers, real companion clients, an active-run instance failure, and a rollback rehearsal before broad promotion.
