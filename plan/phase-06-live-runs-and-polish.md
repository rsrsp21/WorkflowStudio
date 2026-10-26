# Phase 6: Live Runs, History, and Product Readiness

**Schedule:** Days 11–14

**Status:** Complete for the browser-first, single-instance release.

**Verified:** 2026-09-04

## Goal

Deliver the complete governed lifecycle after workflow creation: project assignment, immutable compilation, focused Codex execution, validation and revision loops, human decisions, local-action approvals, completion, history, and recovery.

## Delivered product flow

```text
Create reusable workflow
→ answer and re-plan, keep the first proposal, or continue with unresolved context
→ save draft
→ edit and approve reusable graph
→ choose project root
→ configure and approve assignment
→ compile immutable run
→ run focused Codex stages
→ validate, retry, revise, approve, or stop through explicit routes
→ inspect artifacts, verification, activity, history, and audit evidence
```

## Delivered capabilities

- Lifecycle timeline that keeps definition, assignment, workflow-gate, and local-action approvals separate.
- Live runner with automatic sequential progression until a decision, blocked action, failure, cancellation, or completion.
- Readable node inspection, branches, loops, retries, artifacts, findings, verification results, and retained activity.
- Configurable approval labels and keywords with continue, revise, and stop routes.
- Domain-neutral workflow and skill examples, including an editable multi-skill product-planning workflow.
- User-owned local companion that runs the pinned Codex App Server against explicitly allowed local folders.
- Command, file-change, network/permission, and MCP elicitation approval relay with expiry and redaction.
- Durable cancellation, provider interruption, idempotency, stale-lease recovery, and late-result race protection.
- Paginated run history, JSON/Markdown run export, workflow export, retention, and safe terminal-run deletion.
- Five versioned data migrations, corruption quarantine, per-user backup/restore, support bundle, and error recovery UI.
- Immutable, redacted audit events for approvals, cancellation, export, deletion, backup, restore, and retention.
- Harness v2 contracts for identity and behavior, runtime, observability, verification, adaptation, and governance/security.
- Opt-in adaptation candidates that require an explicit human decision and never alter an active workflow.
- Responsive layouts, semantic controls, keyboard interactions, consistent focus/error states, and bounded rendering for large histories.
- npm-compatible `workflow-studio-runtime` package and local/deployed pairing documentation.

## Release boundary

This release supports one Workflow Studio server instance backed by PostgreSQL, with multiple isolated user accounts and multiple independent runs. Roles are retained for identity and audit responsibility; resources remain strictly owner-scoped.

Real Mastra orchestration is tracked in Phase 7. PostgreSQL multi-instance operation, organization-wide shared resources/RBAC, parallel nodes inside one run, signed distribution, and hosted third-party integrations are tracked in Phase 8—not unfinished Phase 6 requirements.

## Acceptance record

- [x] Draft save is independent from reusable-definition approval.
- [x] Reusable-definition approval is independent from project assignment.
- [x] Assignment approval and exact project scope are required before compilation and execution.
- [x] A run executes focused Codex stages and follows explicit branches and bounded revision loops.
- [x] Agent output cannot bypass output, artifact, route, completion, or human-gate verification.
- [x] Refresh, reconnect, interruption recovery, cancellation, and duplicate delivery preserve durable state.
- [x] Workflow decisions and local Codex side-effect approvals are shown and persisted separately.
- [x] History, exports, retention, deletion, backup, restore, diagnostics, redaction, and audit are operational.
- [x] All six harness layers are compiled into and preserved with every run.
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run runtime:package`, and `npm run build` pass.

See [the detailed Phase 6 task record](./phases/phase6-tasks.md) and [the local companion guide](../docs/local-runtime-companion.md).
