# Workflow Studio local runtime companion

## Connection recovery

The companion sends a heartbeat every 15 seconds independently of active work and idle job notifications. It reconciles the durable queue at least every 20 seconds, and expired job leases are reclaimed using a new lease token; stale workers cannot complete a reclaimed job.

Unexpected worker exits are logged to `runtime.log` in the companion state folder (by default `<user home>/WorkflowStudio/runtime/companion`). The log rotates at 1 MiB. Worker errors and exit codes are retained; bearer credentials are redacted. The launcher restarts the worker with delays from 1 to 30 seconds using the saved pairing. Pause, shutdown, revoked authorization, and incompatible versions do not trigger automatic restarts.

When a paired runtime goes offline, execution remains pending without consuming node retries. Queued or leased jobs retain their execution identity, so reconnecting waits for the existing job instead of enqueueing a duplicate. The live run page rechecks availability every 15 seconds and continues when the runtime reconnects; keep the page open for automatic continuation, or reopen it to continue later. Human approvals and missing-input gates still require their normal decisions. Completed results are retried after temporary upload failures without rerunning the local task.

## What it is

The local runtime companion is a small Node.js process that runs on each user's computer. It connects a deployed Workflow Studio account to that user's locally authenticated Codex runtime and approved project folders.

It currently starts through npm, which is why it may be called the "npm companion":

```powershell
npm run runtime:connect
```

The repository includes an npm-compatible command package. It can run from a Workflow Studio checkout today and can be packed for controlled distribution with `npm run runtime:package`; publication to an npm registry is a release-channel choice, not an architectural dependency.

## Why it is needed

A website running on a deployed server cannot directly access a browser user's local folders or `localhost`. The companion solves that boundary without exposing Codex App Server to the internet:

```text
Browser -> deployed Workflow Studio -> authenticated HTTPS job queue
                                              ^
                                              |
                                   outbound companion connection
                                              |
                                   local Codex App Server
                                              |
                                   explicitly allowed folders
```

The companion:

- Uses its own Codex login stored inside the dedicated Workflow Studio folder.
- Starts Codex App Server locally over `stdio`.
- Receives only jobs assigned to that Workflow Studio user and runtime connection.
- Discovers skills installed inside that user's Workflow Studio folder.
- Inspects and works only inside folders approved during pairing.
- Returns structured progress and results to Workflow Studio.
- Relays governed command, file-change, network, permission, and MCP elicitation requests back to the owning run so the user can allow once, answer, decline, or cancel from the UI.
- Interrupts the active Codex turn when its workflow run is cancelled.
- Reclaims stale leases after an interrupted companion process while rejecting duplicate or stale completions.

Workflow Studio does not collect an OpenAI API key. The Codex login and project files remain on the user's computer.

## Dedicated app folder

The default is `%USERPROFILE%\WorkflowStudio` on Windows or `~/WorkflowStudio` elsewhere. Set `WORKFLOW_STUDIO_HOME` to an absolute path before starting the web app, or pass `--home` to the companion and login command. Use one folder per Workflow Studio account/connection.

- `projects/`: all project folders and their generated artifacts.
- `data/`: reserved local runtime state only. Users, workflows, assignments, skills, projects, runs, approvals, and audit records are stored by the deployed Workflow Studio service in PostgreSQL.
- `.codex/`: private configuration, agent definitions, authentication, sessions, and bundled skills.
- `.agents/skills/` and `.codex/skills/`: app-owned skills.
- `runtime/connection.json`: the paired connection credential.

Workflows belong to the user and remain reusable across projects. The deployed control plane retains application records in its configured local PostgreSQL or Aiven for PostgreSQL database.

The app does not import global skills, agents, configuration, or credentials. On Windows the native Codex skill scanner still discovers OS user skill paths; the launcher explicitly disables those paths for this child process without reading their instructions or modifying global settings. Only app-owned skills are offered by the Workflow Studio catalog. This is configuration and project-boundary isolation, not a separate Windows user or OS container.

For a custom folder, sign in and pair using the same path:

```powershell
npm run runtime:login -- --home "C:\Users\you\WorkflowStudio"
npm run runtime:connect -- --home "C:\Users\you\WorkflowStudio" --server "https://workflow-studio.example.com" --code "PAIRING-CODE"
```

Existing checkout data, projects, and global skills are not moved automatically. The new app home starts separately. Back up the old app data before explicitly migrating it; project paths outside the new projects folder cannot execute.

## Project files and deliverables

Every execution step uses its assigned project folder as its working directory. File-editing steps edit existing files in place; all file-producing steps must report their actual created or modified files in the explicit `artifacts` manifest. The runtime verifies reported files before accepting the step result. It does not guess artifacts from output field names, filenames in prose, or file extensions. Analysis-only steps may return structured results without creating files.

Declared files already inside the project stay in place. Declared files from approved external tool-output folders are copied into `artifacts/<run>/<node>/attempt-<attempt>-iteration-<iteration>/` inside the project. Output references are rewritten to those project paths so later steps use the delivered files. All regular file types, including extensionless files, use the same delivery mechanism. Only files newly created/changed during the task or explicitly supplied as task inputs can be exported. Arbitrary private files, missing files, and paths escaping approved folders are rejected. Existing files are not overwritten by this export operation.

External sources are disabled by default. The local runtime operator may authorize narrowly scoped tool-output folders in `<Workflow Studio folder>/runtime/artifact-sources.json`:

```json
{
  "roots": ["C:/Tools/MyTool/outputs", "C:/Tools/AnotherTool/exports"]
}
```

Use actual absolute tool-output directories on the runtime computer, not filesystem roots, a whole user profile, or credential/configuration folders. No particular tool, cache location, workflow name, or file extension is pre-authorized in code. The configuration is read locally by both direct execution and the companion; the model and remote job payload cannot choose export roots. If a tool cannot save directly in the project, configure its output folder explicitly. Without that configuration, outside-project delivery fails with a boundary error rather than silently broadening access. Limits are 20 configured source folders, 10,000 inspected source files, depth 16, 50 delivered files per step, and 100 MiB per exported file / 250 MiB per step.

Project writes still require an approved workspace-write assignment. Read-only steps do not gain write access through artifact delivery. Restart a source-based companion after updating these scripts, when no task is active, or rebuild the companion package. Already completed tasks are not retroactively exported.

## Two different approval layers

Workflow Studio keeps two decisions separate:

- A **workflow gate** decides which stage runs next. Its buttons and keywords are defined by the workflow author and can say anything, such as `CONTINUE TO DESIGN`, `REVISE REQUIREMENTS`, `REGENERATE SCREENS`, or `STOP`.
- A **local action approval** decides whether one Codex command, file change, network request, or temporary permission may run inside the current task. The request is bound to the owning user, runtime job, workflow run, node, project path, and expiration.

Approving a workflow stage does not silently approve later local side effects. Likewise, allowing one local command does not approve the next workflow stage.

The deployed control plane persists application data in PostgreSQL. This server-side choice does not affect the companion, local Codex login, outbound HTTPS connection, or approved-folder boundary.

## Prerequisites

- Node.js `24.15.0`.
- A local checkout of Workflow Studio.
- Dependencies installed with `npm install`.
- Network access from the user's computer to the deployed Workflow Studio HTTPS URL.
- A Codex account authenticated locally with `npm run runtime:login`.

## Run Workflow Studio locally without pairing

This is the simplest development mode. Planning and execution start Codex App Server directly on the same computer, so the companion is not required. Use it for basic local development; use paired mode when testing the complete in-app command, file-change, permission, MCP-response, cancellation, and reconnect experience.

```powershell
cd C:\Users\srelangi\Downloads\WorkflowStudio
npm install
npm run runtime:login
npm run dev
```

Open `http://localhost:3000`.

Leave `CODEX_RUNTIME_MODE` unset or set it to `local` in `.env`:

```env
CODEX_RUNTIME_MODE=local
```

## Execution settings

### User-controlled quality revisions

Creation examples request one quality review per attempt, followed by a human decision before discretionary revisions. UI consistency review is advisory: present the generated screens and material findings, then let the user continue with recorded tradeoffs, revise selected screens, or stop. Cosmetic differences do not automatically trigger regeneration. Mandatory file, contract, permission, security, and compliance checks still apply.

At a human gate whose revision route enters an exhausted bounded loop, revision is unavailable until the user explicitly increases the loop limit in execution settings. Continue and stop remain available; an exhausted revision request is rejected without failing or changing the waiting run. These creation defaults apply to newly generated or regenerated definitions. Existing approved definitions and compiled runs retain their original graph; review and approve a new version to replace automatic quality loops with human gates.

Execution model settings are separate from the model used to create a workflow. Configure model, reasoning effort, and output verbosity on the workflow graph or individual agent steps. Before starting a compiled run, use **Edit execution settings** on the run page. At an undecided human approval gate, the same editor can update the model and harness for future steps, including revision attempts. Save or discard changes before deciding the gate. The project root remains fixed; enabling workspace writes or disabling destructive-action approval requires explicit confirmation.

Changes are recorded as numbered execution settings revisions in the run journal. Each executing step records its effective model and harness, while the original compiled graph and earlier results remain unchanged. An override selected on the run replaces that setting for subsequent steps; leaving it unset preserves each step's approved setting. Harness edits apply retries, loop limits, tools, sandbox, and approval policy to future execution.

Output verbosity requires companion version **0.1.1** or later. Restart a source-based companion after updating the checkout, or rebuild the companion package. The pinned Codex runtime supports `model_verbosity`, but does not expose temperature or top-p. These sampling controls are shown as unavailable, and unsupported settings submitted through workflow/run APIs are rejected rather than silently ignored.

## Test the paired architecture locally

Use this mode to test the same browser-to-companion flow used by a deployed installation.

1. Add this to `.env`:

   ```env
   CODEX_RUNTIME_MODE=paired
   ```

2. Start Workflow Studio in the first terminal:

   ```powershell
   cd C:\Users\srelangi\Downloads\WorkflowStudio
   npm run dev
   ```

3. Open `http://localhost:3000`, create or sign in to an account, and open **Profile -> Local runtime**.

4. Enter a dedicated Workflow Studio folder, for example `C:\Users\srelangi\WorkflowStudio`, select **Pair this computer**, and copy the generated command.

5. In a second terminal, confirm Codex authentication and run the generated command:

   ```powershell
   cd C:\Users\srelangi\Downloads\WorkflowStudio
   npm run runtime:login
   npm run runtime:connect -- --server "http://localhost:3000" --code "PAIRING-CODE" --home "C:\Users\srelangi\WorkflowStudio"
   ```

6. Keep both terminals running. The profile should show **Connected to your Codex**.

After the first successful pairing, restart the same connection with:

```powershell
npm run runtime:connect
```

The local bearer credential and approved roots are stored in `<Workflow Studio folder>/runtime/connection.json`. Restart with the same `--home` argument when using a custom folder. Existing pairing files from the source checkout are not reused.

## Connect to a deployed Workflow Studio

Every user repeats the pairing process from their own Workflow Studio profile. The generated command uses the deployed HTTPS origin:

```powershell
npm run runtime:connect -- --server "https://workflow-studio.example.com" --code "PAIRING-CODE" --home "C:\Users\you\WorkflowStudio"
```

The companion initiates outbound HTTPS requests. It does not require an inbound firewall port and does not publicly expose local Codex App Server.

## What remains available when the companion stops

### Continuous execution and recovery

After starting a run on the updated app with companion 0.2.0 or later, a durable server coordinator continues authorized work through ordinary steps and approved retries. Input and approval gates still pause for a real user decision. The browser may close while the always-running Node server and companion continue. Historical runs without execution authorization retain their previous manual continuation behavior. See [durable execution and parallel configuration](./runtime-reliability-and-parallel.md) for recovery, limits, and rollout requirements.

Unchosen cyclic branches are pruned by live reachability, so they cannot hold a shared terminal node pending forever. Browser and server no-progress guards reject repeated unchanged states instead of flooding the execution API. Rate-limited execution stops automatic requests, displays the retry time, and preserves completed work.

For a genuine tool failure, use **Retry failed step**. For a validation that rejected existing outputs, correct the reported issues and use **Recheck corrected outputs**. Rechecking reopens that validation on the same run, preserving previous files, history, inputs, and approvals; it does not accept invalid files or automatically regenerate completed work. Human stops and cancelled runs cannot be reopened through validation recovery.

Users can still sign in and view persisted workflows, assignments, approvals, run history, and monitoring data. Local project inspection, installed-skill discovery, planning, and execution remain unavailable until that user's companion reconnects.

After reconnecting, saved companion results replay without running the provider again. If the companion stopped before saving a result, inspect the interrupted stage before explicit recovery. Durable execution does not automatically reclaim an uncertain leased provider task. Completed stages and append-only events are preserved. A cancelled run cannot be resumed or overwritten by a late companion result.

## Backups, retention, and diagnostics

Open **Profile -> Data and diagnostics** to download a logical account backup, restore a validated compatible backup, or download a redacted support bundle. Finished run history can be exported or deleted from **Runs and monitoring**. The storage layer uses versioned PostgreSQL migrations, pooled connections, transactions, health checks, and corruption quarantine records.

## Troubleshooting

- **Runtime offline:** Keep `npm run runtime:connect` running and confirm the deployed URL is reachable.
- **Codex sign-in needed:** Run `npm run runtime:login`, then restart the companion.
- **Pairing code rejected:** Codes work once and expire after ten minutes; generate a new code.
- **Folder rejected:** Create the project inside `<Workflow Studio folder>/projects`. Existing projects outside this folder must be explicitly copied or moved before use.
- **Connection rejected after server data loss:** The server no longer has the matching token hash; pair again.
- **Changed deployment domain:** Generate a new pairing and use the new HTTPS URL.

## Distribution

The supported cross-platform companion is the Node.js command in this repository. `package.json` exposes the `workflow-studio-runtime` binary and pins the compatible Codex runtime. A release owner can produce and inspect the package manifest with:

```powershell
npm run runtime:package
```

The Next.js companion preserves the required user-owned Codex and local-folder boundary without a native installer.
