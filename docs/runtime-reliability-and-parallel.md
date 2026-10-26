# Durable execution and parallel workflows

Implemented on 2026-10-26. This applies to the updated app, database migration 15, and companion 0.2.0 or later. Restart the app and companion together after installing the changes. Older companions can still connect for compatible discovery/planning operations, but focused execution waits for an upgraded companion.

## Ownership and continuation

PostgreSQL owns run revisions, node attempts, routes, approvals, artifacts, and accepted results. Every run write passes the same validated transition boundary. A stale revision is rejected; a stale execution owner cannot commit or dispatch more work. Mastra schedules the domain runner and stores checkpoints. A checkpoint cannot overwrite a newer authoritative run revision.

Starting a run explicitly authorizes server-side continuation. A transactional reconciliation record survives browser closure and server restart. The Node server claims this work using shared leases, renews ownership, and resumes unfinished work. The browser observes live state and submits inputs/decisions; it does not need to keep posting execute requests. This requires an always-running Node deployment. A request-only/serverless deployment needs a separately hosted worker and is not supported by the in-process coordinator.

Existing historical runs are not automatically started by this migration. Account restores preserve history but clear execution authorization for newly restored runs. Completed/cancelled runs cannot be reopened, and failed runs require explicit recovery. Input prompts, human decisions, mandatory validation, cancellation, and configured retry/loop limits still apply.

## Companion result recovery

The companion saves raw provider output before local artifact verification, then atomically saves the verified response before upload. A successful receipt and the node output, artifact records, routes, events, revision, and reconciliation work commit together in PostgreSQL. Identical completion uploads acknowledge the original receipt; conflicting payloads and stale attempts cannot modify the run.

Unacknowledged results live under `<Workflow Studio home>/runtime/results/<hashed connection identity>`. They contain the scoped task/result and local verification baseline, not the pairing token. The directory requests private POSIX permissions; Windows inherits the user profile's ACL. Keep this location within the user's protected profile. Pairing identities cannot replay each other's records.

On reconnect or restart, the companion delivers saved results before taking new tasks. Raw records rerun verification, not the provider. Lost upload acknowledgements replay the same response. A network/delivery problem does not consume a model retry. The companion enforces a bounded provider execution deadline (up to 15 minutes), separately from verification/upload. The server's wait window never authorizes regeneration of a durable leased task, even if its completion notifications were lost. A crashed attempt with neither a saved result nor a definite failure needs explicit inspection/recovery; ambiguous work is not automatically reclaimed. A progress event alone is never accepted as successful output.

If local verification fails, the raw result is retained as blocked. Correct the reported file/verification issue, then run the same paired command with `--reconcile <runtime_job_id>` appended. This retries verification and delivery only. If the original result or files cannot be recovered, inspect the run evidence before explicitly deciding whether to cancel or retry; there is no guarantee of exactly-once external side effects.

The spool is bounded to 200 records, 400 MiB total, and 40 MiB per record, allowing the existing 25 MiB artifact preview contract after base64 expansion. Capacity is checked before leasing more provider tasks. Corruption, conflicting records, and disk errors stop new work visibly. Pending/blocked records are never silently evicted. Acknowledged records are removed; abandoned atomic-write temporary files older than 24 hours are cleaned. For a permanently cancelled/revoked job, inspect/export its pending record before manually removing that specific local record. Deleting it discards recovery evidence.

Artifact verification remains generic: it uses declared manifests and approved source roots, validates paths, and preserves existing files. It does not assume images, UPI projects, or a particular workflow output key. The local development CLI path does not provide the paired companion's crash-durable delivery guarantee.

## Configure parallel work

1. Add a **Fork** with unconditional outgoing edges to independent branches. It has no generated outputs, required files, skills, or approval.
2. Mark analysis branches **Read-only** when the overall run has workspace write permission. This narrows their actual task sandbox; it does not expand any permission.
3. Connect branch ends to a **Join**. Set `all` or `quorum` and a quorum count. Give the join exactly one output key with an object schema, no input keys, no required files, and an unconditional continuation.
4. Set **Concurrent nodes** in the harness/execution settings (1–10). The default is still 1. Set the parallel failure policy to `fail-fast` or `collect-all`.
5. Approve the graph and assignment and compile a new run. These are explicit graph semantics; merely raising concurrency does not remove dependencies.

Independent read-only tasks may overlap up to the budget. Within one run, any task allowed to write the project is exclusive: it waits for that run's other tasks and prevents new overlaps. This conservative scheduling avoids concurrent branch edits; separate branch worktrees or concurrent full-workspace writers are not implemented. Separate runs do not share a project filesystem lock, so avoid overlapping writable runs against the same root. Human gates, revision loops, cyclic participants, and terminal nodes act as barriers.

The companion has a matching worker pool. `WORKFLOW_STUDIO_COMPANION_CONCURRENCY` defaults to 4 and accepts 1–10. The smaller available server/companion capacity determines observed overlap. Each node retains its own model settings, attempt identity, artifacts, and audit history. The live graph can highlight multiple active nodes.

Join output is a deterministic node-ID map in compiled graph order, containing settled ancestor evidence (`status`, `output`, and any error). This avoids last-finisher-wins merging. Quorum joins may continue once enough direct branch parents complete; unfinished contributing branches are skipped and their queued/leased jobs are cancelled. Late results cannot restore discarded branches. A join with insufficient successful branches fails validation.

`fail-fast` stops sibling work after an exhausted failure. `collect-all` lets independent branches settle after exhausted tool failures and supplies their failure evidence to the join. Mandatory validation, permission checks, missing inputs, human decisions, and safety failures remain enforced. The explicitly selected legacy rollback engine stays sequential; parallel execution uses the default Mastra engine.

## Diagnostics and qualification

The node inspector shows execution, verification, upload, blocked, and applied delivery stages. The redacted account support bundle includes run revision, acknowledged reconciliation revision, worker lease/error class, node/task/attempt/iteration, job/thread IDs, and companion queue/provider/verification/delivery timing when available. These are stage observations, not a claim that Mastra overhead has been benchmarked.

Run the repeatable database gate with `npm run qualify:runtime`. It creates a generated disposable database, tests receipt atomicity, rollback, coordinated continuation, reconnects and Mastra dispatch, then drops only that database. The PostgreSQL account needs `CREATEDB` for this command. Normal automated tests use isolated PGlite databases.

The optional real-provider bridge check is `WORKFLOW_STUDIO_REAL_CODEX_CANARY=true` with `npx vitest run tests/phase9-real-codex-canary.test.ts` (use PowerShell environment syntax on Windows). It executes a read-only nonce task through the actual Codex bridge in a disposable project and checks local result persistence. It is intentionally excluded from default tests. It is not a deployed HTTPS/full installed-companion failover test.

## Rollout and rollback

- Migration 15 is additive. Preserve database/backups and pending local spools. Do not reset state revisions or rewrite historical journals.
- Upgrade all app writers together, then companion 0.2.0. Do not mix old unguarded server writers with revision-checked writers. Old companions wait before focused work rather than silently receiving an incompatible task.
- `WORKFLOW_STUDIO_COORDINATOR=off` disables background claims. Quiesce active work before a server rollback. Old code cannot interpret fork/join runs; leave them parked until a compatible server is restored. Preserve migration 15 tables and pending receipts.
- `npm run companion:package -- --qualification` produces a separate ZIP signed with a temporary qualification key, without replacing public production downloads. Company distribution requires the established production signing process and release-owner key custody.
- Local regression, real PostgreSQL, real provider bridge, builds, and package verification are distinct from a company deployment canary. Real deployed-companion process/instance failure, managed restore, and production signing/promotion remain operational rollout checks.

The original October 22 handoff's exact missing-upload cause cannot be proven from retained history. The deadline race and crash/receipt boundaries have reproducible coverage; the new protocol prevents accepted or durably saved work from being regenerated merely because its acknowledgement was interrupted.
