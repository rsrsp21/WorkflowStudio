# Phase 9: Runtime State and Completion Reliability

**Status:** Implementation complete on 2026-10-26; local qualification is recorded in [the implementation report](./phases/phase9-implementation-report.md). Production deployment canary and release-owner promotion remain separate operational gates.

**Created:** 2026-10-22.

**Priority:** Reliability follow-up before expanding workflow capabilities.

## Goal

Remove conflicting lifecycle ownership between Workflow Studio, Mastra, and the companion. A completed provider task must not be executed again merely because result delivery, persistence, or checkpoint acknowledgement was interrupted.

Retain Mastra. Establish one authoritative business-state record and make delivery and recovery explicit, testable protocols rather than independent state machines making competing decisions.

## Evidence and investigation boundary

Run `run_3edb50e5b4aa43f7ed852465caae28b8` recorded a Codex `turn/completed` event at `2026-10-22T11:49:41.355Z`, but its companion job was not recorded as completed before the server timeout at `2026-10-22T11:53:30.525Z`. A second generation attempt then started.

This establishes a completion-handoff gap, not its exact root cause. A provider turn finishing does not prove artifact verification, result upload, or database commit succeeded. P9-T01 must locate that boundary before implementation is finalized. Do not treat a progress event or existing files as a valid task result.

## Ownership contract

| Layer | Owns | Must not own independently |
| --- | --- | --- |
| Workflow Studio domain transition service and PostgreSQL | Authoritative run/node state, routes, approvals, attempt identities, retry budgets, accepted results, artifact records, audit events | A competing scheduler or unapproved provider execution |
| Mastra | Execution scheduling, durable suspension/resumption, checkpoints referencing authoritative run revisions | Separate business decisions about approvals, routes, retry eligibility, or terminal status |
| Companion | Scoped execution, local result verification, durable result delivery and acknowledgement | Advancing the workflow, silently retrying provider work, or changing approved permissions |
| Browser | Displaying persisted state and submitting user actions | Being required to keep a workflow alive or deciding whether a task should be replayed |

The existing generic runner can remain if it obeys this contract. Do not reimplement graph semantics a second time in Mastra primitives as part of this phase.

## Scope

- One transition service used by execution, approvals, cancellation, timeout, completion, and recovery paths.
- Revision checks and attempt/lease fencing for concurrent requests and stale workers.
- A durable, bounded companion result spool written atomically before upload.
- Idempotent completion receipts and transactional application of verified results.
- An outbox/reconciliation mechanism across database commits and Mastra checkpoints.
- Explicit timeout states distinguishing active provider work, local verification, result delivery, and unrecoverable failure.
- Correlated timing and failure-injection qualification across all layers.

## Required invariants

1. One accepted result per run/node/attempt/iteration identity; upload retries reuse the same result identity and payload digest.
2. An exact duplicate completion is acknowledged without duplicate events or artifacts. A different payload using the same identity is rejected visibly.
3. Persist verified result application, node transition, artifact metadata, selected routes, and audit/outbox records atomically in PostgreSQL. If receipt ingestion and result verification are separate stages, persist that distinction and reconcile it explicitly.
4. PostgreSQL and Mastra cannot share a database transaction by assumption. Commit authoritative changes first, then reconcile the checkpoint through durable work; a crash between those stages must not replay completed provider work.
5. Stale leases cannot mutate newer attempts. Late results remain inspectable but cannot silently overwrite a retry or resurrect a cancelled run.
6. Timeout handling checks accepted receipts and delivery state under the same concurrency controls used to authorize retries. A `turn/completed` event alone never marks a node successful.
7. Recovery resumes the unfinished delivery or checkpoint stage when possible, not the entire provider task.
8. Human approvals, exact routing, revision budgets, required verification, tenant ownership, and workspace boundaries remain enforced.
9. Completed/failed/cancelled elapsed time uses the durable terminal timestamp, not the current browser clock or a later metadata update.

## Safety and non-goals

- No UPI-, image-, file-extension-, output-key-, or sample-workflow-specific recovery logic.
- No silently relaxed validation, expanded tools/roots, auto-approved decisions, or increased retry/loop budgets.
- No promise of exactly-once external side effects. Ambiguous side-effect outcomes require explicit policy and, where necessary, human reconciliation rather than blind retry.
- No implicit access to private tool caches. Only explicitly declared artifacts and approved source roots may be delivered.
- Spool records stay local, contain no authentication tokens, have restrictive permissions, bounded size, retention, and a documented cleanup/recovery policy.
- Do not mutate or restart existing live runs during implementation or qualification without user authorization.
- Retain Mastra and keep external integrations outside scope. The user additionally authorized P8-T06 parallel graph execution on 2026-10-26; it is implemented alongside this reliability boundary.

## Acceptance and release gate

- Failure injection covers provider completion, local verification, spool persistence, upload, receipt commit, result application, checkpoint persistence, and acknowledgement loss.
- Reconnect/restart resumes pending delivery without another provider call when a valid durable result exists.
- Duplicate, conflicting, stale, cancelled, and reordered completions leave one explainable authoritative state.
- Approval suspension and recovery remain correct after process restart and across multiple application instances.
- A run continues server-side when its browser is closed; reopening shows persisted progress.
- No workflow-specific exceptions are introduced. Qualify file creation, file editing, read-only analysis, and structured-output workflows.
- Typecheck, lint, regression tests, production build, companion packaging, migration/rollback rehearsal, and authorized end-to-end companion testing pass.
- Publish stage timing evidence before attributing delays to Mastra or claiming a performance improvement.

See [Phase 9 tasks](./phases/phase9-tasks.md) for implementation order and completion evidence.

Investigation evidence and the lifecycle-writer inventory are recorded in [the P9-T01 investigation](./phases/phase9-completion-investigation.md).
