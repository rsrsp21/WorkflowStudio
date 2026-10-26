# Phase 9 Tasks: Runtime State and Completion Reliability

**Status:** Implementation complete on 2026-10-26. Local verification and remaining production rollout boundaries are recorded in [the implementation report](./phase9-implementation-report.md). P8-T06 parallel execution was additionally authorized and implemented.

**Dependency:** Preserve the approved workflow, permission, artifact, tenant, and audit contracts from Phases 4–8. Existing terminal-timer and recovery fixes are baseline behavior, not evidence that this phase is complete.

## P9-T01 — Reproduce and locate the completion gap

**Status:** Investigation complete for retained evidence and reproducible deadline/receipt failures. The original historical missing upload cannot be attributed more precisely; that uncertainty is preserved in [the investigation](./phase9-completion-investigation.md).

- Trace provider completion → final message parsing → local artifact verification → result upload → receipt commit → domain transition → Mastra checkpoint → UI event.
- Inspect current job leases, cancellation requests, upload retries, and completion responses without exposing credentials or unrequested project contents.
- Reproduce the observed failure using a deterministic fake executor and injected interruptions; do not regenerate user assets as a diagnostic shortcut.
- Inventory every lifecycle writer and record which service will own it.

**Done when:** The failing boundary is evidenced, a regression test reproduces it, and the ownership/migration decision is reviewed. Refine estimates and subsequent tasks from that evidence.

## P9-T02 — Centralize authoritative transitions

**Status:** Implemented. All run writes use the revision-checked transition boundary; execution owners are fenced at transactional persistence and before dispatch. Approval identities are committed with decisions, and stale attempts cannot mutate newer state.

- Introduce one domain transition service around existing validated graph semantics.
- Route completion, failure, approval, retry, cancellation, and recovery through it.
- Add expected run revisions and fenced attempt/iteration/lease identities; reject stale mutations deterministically.
- Keep Mastra responsible for scheduling/checkpoints and remove independent retry/route decisions where present.

**Done when:** All public mutation paths use the service, and concurrency tests demonstrate one accepted transition with no lost approvals or terminal-state resurrection.

## P9-T03 — Persist companion results before upload

- Add a versioned local spool keyed by task execution identity with payload digest, verification stage, and upload acknowledgement state.
- Use atomic persistence before upload; persist recoverable provider output early enough to distinguish verification from delivery failures.
- On restart/reconnect, replay pending delivery without invoking the provider again.
- Define bounded retry/backoff, access permissions, retention, size limits, corrupt-record handling, protocol compatibility, and explicit discard policy.

**Done when:** Killing the companion before/after upload and losing the acknowledgement do not lose a valid result or cause another provider execution. Disk/verification failures are surfaced explicitly.

## P9-T04 — Make result acceptance and application transactional

- Add idempotent completion receipts scoped to the owner and fenced execution identity.
- Acknowledge exact duplicates; reject conflicting digests and stale attempts. Retain safe diagnostics for late results.
- Apply verified node output, artifact metadata, selected routes, run revision, audit events, and reconciliation work in a transaction.
- Separate delivery failures from model/task failures so network errors do not spend the model retry budget.

**Done when:** Concurrent/repeated completions produce one accepted result and one logical transition; rollback leaves neither half-applied artifacts nor prematurely completed nodes.

## P9-T05 — Reconcile Mastra checkpoints with authoritative state

- Persist checkpoint/outbox work alongside the domain transition and retry reconciliation idempotently.
- Restore or reconcile Mastra snapshots using explicit run revisions and immutable definition fingerprints, not timestamp-only precedence.
- Ensure normal execution does not depend on a browser execute loop; keep dispatch/reconciliation server-owned with bounded scheduling and lease renewal.
- Reject incompatible snapshots visibly and preserve historical run readability.

**Done when:** Server crashes between domain commit and snapshot acknowledgement recover without duplicate provider work, lost approvals, or competing active executions. Closing the browser does not stop authorized work.

## P9-T06 — Fence timeouts, late results, and retries

- Check committed receipts, active ownership, and durable delivery state before authorizing another attempt.
- Expose execution, verification, delivery, and reconciliation stages distinctly. Use bounded, documented grace/reconciliation windows rather than silently extending timeouts indefinitely.
- Handle completion-versus-timeout and cancellation-versus-completion races transactionally.
- Preserve completed nodes and approvals; request human intervention for ambiguous side effects or unrecoverable result loss.

**Done when:** Race tests cannot launch a duplicate attempt when a valid result has already been accepted; stale late results never overwrite a newer attempt or cancelled state.

## P9-T07 — Add timing and actionable diagnostics

- Correlate run, node, attempt, iteration, job, provider thread, receipt digest, run revision, and checkpoint revision.
- Measure provider time, approval wait, artifact verification, upload/acknowledgement, database application, and checkpoint reconciliation independently.
- Show delivery/reconciliation progress and the actual blocking stage instead of an unchanged generic running state.
- Verify elapsed time remains frozen after terminal states and resumes only after an explicit valid recovery transition.

**Done when:** A redacted support export explains where a stalled task is waiting without needing credentials, private prompts, or unrestricted local file access.

## P9-T08 — Qualify and roll out safely

- Test disconnects, process kills, lost notifications/acknowledgements, database failures, duplicate/conflicting uploads, expired leases, clock skew, cancellation races, and snapshot drift.
- Qualify generic file creation/editing, structured analysis, approvals, bounded revisions, retries, reconnects, and browser closure.
- Version schema/protocol changes; rehearse rollout and rollback with mixed companion versions and preserved historical records.
- Run typecheck, lint, full regressions, production build, companion packaging, and an authorized real companion run. Record evidence and unresolved limitations here.

**Done when:** The Phase 9 acceptance gate passes with replayable evidence. No existing live run is changed without authorization and no universal error-free-workflow claim is made.

## Completion checklist

- [x] P9-T01: Reproducible deadline/receipt boundaries evidenced; exact historical upload cause remains unproven.
- [x] P9-T02: One authoritative transition service.
- [x] P9-T03: Durable companion result spool and replay.
- [x] P9-T04: Idempotent receipts and transactional result application.
- [x] P9-T05: Mastra checkpoint reconciliation and server-owned continuation.
- [x] P9-T06: Fenced timeout/retry/cancellation races.
- [x] P9-T07: Stage timing and user-visible diagnostics.
- [x] P9-T08 implementation/local qualification: isolated PostgreSQL, process-kill spool recovery, provider bridge, regression, build and package checks (see report).
- [ ] Operational promotion: deployed HTTPS companion failover, production topology/managed restore and company release signing.

## Expected implementation touchpoints

Confirm these during P9-T01; this list is not permission to rewrite unrelated code.

- `src/adapters/mastra-adapter.ts`, `src/adapters/paired-runtime-adapter.ts`
- `src/domain/runtime-engine.ts`, `src/domain/runtime.ts`
- `src/storage/run-repository.ts`, `src/storage/runtime-connection-repository.ts`
- Run execution/approval/recovery APIs and companion job completion APIs
- `scripts/workflow-studio-runtime.mjs`, `scripts/project-deliverables.cjs`
- PostgreSQL schema/migrations, live run UI, diagnostics, and runtime regression fixtures
