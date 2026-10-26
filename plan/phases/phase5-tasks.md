# Phase 5 Tasks: Validation and Harness Controls

**Current status:** Complete. P5-T01 through P5-T08 are implemented and covered by automated regression tests.

## P5-T01 — Central lifecycle policy

- Define one transition policy for draft save, re-plan, continue unresolved, definition approval, assignment approval, compile, and execute.
- Return consistent allowed/blocked results and user-facing reasons from the domain layer.
- Use the policy in UI controls and API routes.

**Status:** Done. A shared lifecycle policy now returns consistent decisions for draft save, re-plan, continue unresolved, definition approval, assignment creation, assignment approval, compile, and execution. Workflow and assignment APIs use explicit lifecycle actions instead of inferring gates from unrelated fields.

## P5-T02 — Draft and open-question rules

- Allow drafts to be saved with unanswered questions.
- Preserve unresolved questions and completed answers.
- Support re-plan, keep current, and explicit continue-unresolved paths.
- Add UI/API regression tests for every path.

**Status:** Done. Draft saves and explicit continue-unresolved saves preserve open questions and partial answers without requiring acknowledgment flags. Re-planning remains answer-driven, and regression tests cover unresolved draft persistence.

## P5-T03 — Reusable graph approval

- Approve structurally valid reusable graphs without a project assignment.
- Persist definition approval independently with version, actor, and timestamp.
- Ensure definition approval grants no project or runtime permissions.

**Status:** Done. Valid reusable graphs can be approved without an assignment. Approval persists actor, timestamp, and workflow version metadata, creates no assignment, grants no additional project access, and is covered by domain and API tests.

## P5-T04 — Assignment validation and approval

- Require project root, external inputs, pinned active skills, permissions, and assignment harness settings.
- Persist assignment approval separately from definition approval.
- Invalidate assignment approval when its graph override or execution configuration changes.

**Status:** Done. Assignment approval validates the approved reusable definition, effective graph, project inputs, pinned active skills, exact root permissions, and harness settings. Approval records actor, timestamp, workflow version, and configuration version. Graph, input, skill, permission, or harness changes increment the configuration version, clear approval, and return the assignment to draft.

## P5-T05 — Compile and execution gate

- Require approved definition and approved assignment before compilation and execution.
- Validate exact project-root and permission boundaries.
- Return actionable missing-prerequisite messages.

**Status:** Done. Compilation and every execution advance use the shared lifecycle policy, require an approved definition and ready assignment, revalidate the effective graph and pinned skills, enforce the exact project root, and reject stale or unavailable dependencies with a specific next action.

## P5-T06 — Output, artifact, and completion contracts

- Validate node outputs against schemas before downstream use.
- Validate required artifacts and completion criteria.
- Distinguish validation failure, tool failure, human rejection, blocked action, and missing context.

**Status:** Done. Workflows support optional typed output schemas, node-required artifact labels, and workflow completion contracts. Declared contracts reject missing, extra, or wrong-typed outputs before downstream use, reject missing or boundary-violating artifacts, and block successful completion until required outputs and artifacts exist. Runtime failures persist distinct validation, tool, human-rejection, missing-context, and blocked-action classifications.

## P5-T07 — Harness controls and validation matrix

- Complete permissions, workspace scope, sandbox, retry, approval, schema, and completion controls.
- Require explicit confirmation for destructive actions or broader access.
- Test every lifecycle state against save, approve, assign, compile, execute, revise, and complete actions.

**Status:** Done. The graph editor now exposes sandbox, retry, loop, concurrency, tool, destructive-action approval, output-schema, artifact, and completion controls. Assignment creation requires explicit confirmation before workspace writes or destructive-action approval bypasses. A lifecycle matrix verifies independent draft, definition, assignment, compile, and execute gates, including missing and stale approval records.

## P5-T08 — Validation edge-case matrix

- Handle empty graphs, multiple entry nodes, unreachable terminals, duplicate/self edges, invalid cycles, exhausted loops, missing branches, and approval nodes without continuation paths.
- Handle missing, renamed, duplicated, malformed, oversized, stale, archived, deleted, or incompatible skills and pinned skill versions.
- Handle absent, blank, malformed, conflicting, or unexpectedly changed external inputs, schemas, artifacts, and completion criteria.
- Detect stale workflow versions, concurrent graph edits, approval of an outdated version, and assignment overrides based on superseded definitions.
- Invalidate the correct approval when graph structure, prompts, skills, inputs, permissions, project root, or harness settings change.
- Reject path traversal, symlink escape, inaccessible roots, deleted roots, permission drift, and runtime access outside the approved project boundary.
- Bound retries, revisions, loops, context size, output size, execution time, concurrency, and accumulated artifacts.
- Make save, approve, compile, and execution-start requests idempotent and safe against double clicks, retries, and duplicate delivery.
- Test empty, null, malformed, unexpected, and forward-compatible API payloads without corrupting persisted data.

**Status:** Done. Validation now handles malformed and oversized models, empty and conflicting graphs, terminal continuations, incomplete approval paths, invalid cycles, unavailable or oversized skill context, stale definitions and concurrent edits, stale compiled assignment snapshots, deleted roots, permission drift, traversal and symlink escapes, output/artifact limits, and malformed API bodies. Workflow saves and approvals, assignment creation and mutations, run compilation, and execution starts use payload-bound idempotency keys with retained recent receipts. Regression tests cover immediate and delayed duplicate delivery, key reuse with a different payload, stale writes, direct approved-definition revisions, forward-compatible fields, root deletion, symlink escape, resource ceilings, and durable-state preservation.

## Phase completion gate

- Draft saving is never blocked solely by unresolved planning questions.
- Reusable graph approval is never blocked solely by a missing assignment.
- Assignment approval and execution remain blocked until their project-specific prerequisites pass.
- Client, API, compiler, and runtime produce matching decisions and messages.
- Every P5-T08 case has a deterministic outcome, actionable message, and automated regression test.

**Gate status:** Passed.
