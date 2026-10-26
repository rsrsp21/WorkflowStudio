# Phase 6 Tasks: Live Runs, History, and Product Readiness

**Current status:** Complete for the current browser-first, single-instance product release. All P6-T01 through P6-T20 acceptance paths are implemented and verified on 2026-09-04.

## Release scope

Phase 6 completes the governed workflow lifecycle from an approved reusable definition to a durable, recoverable Codex-backed run. The supported deployment uses the Next.js control plane with PostgreSQL persistence and a user-owned Node.js companion for local Codex and project-folder access.

Real Mastra orchestration is a Phase 7 milestone. PostgreSQL multi-instance scaling, organization-wide collaborative RBAC, parallel nodes, hosted integrations, and signed distribution are Phase 8 milestones. They are not required for this release and do not change the local companion boundary.

## P6-T01 — Lifecycle timeline and statuses

**Status:** Done. Planning, unresolved questions, definition approval, assignment approval, compilation, execution, human decisions, recovery, cancellation, failure, and completion remain separate persisted lifecycle events.

## P6-T02 — Live execution dashboard

**Status:** Done. The run screen shows active, waiting, pending, completed, failed, and blocked work together with elapsed time, retries, selected routes, loop counts, Codex activity, artifacts, and findings.

## P6-T03 — Node inspection and workflow approvals

**Status:** Done. Users can inspect resolved inputs, focused instructions, exact skill versions, outputs, errors, decisions, artifacts, and node history. Approval, rejection, revision, feedback, actor, timestamp, route, and resume state are durable.

## P6-T04 — Reconnection, cancellation, and recovery

**Status:** Done. Refresh and reconnect load the latest durable state. Interrupted nodes can recover without replaying completed work. Cancellation marks unfinished stages safely, cancels queued jobs, interrupts an active App Server turn, and prevents late completion from overwriting cancellation.

## P6-T05 — Run history, artifacts, traceability, and export

**Status:** Done. The dedicated paginated Runs workspace supports search, status filters, run detail, retained monitoring, artifacts, exact compiled skills, workflow JSON export, and redacted run JSON or Markdown export.

## P6-T06 — Data lifecycle and resilience

**Status:** Done. Versioned PostgreSQL migrations, pooled access, corruption quarantine, per-user logical backup/restore, terminal-history retention, ownership-safe deletion, active-dependency deletion guards, and append-only run journals are implemented.

## P6-T07 — Diagnostics and security hardening

**Status:** Done. Authentication and ownership guard APIs and records; project paths are canonicalized and allowlisted; runtime credentials are hashed and revocable; exports, approvals, logs, and support bundles are redacted; error boundaries offer recovery actions; immutable audit decisions cover sensitive lifecycle actions.

## P6-T08 — Performance, accessibility, and responsive QA

**Status:** Done. Run history is server-paginated, long journals and artifact lists are render-capped without truncating exports, polling is bounded, controls use semantic labels and keyboard behavior, focus/error states are exposed, layouts adapt to narrow screens, and one consistent thin scrollbar is used throughout.

## P6-T09 — Distribution and product documentation

**Status:** Done. Node.js 24.15 is pinned; local browser mode, paired deployed mode, supported commands, setup, safety, cancellation, backup, restore, diagnostics, troubleshooting, and rollback-by-version are documented. The `workflow-studio-runtime` npm-compatible companion package resolves its pinned Codex runtime independently of a global CLI and passes `npm pack --dry-run`.

## P6-T10 — End-to-end release qualification

**Status:** Done. Automated coverage exercises workflow creation examples across multiple domains and a complete editable multi-skill planning workflow through compile, execution, custom revision, continued execution, approval, verification, and completion. Lifecycle and graph tests cover blocked prerequisites with actionable messages.

## P6-T11 — Runtime and product edge cases

**Status:** Done. Tests cover ownership isolation, malformed payloads, stale state, idempotent compile/execution/approval, duplicate job completion, expired approvals, reconnect recovery, cancellation races, bounded loops/retries, corrupted records, redaction, unavailable runtimes, missing dependencies, and large retained histories. Failures terminate or recover explicitly rather than silently duplicating work.

## P6-T12 — Harness identity and behavior layer

**Status:** Done. Harness v2 freezes workflow purpose, agent role, approved assignment context, context budget, adaptation boundary, and immutable full skill snapshots with source, version, instructions, validation criteria, and integrity metadata.

## P6-T13 — Harness runtime layer

**Status:** Done. The compiled contract freezes engine, sandbox, tools, exact workspace root, concurrency, retries, loops, timeout, cancellation, and escalation behavior. Durable run, node, route, approval, artifact, verification, job lease, and recovery state are independent of an ephemeral Codex thread.

## P6-T14 — Harness observability layer

**Status:** Done. Correlation links workflow, assignment, project, run, node, task, provider thread, approval, artifact, and verification records. The UI and exports expose durations, retries, loops, failure categories, activity, and evidence; provider token/cost metrics are explicitly marked unavailable when not reported instead of shown as zero.

## P6-T15 — Harness verification layer

**Status:** Done. Every node result is checked against declared outputs, artifacts, route contracts, and completion requirements. Verification results are persisted and displayed independently from agent messages, and failed checks route through retry/revision/failure rules rather than producing false success.

## P6-T16 — Harness adaptation layer

**Status:** Done. Adaptation is off by default and opt-in by scope. Failure/revision lessons become provenance-linked candidates; approve/reject decisions are human-controlled and audited; approval never mutates the active run or an existing workflow/skill version.

## P6-T17 — Harness governance and security layer

**Status:** Done. Ownership, least privilege, path scope, destructive-action policy, approval expiry, redaction, retention, export, deletion guards, and append-only audit are evaluated at the relevant API and runtime boundaries. User roles are retained as actor responsibility metadata; this single-owner release does not grant cross-user access from a role label.

## P6-T18 — Generic visual workflow composition

**Status:** Done. Users can create workflows for any supported domain using typed agent, Codex, tool, validation, approval, loop, success, and failure stages. Skill-backed stages remain visible focused Codex tasks, and examples are editable starting points rather than hard-coded product paths.

## P6-T19 — Configurable outcomes and revision routing

**Status:** Done. Approval gates support up to eight custom labels/keywords with continue, revise, or stop behavior. Conditions must match routes, revisions use bounded loops, unknown or stale decisions are rejected, and the exact decision is persisted and shown.

## P6-T20 — Codex action approvals and local side-effect governance

**Status:** Done. Workflow decisions are separate from App Server command, file-change, network/permission, and MCP elicitation requests. Paired approvals are bound to owner, connection, job, run, task, node, project path, expiry, and one-time decision; structured responses are redacted, reconnectable, and fail closed.

## Phase completion gate

- [x] The complete draft → definition approval → assignment approval → compile → run → revise/approve → complete lifecycle works without conflating gates.
- [x] Runs execute focused Codex stages against the approved local project root and stop at workflow or local-action approvals.
- [x] Active and recovered runs are durable, cancellable, traceable, and idempotent.
- [x] History, artifacts, monitoring, verification, exports, retention, backup, restore, deletion, and diagnostics are available.
- [x] Harness v2 preserves all six contracts and their evidence for every compiled run.
- [x] Generic multi-skill workflows and custom approval words/revision routes execute end to end.
- [x] Lint, TypeScript, 151 automated tests, npm companion packaging, and the optimized Next.js production build pass.
