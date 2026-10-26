# Phase 7 Tasks: Mastra Runtime Integration

**Current status:** Implementation complete. P7-T01 through P7-T10 are complete; qualification results are recorded below.

**Dependency:** Phase 6 behavior and tests must remain green throughout the migration.

## P7-T01 — Pin Mastra and define the runtime boundary

**Status:** Done (2026-09-08).

- Add supported Mastra packages with exact compatible versions.
- Replace the placeholder interface with explicit compile, start, suspend, resume, cancel, inspect, and recover operations.
- Record the Mastra version and active engine in diagnostics and support exports.

**Done when:** Production code loads Mastra successfully and no component presents the placeholder as a configured runtime.

## P7-T02 — Compile dynamic workflow definitions

**Status:** Done (2026-09-08).

- Translate validated nodes, edges, schemas, route choices, retry limits, and loop bounds into Mastra workflows.
- Keep stable IDs linking definition, assignment, run, node, and Mastra step.
- Reject unsupported or ambiguous graphs before a run is created.

**Done when:** Representative saved workflows compile deterministically into registered Mastra workflows with traceable IDs.

## P7-T03 — Bridge Codex companion tasks

**Status:** Done (2026-09-08).

- Implement a Mastra step that dispatches the existing scoped Codex job to the owning paired runtime.
- Preserve selected skills, project root, sandbox, output schema, metadata, timeouts, leases, and local action approvals.
- Convert companion results and failures into typed Mastra step outputs and errors.

**Done when:** A real Mastra workflow executes a Codex step through the companion without exposing local credentials or files to the server.

## P7-T04 — Map control flow and bounded recovery

**Status:** Done (2026-09-08).

- Implement sequential execution, conditional routing, bounded revision loops, and retries using Mastra control flow.
- Preserve exact-choice routing rules and deterministic limit enforcement.
- Keep explicit unsupported errors for graph constructs deferred to Phase 8.

**Done when:** Existing branch and revision-loop fixtures produce the same routes, limits, and outputs through Mastra.

## P7-T05 — Suspend and resume approval gates

**Status:** Done (2026-09-08).

- Suspend the Mastra step at a human gate and persist allowed decisions, reviewer feedback, and reviewable artifacts.
- Validate the submitted choice before resuming; unknown or stale decisions must leave the run suspended.
- Route rejection and revision feedback only to the configured affected stage.

**Done when:** Approval, rejection, revision, invalid choice, stale decision, and repeated-decision tests pass without bypassing the gate.

## P7-T06 — Persist snapshots and correlation in PostgreSQL

**Status:** Done (2026-09-08).

- Configure PostgreSQL-backed Mastra workflow state.
- Persist Mastra workflow/run/step identifiers alongside Workflow Studio runs, events, approvals, artifacts, and audit entries.
- Add restart and snapshot compatibility checks with clear migration/version errors.

**Done when:** Suspended and active runs recover after a server restart with no duplicated completed step or lost approval state.

## P7-T07 — Cancellation, disconnect, and lease recovery

**Status:** Done (2026-09-09).

- Propagate user cancellation to Mastra and the active companion Codex turn.
- Reconcile disconnects, expired leases, reclaimed jobs, late results, and retries with Mastra step state.
- Fence duplicate completion and stale resume attempts.

**Done when:** Cancellation and reconnect race tests remain deterministic and leave one authoritative terminal state.

## P7-T08 — Artifacts, events, and observability

**Status:** Done (2026-09-09).

- Map Mastra lifecycle events into the live run view and immutable audit stream.
- Preserve document/image review before approval and affected-stage reruns.
- Include engine, workflow, run, step, attempt, companion job, and Codex thread correlation in redacted diagnostics.

**Done when:** Users can review the same outputs and support diagnostics can trace a run across all runtime layers.

## P7-T09 — Compatibility migration and rollout switch

**Status:** Done (2026-09-09).

- Define how pre-Mastra completed, suspended, interrupted, and pending runs are read or completed.
- Add an explicit runtime engine version and a controlled feature flag for staged rollout and rollback.
- Prevent new custom-engine runs after Mastra becomes required while keeping historical data readable.

**Done when:** A staged migration and rollback preserve definitions, ownership, approvals, events, and artifacts.

## P7-T10 — End-to-end qualification

**Status:** Done (2026-09-09). The supported workflow matrix, type checking, lint, companion build/package, and optimized application build pass. Phase 8 remains the production-scale launch gate.

- Test sequential work, branches, bounded loops, approvals, revision feedback, invalid choices, missing capabilities, reconnect, cancellation, recovery, and final artifacts through the companion.
- Run type checking, lint, full tests, companion packaging, and the optimized Next.js build.
- Update product and administrator documentation to state the real Mastra boundary accurately.

**Done when:** The complete supported workflow matrix passes with real Mastra execution and no placeholder or silent custom-engine fallback.

## Phase completion gate

- [x] Real Mastra packages are installed and invoked in production execution.
- [x] Supported user-authored graphs compile deterministically.
- [x] Companion Codex steps preserve local security boundaries.
- [x] Approval gates suspend and resume with exact-choice enforcement.
- [x] PostgreSQL snapshots recover after restart.
- [x] Cancellation, reconnect, retries, artifacts, and diagnostics pass.
- [x] Compatibility migration and rollback are proven.
- [x] Full verification passes before Phase 8 begins.
