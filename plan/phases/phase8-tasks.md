# Phase 8 Tasks: Scale, Collaboration, and Managed Distribution

**Current status:** The requested launch baseline is implemented and locally qualified: PostgreSQL schema 14, 1,000-user tenancy, two-instance shared coordination, organizations and approved workflow sharing, enforced product and organization roles, signed source-companion packaging, protected Prometheus metrics, retention, backup/restore, load, and a repeatable rollout promotion gate. Company staging exercises and the explicitly deferred parallel-join and managed-integration expansions remain below.

**Dependency:** Phase 6 must remain green throughout migration and rollout.

## P8-T01 — PostgreSQL schema and repository boundary

**Status:** Implemented and locally qualified. PostgreSQL uses asynchronous pooled repositories, transactional run/workflow updates, optimistic workflow concurrency, append-only run events, indexed tenant and organization keys, immutable audit records, and schema verification. The 1,000-user fixture and restored copy both passed schema and ownership checks.

- Use repository interfaces and transactional PostgreSQL implementations.
- Model users, sessions, organizations, memberships, workflows, skills, projects, assignments, runs, events, artifacts, approvals, runtime connections, jobs, audit, and schema versions.
- Add constraints, indexes, optimistic concurrency, tenant keys, and immutable audit protections.

**Done when:** The application passes its existing contract suite against PostgreSQL without bypassing ownership, append-only history, or idempotency rules.

## P8-T02 — Migration, backup, restore, and rollback

**Status:** Locally qualified. A 1,000-user PostgreSQL fixture has been backed up, restored into a clean PostgreSQL 17 database, schema-verified, and compared across 22 tables with zero row-count or content-fingerprint mismatches. Managed-service point-in-time recovery and deployment rollback remain company-environment gates.

- Verify PostgreSQL schema migrations with checksums, counts, ownership validation, and quarantine reporting.
- Rehearse backup, point-in-time restore, migration interruption, rollback, and forward recovery.
- Keep the original local data read-only until post-migration verification is approved.

**Done when:** A production-sized fixture migrates and rolls back without missing, duplicated, cross-owned, or corrupted records.

## P8-T03 — Multi-instance runtime coordination

**Status:** Implemented and locally qualified. Job attempt idempotency, lease renewal/reclaim, fencing tokens, stale completion rejection, and shared run locks are implemented. Two optimized instances sharing PostgreSQL passed release compatibility, cross-instance session, atomic pairing, heartbeat visibility, connection visibility, and revocation checks. Active Codex work failover through real companions remains a company canary gate.

- Move sessions, pairing state, job queues, leases, heartbeats, approvals, event ordering, and cancellation coordination to shared infrastructure.
- Add atomic claim/complete operations, fencing tokens, lease renewal, dead-worker recovery, backpressure, and rate limits.
- Prove duplicate and out-of-order requests remain idempotent across instances.

**Done when:** Multiple web instances can fail over during active runs without duplicate Codex work or lost decisions.

## P8-T04 — Organizations and shared ownership

**Status:** Implemented for the launch scope. Personal projects, definitions, assignments, skills, runs, and companions remain isolated. Organizations support invitations, membership roles, removal, protected ownership, atomic owner transfer, and read-only sharing of owner-approved workflow definitions. Personal project, run, companion, and editable workflow ownership never transfer implicitly.

- Add organizations, invitations, membership lifecycle, organization projects, shared workflow/skill libraries, and transfer rules.
- Preserve personal workspaces and require explicit copy or transfer into an organization.
- Enforce tenant isolation in repositories, APIs, exports, search, jobs, logs, audit, and backups.

**Done when:** Cross-tenant access tests fail closed and retained history remains understandable after membership or ownership changes.

## P8-T05 — RBAC and separation of duties

**Status:** Implemented for the launch scope. Product roles are server-managed, bootstrap administrators can manage paginated users, self-promotion is blocked, changes are audited, reviewer gates are enforced, and explicit reviewer assignments scope queues and artifact access. Organization owner, administrator, reviewer, and member roles authorize membership and approved-library actions server-side.

- Define builder, reviewer, and administrator permissions for creation, publishing, assignment, execution, approval, export, retention, policy, and membership actions.
- Support policies that prohibit self-approval or require a second reviewer for selected gates and destructive actions.
- Add permission previews, denied-action explanations, delegated review queues, and immutable policy decisions.

**Done when:** Roles affect authorization rather than presentation, and privilege-escalation/stale-approval tests pass.

## P8-T06 — Parallel graph execution and joins

**Status:** Implemented on 2026-10-26 with Phase 9. Explicit fork/join, all/quorum, fail-fast/collect-all, per-node read-only sandboxing, 1–10 concurrency, deterministic merges, global human/input barriers, branch cancellation and durable active-attempt resumption are implemented. Project writers are exclusive, so full-workspace concurrent writes cannot conflict. See [the implementation report](./phase9-implementation-report.md) and [configuration guide](../../docs/runtime-reliability-and-parallel.md).

- Add explicit fork, parallel branch, join, quorum, fail-fast, and collect-all semantics.
- Isolate branch state, merge typed outputs deterministically, enforce concurrency budgets, and detect write conflicts.
- Implement branch cancellation, partial retry, approval waits, timeouts, and recovery after coordinator failure.

**Done when:** Fan-out/fan-in workflows produce deterministic results without duplicate nodes, lost outputs, or unsafe concurrent file changes.

## P8-T07 — Signed companion distribution and updates

**Status:** Implemented for the user-approved Windows source-distribution boundary. Packaging emits a portable Node.js 24.15.0 source ZIP, SHA-256 checksum, Ed25519 detached signature, and public key. Runtime version negotiation, health, revocation, explicit workspace roots, manual upgrade, rollback, and removal are documented. Company signing-key custody and allowlisting remain release-owner gates; an EXE, Electron wrapper, installer, service, tray process, and automatic updater are intentionally outside the approved design.

- Package a signed cross-platform companion or desktop wrapper around the existing protocol.
- Add secure credential storage, service/tray lifecycle, version negotiation, update channels, signature verification, health reporting, and rollback.
- Document enterprise allowlisting, proxy support, offline behavior, and uninstall/revocation.

**Done when:** Supported platforms install, pair, update, roll back, and uninstall without exposing Codex credentials or project folders.

## P8-T08 — Managed integrations and secret governance

**Status:** Deferred expansion. The launch scope blocks runs with undeclared or unavailable credentials and does not expose a general-purpose managed connector secret store.

- Add an integration contract for outbound webhooks, apps, and tools with encrypted credentials and per-project scopes.
- Require approval for sensitive connector actions and bind every request to tenant, user, run, node, purpose, and expiry.
- Redact integration secrets from prompts, events, exports, support bundles, and audit details.

**Done when:** Connector failures, revocation, rotation, retries, replay attacks, and cross-tenant secret access fail safely.

## P8-T09 — Production operations, performance, and security

**Status:** Implemented and locally qualified for release handoff. Readiness/liveness, protected Prometheus aggregates, database-backed rate limits, security headers, release identity, threat model, retention enforcement, dependency review, automated accessibility contracts, 1,000-request load, two-instance coordination, backup/restore, and signed-artifact rollout checks pass. Company alert delivery, human accessibility review, penetration testing, managed point-in-time recovery, and production-topology load remain promotion gates.

- Add service-level metrics, tracing, alerting, queue dashboards, database health, capacity limits, and incident runbooks.
- Load-test large organizations, libraries, graphs, histories, concurrent runs, reconnect storms, and parallel execution.
- Complete threat modeling, dependency review, penetration testing, accessibility audit, retention enforcement, and disaster-recovery exercises.

**Done when:** Agreed latency, throughput, recovery, accessibility, security, and data-protection gates pass under production-like load.

## P8-T10 — End-to-end rollout and rollback qualification

**Status:** Repeatable local promotion gate implemented and passed. `npm run qualify:rollout` verifies release/schema/runtime identity, PostgreSQL readiness, browser headers, metrics authorization, and the downloaded companion signature. The company canary must still exercise real companion execution, instance failure during an active run, managed restore, and deployment rollback before broad promotion.

- Run staged migration and canary deployment with compatibility checks for older companions and active Phase 6 runs.
- Exercise organization onboarding, role changes, shared workflow approval, parallel execution, local-action approval, failover, export, restore, and audit review.
- Define promotion, rollback, communication, and support criteria.

**Done when:** A canary can be promoted or rolled back without data loss, tenant leakage, stranded runtimes, or unrecoverable runs.

## Requested company-launch baseline gate

- [x] PostgreSQL schema, tenant indexes, immutable audit, and 1,000-user data are verified.
- [x] Backup/restore comparison across 22 tables has zero mismatches.
- [x] Two-instance sessions, pairing, heartbeats, visibility, revocation, leases, and fencing use shared PostgreSQL coordination.
- [x] Organization invitations, membership roles, protected ownership transfer, approved workflow sharing, delegated review, and fail-closed tenant tests pass.
- [x] The source companion ZIP, checksum, detached Ed25519 signature, public key, compatibility identity, and manual distribution guide are present.
- [x] Readiness/liveness, protected Prometheus metrics, rate limits, security headers, threat model, retention, and incident/rollback runbooks are present.
- [x] The 1,000-request load gate and standalone rollout promotion gate pass with saved reports.
- [x] Full tests, lint, type checking, web build, companion build/package verification, schema verification, and production dependency audit pass.

## Full expansion phase completion gate

- [ ] PostgreSQL migration and rollback are proven with production-sized data.
- [ ] Multi-instance execution remains idempotent and recoverable.
- [ ] Organization ownership and RBAC are enforced end to end.
- [x] Parallel branches and joins are deterministic and safe within the documented read-only parallel / exclusive-writer policy.
- [ ] Signed companion installation, updates, compatibility, and rollback pass.
- [ ] Integrations and secrets remain least-privilege, isolated, redacted, and audited.
- [ ] Production load, security, accessibility, disaster-recovery, canary, and rollback gates pass.
