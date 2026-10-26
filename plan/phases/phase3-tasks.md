# Phase 3 Tasks: Project Workspaces, Reusable Workflows, Skills, and Graph Review

**Parent phase:** [Phase 3 — Project workspaces, reusable workflows, skills, and graph review](../phase-03-skills-and-graph-review.md)  
**Schedule:** Days 5–6  
**Outcome:** A user can create reusable workflows from one dashboard, edit their graph and skills, and select a project only when using or running a workflow.

**Current status:** Complete. All Phase 3 acceptance criteria, including loop-aware approval validation and assignment-input handling, are implemented and covered by the 85-test suite, lint, TypeScript, and production-build verification.

## Day 5 — Project and workflow foundations

### P3-T01 — Define project and reusable workflow models

- Add typed `Project`, `Workflow`, `ProjectWorkflow`, and `Skill` models.
- Include stable IDs, schema versions, timestamps, status, workspace scope, and root paths.
- Represent workflow assignments separately from reusable workflow definitions.
- Store input overrides, permissions, selected skill versions, and run references on assignments.
- Validate identifiers, paths, statuses, version references, and assignment relationships.

**Done when:** Project, workflow, assignment, and skill data can be persisted without allowing project-specific changes to mutate reusable definitions.

**Status:** Done. Typed models, creation helpers, cross-record validation, version pinning, project-root checks, and independent JSON stores are implemented in [workspace.ts](../../src/domain/workspace.ts) and [workspace-stores.ts](../../src/storage/workspace-stores.ts), with isolation and persistence coverage in [workspace-models.test.ts](../../tests/workspace-models.test.ts).

### P3-T02 — Add project workspace selection

- Add a project workspace screen with the selected folder and access scope visible.
- Support selecting an existing folder and creating/selecting an empty folder.
- Detect empty folders, existing repositories, and existing non-development workspaces.
- Keep planning inspection read-only for existing folders.
- Use a controlled browser-mode folder flow and companion folder selection.
- Require explicit confirmation of the project root when a user chooses `Use workflow`, before assignment or execution.

**Done when:** A user can select or create a project folder and see exactly which root will be used.

**Status:** Done for workspace infrastructure. Read-only inspection, empty/repository/general-workspace detection, saved projects, controlled browser navigation, companion folder selection, and local-root autofill exist. The active dashboard now opens project selection from `Use workflow`; workflow creation no longer requires or displays a project root.

### P3-T03 — Build reusable workflow library

- Add a searchable workflow library.
- Include starter workflows for software, documentation, research, compliance, content, and operations.
- Show workflow description, domain, version, status, required inputs, outputs, and supported skills.
- Support one project using multiple workflows and one workflow being assigned to multiple projects.
- Keep workflow definitions domain-neutral and reusable.

**Done when:** A user can choose a reusable workflow without assuming the project is a software repository.

**Status:** Done. The searchable/filterable library includes six domain starters, definition metadata, assignment counts/history, routed graph access, use, and deletion controls.

### P3-T04 — Create project-specific workflow assignments

- Add an assignment flow from a project to a reusable workflow.
- Copy or reference assignment-level inputs, permissions, selected skills, and harness overrides.
- Preserve project, workflow, assignment, and root-path IDs through all later requests.
- Show assignment history and current status.
- Prevent assignment edits from silently changing the reusable workflow.

**Done when:** A project can have an independently configurable workflow instance pinned to its source definition.

**Status:** Done. `Use workflow` creates an independently persisted assignment with project/root identity, ordered version pins, inputs, permissions, harness settings, graph overrides, status, and history links. Assignment graph edits do not mutate reusable definitions.

### P3-T05 — Create the curated skill registry

- Add a local registry with at least two starter skills, such as Requirements Review and Design Review.
- Display instructions, triggers, required context, inputs, outputs, permissions, and validation criteria.
- Show source, author, version, last-updated time, compatibility, workspace scope, and estimated context size.
- Support search and filters for active/archived state, scope, freshness, and size.
- Prevent archived or inactive skills from being newly selected.

**Done when:** A user can inspect and select at least two active skills with enough metadata to understand their cost and permissions.

**Status:** Done. The registry includes seeded and generated skills, search/state filters, scope, source, author, version, freshness, compatibility, context estimates, permissions, and inactive-selection enforcement.

## Day 6 — Skills and graph review

### P3-T06 — Add skill selection and version pinning

- Allow adding, removing, and reordering skills on a workflow assignment.
- Validate skill inputs and permissions against the selected project and harness policy.
- Preserve the exact selected skill version in the workflow definition.
- Warn about stale, oversized, duplicate, or overlapping skill content.
- Show context-cost estimates before planning and graph approval.

**Done when:** Existing workflow assignments remain pinned to recorded skill versions and unavailable capabilities are visibly flagged.

**Status:** Done. Assignment configuration supports add/remove/reorder, exact version pins, context totals, stale/oversized/overlap feedback, scope checks, and blocking permission validation.

### P3-T07 — Add skill editor and lifecycle controls

- Build an editor for instructions, triggers, inputs, outputs, permissions, and validation criteria.
- Support draft and published versions.
- Add explicit Edit, Duplicate, Archive, Restore, and Activate actions.
- Show version history, author, source, compatibility, and update time.
- Ensure publishing a new version does not silently alter existing workflows.

**Done when:** A user can publish a new skill version while existing workflows continue using their pinned versions.

**Status:** Done. Users can create, edit, duplicate, publish/activate, archive, restore, inspect history, and delete versions. Editing a published skill creates a new draft version while existing assignments remain pinned.

### P3-T08 — Build graph review and readable step list

- Render the validated `WorkflowPlan` as a visual graph and a readable non-visual step list.
- Distinguish Codex, agent, validation, approval, loop, success, and failure nodes.
- Support node selection and inspection.
- Keep the graph usable on desktop, tablet, and mobile through a step-list fallback.
- Show warnings and unresolved ambiguities above the graph.

**Done when:** A user can understand the entire plan even without relying on visual graph interaction.

**Status:** Done. The routed editor provides the draggable graph, semantic node types including loops and terminal outcomes, keyboard-selectable readable steps, editable connections, and visible validation summaries.

### P3-T09 — Add node inspection and editing

- Allow editing prompts, context, input/output schemas, selected skills, retry limits, loop limits, and approval settings.
- Keep edits scoped to the current project workflow instance.
- Revalidate the plan after every graph edit.
- Highlight changed nodes and the source of each setting.
- Block approval while required fields, edges, or permissions remain invalid.

**Done when:** Every executable node can be inspected and edited with validation feedback beside the affected field.

**Status:** Done. Node names, types, prompts, input/output contracts, retries, approvals, and skills are editable with immediate graph-wide revalidation. Assignment mode stores edits as an explicit graph override, preserving provenance and definition isolation.

### P3-T10 — Add graph validation and approval boundary

- Detect missing inputs, invalid edges, unreachable nodes, cycles outside configured loops, and incomplete success/failure paths.
- Verify selected skills, permissions, workspace scope, and pinned versions.
- Show warnings separately from blocking errors.
- Require a selected project only before project-specific assignment, approval, or execution; reusable workflow planning and graph review shall remain project-independent.
- Enable `Approve and compile` only after validation passes.
- Preserve a review decision and plan/assignment identifiers for Phase 4.

**Done when:** Execution remains disabled until project context, skill configuration, and graph validation all pass explicit review.

**Status:** Done. Validation covers structure, duplicate/self/unknown edges, missing data inputs, reachability, incomplete paths, terminal outcomes, cycles outside bounded loop nodes, skill state/scope/version, permissions, context cost, and freshness. Approval unlocks only for a valid project assignment and stores the ready decision for Phase 4; execution remains a Phase 4 concern.

### P3-T12 — Replace multi-screen shell with enterprise dashboard

- Remove the left navigation sidebar and separate locked screens.
- Put workflow creation at the top with harness defaults on the right.
- Split workflow intent into objective, stages, decision points, human approvals, constraints, and expected outputs instead of requiring one large planning paragraph.
- Display created workflows as the primary home-page library with `Open graph`, `Use workflow`, and delete actions.
- Keep graph and skill editing in focused workspaces reached from the dashboard.
- Keep planning and runtime logs in a persistent bottom monitoring dock.
- Request project-root selection from `Use workflow`, never as a workflow-creation prerequisite.

**Done when:** The product can be understood and operated as one professional dashboard, and reusable workflow creation is independent of project assignment.

**Status:** Done. Implemented in [workflow-dashboard.tsx](../../src/components/workflow-dashboard.tsx), [dashboard.css](../../src/app/dashboard.css), and the dashboard-backed home route. Structured inputs are composed into the existing planning request contract, preserving adapter compatibility.

### P3-T14 — Split graph and skill management into routes

- Keep `/` focused on workflow creation, workflow cards, project use, and monitoring.
- Open each workflow graph at `/workflows/{workflowId}/graph`.
- Open the skill registry at `/skills`.
- Open skill creation at `/skills/new` and skill editing at `/skills/{skillId}/edit`.
- Remove embedded dashboard graph and skill editor state branches.
- Preserve return navigation when a graph node creates a suggested skill.

**Done when:** Graph display, skill display, skill creation, and skill editing each have stable browser URLs and no longer depend on hidden dashboard state.

**Status:** Done. Dedicated App Router pages and client workspaces are implemented, with dashboard links and route-contract tests.

### P3-T13 — Materialize generated workflow skills

- Persist every new Codex-proposed skill reference when a workflow is saved.
- Derive a stable workflow-owned skill for executable nodes that do not contain a skill reference.
- Create generated skills in draft status and expose them in the dashboard registry.
- Reuse an existing identifier instead of creating duplicate skill records.
- Allow generated skills to be inspected, edited, or deleted with confirmation.
- Remove deleted skill references from every persisted workflow node.
- Re-run materialization when graph edits introduce executable nodes without skills.

**Done when:** Saving or editing a workflow cannot leave a new executable capability invisible from the skill registry, and users retain full view/edit/delete control over generated drafts.

**Status:** Done. Implemented by the generated-skill domain materializer, server-owned workflow-save integration, registry controls, cascading node-reference cleanup, and unit coverage.

### P3-T11 — Test Phase 3 behavior

- Test project creation, existing-folder detection, and root-path scoping.
- Test reusable workflow assignment and isolation of assignment-level changes.
- Test multi-project and multi-workflow relationships.
- Test skill selection, ordering, unavailable permissions, stale/oversized warnings, and version pinning.
- Test skill draft/publish/archive/restore behavior.
- Test graph rendering, readable step-list fallback, node editing, invalid edges, unreachable nodes, and approval blocking.
- Test preservation of project, workflow, assignment, root-path, skill-version, and plan identifiers.

**Done when:** Critical workspace, reuse, skill, graph-review, and execution-boundary paths are covered by automated tests.

**Status:** Done. The 85-test suite covers workspace inspection and atomic persistence recovery, authentication and cross-user workflow isolation, no-sidebar/project-independent UI contracts, consistent icon/input contracts, strict planning schemas, structured prompt composition, iterative and acknowledged-unresolved question paths, installed-skill matching, generated-skill cleanup, multi-project assignment isolation, graph overrides, ordered version pins, inactive skill rejection, immutable publication, loop-aware reachability and external-input validation, approval unlocking, and identifier preservation.

### P3-T15 - Harden loop-aware approval and assignment inputs

- Treat an edge from a bounded loop node back into its revision path as a backedge rather than a normal entry dependency.
- Derive true workflow inputs as consumed keys that no graph node produces.
- Accept loop-carried values on later iterations without requiring them on the first pass.
- Require assignment values only for true external inputs and autofill source inputs from the selected project root.
- Suppress unreachable-node and terminal-path cascades when a graph genuinely has no entry.

**Done when:** A valid draft-review-revise workflow has a stable entry node, assignment inputs are explicit and available, and approval feedback reports root causes rather than cascading errors.

**Status:** Done. Loop-aware entry and input analysis, project-root input autofill, focused assignment-input errors, and cascade suppression are implemented with regression coverage based on the requirements-review workflow shape.

## Dependencies

| Task | Depends on |
| --- | --- |
| P3-T01 | Phase 1 domain model and Phase 2 planning contract |
| P3-T02 | P3-T01 |
| P3-T03 | P3-T01 |
| P3-T04 | P3-T01, P3-T02, P3-T03 |
| P3-T05 | P3-T01 |
| P3-T06 | P3-T04, P3-T05 |
| P3-T07 | P3-T05, P3-T06 |
| P3-T08 | Phase 2 validated `WorkflowPlan` |
| P3-T09 | P3-T08 |
| P3-T10 | P3-T02, P3-T04, P3-T06, P3-T08, P3-T09 |
| P3-T11 | P3-T02, P3-T06, P3-T07, P3-T10 |
| P3-T12 | P3-T02, P3-T03, P3-T05, P3-T08 |
| P3-T13 | P3-T05, P3-T07, P3-T08 |
| P3-T14 | P3-T08, P3-T12, P3-T13 |
| P3-T15 | P3-T04, P3-T09, P3-T10 |

## Phase 3 acceptance checklist

- [x] Project, reusable workflow, assignment, and skill models are persisted and validated.
- [x] User can select an empty or existing project folder with visible root scope.
- [x] Workflow creation does not require a project root; project selection begins from `Use workflow`.
- [x] The home page is a unified dashboard without a left sidebar.
- [x] Existing folders are inspected read-only during planning.
- [x] User can assign reusable workflows across multiple projects without definition mutation.
- [x] User can select, remove, and reorder at least two active skills.
- [x] Selected skills retain explicit versions in workflow definitions.
- [x] Archived or inactive skills cannot be newly selected.
- [x] Skill context cost, freshness, compatibility, and permission metadata are visible.
- [x] Saving a workflow automatically creates missing workflow-scoped draft skills and exposes them in the registry.
- [x] User can inspect, edit, and confirm deletion of generated skills without leaving dangling node references.
- [x] Graph, skill registry, skill creation, and skill editing have dedicated routes.
- [x] User can inspect and edit generated graph nodes and connections. Advanced schema/provenance editing remains.
- [x] Graph validation catches missing inputs, invalid edges, unreachable nodes, and incomplete paths.
- [x] Bounded revision backedges preserve a valid entry node, and true external inputs are autofilled and validated on the assignment.
- [x] Graph has a readable non-visual stage and connection representation.
- [x] Execution remains disabled until project, skill, graph, and approval validation pass; Phase 3 now persists the validated ready boundary consumed by Phase 4.
- [x] Project, workflow, assignment, root-path, plan, and skill-version identifiers are preserved for Phase 4 runtime execution.
- [x] Users can permanently delete their own created workflows with explicit confirmation.
- [x] Workflow graph, skill registry, skill creation, and skill editing remain focused routed screens rather than one embedded dashboard screen.
- [x] Project-root selection is separate from reusable workflow planning and begins only from `Use workflow`.
