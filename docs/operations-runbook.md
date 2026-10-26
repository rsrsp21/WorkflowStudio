# Workflow Studio operations runbook

## Monitoring contract

Set `WORKFLOW_STUDIO_METRICS_TOKEN` from the deployment secret store to a random value of at least 32 characters. Configure the monitoring scraper to call `GET /api/metrics` with `Authorization: Bearer <token>`. The endpoint returns Prometheus text and contains aggregate counts only.

Monitor these signals:

- `workflow_studio_database_probe_milliseconds`
- `workflow_studio_oldest_queued_job_seconds`
- `workflow_studio_runtime_jobs{state="failed"}`
- `workflow_studio_expired_run_locks`
- `workflow_studio_quarantined_records`
- `workflow_studio_companions{state="connected"}`
- `/api/health` readiness and `/api/health/live` liveness

Initial alert thresholds for staging are database probe above 1,000 ms for five minutes, oldest queued job above 120 seconds, any expired run lock for five minutes, any quarantined record, readiness failure on an instance, or a sustained increase in failed jobs. Tune thresholds from canary traffic before broad launch.

Never put the metrics token in browser code, logs, screenshots, or support bundles. Rotate it by updating the secret store and scraper together, then restart the web instances.

## Release and canary identity

Set an immutable `WORKFLOW_STUDIO_RELEASE_ID` for each image. `GET /api/version` reports the release ID, API schema, database schema, runtime engine, runtime version, and companion compatibility. A canary may be promoted only when every instance reports the intended release and compatible schema values.

Run `npm run qualify:multi-instance` against two canary instances sharing the canary database. A mismatch in `/api/version`, readiness, session sharing, pairing, heartbeat visibility, or revocation is a promotion failure.

Run `npm run qualify:rollout` against the externally reachable canary using the exact release ID, database schema, and metrics token. Keep its JSON report with the release evidence. The command also downloads the published companion and verifies its SHA-256 and Ed25519 signature with the published public key.

## Retention

Configure:

```dotenv
WORKFLOW_STUDIO_RUN_RETENTION_DAYS=90
WORKFLOW_STUDIO_JOB_RETENTION_DAYS=30
WORKFLOW_STUDIO_CONNECTION_RETENTION_DAYS=30
```

Schedule `npm run retention:check` daily and retain its aggregate report. Schedule `npm run retention:enforce` only after the dry-run result has been reviewed. Enforcement expires pending local approvals, removes expired locks and sessions, deletes expired unused pairing records, removes old terminal runs/jobs and rate-limit buckets, and writes an immutable audit record before removing a retained run.

Take and verify a database backup before changing retention periods. Audit events are not deleted by the retention command.

## Incident actions

### Database readiness failure

1. Remove failing instances from traffic using `/api/health`.
2. Check PostgreSQL connectivity, pool saturation, storage, replication, and provider status.
3. Keep liveness separate from readiness so the orchestrator does not restart a healthy process repeatedly during a database incident.
4. Restore traffic only after `npm run db:check` and `npm run db:verify` pass.

### Queue growth or companion reconnect storm

1. Inspect queued, leased, and failed job metrics plus oldest queue age.
2. Confirm both web instances report the same release and database schema.
3. Run the cross-instance heartbeat load tool in staging, never with a production user credential.
4. Revoke a compromised or malfunctioning connection from Profile → Local runtime. Revocation is enforced across all instances through PostgreSQL.

### Suspected tenant or reviewer access issue

1. Disable the affected account or remove its reviewer assignment through administrator controls.
2. Preserve audit records and correlation IDs.
3. Export a redacted support bundle; do not copy database credentials or companion tokens.
4. Validate that reviewer queues and artifacts contain only explicitly delegated owners.

## Rollback

Keep the previous server image, database backup, release manifest, and companion ZIP/checksum. Before rollback, stop new run creation, allow or cancel active tasks, create a backup, and record the decision. Restore the previous server only if its reported database and runtime schema are compatible. Historical legacy runs remain readable; enabling creation through the legacy engine is an emergency action requiring both documented rollback flags.

After rollback, run readiness, schema verification, multi-instance qualification, a companion heartbeat, and an approval/revision workflow before reopening traffic.
