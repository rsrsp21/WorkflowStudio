# Phase 1: Project Foundation and Data Model

**Schedule:** Days 1–2

**Status:** Complete. Later UI refinements retained the Phase 1 shell while moving project-folder selection into Phase 3.

Detailed task breakdown and status: [plan/phases/phase1-tasks.md](./phases/phase1-tasks.md)

## Goal

Create a runnable local-first product foundation with the typed data model and persistence boundaries required by later product phases.

## Tasks

- Set up the frontend, local backend/companion service, and development scripts.
- Establish the Mastra runtime and Codex adapter interfaces.
- Define schemas for:
  - `WorkflowPlan`
  - `Project` and project folder metadata
  - Reusable `Workflow` definitions
  - `ProjectWorkflow` assignments
  - Nodes and edges
  - Skills
  - Harness policies
  - Run state and lifecycle events
  - Approval decisions
  - Artifacts and validation findings
- Add schema versioning for workflow definitions.
- Add local persistence for workflows, runs, events, and artifacts.
- Build the application shell, utility header, sidebar navigation, single-screen content views, and empty states.
- Add safe defaults for sandbox mode, retries, concurrency, and approvals.

## Deliverables

- Application starts locally.
- A workflow definition can be saved and loaded.
- Projects, reusable workflows, and project-workflow assignments have separate identities.
- Typed interfaces are shared by UI, backend, and runtime adapters.
- Persistence and adapter boundaries are ready for implementation.
- The content pane scrolls independently from the fixed sidebar, and prerequisite-dependent screens can be locked safely.

## Acceptance criteria

- Invalid workflow data is rejected with a readable error.
- No secrets or authentication details are exposed unnecessarily to the browser.
- A saved workflow survives application restart.
