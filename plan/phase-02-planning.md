# Phase 2: Natural-Language Planning

**Schedule:** Days 3–4

**Status:** Core browser-first planning flow complete.

Detailed task breakdown and status: [plan/phases/phase2-tasks.md](./phases/phase2-tasks.md)

## Goal

Turn the user's natural-language request into a structured, reviewable `WorkflowPlan` without allowing planning output to execute automatically.

## Tasks

- Build the workflow creation form.
- Capture workflow description, selected project workspace, constraints, output requirements, and execution settings.
- Keep planning compatible with empty folders and existing project folders.
- Keep workflow intent domain-neutral; planning must not assume the project is software development.
- Use Codex App Server as the primary locally authenticated planning adapter, with non-interactive Codex CLI fallback for provider failure.
- Stream user-meaningful Codex activity to the planning workspace while filtering internal protocol and shell noise.
- Parse and validate the returned `WorkflowPlan`.
- Display:
  - Original planning prompt
  - Interpreted intent
  - Proposed stages
  - Inputs and outputs
  - Constraints
  - Completion criteria
  - Open questions and ambiguities, with explicit answers captured during post-generation review
- Add loading, timeout, retry, and malformed-response handling.

## Deliverables

- A user can submit a workflow request.
- The UI displays a structured plan and unresolved questions.
- Planning identifiers are preserved for traceability.
- Validated plans can be deleted later from local History through explicit confirmation.

## Acceptance criteria

- Free-form planning prose cannot bypass plan validation or user approval.
- Missing information is shown as an open question rather than silently invented.
- A malformed Codex response produces an actionable error.

## Post-phase refinements now included

- Project selection and workflow description are separate screens.
- The workflow form provides an editable autofill example.
- App Server uses the pinned local Codex runtime, read-only planning access, structured output schema, and CLI fallback.
- Planning events hide remote-control, MCP startup, PowerShell snapshot, stdin, and generic item-completion noise.
- Hydration tolerates browser-extension or pre-hydration theme attributes without showing a false mismatch warning.
