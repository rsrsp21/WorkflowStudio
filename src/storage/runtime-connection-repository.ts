import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { RuntimeConnection, RuntimeJob, RuntimeJobKind, RuntimePairing, RuntimeToolApproval, RuntimeToolApprovalDecision, RuntimeToolApprovalKind } from '@/src/domain/runtime-connection';
import { COMPANION_PROTOCOL_VERSION, RUNTIME_JOB_LEASE_MS, RUNTIME_ONLINE_WINDOW_MS, RUNTIME_PAIRING_DURATION_MS } from '@/src/domain/runtime-connection';
import { getDatabase } from './async-database';
import { applyRuntimeResult, recordRuntimeDeliveryStage } from './runtime-result-application';
import { requestFingerprint } from '@/src/server/request-fingerprint';

type ConnectionRow = {
  id: string; user_id: string; name: string; pairing_code_hash: string | null; pairing_expires_at: string | null;
  token_hash: string | null; status: string; auth_mode: string | null; codex_account_label: string | null;
  platform: string | null; hostname: string | null; allowed_roots: string; created_at: string; claimed_at: string | null;
  last_seen_at: string | null; revoked_at: string | null;
  protocol_version: number | null; companion_version: string | null;
  supported_models: string; supported_reasoning_efforts: string;
};

type JobRow = {
  id: string; user_id: string; connection_id: string; kind: RuntimeJobKind; payload: string; status: RuntimeJob['status'];
  run_id: string | null; task_id: string | null; node_id: string | null;
  execution_key: string | null;
  first_leased_at?: string | null;
  lease_id: string | null; leased_at: string | null; result: string | null; error: string | null; created_at: string; updated_at: string; completed_at: string | null;
};

type ToolApprovalRow = {
  id: string; user_id: string; connection_id: string; job_id: string; run_id: string | null; task_id: string | null;
  node_id: string | null; server_request_id: string; request_method: string; kind: RuntimeToolApprovalKind; title: string;
  reason: string | null; command_preview: string | null; cwd: string | null; details: string; status: RuntimeToolApproval['status'];
  decision: RuntimeToolApprovalDecision | null; requested_at: string; expires_at: string; decided_at: string | null; decided_by: string | null;
  response_json: string | null;
};

const secretHash = (value: string) => createHash('sha256').update(value).digest('hex');
const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

function redactRuntimeValue(value: unknown, key = '', depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (/token|password|secret|authorization|cookie|api[-_]?key/i.test(key)) return '[redacted]';
  if (typeof value === 'string') return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|sess|pat)_[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .slice(0, 4000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactRuntimeValue(item, key, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([childKey, child]) => [childKey, redactRuntimeValue(child, childKey, depth + 1)]));
  return value;
}

function statusFor(row: ConnectionRow, now = Date.now()): RuntimeConnection['status'] {
  if (row.status === 'revoked' || row.revoked_at) return 'revoked';
  if (!row.claimed_at) return Date.parse(row.pairing_expires_at ?? '') > now ? 'pairing' : 'offline';
  return row.last_seen_at && now - Date.parse(row.last_seen_at) <= RUNTIME_ONLINE_WINDOW_MS ? 'online' : 'offline';
}

function publicConnection(row: ConnectionRow, now = Date.now()): RuntimeConnection {
  return {
    id: row.id,
    name: row.name,
    status: statusFor(row, now),
    ...(row.auth_mode ? { authMode: row.auth_mode } : {}),
    ...(row.codex_account_label ? { codexAccountLabel: row.codex_account_label } : {}),
    ...(row.platform ? { platform: row.platform } : {}),
    ...(row.hostname ? { hostname: row.hostname } : {}),
    allowedRoots: parseJson<string[]>(row.allowed_roots, []),
    createdAt: row.created_at,
    ...(row.claimed_at ? { claimedAt: row.claimed_at } : {}),
    ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at } : {}),
    ...(row.protocol_version ? { protocolVersion: row.protocol_version } : {}),
    ...(row.companion_version ? { companionVersion: row.companion_version } : {}),
    supportedModels: parseJson<string[]>(row.supported_models, []), supportedReasoningEfforts: parseJson<string[]>(row.supported_reasoning_efforts, [])
  };
}

function publicJob(row: JobRow): RuntimeJob {
  return {
    id: row.id, userId: row.user_id, connectionId: row.connection_id, kind: row.kind,
    payload: parseJson(row.payload, {}), status: row.status,
    ...(row.lease_id ? { leaseId: row.lease_id } : {}),
    ...(row.leased_at ? { leasedAt: row.leased_at, leaseExpiresAt: new Date(Date.parse(row.leased_at) + RUNTIME_JOB_LEASE_MS).toISOString() } : {}),
    ...(row.result ? { result: parseJson(row.result, null) } : {}),
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {})
  };
}

function publicToolApproval(row: ToolApprovalRow): RuntimeToolApproval {
  return {
    id: row.id, userId: row.user_id, connectionId: row.connection_id, jobId: row.job_id,
    ...(row.run_id ? { runId: row.run_id } : {}), ...(row.task_id ? { taskId: row.task_id } : {}), ...(row.node_id ? { nodeId: row.node_id } : {}),
    requestMethod: row.request_method, kind: row.kind, title: row.title,
    ...(row.reason ? { reason: row.reason } : {}), ...(row.command_preview ? { command: row.command_preview } : {}), ...(row.cwd ? { cwd: row.cwd } : {}),
    details: parseJson<Record<string, unknown>>(row.details, {}), status: row.status, ...(row.decision ? { decision: row.decision } : {}),
    requestedAt: row.requested_at, expiresAt: row.expires_at, ...(row.decided_at ? { decidedAt: row.decided_at } : {}),
    ...(row.decided_by ? { decidedBy: parseJson(row.decided_by, { id: 'unknown', name: 'Unknown user', role: 'unknown' }) } : {}),
    ...(row.response_json ? { response: parseJson<Record<string, unknown>>(row.response_json, {}) } : {})
  };
}

export async function createRuntimePairing(userId: string, name = 'Local Codex runtime', now = new Date()): Promise<RuntimePairing> {
  const db = await getDatabase();
  const id = `runtime_${randomUUID()}`;
  const raw = randomBytes(8).toString('hex').toUpperCase();
  const pairingCode = raw.match(/.{1,4}/g)?.join('-') ?? raw;
  const createdAt = now.toISOString();
  const pairingExpiresAt = new Date(now.getTime() + RUNTIME_PAIRING_DURATION_MS).toISOString();
  await db.run("UPDATE runtime_connections SET status = 'revoked', revoked_at = ? WHERE user_id = ? AND status = 'pairing'", [createdAt, userId]);
  await db.run(`INSERT INTO runtime_connections
    (id, user_id, name, pairing_code_hash, pairing_expires_at, status, allowed_roots, created_at)
    VALUES (?, ?, ?, ?, ?, 'pairing', '[]', ?)`,
    [id, userId, name.trim() || 'Local Codex runtime', secretHash(pairingCode), pairingExpiresAt, createdAt]);
  const row = await db.get<ConnectionRow>('SELECT * FROM runtime_connections WHERE id = ?', [id]);
  if (!row) throw new Error('Runtime pairing could not be created.');
  await db.run("SELECT pg_notify('workflow_studio_user_events', ?)", [`runtime:${userId}`]).catch(() => undefined);
  return { ...publicConnection(row, now.getTime()), pairingCode, pairingExpiresAt };
}

export async function claimRuntimePairing(input: { code: string; name?: string; platform?: string; hostname?: string; allowedRoots?: string[] }, now = new Date()) {
  const db = await getDatabase();
  const normalizedCode = input.code.trim().toUpperCase();
  const row = await db.get<ConnectionRow>("SELECT * FROM runtime_connections WHERE pairing_code_hash = ? AND status = 'pairing'", [secretHash(normalizedCode)]);
  if (!row || !row.pairing_expires_at || Date.parse(row.pairing_expires_at) <= now.getTime()) return null;
  const token = randomBytes(32).toString('base64url');
  const claimedAt = now.toISOString();
  const roots = [...new Set((input.allowedRoots ?? []).map((root) => root.trim()).filter(Boolean))];
  await db.run(`UPDATE runtime_connections SET name = ?, token_hash = ?, status = 'online', platform = ?, hostname = ?,
    allowed_roots = ?, claimed_at = ?, last_seen_at = ?, pairing_code_hash = NULL, pairing_expires_at = NULL WHERE id = ?`,
    [input.name?.trim() || row.name, secretHash(token), input.platform?.slice(0, 80) ?? null, input.hostname?.slice(0, 120) ?? null, JSON.stringify(roots), claimedAt, claimedAt, row.id]);
  const claimed = await db.get<ConnectionRow>('SELECT * FROM runtime_connections WHERE id = ?', [row.id]);
  if (!claimed) throw new Error('Runtime pairing claim could not be loaded.');
  await db.run("SELECT pg_notify('workflow_studio_user_events', ?)", [`runtime:${row.user_id}`]).catch(() => undefined);
  return { token, connection: publicConnection(claimed, now.getTime()), userId: row.user_id };
}

export async function authenticateRuntimeToken(token: string | undefined) {
  if (!token) return null;
  const row = await (await getDatabase()).get<ConnectionRow>("SELECT * FROM runtime_connections WHERE token_hash = ? AND status != 'revoked'", [secretHash(token)]);
  return row ? { connection: publicConnection(row), userId: row.user_id } : null;
}

export async function heartbeatRuntime(connectionId: string, input: { authMode?: string; codexAccountLabel?: string; protocolVersion?: number; companionVersion?: string; supportedModels?: string[]; supportedReasoningEfforts?: string[] }, now = new Date()) {
  if (input.protocolVersion !== undefined && input.protocolVersion !== COMPANION_PROTOCOL_VERSION) throw new Error(`Companion protocol ${input.protocolVersion} is incompatible with server protocol ${COMPANION_PROTOCOL_VERSION}.`);
  const db = await getDatabase();
  await db.run(`UPDATE runtime_connections SET status = 'online', auth_mode = COALESCE(?, auth_mode),
    codex_account_label = COALESCE(?, codex_account_label), protocol_version = COALESCE(?, protocol_version), companion_version = COALESCE(?, companion_version), supported_models = COALESCE(?, supported_models), supported_reasoning_efforts = COALESCE(?, supported_reasoning_efforts), last_seen_at = ? WHERE id = ? AND status != 'revoked'`,
    [input.authMode?.slice(0, 40) ?? null, input.codexAccountLabel?.slice(0, 160) ?? null, input.protocolVersion ?? null, input.companionVersion?.slice(0, 40) ?? null, input.supportedModels ? JSON.stringify(input.supportedModels) : null, input.supportedReasoningEfforts ? JSON.stringify(input.supportedReasoningEfforts) : null, now.toISOString(), connectionId]);
  const row = await db.get<ConnectionRow>('SELECT * FROM runtime_connections WHERE id = ?', [connectionId]);
  if (row) await db.run("SELECT pg_notify('workflow_studio_user_events', ?)", [`runtime:${row.user_id}`]).catch(() => undefined);
  return row ? publicConnection(row, now.getTime()) : null;
}

export async function listRuntimeConnections(userId: string): Promise<RuntimeConnection[]> {
  return (await (await getDatabase()).all<ConnectionRow>('SELECT * FROM runtime_connections WHERE user_id = ? AND status != ? ORDER BY created_at DESC', [userId, 'revoked'])).map((row) => publicConnection(row));
}

export async function getOnlineRuntimeConnection(userId: string): Promise<RuntimeConnection | null> {
  return (await listRuntimeConnections(userId)).find((connection) => connection.status === 'online' && connection.authMode === 'chatgpt') ?? null;
}

export async function revokeRuntimeConnection(userId: string, connectionId: string, now = new Date()): Promise<boolean> {
  const db = await getDatabase();
  const changed = Boolean((await db.run("UPDATE runtime_connections SET status = 'revoked', revoked_at = ?, token_hash = NULL WHERE id = ? AND user_id = ?", [now.toISOString(), connectionId, userId])).changes);
  if (changed) await db.run("SELECT pg_notify('workflow_studio_user_events', ?)", [`runtime:${userId}`]).catch(() => undefined);
  return changed;
}

export async function enqueueRuntimeJob(userId: string, connectionId: string, kind: RuntimeJobKind, payload: unknown, now = new Date()): Promise<RuntimeJob> {
  const metadata = payload && typeof payload === 'object' && !Array.isArray(payload) && 'metadata' in payload && (payload as { metadata?: unknown }).metadata && typeof (payload as { metadata?: unknown }).metadata === 'object'
    ? (payload as { metadata: Record<string, unknown> }).metadata : {};
  const runId = typeof metadata.workflow_studio_run_id === 'string' ? metadata.workflow_studio_run_id : null;
  const taskId = typeof metadata.workflow_studio_task_id === 'string' ? metadata.workflow_studio_task_id : null;
  const nodeId = typeof metadata.workflow_studio_node_id === 'string' ? metadata.workflow_studio_node_id : null;
  const attempt = typeof metadata.workflow_studio_attempt === 'string' ? metadata.workflow_studio_attempt : null;
  const iteration = typeof metadata.workflow_studio_iteration === 'string' ? metadata.workflow_studio_iteration : null;
  const executionKey = kind === 'focused-task' && runId && taskId && nodeId && attempt && iteration ? `${runId}:${taskId}:${nodeId}:${attempt}:${iteration}` : null;
  const db = await getDatabase();
  if (executionKey) {
    const existing = await db.get<JobRow>('SELECT * FROM runtime_jobs WHERE user_id = ? AND execution_key = ?', [userId, executionKey]);
    if (existing) return publicJob(existing);
  }
  const id = `runtime_job_${randomUUID()}`;
  const timestamp = now.toISOString();
  await db.run(`INSERT INTO runtime_jobs (id, user_id, connection_id, kind, run_id, task_id, node_id, execution_key, payload, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?) ON CONFLICT DO NOTHING`,
    [id, userId, connectionId, kind, runId, taskId, nodeId, executionKey, JSON.stringify(payload), timestamp, timestamp]);
  const stored = executionKey
    ? await db.get<JobRow>('SELECT * FROM runtime_jobs WHERE user_id = ? AND execution_key = ?', [userId, executionKey])
    : await db.get<JobRow>('SELECT * FROM runtime_jobs WHERE id = ? AND user_id = ?', [id, userId]);
  if (!stored) throw new Error('Runtime job could not be queued.');
  await db.run("SELECT pg_notify('workflow_studio_runtime_jobs', ?)", [connectionId]).catch(() => undefined);
  return publicJob(stored);
}

export async function leaseNextRuntimeJob(connectionId: string, now = new Date()): Promise<RuntimeJob | null> {
  const db = await getDatabase();
  const staleBefore = new Date(now.getTime() - RUNTIME_JOB_LEASE_MS).toISOString();
  await db.run(`UPDATE runtime_jobs SET status = 'queued', lease_id = NULL, leased_at = NULL, updated_at = ?
    WHERE connection_id = ? AND status = 'leased' AND leased_at < ?
      AND NOT (kind = 'focused-task' AND COALESCE(safe_jsonb(payload)->>'durableResults', 'false') = 'true') AND NOT EXISTS (
      SELECT 1 FROM runtime_job_events WHERE job_id = runtime_jobs.id AND safe_jsonb(payload)->>'type' = 'turn/completed'
      AND safe_jsonb(payload)->>'message' = 'Codex turn completed.')`, [now.toISOString(), connectionId, staleBefore]);
  const leaseId = `lease_${randomUUID()}`;
  const leased = await db.get<JobRow>(`UPDATE runtime_jobs SET status = 'leased', lease_id = ?, first_leased_at = COALESCE(first_leased_at, ?), leased_at = ?, updated_at = ?
    WHERE id = (SELECT id FROM runtime_jobs WHERE connection_id = ? AND status = 'queued' ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1)
    AND status = 'queued' RETURNING *`, [leaseId, now.toISOString(), now.toISOString(), now.toISOString(), connectionId]);
  return leased ? publicJob(leased) : null;
}

export async function hasQueuedRuntimeJob(connectionId: string): Promise<boolean> {
  return Boolean(await (await getDatabase()).get('SELECT id FROM runtime_jobs WHERE connection_id = ? AND status = ? LIMIT 1', [connectionId, 'queued']));
}

export async function renewRuntimeJobLease(connectionId: string, jobId: string, leaseId: string, now = new Date()): Promise<boolean> {
  return Boolean((await (await getDatabase()).run("UPDATE runtime_jobs SET leased_at = ?, updated_at = ? WHERE id = ? AND connection_id = ? AND lease_id = ? AND status = 'leased'", [now.toISOString(), now.toISOString(), jobId, connectionId, leaseId])).changes);
}

export async function appendRuntimeJobEvent(connectionId: string, jobId: string, leaseId: string, sequence: number | null, payload: unknown, now = new Date()): Promise<boolean> {
  const db = await getDatabase();
  return db.transaction(async (tx) => {
    const owned = await tx.get<JobRow>("SELECT * FROM runtime_jobs WHERE id = ? AND connection_id = ? AND lease_id = ? AND status = 'leased' FOR UPDATE", [jobId, connectionId, leaseId]);
    if (!owned) return false;
    if (sequence === null) sequence = Number((await tx.get<{ next: number }>('SELECT COALESCE(MAX(sequence), -1) + 1 AS next FROM runtime_job_events WHERE job_id = ?', [jobId]))?.next ?? 0);
    const added = await tx.run('INSERT INTO runtime_job_events (job_id, sequence, payload, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [jobId, sequence, JSON.stringify(payload), now.toISOString()]);
    if (added.changes) await recordRuntimeDeliveryStage(tx, owned, payload);
    await tx.run("SELECT pg_notify('workflow_studio_runtime_job_updates', ?)", [jobId]);
    return true;
  });
}

export async function listRuntimeJobEvents(userId: string, jobId: string, afterSequence = -1): Promise<Array<{ sequence: number; payload: unknown }>> {
  const rows = await (await getDatabase()).all<{ sequence: number; payload: string }>(`SELECT runtime_job_events.sequence, runtime_job_events.payload FROM runtime_job_events
    JOIN runtime_jobs ON runtime_jobs.id = runtime_job_events.job_id
    WHERE runtime_jobs.id = ? AND runtime_jobs.user_id = ? AND runtime_job_events.sequence > ? ORDER BY runtime_job_events.sequence ASC`,
    [jobId, userId, afterSequence]);
  return rows.map((row) => ({ sequence: row.sequence, payload: parseJson(row.payload, {}) }));
}

export async function completeRuntimeJob(connectionId: string, jobId: string, leaseId: string, outcome: { result?: unknown; error?: string }, now = new Date()): Promise<boolean> {
  const db = await getDatabase();
  const fingerprint = requestFingerprint(outcome);
  return db.transaction(async (tx) => {
    const job = await tx.get<JobRow & { result_digest?: string }>('SELECT * FROM runtime_jobs WHERE id = ? AND connection_id = ? FOR UPDATE', [jobId, connectionId]);
    if (!job) return false;
    if (job.status === 'completed' || job.status === 'failed') {
      if (job.result_digest) return job.result_digest === fingerprint;
      return requestFingerprint({ ...(job.result ? { result: JSON.parse(job.result) } : {}), ...(job.error ? { error: job.error } : {}) }) === fingerprint;
    }
    if (job.lease_id !== leaseId) return false;
    if (job.status !== 'leased') return false;
    const applied = job.kind === 'focused-task' ? await applyRuntimeResult(tx, job, outcome) : {};
    if (applied.stale) return false;
    const error = applied.error ?? outcome.error;
    const update = await tx.run(`UPDATE runtime_jobs SET status = ?, result = ?, error = ?, result_digest = ?, applied_revision = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND connection_id = ? AND lease_id = ? AND status = 'leased'`,
    [error ? 'failed' : 'completed', outcome.result === undefined ? null : JSON.stringify(outcome.result), error ?? null, fingerprint,
      applied.revision ?? null, now.toISOString(), now.toISOString(), jobId, connectionId, leaseId]);
    if (!update.changes) throw new Error('Runtime completion lost its fenced lease.');
    await tx.run("SELECT pg_notify('workflow_studio_runtime_job_updates', ?)", [jobId]);
    return true;
  });
}

export async function getRuntimeJob(userId: string, jobId: string): Promise<RuntimeJob | null> {
  const row = await (await getDatabase()).get<JobRow>('SELECT * FROM runtime_jobs WHERE id = ? AND user_id = ?', [jobId, userId]);
  return row ? publicJob(row) : null;
}

export async function listRuntimeJobDiagnosticsForRun(userId: string, runId: string) {
  const rows = await (await getDatabase()).all<JobRow>('SELECT * FROM runtime_jobs WHERE user_id = ? AND run_id = ? ORDER BY created_at ASC', [userId, runId]);
  return rows.map((row) => {
    const payload = parseJson<{ metadata?: Record<string, string> }>(row.payload, {});
    const result = parseJson<{ providerThreadId?: unknown; timings?: { providerCompletedAt?: string; verificationStartedAt?: string; verificationCompletedAt?: string } }>(row.result, {});
    const span = (start?: string, end?: string) => start && end && Number.isFinite(Date.parse(start)) && Number.isFinite(Date.parse(end)) ? Math.max(0, Date.parse(end) - Date.parse(start)) : undefined;
    const leasedAt = row.first_leased_at || row.leased_at ? Date.parse(row.first_leased_at ?? row.leased_at!) : undefined;
    const completedAt = row.completed_at ? Date.parse(row.completed_at) : undefined;
    return {
      jobId: row.id,
      connectionId: row.connection_id,
      kind: row.kind,
      status: row.status,
      taskId: row.task_id ?? undefined,
      nodeId: row.node_id ?? undefined,
      attempt: payload.metadata?.workflow_studio_attempt ? Number(payload.metadata.workflow_studio_attempt) : undefined,
      iteration: payload.metadata?.workflow_studio_iteration ? Number(payload.metadata.workflow_studio_iteration) : undefined,
      createdAt: row.created_at,
      leasedAt: row.leased_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      queueTimeMs: leasedAt === undefined ? undefined : Math.max(0, leasedAt - Date.parse(row.created_at)),
      executionTimeMs: leasedAt === undefined || completedAt === undefined ? undefined : Math.max(0, completedAt - leasedAt),
      providerTimeMs: span(row.first_leased_at ?? row.leased_at ?? undefined, result.timings?.providerCompletedAt),
      verificationTimeMs: span(result.timings?.verificationStartedAt, result.timings?.verificationCompletedAt),
      deliveryTimeMs: span(result.timings?.verificationCompletedAt, row.completed_at ?? undefined),
      providerThreadId: typeof result.providerThreadId === 'string' ? result.providerThreadId : undefined,
      failure: row.error ? String(redactRuntimeValue(row.error)).slice(0, 2000) : undefined
    };
  });
}

export async function cancelRuntimeJob(userId: string, jobId: string, now = new Date()): Promise<void> {
  const db = await getDatabase();
  const job = await db.get<JobRow>('SELECT * FROM runtime_jobs WHERE id = ? AND user_id = ?', [jobId, userId]);
  await db.run("UPDATE runtime_jobs SET status = 'cancelled', updated_at = ?, completed_at = ? WHERE id = ? AND user_id = ? AND status IN ('queued', 'leased')", [now.toISOString(), now.toISOString(), jobId, userId]);
  if (job) await db.run("SELECT pg_notify('workflow_studio_runtime_events', ?)", [JSON.stringify({ connectionId: job.connection_id, type: 'job-cancelled', jobId })]).catch(() => undefined);
  if (job) await db.run("SELECT pg_notify('workflow_studio_runtime_job_updates', ?)", [jobId]).catch(() => undefined);
}

export async function cancelRuntimeJobsForRun(userId: string, runId: string, now = new Date()): Promise<number> {
  const timestamp = now.toISOString();
  const db = await getDatabase();
  const jobs = await db.all<JobRow>("SELECT * FROM runtime_jobs WHERE user_id = ? AND run_id = ? AND status IN ('queued', 'leased')", [userId, runId]);
  const result = await db.run("UPDATE runtime_jobs SET status = 'cancelled', error = 'Workflow run was cancelled.', updated_at = ?, completed_at = ? WHERE user_id = ? AND run_id = ? AND status IN ('queued', 'leased')", [timestamp, timestamp, userId, runId]);
  await db.run("UPDATE runtime_tool_approvals SET status = 'cancelled', decision = 'cancel', decided_at = ? WHERE user_id = ? AND run_id = ? AND status = 'pending'", [timestamp, userId, runId]);
  for (const job of jobs) await db.run("SELECT pg_notify('workflow_studio_runtime_events', ?)", [JSON.stringify({ connectionId: job.connection_id, type: 'job-cancelled', jobId: job.id })]).catch(() => undefined);
  for (const job of jobs) await db.run("SELECT pg_notify('workflow_studio_runtime_job_updates', ?)", [job.id]).catch(() => undefined);
  return Number(result.changes);
}

async function expireRuntimeToolApprovals(now = new Date()) {
  await (await getDatabase()).run("UPDATE runtime_tool_approvals SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?", [now.toISOString()]);
}

export async function createRuntimeToolApproval(connectionId: string, jobId: string, input: {
  serverRequestId: string;
  requestMethod: string;
  kind: RuntimeToolApprovalKind;
  title: string;
  reason?: string;
  command?: string;
  cwd?: string;
  details?: Record<string, unknown>;
}, now = new Date()): Promise<RuntimeToolApproval | null> {
  const db = await getDatabase();
  const job = await db.get<JobRow>("SELECT * FROM runtime_jobs WHERE id = ? AND connection_id = ? AND status = 'leased'", [jobId, connectionId]);
  if (!job) return null;
  const payload = parseJson<{ metadata?: Record<string, string> }>(job.payload, {});
  const id = `runtime_approval_${randomUUID()}`;
  const requestedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  const details = JSON.stringify(redactRuntimeValue(input.details ?? {})).slice(0, 20_000);
  const command = redactRuntimeValue(input.command ?? '') as string;
  const reason = redactRuntimeValue(input.reason ?? '') as string;
  await db.run(`INSERT INTO runtime_tool_approvals
    (id, user_id, connection_id, job_id, run_id, task_id, node_id, server_request_id, request_method, kind, title, reason, command_preview, cwd, details, status, requested_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT DO NOTHING`,
    [id, job.user_id, connectionId, jobId, payload.metadata?.workflow_studio_run_id ?? null, payload.metadata?.workflow_studio_task_id ?? null,
      payload.metadata?.workflow_studio_node_id ?? null, input.serverRequestId.slice(0, 120), input.requestMethod.slice(0, 160), input.kind,
      input.title.slice(0, 200), reason.slice(0, 2000) || null, command || null, input.cwd?.slice(0, 2000) ?? null,
      details, requestedAt, expiresAt]);
  const row = await db.get<ToolApprovalRow>('SELECT * FROM runtime_tool_approvals WHERE job_id = ? AND server_request_id = ?', [jobId, input.serverRequestId.slice(0, 120)]);
  if (row?.run_id) await db.run("SELECT pg_notify('workflow_studio_user_events', ?)", [`run:${row.user_id}:${row.run_id}`]).catch(() => undefined);
  return row ? publicToolApproval(row) : null;
}

export async function getRuntimeToolApprovalForAgent(connectionId: string, jobId: string, approvalId: string, now = new Date()): Promise<RuntimeToolApproval | null> {
  await expireRuntimeToolApprovals(now);
  const row = await (await getDatabase()).get<ToolApprovalRow>('SELECT * FROM runtime_tool_approvals WHERE id = ? AND job_id = ? AND connection_id = ?', [approvalId, jobId, connectionId]);
  return row ? publicToolApproval(row) : null;
}

export async function listRuntimeToolApprovalsForRun(userId: string, runId: string, now = new Date()): Promise<RuntimeToolApproval[]> {
  await expireRuntimeToolApprovals(now);
  return (await (await getDatabase()).all<ToolApprovalRow>('SELECT * FROM runtime_tool_approvals WHERE user_id = ? AND run_id = ? ORDER BY requested_at DESC', [userId, runId])).map(publicToolApproval);
}

export async function decideRuntimeToolApproval(userId: string, runId: string, approvalId: string, decision: RuntimeToolApprovalDecision, actor: { id: string; name: string; role: string }, response?: Record<string, unknown>, now = new Date()): Promise<RuntimeToolApproval | null> {
  await expireRuntimeToolApprovals(now);
  const status = decision === 'accept' ? 'accepted' : decision === 'decline' ? 'declined' : 'cancelled';
  const timestamp = now.toISOString();
  const safeResponse = response ? JSON.stringify(redactRuntimeValue(response)).slice(0, 20_000) : null;
  const db = await getDatabase();
  const result = await db.run(`UPDATE runtime_tool_approvals SET status = ?, decision = ?, decided_at = ?, decided_by = ?, response_json = ?
    WHERE id = ? AND user_id = ? AND run_id = ? AND status = 'pending'`, [status, decision, timestamp, JSON.stringify(actor), safeResponse, approvalId, userId, runId]);
  if (!result.changes) return null;
  const row = await db.get<ToolApprovalRow>('SELECT * FROM runtime_tool_approvals WHERE id = ?', [approvalId]);
  if (!row) return null;
  await db.run("SELECT pg_notify('workflow_studio_runtime_events', ?)", [JSON.stringify({ connectionId: row.connection_id, type: 'approval-decided', jobId: row.job_id, approvalId })]).catch(() => undefined);
  await db.run("SELECT pg_notify('workflow_studio_user_events', ?)", [`run:${row.user_id}:${runId}`]).catch(() => undefined);
  return publicToolApproval(row);
}
