# P9-T01: Completion Handoff Investigation

**Date:** 2026-10-26.

**Status:** Investigation evidence preserved. A deadline race was reproduced and mitigated; the exact historical missing-upload cause is not established. Subsequent implementation and qualification are recorded in [the completion report](./phase9-implementation-report.md).

## Historical evidence (read-only inspection)

Run: `run_3edb50e5b4aa43f7ed852465caae28b8`; node: `generate_initial`.

| Boundary | First attempt | Second attempt |
| --- | --- | --- |
| Job created | 2026-10-22T11:38:30.462Z | 2026-10-22T11:53:31.008Z |
| Provider completion event persisted | 2026-10-22T11:49:41.355Z | 2026-10-22T12:00:18.965Z |
| Job terminal state | Cancelled by timeout at 11:53:30.493Z | Completed at 12:00:18.977Z |
| Saved result | None | 4,319 bytes |

The run subsequently completed; its persisted update timestamp is `2026-10-22T12:15:54.741Z`. No existing run/job state was modified by this investigation, and no provider work was launched.

The first attempt's provider completion preceded timeout cancellation by about 229 seconds. A deadline-only race does **not** explain that interval. Retained progress does not identify whether local verification, process shutdown, HTTP result delivery, or another boundary failed. Do not mark that historical root cause resolved based on the mitigation below.

## Current completion path

1. Companion `runCodexTask` receives the final agent message and provider completion.
2. Declared local deliverables are verified by `createProjectDeliverables().finish`.
3. The result is held in process memory and passed to `completeJob`.
4. Completion upload retries transient failures; there is no durable result spool across process death.
5. The completion API conditionally updates the owned leased job and sends a notification.
6. The paired adapter reads the saved job result and parses focused output.
7. Mastra's runner calls the existing domain reducer and persists the Workflow Studio run separately from its own checkpoint.
8. Live events update the browser, which also has execution-continuation behavior.

Provider completion is evidence of step 1 only. It must not bypass verification, substitute for a result receipt, or establish workflow success.

## Reproduced deadline defect and mitigation

Previously, `waitForRuntimeJob` exited its polling loop at the deadline, attempted conditional cancellation, and unconditionally threw `JOB_TIMEOUT`. If completion won the database race at that boundary, cancellation correctly left the completed job intact, but the adapter still reported failure. This could spend another task attempt unnecessarily. An actual verification failure committed at the same boundary could also be hidden by the timeout message.

Mitigation: after conditional cancellation, reread the owner-scoped job. Return an already-completed result; preserve an already-failed job's actual error. Missing jobs remain explicit errors, and unfinished/cancelled jobs still time out. No timeout extension, permission change, graph exception, or success inferred from provider events is introduced.

Tests in `tests/paired-runtime-reconnect.test.ts` reproduced three failures before the patch and pass after it: deadline completion, completion immediately before cancellation, and failure committed at the deadline. A fourth check confirms that provider-completed progress without a saved job result still cannot be accepted as success.

Repository coverage in `tests/paired-runtime-ownership.test.tsx` checks both serialization orders: completion-before-cancellation preserves the result; cancellation-before-completion rejects late results. It also checks identical completion replay and conflicting payload rejection.

This patch does not remove the independent outer node timeout in the execute route. Aligning nested deadlines and all retry paths belongs to P9-T06 and is required before claiming end-to-end timeout reconciliation.

## Lifecycle writers and intended ownership

| Current writer | Current responsibility | Target boundary |
| --- | --- | --- |
| `src/adapters/mastra-adapter.ts` | Start/complete/fail reducers, approvals, cancellation/recovery, run writes, snapshots | Request domain transitions through one service; retain scheduling and checkpoints |
| `src/domain/runtime-engine.ts` / `SequentialRuntime` | Pure graph reducers plus legacy read/mutate/write facade | Reuse pure reducers; route persistent mutations through the same transition service |
| Run execute API | Input/runtime waiting, action keys, orchestration, independent outer timeout | Authorize and submit transitions; no separate lifecycle writer |
| Run approval/input/retry/settings APIs | User actions and independent run writes | Authorize user actions; transition service validates and persists changes |
| Run recovery/cancellation APIs | Delegation to engine and companion job cancellation | One fenced transition plus durable cancellation/reconciliation work |
| Companion completion API / runtime-job repository | Lease-conditional completion receipt | Keep receipt ownership/fencing; reconcile accepted result transactionally with domain application |
| `RunRepository.upsert` | Append-only journal validation and whole-run writes | Keep integrity guarantees; add revision-based concurrency control under transition service |
| Companion worker | Provider execution, local verification, in-memory upload retries | Durable result spool and replay, not another provider execution on upload loss |
| Browser execution control | Live state and automatic continuation requests | Display and user actions; server-owned continuation/reconciliation |

Mastra should not become a second implementation of routing and approval semantics. PostgreSQL remains authoritative for business state; Mastra snapshots reference committed revisions. The database transaction cannot be assumed to include local files or Mastra checkpoint acknowledgement.

## Next investigation and implementation gates

- Add stage correlation before attempting another live reproduction of the historical missing upload. Obtain explicit authorization before any real provider execution or live-run mutation.
- Preserve raw provider output locally before verification/delivery can lose it, with bounded protected storage and explicit stages (P9-T03).
- Distinguish process death, verification failure, HTTP rejection, lost acknowledgement, and checkpoint delay in deterministic failure-injection tests.
- Introduce revision-fenced transitions and transactional reconciliation work (P9-T02/P9-T04/P9-T05); do not weaken existing lease and cancellation fencing.
- Keep P9-T01 open until the ownership migration decision is reviewed and the remaining investigation evidence gap is explicitly resolved or accepted as unavailable.

## Verification

- Red phase: three deadline regression tests failed against the previous adapter behavior.
- Green phase: all seven reconnect/deadline tests passed after the patch.
- Targeted reconnect/deadline, repository ownership/fencing, and Mastra companion integration: 3 test files, 16 tests passed (`--maxWorkers=1`). These are deterministic fixtures, not a live provider rerun.
- TypeScript check (`tsc --noEmit`): passed.
- ESLint on the changed adapter and two regression test files: passed.
- Whitespace/diff integrity (`git diff --check`): passed.
