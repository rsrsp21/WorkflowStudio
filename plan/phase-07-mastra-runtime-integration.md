# Phase 7: Mastra Runtime Integration

**Schedule:** Days 15–18

**Status:** Complete. Mastra compilation and execution, companion-backed Codex steps, approval suspension/resumption, PostgreSQL snapshots, cancellation, lease fencing, artifact review, diagnostics, compatibility, and controlled rollback are implemented.

## Goal

Replace the custom runtime placeholder with real Mastra workflow orchestration while preserving Workflow Studio's user ownership, approval enforcement, capability checks, PostgreSQL deployment, local companion, Codex App Server execution, artifacts, audit history, cancellation, and recovery boundaries.

## Scope

- Install and pin the supported Mastra packages, including `@mastra/core`.
- Register user-authored graphs as Mastra workflows at runtime.
- Compile typed sequential steps, conditional branches, bounded revision loops, retries, and declared outputs into Mastra primitives.
- Execute Codex-backed steps by dispatching scoped jobs to the owning user's paired companion.
- Suspend Mastra runs at workflow approval gates and resume only with an allowed decision and reviewer feedback.
- Persist Mastra run identifiers, snapshots, step state, and Workflow Studio trace identifiers using PostgreSQL.
- Bridge cancellation, reconnect, lease recovery, artifact review, validation failure, and affected-stage reruns across Mastra and the existing runtime APIs.
- Add compatibility for existing approved workflows and historical custom-engine runs without losing evidence or changing public workflow definitions.
- Remove misleading placeholder behavior and expose the active orchestration engine in diagnostics.

## Architecture boundary

Mastra becomes the workflow execution engine. Workflow Studio remains the control plane for users, reusable definitions, projects, assignment approval, capability policy, review UI, audit, and artifacts. Codex remains the focused task executor and continues to run locally through the companion. Mastra must not receive unrestricted filesystem access or global Codex skills.

## Acceptance criteria

- `@mastra/core` is installed and production code imports and executes real Mastra workflows.
- Every supported graph construct has an explicit Mastra mapping or fails compilation with a clear unsupported-capability error.
- Sequential, branch, bounded-loop, retry, approval, rejection, revision, cancellation, disconnect/reconnect, and recovery scenarios pass end to end.
- Approval gates persist a suspended workflow state and reject unknown decisions before resumption.
- Existing definitions remain reusable across projects and retain project-specific inputs and permissions at run time.
- Codex tasks execute only through the owning user's connected companion and approved project root.
- PostgreSQL contains sufficient correlation data to recover and audit Mastra runs after an application restart.
- Existing runs created before migration remain readable under a documented compatibility policy.
- The custom placeholder cannot silently bypass Mastra when Mastra mode is required.

See [the detailed Phase 7 task record](./phases/phase7-tasks.md).
