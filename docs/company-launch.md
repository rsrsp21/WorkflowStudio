# Company demo and launch runbook

## Choose the launch profile

Use the **demo** profile when one presenter controls the server and a small number of people actively use it during a presentation. Use a local or managed PostgreSQL database. A 1,000-person audience is not the same as 1,000 simultaneous users.

Use the **production** profile for a company pilot with real user accounts. Configure PostgreSQL, paired local runtimes, managed roles, HTTPS, durable storage, monitoring, backups, and a published companion ZIP. Load-test the intended topology before promising high concurrent usage.

## Server setup

1. Install Node.js 24.15.x on the server and run `npm ci`.
2. Copy `.env.example` to `.env.local` and keep passwords in the deployment secret store.
3. For a controlled local PostgreSQL demo set:

   ```dotenv
   WORKFLOW_STUDIO_LAUNCH_PROFILE=demo
   PGHOST=127.0.0.1
   PGPORT=5432
   PGUSER=workflow_studio
   PGPASSWORD=replace-me
   PGDATABASE=workflow_studio
   PGSSL_MODE=disable
   CODEX_RUNTIME_MODE=paired
   WORKFLOW_STUDIO_RUNTIME_ENGINE=mastra
   WORKFLOW_STUDIO_ENABLE_LEGACY_ROLLBACK=false
   WORKFLOW_STUDIO_COMPANION_DOWNLOAD_URL=https://company.example/workflow-studio-companion.zip
   ```

4. For a company pilot set the production profile, PostgreSQL TLS variables, `WORKFLOW_STUDIO_ENFORCE_ROLE_GATES=true`, and `WORKFLOW_STUDIO_BOOTSTRAP_ADMIN_EMAILS` to one or more comma-separated administrator email addresses. Also set an immutable `WORKFLOW_STUDIO_RELEASE_ID`, a secret `WORKFLOW_STUDIO_METRICS_TOKEN` of at least 32 characters, the three retention periods from `.env.example`, and HTTPS URLs for the companion signature and public key.
   Also set `WORKFLOW_STUDIO_REQUIRE_SEPARATE_REVIEWER=true`. Builders retain ownership of their work; reviewers and administrators receive a review queue in Profile for draft definitions, draft assignments, and active workflow gates.
5. Start the application once to apply schema changes, then run `npm run db:check`, `npm run db:verify`, `npm run launch:check`, `npm test`, `npm run lint`, and `npm run build`.
6. Start the standalone image behind an HTTPS reverse proxy. The included Docker image runs `node server.js`; for a source checkout, copy `public` and `.next/static` into `.next/standalone` and run `node .next/standalone/server.js`. Use `/api/health` for readiness.
7. Sign up with a configured bootstrap administrator email. In **Profile and settings → User access**, assign reviewer and builder roles. Set a delegated reviewer for each account that needs independent approval; reviewers see only their assigned accounts, while administrators retain audited deployment-wide access. Use **Profile and settings → Organizations** to create explicit team memberships, accept invitations, transfer ownership, and share approved workflow definitions.

## Multi-instance qualification

Start two release-image instances against the same PostgreSQL database and different ports. Then run:

```powershell
$env:WORKFLOW_STUDIO_INSTANCE_A='https://workflow-studio-a.company.example'
$env:WORKFLOW_STUDIO_INSTANCE_B='https://workflow-studio-b.company.example'
$env:WORKFLOW_STUDIO_QUALIFICATION_REPORT='release-validation/multi-instance.json'
npm run qualify:multi-instance
```

The qualification creates a disposable test account and verifies cross-instance sessions, an atomic one-time pairing claim, shared heartbeats, shared connection visibility, and immediate revocation. Run it only against a staging or canary database because the test account and its audit history are intentionally retained.

## Companion distribution

1. Run `npm run companion:build` and `npm run companion:package`.
2. Publish the ZIP from `release/companion-next` through the approved company download channel.
3. A user downloads and extracts the ZIP, opens PowerShell in the extracted folder, and runs:

   ```powershell
   & ".\app\tools\node\node.exe" ".\start.cjs"
   ```

4. The user chooses the dedicated Workflow Studio workspace folder and completes local Codex sign-in.
5. In the deployed website they open **Profile → Local runtime**, generate a one-time pairing code, and enter it in the companion UI with the website HTTPS origin.
6. The companion must remain running while workflows inspect folders, discover selected skills, or execute Codex nodes.

## Demo verification

Prepare at least two users and prove that the same workflow and skill IDs remain isolated. Demonstrate a sequential stage, branch, exact-choice approval, revision loop, artifact preview, invalid choice, cancellation, companion disconnect/reconnect, and final export. Show the six-layer harness and support bundle on the run page.

After starting the built server, run the public readiness smoke test:

```powershell
$env:WORKFLOW_STUDIO_LOAD_URL='https://workflow-studio.company.example'
$env:WORKFLOW_STUDIO_LOAD_REQUESTS='1000'
$env:WORKFLOW_STUDIO_LOAD_CONCURRENCY='50'
$env:WORKFLOW_STUDIO_LOAD_PATHS='/api/health,/api/workflows,/api/runs?limit=25'
$env:WORKFLOW_STUDIO_LOAD_COOKIE='workflow_studio_session=REDACTED_TEST_SESSION'
$env:WORKFLOW_STUDIO_LOAD_REPORT='release-validation/load-smoke.json'
npm run load:smoke
```

Use a dedicated non-production test account/session. The report separates latency and failures for readiness, workflow-library, and run-history traffic. It does not qualify 1,000 concurrent workflow executions because each execution also depends on a separate user companion and local Codex capacity.

The current PostgreSQL scale-fixture baseline completed 1,000 organization, workflow, and run-history requests at concurrency 50 with zero failures, p50 373 ms, p95 688 ms, and p99 2,417 ms. Treat these as development-machine measurements and repeat them on the deployed infrastructure. See [launch qualification evidence](./launch-qualification-2026-09-10.md).

After the built canary is running, execute the promotion gate:

```powershell
$env:WORKFLOW_STUDIO_ROLLOUT_URL='https://workflow-studio-canary.company.example'
$env:WORKFLOW_STUDIO_EXPECTED_RELEASE_ID='release-id-from-image'
$env:WORKFLOW_STUDIO_EXPECTED_DATABASE_SCHEMA='14'
$env:WORKFLOW_STUDIO_METRICS_TOKEN='secret-from-monitoring-store'
$env:WORKFLOW_STUDIO_ROLLOUT_REPORT='release-validation/rollout.json'
npm run qualify:rollout
```

The gate fails on a release or schema mismatch, database readiness failure, missing browser security headers, exposed metrics, or an invalid companion signature.

## Go/no-go evidence

- Production build, full tests, lint, companion build, and companion packaging pass from the release commit.
- Launch preflight returns `ready: true` without printing secrets.
- Database backup and restore are rehearsed against a disposable environment.
- Tenant isolation, role changes, approval enforcement, rate limits, audit immutability, cancellation, lease reclaim, and artifact access tests pass.
- Multi-instance qualification returns `ready: true` against two instances using the same staging database.
- Readiness and administrator metrics are connected to the company monitoring system.
- The load target and p95 latency are measured on production-like infrastructure.
- A rollback version and the previous companion ZIP remain available.
- The [security threat model](./security-threat-model.md) has been reviewed against the release topology, and the signed companion passes `npm run companion:verify`.
