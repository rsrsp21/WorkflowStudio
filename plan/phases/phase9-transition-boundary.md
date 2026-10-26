# P9-T02: Shared Transition Boundary

**Date:** 2026-10-26.

**Status:** Historical intermediate implementation notes. The remaining-work list below describes the initial revision-boundary increment and is superseded by [the completed implementation report](./phase9-implementation-report.md).

## Implemented slice

- `src/domain/run-transition-service.ts` owns the shared commit policy. It checks ownership, the caller's expected revision, immutable run identity, append-only events, terminal-state reopening, and existing run validation. Existing pure graph/approval/retry reducers remain the semantic authority; they are not reimplemented in Mastra.
- `RunRepository.upsert` snapshots the proposal before asynchronous work, locks the existing row, applies the policy, and uses a conditional database update against the exact previously read payload. A stale write fails with `RUN_STATE_CONFLICT` rather than overwriting a concurrent action. All existing run-upsert callers use this boundary, including metadata-only changes without new events.
- Each successful commit increments `WorkflowRun.stateRevision`. The repository returns the saved state and updates the caller object's revision only after the transaction succeeds, preserving the existing calling convention. Failed writes do not advance the caller revision.
- Legacy records without this optional field hydrate to revision zero. No historical row is eagerly rewritten; a subsequent authorized save upgrades that record. Run schema compatibility remains unchanged.
- Mastra retains revisions returned by the repository before dispatching provider work. Before applying a result or error it checks the latest persisted run and the captured node/task/attempt/iteration identity. Legacy asynchronous execution uses the same fence. Old work cannot complete or fail a recovered attempt, and revision conflicts are not converted into model failures.
- Mastra checkpoint reconciliation validates identity and common event history as before, then uses the persisted revision as the authority for versioned runs. An ahead checkpoint fails explicitly. Unversioned historical fixtures retain the legacy reconciliation path until migration is qualified.

## What this does not solve

- This is a centralized commit guard, not a completed migration of every action into a transactional command API.
- Runtime-job lease fencing remains in the existing companion job repository; it is not yet transactionally connected to node-result application.
- A failed node can reopen only with an appended recovery event; the existing recovery reducers and API authorization must still enforce retry eligibility and exact human choices.
- Companion results are still held in memory before upload. Revision conflicts cannot recover a provider result that was never durably saved; the local spool and receipts remain P9-T03/P9-T04 work.
- PostgreSQL state and Mastra snapshots are still separate commits. Durable checkpoint reconciliation/outbox work remains P9-T05.
- A stale completion rejected after concurrent state changes must not be treated as permission to rerun external actions. End-to-end retry/reconciliation policy remains P9-T06.
- Review public action identities and idempotency handling, including repeated human gates, before marking P9-T02 complete.

## Rollout and compatibility requirements

- Do not deploy versioned and old unguarded server writers concurrently. Quiesce/drain old writers before promoting this boundary, or first add an explicit rollout fence accepted by all versions. An older server can bypass a new guard if it still writes directly.
- Do not reset `stateRevision` to zero to make a stale checkpoint or client proposal pass.
- Do not restore an old snapshot over a higher committed revision. Preserve mismatches for diagnosis and use an explicit reconciliation/migration path.
- No existing live run was edited or restarted for these checks. Validation uses isolated test databases and fake executors; no real provider task was launched.
- P9-T08 still requires real PostgreSQL multi-instance concurrency, restart/recovery qualification, mixed-version policy, and rollback rehearsal. In-process fixtures alone do not satisfy that gate.

## Tests and verification

- `tests/run-transition-service.test.ts`: revision migration, metadata-only conflicts, terminal-state protection, identity/ownership/journal checks, and delayed legacy result/error fencing after recovery.
- `tests/phase4-recovery-and-events.test.ts`: two concurrent repository updates with the same revision accept one writer and reject the other without a lost update; existing event/artifact and recovery scenarios remain covered.
- `tests/mastra-state-fencing.test.ts`: same-journal revision reconciliation, ahead-checkpoint rejection, and delayed result/error fencing through real Mastra workflow execution with an isolated in-memory state store and fake provider.
- Initial targeted run: 22 of 23 tests passed; the concurrency test exposed insufficient protection when test transactions interleaved. The additional database compare-and-swap guard fixed that failure. The follow-up two-file run passed all 12 tests; Mastra-specific fencing passed all 3 tests.
- Full suite: 86 files and 311 tests passed with `--maxWorkers=2`. The subsequently added Mastra fencing file passed its 3 tests separately (87 files / 314 tests across the two runs).
- Final TypeScript check and targeted ESLint, including the additional Mastra test file: passed.
- `git diff --check`: passed.
- Optimized Next.js production build: passed. No running application or companion was restarted, and no live provider work was launched.
