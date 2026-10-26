# Phase 9 and P8-T06 implementation report

Date: 2026-10-26. Scope: runtime completion reliability plus the user's explicit request to complete parallel execution. Changes are in the working tree; this report does not imply a commit, push, deployment, or restart of existing runs.

## Delivered implementation

| Area | Result |
| --- | --- |
| Authoritative transitions | Shared owner/revision/identity/journal validation; compare-and-swap run writes; transactional execution-lease fencing; stale task/attempt/iteration rejection. |
| Durable delivery | Bounded atomic local raw/verified result spool; restart replay; blocked verification reconciliation; acknowledgement-safe uploads. |
| Receipts | Canonical digest and lease/attempt fences; duplicate acknowledgements; node outputs/artifacts/routes/events/receipt/outbox committed together; injected rollback coverage. |
| Continuation | PostgreSQL reconciliation claims and renewable run locks; Node coordinator; authorized runs continue without a browser execute loop. |
| Mastra | Domain semantics remain authoritative; reconcile by revision; resume existing attempts and rebuild lost gate suspension without replaying completed nodes. |
| Timeouts | Companion provider deadline separated from verification/delivery; server wait windows and lost events cannot authorize duplicate durable attempts. Ambiguous crashed work requires inspection. |
| Approvals | Decision digest/idempotency key committed with decision; exact gate IDs sent by UI; same key with different choice rejected. |
| Parallel graphs | Native fork/join, all/quorum, 1–10 budget, fail-fast/collect-all, read-only parallelism and exclusive project writers; deterministic joins, input/human barriers, cancellation and active-attempt resumption. |
| Diagnostics | Delivery stages; run/reconciliation revisions and worker lease/error class in redacted support exports; queue/provider/verification/delivery durations where available. |
| Compatibility | Additive migration 15; companion 0.2.0; focused work waits for upgrade; restored/historical runs are not implicitly started. |

## Qualification evidence

- Real PostgreSQL receipt/rollback, lost notifications, companion dispatch and recovery passed: **3 files / 11 tests** in a generated disposable database. The fixture database was removed afterward; application runs were not changed.
- An authenticated real Codex App Server bridge canary passed: one read-only task returned the expected nonce and saved its result locally. Only control-plane event transport is stubbed. This is not an installed-companion/deployed-HTTPS failover canary.
- A companion 0.2.0 qualification ZIP and detached Ed25519 signature were generated and verified. The key was ephemeral; public production downloads were not replaced. Final refresh results are recorded below.
- The settled-source full suite passed **90 files / 335 tests**, with the optional real-provider canary skipped by default. The canary passed separately (1 test). An earlier contention timeout and an intermediate run using cached modules were superseded by this passing run.
- Targeted tests cover real child-process termination after spool persistence, competing coordinator claims, transactional rollback, stale ownership, deterministic parallel merges, quorum cancellation and browser handoff.

Final verification:

- Full regression: 335 tests passed; 1 optional canary skipped.
- Final parallel/manual-retry follow-up: 2 files / 13 tests passed, including the added later-branch retry case. This one-line retry eligibility correction was made after the full run and qualified with its relevant suites.
- Final delegated-review/recovery ownership follow-up: 4 files / 23 tests passed. All long-running execution entry points now use the fenced repository and check ownership before provider dispatch.
- Final spool follow-up: 6 tests passed, including child-process termination and the pre-existing 25 MiB artifact preview expanded to base64. Local bounds are 400 MiB total / 40 MiB per record / 200 records.
- Real PostgreSQL: 11 tests passed in the disposable database.
- Real Codex provider bridge: 1 test passed against the updated companion execution logic; the later storage-capacity adjustment passed the separate spool suite.
- TypeScript, full ESLint and final changed-file ESLint: passed.
- Optimized main Next.js production build: passed with the background coordinator explicitly disabled for build qualification.
- Companion Next.js production build: passed.
- Final companion 0.2.0 qualification ZIP: SHA-256 and Ed25519 signature passed. SHA-256: `6c0d90707d3521ea3e4164b8b244f3e0f1b1c71712b6e108b620b06a9ff394f8`. Both packaged runtime helpers match the qualified source exactly; no server `.env` or PostgreSQL configuration is included. Production downloads and signing keys were not replaced.
- `git diff --check`: passed.

## Operational boundary

Local qualification does not constitute a company production rollout. Preserve existing release-owner signing-key custody and deployed HTTPS companion/instance-failure, production-load, managed-restore and rollback checks before broad promotion. The coordinator requires an always-running Node server. The explicit legacy rollback engine remains sequential. Concurrent workspace writers/worktree isolation and general external connectors are outside this implementation.

No existing live run was restarted or edited for qualification. The exact October 22 missing-upload cause remains unproven; reproducible deadline/receipt failures and the new durable protocol have independent evidence. There is no universal error-free-workflow or exactly-once external-side-effect claim.

Configuration, spool repair, upgrade and rollback: [runtime guide](../../docs/runtime-reliability-and-parallel.md).
