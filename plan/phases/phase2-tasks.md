# Phase 2 Tasks: Natural-Language Planning

**Parent phase:** [Phase 2 — Natural-Language Planning](../phase-02-planning.md)  
**Schedule:** Days 3–4  
**Outcome:** A user can submit a workflow description and receive a validated, reviewable `WorkflowPlan` without execution bypassing approval.

**Current status:** Complete for the browser-first product. The supported release is browser-first with the Next.js companion.

## Day 3 — Planning input and adapter flow

### P2-T01 — Define planning request contract

- Create the typed request shape for planning input.
- Include workflow name, planning prompt, workspace path, constraints, output requirements, and execution settings.
- Define the response envelope for a structured plan, warnings, open questions, and trace identifiers.
- Confirm that planning and execution requests use separate types.

**Done when:** The frontend and backend share one typed planning contract.

**Status:** Done. Shared request, response, error, trace, and execution-boundary types are defined in [planning.ts](../../src/domain/planning.ts), and the Codex adapter consumes them.

### P2-T02 — Build the planning input experience

- Add fields for:
  - Workflow name
  - Natural-language workflow description
  - Workspace or repository path
  - Constraints
  - Desired outputs
  - Approval policy
- Add safe defaults for sandbox mode, retry limit, and concurrency.
- Add field-level validation and accessible labels.
- Preserve entered values when a request fails.

**Done when:** A user can prepare a complete planning request without using a terminal.

**Status:** Done. The workflow screen captures the complete planning request with safe execution defaults, accessible field errors, failure-safe controlled values, and an optional editable autofill example. Project-root selection is handled separately and must be confirmed first.

### P2-T03 — Implement the Codex planning adapter

- Add a planning-only method to the Codex adapter.
- Send the original planning prompt with the selected project context.
- Preserve the planning thread identifier.
- Keep the adapter independent from the Mastra execution adapter.
- Return a typed result or a typed error.

**Done when:** The application can call the planning boundary without coupling it to execution.

**Status:** Done. Dedicated planning routes validate the shared request contract and call a typed planning-only adapter. Codex App Server is primary and uses the project root, read-only sandboxing, structured output, streamed thread/turn/item events, and trace identifiers. A non-interactive `codex exec` adapter provides schema-equivalent fallback for provider failure. Both use the project-pinned Codex runtime and isolated `CODEX_HOME`.

### P2-T04 — Package Workflow Studio as a local desktop app

- Package the browser UI and local companion as separate Next.js applications.
- Start each Next.js server through its documented Node command.
- Keep the project-pinned Codex runtime on the user’s computer with read-only planning defaults.
- Store workflow data under the user’s Electron application-data directory.
- Provide a Windows installer build command.

**Done when:** The planning UI can invoke the real local Codex runtime and receive a traceable, structured planning response in development and from the packaged desktop app.

**Status:** The browser-first product and Next.js companion provide the complete supported product lifecycle.

### P2-T05 — Add request lifecycle states

- Implement idle, submitting, receiving, success, failure, timeout, and retry states.
- Show progress feedback while Codex is planning.
- Disable duplicate submissions while a request is active.
- Provide a clear retry action after failure.

**Done when:** Every normal and failure path has a visible user-facing state.

**Status:** Done. The planning UI now tracks idle, submitting, receiving, success, failure, and timeout states, prevents duplicate submissions, streams progress, preserves entered values after failures, and reports lifecycle outcomes clearly. Internal App Server/CLI protocol noise is filtered from the user-facing event list.

## Day 4 — Plan parsing, validation, and review handoff

### P2-T06 — Parse and validate `WorkflowPlan`

- Validate the response against the workflow schema.
- Check required fields, node types, node identifiers, edges, harness settings, and status.
- Reject free-form prose when a structured plan is required.
- Return field-level and plan-level validation messages.

**Done when:** Invalid planning output cannot enter graph review as if it were valid.

**Status:** Done. CLI JSON is normalized, validated for the complete workflow envelope, node and edge graph, harness policy, and status, then rejected with typed errors before persistence.

### P2-T07 — Surface ambiguities and warnings

- Display unresolved questions from the plan.
- Identify missing workspace context, permissions, skills, outputs, or completion criteria.
- Distinguish warnings from blocking validation errors.
- Allow the user to resolve or annotate open questions before continuing.

**Done when:** The system surfaces uncertainty instead of silently inventing requirements.

**Status:** Done. Generated plans now pause in a review gate that displays warnings, exposes editable open questions, and requires an explicit save action before persistence.

### P2-T08 — Build the plan summary view

- Show the original planning prompt.
- Show interpreted intent and workflow summary.
- Show proposed stages, inputs, outputs, skills, and completion criteria.
- Show constraints separately from generated assumptions.
- Show planning thread and plan identifiers for traceability.

**Done when:** A user can understand what Codex interpreted before reviewing the graph.

**Status:** Done. The planning review now summarizes the original prompt, interpreted intent, stages, inputs, outputs, skills, constraints, generated warnings, completion criteria, workspace, planning thread, and plan identifier.

### P2-T09 — Add planning-to-review handoff

- Store the validated draft plan locally.
- Pass the plan to the graph review screen without compiling or executing it.
- Add actions for `Review graph`, `Refine plan`, and `Start over`.
- Prevent `Approve and compile` until the graph review phase.

**Done when:** Planning output always enters a review boundary before runtime execution.

**Status:** Done. Validated drafts are saved locally and handed to a non-executing graph review view with `Review graph`, `Refine plan`, and `Start over` actions. `Approve and compile` remains disabled. Saved plans can be removed later from History with a two-step delete confirmation.

### P2-T10 — Test Phase 2 behavior

- Test valid planning responses.
- Test missing required fields.
- Test malformed JSON and free-form provider output.
- Test provider timeout and retry behavior.
- Test ambiguity display.
- Test that planning cannot directly start execution.
- Test that planning identifiers are preserved.

**Done when:** Critical planning and safety paths are covered by automated tests.

**Status:** Done. Vitest covers valid and invalid plans, required fields, malformed and free-form responses, provider timeout and retry rules, ambiguity display, trace preservation, and the planning-to-execution safety boundary.

### P2-T11 — Add iterative question review and automatic installed-skill matching

- Split workflow creation into objective, stages, decision points, human approvals, constraints, and expected outputs.
- Preserve open questions and answer records in the strict planning response schema.
- Let users answer questions and regenerate the plan with those answers.
- Let users explicitly keep the first generated plan and continue with acknowledged unresolved questions.
- Prevent silent workflow creation while questions remain unresolved unless the user explicitly chooses to continue.
- Match installed Codex skills to generated workflow needs automatically, including `imagegen` for image/UI-generation work.
- Fall back from Codex App Server to Codex CLI without changing the required output contract.

**Status:** Done. Iterative re-planning, explicit keep-current-plan behavior, strict `questionResponses` schema support, acknowledged unresolved questions, and installed-skill matching are implemented and tested.

## Dependencies

| Task | Depends on |
| --- | --- |
| P2-T01 | Phase 1 domain model |
| P2-T02 | P2-T01 |
| P2-T03 | P2-T01 |
| P2-T04 | P2-T03 |
| P2-T05 | P2-T02, P2-T03 |
| P2-T06 | P2-T01, P2-T03 |
| P2-T07 | P2-T06 |
| P2-T08 | P2-T06 |
| P2-T09 | P2-T06, P2-T08 |
| P2-T10 | P2-T05, P2-T06, P2-T09 |
| P2-T11 | P2-T05, P2-T06, P2-T08, P2-T09 |

## Phase 2 acceptance checklist

- [x] User can enter a complete planning request.
- [x] P2-T01 planning request contract is defined and shared.
- [x] Planning request is sent through a dedicated Codex App Server boundary with CLI fallback.
- [x] The project-pinned local Codex runtime can plan without requiring an application API key.
- [x] Structured `WorkflowPlan` is validated before display.
- [x] Open questions and warnings are visible, and question answers are captured with the reviewed workflow.
- [x] Original prompt, context, constraints, and outputs are distinguishable.
- [x] Planning identifiers are preserved.
- [x] Plan can be handed off to graph review.
- [x] Planning cannot bypass review, compilation, or execution validation.
- [x] Failure, timeout, retry, and malformed-response paths are tested.
- [x] Users can regenerate from answered open questions or explicitly continue with the original plan.
- [x] Planning automatically attaches relevant installed Codex skills without inventing unavailable skill records.
- [x] Browser-first planning and the Next.js companion work without a native installer.
