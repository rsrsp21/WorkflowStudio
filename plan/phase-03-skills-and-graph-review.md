# Phase 3: Project Workspaces, Reusable Workflows, Skills, and Graph Review

**Schedule:** Days 5–6

**Status:** Complete. Reusable workflow assignments, versioned skill lifecycle, loop-aware graph approval, external-input autofill, routed workspaces, and automated coverage are implemented.

Detailed task breakdown and status: [plan/phases/phase3-tasks.md](./phases/phase3-tasks.md)

## Goal

Let users create reusable workflows from one dashboard, control skills and the generated graph, and select a project folder only when applying or executing a workflow.

## Implemented baseline

- Typed and independently persisted `Project`, reusable `Workflow`, `ProjectWorkflow`, and `Skill` records.
- Cross-record validation for project roots, assignment isolation, permissions, selected skill versions, and reusable workflow versions.
- Unified dashboard with workflow creation independent of project selection.
- Structured workflow creation fields for objective, stages, decisions, approvals, constraints, and outputs.
- Read-only detection of empty folders, repositories, and general workspaces.
- Controlled browser folder navigation and empty-folder creation, with companion folder selection.
- Project autofill using the local server root and workflow-form autofill using an editable planning example.
- Project-root selection opened from `Use workflow`, after reusable workflow creation and graph editing.
- Persistent bottom monitoring dock for planning and future runtime events.
- Draggable graph nodes, editable node settings, add/remove connections, and right-side harness controls.
- Seeded skill registry plus automatic workflow-scoped draft generation with inspect, edit, confirmed delete, and node-reference cleanup flows.
- Readable plan-stage and edge previews, warnings, open questions, basic unknown-edge validation, and a locked compile boundary.
- Local History deletion for generated workflow plans with explicit confirmation.

## Completed Phase 3 scope

- Searchable reusable workflow library with six domain starters and assignment history.
- Project-to-workflow assignment creation with isolated graph, input, permission, harness, and skill configuration.
- Ordered skill selection, exact version pins, compatibility/context-cost warnings, history, and lifecycle controls.
- Editable node contracts, keyboard-readable steps, assignment override provenance, and bounded loop semantics.
- Reachability, data-input, edge, cycle, terminal-path, permission, skill, and approval validation.
- Automated coverage for workflow, skill, assignment, graph, approval, cleanup, and identifier behavior.

## Tasks

- Define `Project`, reusable `Workflow`, and `ProjectWorkflow` assignment models.
- Add a project workspace screen with actions to select an existing folder or create/select an empty folder.
- Detect whether the selected folder is empty, an existing repository, or another existing workspace without assuming a development project.
- Add a controlled local folder browser for browser mode and companion folder selection.
- Add a reusable workflow library for software, documentation, research, compliance, content, operations, and other domains.
- Allow one project to use multiple workflows and one workflow to be assigned to multiple projects.
- Create project-specific workflow instances with input overrides, permissions, selected skills, and run history without mutating reusable workflow definitions.
- Require a selected project only before assignment, approval, or execution; keep reusable planning and graph review project-independent.
- Preserve project, workflow, assignment, and root-path identifiers through planning, review, execution, and history.
- Create a curated local skill registry.
- Materialize Codex-proposed and derived executable-node skills as workflow-scoped drafts whenever a workflow is saved.
- Define at least two starter skills, such as requirements review and design review.
- Display skill descriptions, triggers, required context, inputs, outputs, permissions, and validation criteria.
- Support adding, removing, and reordering skills.
- Build the visual graph view and readable step list.
- Distinguish Codex, agent, validation, approval, loop, success, and failure nodes.
- Add node inspection and editing for prompts, context, schemas, skills, retries, and approval settings.
- Add graph validation warnings for missing inputs, unreachable nodes, invalid edges, and incomplete paths.
- Build a user-editable skill editor for instructions, triggers, inputs, outputs, permissions, and validation criteria.
- Allow users to inspect, edit, and delete generated skills while preventing dangling workflow-node references.
- Add skill versioning, draft/published status, archive/restore, activation, and workspace scoping.
- Display skill source, author, last-updated time, compatibility, and estimated token/context size.
- Add warnings for stale, oversized, duplicate, or overlapping skill content.
- Preserve the selected skill version in the workflow definition.

## Deliverables

- User can select at least two skills.
- User can select an empty or existing project folder and apply a reusable workflow to it.
- Project-specific changes do not silently mutate the reusable workflow definition.
- User can inspect and edit every executable node.
- User can approve or return the graph for changes.
- User can edit a skill and publish a new version without changing existing workflows silently.
- User can inspect the context cost and freshness of each selected skill.

## Acceptance criteria

- A skill with unavailable inputs or permissions is visibly flagged.
- Folder access is scoped to the selected project root and shown before execution.
- Empty-folder workflows cannot create files until workspace-write execution is approved.
- Existing folders are inspected read-only during planning.
- Workflows are not restricted to software-development projects.
- The graph has a readable non-visual representation.
- Execution remains disabled until the plan passes review and approval.
- Existing workflows remain pinned to their recorded skill versions.
- Archived or inactive skills cannot be newly selected.

The Phase 3 graph editor supports definition-only review and project-assignment review. Valid assignments can be explicitly approved and persisted as `ready`; compilation and runtime execution begin in Phase 4.
