# Phase 4 Tasks: Runtime Compilation and Focused Codex Execution

**Parent phase:** [Phase 4 - Durable runtime foundation and Codex execution](../phase-04-runtime-and-codex.md)
**Schedule:** Days 7-8  
**Outcome:** A validated, approved project assignment can be compiled into a durable run and executed through governed, focused node tasks.

**Current status:** Complete. P4-T01 through P4-T08 are implemented and verified by the 88-test suite, lint, TypeScript, and an optimized production build.

## Day 7 - Compilation and run foundation

### P4-T01 - Define compiled workflow and run contracts

- Define versioned compiled-workflow, workflow-run, node-run, and run-event records.
- Bind every run to its user, project, reusable workflow, workflow version, assignment, root path, and source plan.
- Compile only assignments persisted as `ready` after Phase 3 validation.
- Preserve node prompts rather than copying the full planning prompt into every task.
- Preserve graph edges, retry limits, loop limits, approval gates, selected skill versions, and harness permissions.
- Preserve assignment input values separately from reusable workflow planning context.
- Persist compiled runs in PostgreSQL with user ownership.
- Reject cross-user assignment/run access.

**Done when:** An authenticated user can compile their own ready assignment into a durable, inspectable run, while draft, invalid, missing, and cross-user assignments are rejected.

**Status:** Done. Versioned compiled workflow, workflow run, and node run contracts are implemented. Ready-only compilation preserves all required identities, focused prompts, and assignment input values; PostgreSQL persists runs by user ID, assignments record run IDs, and tests cover durable compilation, planning-prompt exclusion, draft rejection, and cross-user isolation.

### P4-T02 - Add approval-to-compilation API and UI

- Add a compilation endpoint for ready assignments.
- Add a graph action that creates a run without starting it implicitly.
- Show compilation errors beside the approval state.
- Add a routed run workspace with a compiled summary.

**Status:** Done. Approved assignment graphs show an explicit compile boundary, compilation errors remain in the graph workspace, successful compilation opens a protected `/runs/{runId}` route, and the read-only run summary displays identities, harness locks, focused node tasks, and pending states. The start control remains disabled until P4-T04 connects the focused Codex executor.

### P4-T03 - Implement sequential runtime execution

- Execute one runnable node at a time.
- Persist node and run state transitions.
- Resolve prior outputs into downstream node inputs.
- Seed focused node inputs from compiled assignment values before resolving prior node outputs.
- Respect retry limits and terminal success/failure nodes.

**Status:** Done. A durable sequential runtime now starts one runnable node at a time, seeds external assignment inputs, freezes resolved ancestor outputs into focused node inputs, persists every transition, retries within compiled limits, blocks concurrent active nodes, pauses approval tasks, and closes success or failure terminal paths while skipping unresolved work.

### P4-T04 - Implement focused Codex task execution

- Send only the node prompt, relevant prior outputs, selected skills, workspace context, and harness state.
- Preserve run, task, planning, workflow, assignment, and node identifiers.
- Return and validate structured node output.
- Surface provider failures as durable node failures.

**Status:** Done. App Server and CLI execution now receive only the focused node prompt, resolved prior outputs, pinned published skill instructions, workspace and harness state, and complete run/task/plan/workflow/assignment/project/node identity. Schema-constrained results validate trace IDs and required outputs before persistence, fallback is supported, and provider or validation failures become durable retry/failure states visible in the run workspace.

## Day 8 - Branches, loops, and recovery

### P4-T05 - Add conditional branches and bounded revision loops

- Evaluate explicit edge conditions.
- Implement draft, review, revise, and validate loops.
- Enforce the compiled maximum iteration count.
- Route exhausted loops to a visible failure state.

**Status:** Done. The sequential runtime now requires explicit route selection, durably records selected and rejected edges, skips rejected paths, supports an explicit default route, and executes bounded draft-review-revise cycles. Loop iterations and route decisions are visible in the run workspace, and exhausted loops enter a visible failed state.

### P4-T06 - Enforce runtime workspace boundaries

- Reject file access outside the assignment root.
- Keep read-only assignments unable to write.
- Require explicit workspace-write permission before creating or modifying files.
- Preserve the approved root and permissions in every task request and artifact.

**Status:** Done. Assignment permissions are authoritative at compilation, every focused task is restricted to one canonical project root, App Server and CLI execution use explicit read-only or workspace-write sandboxes, and isolated mode remains non-writing. Artifact paths outside the root are rejected, while accepted artifacts carry the approved root and permission snapshot.

### P4-T07 - Persist events, outputs, and recovery state

- Store append-only run and node events.
- Store structured node outputs and artifact references.
- Resume interrupted sequential runs from durable state.
- Keep failures and retries visible to the monitor.

**Status:** Done. Runs now carry a validated append-only event journal, structured node output, provider summaries/thread IDs, and root-bound artifact records. Every transition is persisted before or after focused execution as appropriate, journal rewrites are rejected, legacy runs hydrate safely, and explicitly recovered interrupted nodes return to pending state and resume from the durable repository.

### P4-T08 - Test Phase 4 behavior

- Test approval-to-compilation boundaries and ownership isolation.
- Test focused prompt construction and planning-prompt exclusion.
- Test sequential transitions, retries, branches, bounded loops, root confinement, failures, and recovery.

**Status:** Done. Phase 4 coverage verifies approval-to-compilation and ownership boundaries, focused prompt isolation, assignment inputs, sequential transitions, retries, provider failures, explicit branches, bounded loops, exact workspace confinement, artifact validation, append-only events, legacy hydration, interrupted-run recovery, protected execution/recovery routes, and run workspace visibility.

## Phase 4 acceptance checklist

- [x] A ready assignment compiles into a durable user-owned run.
- [x] Draft or invalid assignments cannot compile.
- [x] Every run preserves project, workflow, assignment, root, plan, skill-version, and user identity.
- [x] External workflow inputs are validated on the assignment and available to the first focused node.
- [x] The original planning prompt is not copied into each node task.
- [x] At least one node executes through focused Codex execution.
- [x] Sequential transitions and terminal outcomes are durable.
- [x] Conditional branches and bounded revision loops execute correctly.
- [x] Runtime writes cannot escape the approved project root.
- [x] Codex failures produce visible, recoverable node and run states.
- [x] Structured outputs, artifacts, and append-only lifecycle events survive durable reloads.
- [x] Interrupted running nodes can be explicitly recovered and resumed without rebuilding the run.
