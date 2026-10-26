# Phase 8: Scale, Collaboration, and Managed Distribution

**Schedule:** Days 15–20

**Status:** Launch baseline implemented and locally qualified for PostgreSQL persistence, multi-instance coordination, organization workflow sharing, RBAC, source-companion distribution, operations, load, and rollout checks. Parallel graph joins were additionally implemented on 2026-10-26 with Phase 9 (see [implementation report](./phases/phase9-implementation-report.md)). Managed connector infrastructure remains deferred. Company staging and governance gates remain before broad promotion.

## Goal

Take the completed single-instance product into a multi-instance, organization-ready release without weakening the local Codex, project-root, approval, audit, or recovery boundaries established in Phase 6.

## Scope

- PostgreSQL-backed control-plane persistence and verified pooled asynchronous persistence.
- Multi-instance coordination for sessions, runtime connections, jobs, leases, events, approvals, and runs.
- Organization workspaces, invitations, shared workflow/skill ownership, and tenant isolation.
- Enforced RBAC and separation of duties for builders, reviewers, and administrators.
- Parallel nodes, joins, fan-out/fan-in state, cancellation, and deterministic recovery inside one run.
- Signed companion/desktop distribution, automatic updates, version compatibility, and rollback.
- Managed integrations, encrypted secrets, scoped webhooks, and connector governance.
- Production observability, load/security qualification, staged rollout, and disaster recovery.

## Release boundary

Phase 8 changes the scale and collaboration model, not the product's core execution boundary. Codex App Server, Codex authentication, and local project files remain on each user's computer behind the paired companion. The deployed control plane continues to receive only scoped jobs, redacted events, decisions, and declared outputs.

## Acceptance criteria

- The migration can be rehearsed, verified, rolled back, and completed without losing ownership or traceability.
- Multiple application instances safely process work without duplicate dispatch, completion, approval, or events.
- Organization members see and mutate only resources permitted by tenant and role policy.
- Parallel branches join deterministically and recover correctly after process or companion interruption.
- Companion releases are signed, version-checked, updateable, and rollback-safe.
- Integrations use encrypted, least-privilege credentials and produce redacted audit evidence.
- Load, failover, security, backup/restore, and end-to-end rollout tests pass before production promotion.

See [the detailed Phase 8 task record](./phases/phase8-tasks.md).
