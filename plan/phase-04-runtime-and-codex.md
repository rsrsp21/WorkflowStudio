# Phase 4: Durable Runtime Foundation and Codex Execution

**Status:** Complete. Approved assignments compile external input values into durable runs, execute focused Codex tasks, choose explicit branches, run bounded revision cycles, enforce assignment-root read/write boundaries, persist append-only execution history and artifacts, and recover interrupted nodes from durable state.

Detailed task breakdown and status: [plan/phases/phase4-tasks.md](./phases/phase4-tasks.md)

**Schedule:** Days 7–8

## Goal

Compile an approved plan into Workflow Studio's durable runtime model and execute a focused Codex task within the graph. Real Mastra orchestration is introduced in Phase 7.

## Tasks

- Implement approval-to-compilation flow.
- Bind every run to a `ProjectWorkflow` assignment and its selected project root.
- Permit creation in an empty folder or modification of an existing folder only after explicit workspace-write approval.
- Reject runtime file access that escapes the selected project root.
- Compile typed nodes, edges, state, retries, loops, and gates into the durable runtime model.
- Implement sequential execution first.
- Add conditional branches and bounded revision loops.
- Implement the baseline governed execution sequence:
  - Draft
  - Review
  - Revise
  - Validate
- Build the Codex execution adapter for focused node prompts.
- Pass only the node prompt, relevant prior outputs, selected skills, workspace context, and harness state.
- Return structured node output to the durable runtime.
- Preserve planning, workflow, run, and node task identifiers.
- Preserve project and project-workflow assignment identifiers in every run and artifact.

## Deliverables

- An approved workflow executes through the durable custom runtime that Phase 7 will migrate to Mastra.
- At least one node executes through Codex.
- Failed validation can route to a bounded revision step.

## Acceptance criteria

- Full original planning prompt is not automatically sent to every execution node.
- Every loop has an explicit maximum iteration count.
- Codex failures result in visible node failure and recovery state.
