# Deploying Workflow Studio with user-owned Codex runtimes

For installation, local testing, pairing, reconnection, and troubleshooting instructions, see [Workflow Studio local runtime companion](./local-runtime-companion.md).

Workflow Studio has two separate identities:

- The Workflow Studio account owns workflows, saved project references, assignments, approvals, and run history. Saved project roots are isolated by user ID.
- The paired local runtime owns Codex authentication, installed Codex skill discovery, and access to local project files.

Pairing binds one local runtime connection to exactly one Workflow Studio user. The deployed application never asks for or stores an OpenAI API key. The companion uses the Codex account authenticated inside its private Workflow Studio folder.

## Architecture

```text
Browser -> deployed Workflow Studio -> user-scoped HTTPS job queue
                                         ^
                                         | outbound polling
                                         |
                              local runtime companion
                                         |
                                         v
                             Codex App Server over stdio
                                         |
                                         v
                              explicitly allowed folders
```

The local companion makes outbound HTTPS requests, so the deployed service never connects directly to a user's `localhost` and Codex App Server is never exposed to the public internet. Project inspection, folder browsing and creation, run-root validation, planning, and focused execution are all dispatched to the owning user's companion.

## Deploy the web application

The server requires PostgreSQL for relational and workspace metadata. It supports a local PostgreSQL server or a managed service such as Aiven. See database-setup.md for environment settings. Deploy it as a long-lived Node.js container or VM, not as an ephemeral serverless function.

Set `NODE_ENV=production`, `CODEX_RUNTIME_MODE=paired`, `WORKFLOW_STUDIO_RUNTIME_ENGINE=mastra`, and `WORKFLOW_STUDIO_DATA_DIR` to a durable storage path. Terminate TLS at a reverse proxy or managed load balancer. The companion refuses plain HTTP except for `localhost` development.

The repository includes a multi-stage `Dockerfile` and a local PostgreSQL `compose.yaml`. For a local container rehearsal, set `PGPASSWORD` and run `docker compose up --build`. Production may use the same image with Aiven or another managed PostgreSQL service. Use `/api/health/live` for process liveness and `/api/health` for database-backed readiness; remove an instance from traffic when readiness fails.

Historical legacy runs remain readable and executable by their recorded engine. Emergency creation of new legacy runs requires both `WORKFLOW_STUDIO_RUNTIME_ENGINE=legacy` and `WORKFLOW_STUDIO_ENABLE_LEGACY_ROLLBACK=true`; remove both rollback settings after the incident.

PostgreSQL stores runtime job leases, user sessions, workflows, assignments, runs, audit records, and workspace metadata. Keep the companion ZIP and any server-generated artifacts on durable shared storage when running multiple web instances.

Set `WORKFLOW_STUDIO_RELEASE_ID`, the retention variables, and a secret-store-backed `WORKFLOW_STUDIO_METRICS_TOKEN` in production. The monitoring system can scrape authenticated Prometheus metrics from `/api/metrics`; `/api/version` supplies canary and compatibility identity. See the [operations runbook](./operations-runbook.md).

Production companion downloads require a detached Ed25519 signature and a public key distributed through an approved HTTPS channel. Set `WORKFLOW_STUDIO_COMPANION_SIGNATURE_URL` and `WORKFLOW_STUDIO_COMPANION_PUBLIC_KEY_URL`; keep the private signing key outside the application image. Review the [security threat model](./security-threat-model.md) before promotion.

## PostgreSQL persistence

The control plane uses asynchronous pooled PostgreSQL repositories, transactions, schema migrations, tenant ownership checks, and database health reporting. Configure managed backups and rehearse restore before company rollout. Large artifact payloads may later move to object storage while PostgreSQL retains ownership, metadata, integrity hashes, and traceability records.

This storage migration does not change the local companion architecture. Each user will still pair their own computer, keep Codex authentication local, and grant access only to explicit local project roots. Only Workflow Studio control-plane persistence changes.

## Pair a user's computer

Distribute the separately packaged Workflow Studio Companion through your approved software channel. Users do not download the website source or separately install Node.js. Follow [companion distribution](./companion-distribution.md) to build and publish the Next.js companion ZIP.

Set `WORKFLOW_STUDIO_COMPANION_DOWNLOAD_URL` to the HTTPS package or company software-portal URL. The profile download button appears only when this is configured.

1. The user signs in to the deployed website and opens **Profile → Local runtime**.
2. They extract the approved ZIP, open PowerShell in its **Workflow-Studio-Companion** folder, and run `& ".\app\tools\node\node.exe" ".\start.cjs"`. They choose a dedicated folder and sign in to Codex inside its guided setup.
3. On the website, they select **Generate pairing code**.
4. In the companion, they enter the website origin, paste the code, and select **Connect**.
5. Both surfaces show connected status once authenticated heartbeats arrive.

Codes expire in ten minutes and work once. The companion stores the returned credential in the dedicated folder's `runtime/connection.json`; the server stores its hash. Keep PowerShell open; the browser tab can be closed.

## Development

`npm run dev` retains the existing direct local App Server behavior. To exercise the deployed pairing path locally, set `CODEX_RUNTIME_MODE=paired`, restart Next.js, pair against `http://localhost:3000`, and run the companion in another terminal.

## Security boundaries

- Every connection and job is tied to one Workflow Studio user ID.
- Saved project roots are returned only to their owning Workflow Studio user.
- Runtime tokens are bearer credentials and are returned only during pairing.
- Jobs can be leased, updated, and completed only by their assigned runtime connection.
- Event sequence numbers and job leases prevent duplicate completion or cross-runtime updates.
- Reviewers can access only accounts explicitly delegated by an administrator; reviewer assignment changes and review decisions are audited.
- The companion canonicalizes paths and rejects work outside the roots approved during pairing.
- Changing allowed roots requires a fresh one-time pairing rather than a heartbeat update.
- Planning receives installed-skill metadata from that user's companion instead of scanning the deployment host.
- Codex authentication remains local; Workflow Studio receives only the auth mode and an optional account label.
- Disconnecting the runtime revokes its bearer credential.

## Current packaging boundary

The companion is a separate Next.js ZIP with portable Node/npm, start.cjs, optional BAT launchers, and a plain-text setup guide. Build and package it using the companion distribution guide. Corporate application-control products may still require Node.js and the project-pinned Codex runtime to be approved.

OpenAI documents App Server as the rich-client integration for authentication, history, approvals, and streamed events. Workflow Studio uses its local `stdio` transport. OpenAI currently marks direct App Server WebSocket transport as experimental and unsupported for production, which is why this design uses an application-owned HTTPS relay instead of exposing App Server remotely.
