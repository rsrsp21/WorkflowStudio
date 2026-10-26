# Workflow Studio Development Plan

This folder contains the staged product implementation plan for Workflow Studio.

The visual direction is documented in [design.md](./design.md), with reusable tokens and component rules in [design-system/README.md](../design-system/README.md).

Detailed execution tasks are organized in the [phases](./phases) folder.

Current task status is tracked in [phase1-tasks.md](./phases/phase1-tasks.md), [phase2-tasks.md](./phases/phase2-tasks.md), [phase3-tasks.md](./phases/phase3-tasks.md), [phase4-tasks.md](./phases/phase4-tasks.md), [phase5-tasks.md](./phases/phase5-tasks.md), [phase6-tasks.md](./phases/phase6-tasks.md), [phase7-tasks.md](./phases/phase7-tasks.md), and [phase8-tasks.md](./phases/phase8-tasks.md).

Runtime reliability and the user-authorized parallel execution expansion are implemented. Local verification and operational release gates are tracked in [phase9-tasks.md](./phases/phase9-tasks.md) and [the implementation report](./phases/phase9-implementation-report.md).

## Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 1 | Complete | Foundation, typed workflow model, PostgreSQL authentication and workflow ownership, public landing/auth routes, persistence, safe defaults, responsive shell, and build verification are complete. |
| Phase 2 | Complete | Structured multi-part planning, App Server/CLI adapters, streaming lifecycle, strict schemas, iterative open-question review, installed-skill matching, validation, and safety boundaries are complete. The product uses the browser-first release boundary. |
| Phase 3 | Complete | Reusable workflow creation/deletion, isolated project assignments, routed graph/skill workspaces, generated and version-pinned skills, editable graphs, loop-aware validation, external-input autofill, and validated approval are implemented. |
| Phase 4 | Complete | Approved assignments compile with external input values into durable runs, execute focused Codex tasks, select explicit routes, run bounded revision cycles, enforce exact project-root permissions, persist events/artifacts, and recover interrupted execution. |
| Phase 5 | Complete | Independent lifecycle gates, explicit permission confirmations, editable harness/output/completion contracts, stale-write protection, idempotent mutations, strict runtime boundaries, resource ceilings, and edge-case regression coverage are complete. |
| Phase 6 | Complete | Live and historical runs, cancellation/recovery, verification, exports, backup/restore, diagnostics, generic custom-gate workflows, paired local Codex action approvals, and all six Harness v2 layers are implemented and release-verified. |
| Phase 7 | Complete | Mastra registration, execution, approvals, companion dispatch, cancellation/recovery, PostgreSQL snapshots, observability, migration, and P7-T07 through P7-T10 qualification are complete. |
| Phase 8 | Launch baseline qualified; parallel expansion implemented | PostgreSQL, multi-instance coordination, organizations/RBAC, source-companion distribution, operations and local rollout qualification are implemented. Fork/join execution is now implemented with Phase 9; managed integrations remain deferred. |
| Phase 9 | Implementation complete; local qualification | Shared revision/lease/attempt fencing, durable companion delivery, transactional receipts, server-owned continuation, diagnostics, and parallel runtime integration. Production canary/promotion remain operational gates. |

Historical completion and qualification entries above describe the tested baseline, not a guarantee that arbitrary live workflows are error-free. The observed completion-handoff failure on 2026-10-22 requires the Phase 9 follow-up before claiming this reliability gap is resolved.

The automated suite covers deterministic Mastra compilation, branches, retries, bounded loops, approval suspension/resumption, PostgreSQL recovery, active-snapshot reconciliation, full multi-skill execution, Mastra companion dispatch, paired-runtime ownership/action approvals, cancellation races, verification, backup, redaction, user-specific Codex skill discovery, organization tenancy, delegated review, and signed artifact verification. Phases 1–7 and the Phase 8 launch baseline are verified by lint, TypeScript, tests, companion packaging, an optimized Next.js standalone build, PostgreSQL restore comparison, multi-instance checks, load tests, and the rollout promotion gate.

## Current local run modes

- `npm run dev` is the supported browser-mode development path.
- Node.js `24.15.0` is pinned in `.nvmrc`, `.node-version`, and `package.json`.
- The project-pinned `@openai/codex` runtime starts Codex App Server for planning and falls back to non-interactive Codex CLI on provider failure.
- Production defaults to a per-user paired local companion. It uses that user's ChatGPT Codex login and installed skills, keeps Codex App Server and project files local, and exchanges user-scoped jobs with the deployed control plane over outbound HTTPS.
- PostgreSQL is the control-plane persistence layer, including Mastra runtime state. Scaling work does not alter the local companion boundary.
- The main UI and companion are Next.js applications; the companion ZIP uses portable Node and does not require a native installer.

## Plan structure

| Phase | Focus | Target days |
| --- | --- | --- |
| [Phase 1](./phase-01-foundation.md) | Project foundation and data model | Days 1–2 |
| [Phase 2](./phase-02-planning.md) | Natural-language planning and WorkflowPlan generation | Days 3–4 |
| [Phase 3](./phase-03-skills-and-graph-review.md) | Project workspaces, reusable workflows, skills, and graph review | Days 5–6 |
| [Phase 4](./phase-04-runtime-and-codex.md) | Durable workflow runtime and Codex execution | Days 7–8 |
| [Phase 5](./phase-05-validation-and-harness.md) | Validation and harness controls | Days 9–10 |
| [Phase 6](./phase-06-live-runs-and-polish.md) | Live runs, approvals, history, recovery, and product readiness | Days 11–14 |
| [Phase 7](./phase-07-mastra-runtime-integration.md) | Real Mastra orchestration and runtime migration | Days 15–18 |
| [Phase 8](./phase-08-scale-collaboration-and-distribution.md) | Scale, collaboration, parallel execution, and managed distribution | Days 19–24 |
| [Phase 9](./phase-09-runtime-state-and-completion-reliability.md) | Runtime ownership and reliable companion completion | Estimate after P9-T01 |

## Project and workflow model

Phase 3 now includes project workspaces and reusable workflow assignment. The intended flow is:

```text
Generate reusable workflow -> Answer and re-plan, keep current, or continue unresolved -> Save draft
-> Open routed graph or skill workspaces -> Approve reusable graph
-> Choose Use workflow -> Select project root -> Create assignment -> Approve assignment -> Compile -> Execute
```

Project folders may be empty or existing and may contain software, documents, research, operations, media, or other work. A project can use multiple workflows, and a reusable workflow can be assigned to multiple projects.

The dashboard creates reusable workflows without requiring a project. Project selection and root confirmation occur from `Use workflow`, immediately before project-specific assignment and future execution.

The authoritative lifecycle keeps four gates independent: draft persistence, reusable-definition approval, project-assignment approval, and in-run human approval. Open questions remain visible context and do not prevent saving a draft. A project is not required to approve a reusable graph; it is required for assignment approval and execution.

## Product outcome

The product shall support this complete flow:

```text
User prompt → Codex planning → Answer and re-plan, keep current, or continue unresolved
→ Save reusable draft → Skill selection → Reusable graph approval
→ Project assignment → Assignment approval → Compile → Workflow Studio execution
→ Focused Codex task → Validation/revision loop → In-run human approval
→ Final artifacts, history, and recovery trace
```

## Scope guardrails

Prioritize reliable, recoverable end-to-end behavior before expanding integrations. Workflows must remain reusable and domain-neutral rather than assuming software development. Real Mastra orchestration is Phase 7. PostgreSQL scaling, organization collaboration/RBAC, parallel nodes, signed distribution, and managed integrations are Phase 8 rather than hidden inside the completed Phase 6 release.
