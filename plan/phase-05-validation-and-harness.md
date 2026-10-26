# Phase 5: Validation and Harness Controls

**Status:** Complete

**Schedule:** Days 9–10

## Goal

Make workflow execution safe, bounded, observable, and contract-driven.

## Tasks

- Formalize and enforce the lifecycle gates independently:
  - A generated workflow may be saved as a draft with unanswered open questions.
  - Users may answer and re-plan, keep the generated plan, or explicitly continue with unresolved questions.
  - A reusable graph may be approved without selecting a project or creating an assignment.
  - Project selection is required only when creating a project-specific assignment.
  - Assignment approval validates project inputs, pinned skills, permissions, and harness settings without changing the reusable definition.
  - Execution requires an approved reusable definition and an approved assignment.
- Add a shared lifecycle-policy module so UI controls, API routes, domain validation, and tests use the same gate decisions and messages.
- Distinguish save validation from approval validation: saving preserves incomplete work; approval blocks only on structural or safety errors relevant to that approval level.
- Implement pre-execution graph validation for:
  - Missing inputs
  - Incompatible outputs
  - Unreachable nodes
  - Unbounded loops
  - Missing failure paths
  - Approval gates without continuation paths
- Validate node outputs against declared schemas.
- Validate required artifacts and completion criteria.
- Keep automated acceptance checks separate from human approval decisions.
- Keep reusable-definition approval, assignment approval, destructive-action approval, and in-run human-node approval as separate persisted decisions.
- Build the harness panel for permissions, workspace scope, sandbox, schemas, retries, approvals, and completion rules.
- Require explicit confirmation for broader workspace access or destructive actions.
- Record blocked actions and missing-context conditions.
- Add clear distinction between validation failure, human rejection, tool failure, and missing context.
- Cover malformed data, stale versions, concurrent edits, duplicate actions, dependency deletion, permission drift, path escape, bounded-resource exhaustion, and approval invalidation edge cases.

## Deliverables

- A single lifecycle validation policy used consistently by the client, APIs, persistence, compiler, and runtime.
- Incomplete or unsafe workflows cannot start.
- Invalid outputs cannot silently reach downstream nodes.
- Harness decisions are visible during execution.

## Acceptance criteria

- Draft saving succeeds with unresolved planning questions and preserves those questions for later review.
- Reusable graph approval succeeds without a project assignment when graph validation passes.
- Creating or approving a reusable definition never grants project access or execution permissions.
- Assignment approval requires a selected project root and all assignment-scoped inputs, skills, and permissions.
- Execution cannot start until both definition and assignment gates pass.
- UI and API behavior match for every lifecycle transition; no stale validation rule can block a transition allowed by the product flow.
- The system refuses completion when the completion contract is not satisfied.
- Retry and revision limits stop repeated failures.
- Blocked actions explain what must be resolved.
- Validation edge cases fail deterministically without corrupting drafts, approvals, assignments, or runs.
