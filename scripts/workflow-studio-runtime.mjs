import { ensureStudioHome, assertStudioProject, studioRuntimeEnvironment, studioCodexInvocation } from './studio-home.cjs';
import { createProjectDeliverables, loadArtifactSourceRoots } from './project-deliverables.cjs';
import { createResultSpool } from './runtime-result-spool.cjs';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let CONFIG_PATH;
const RUNTIME_PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const COMPANION_PROTOCOL_VERSION = 1;
const COMPANION_APP_VERSION = '0.2.0';
let stopping = false;
let shutdown = new AbortController();
const activeClients = new Set();

function argumentsFrom(argv) {
  const values = { roots: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--home' && argv[index + 1]) values.home = argv[++index];
    else if (key === '--login') values.login = true;
    else if (key === '--root' && argv[index + 1]) values.roots.push(argv[++index]);
    else if (key === '--server' && argv[index + 1]) values.server = argv[++index];
    else if (key === '--code' && argv[index + 1]) values.code = argv[++index];
    else if (key === '--name' && argv[index + 1]) values.name = argv[++index];
    else if (key === '--reconcile' && argv[index + 1]) values.reconcile = argv[++index];
  }
  return values;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function startRuntimeHeartbeat(send, onError, intervalMs = 15_000) {
  let active = true;
  let inFlight = false;
  const timer = setInterval(() => {
    if (!active || inFlight) return;
    inFlight = true;
    void Promise.resolve().then(send).catch((error) => { if (active) onError(error); }).finally(() => { inFlight = false; });
  }, intervalMs);
  return () => { active = false; clearInterval(timer); };
}

function safeServerUrl(value) {
  const url = new URL(value);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Use HTTPS for a deployed Workflow Studio server. HTTP is allowed only for localhost.');
  return url.origin;
}

async function request(server, pathname, token, body) {
  const response = await fetch(new URL(pathname, server), {
    method: 'POST',
    signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(30_000)]),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(result.errors?.[0] || `Workflow Studio returned ${response.status}.`); error.status = response.status; throw error; }
  return result;
}

async function readRequest(server, pathname, token) {
  const response = await fetch(new URL(pathname, server), { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(30_000)]) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(result.errors?.[0] || `Workflow Studio returned ${response.status}.`); error.status = response.status; throw error; }
  return result;
}

async function waitForRuntimeEvent(server, token, accept, options = {}) {
  const url = new URL('/api/runtime/agent/jobs/events', server);
  if (options.jobId) url.searchParams.set('jobId', options.jobId);
  if (options.approvalId) url.searchParams.set('approvalId', options.approvalId);
  const signal = options.signal ? AbortSignal.any([shutdown.signal, options.signal]) : shutdown.signal;
  const response = await fetch(url, {
    headers: { accept: 'text/event-stream', authorization: `Bearer ${token}` },
    signal
  });
  if (!response.ok || !response.body) {
    const error = new Error(`Workflow Studio event stream returned ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!stopping) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('Workflow Studio event stream closed.');
      buffer += decoder.decode(chunk.value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        const lines = event.split('\n');
        const type = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
        const raw = lines.find((line) => line.startsWith('data:'))?.slice(5).trim();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
        if (type && accept(type, data)) return data;
      }
    }
  } finally { await reader.cancel().catch(() => undefined); }
}

async function loadConfiguration(args) {
  let stored = {};
  try { stored = JSON.parse(await readFile(CONFIG_PATH, 'utf8')); } catch {}
  const server = safeServerUrl(args.server || stored.server || 'http://localhost:3000');
  const roots = args.code ? (args.roots.length ? args.roots : [ensureStudioHome().projects]) : Array.isArray(stored.allowedRoots) ? stored.allowedRoots : [];
  for (const root of roots) assertStudioProject(root);
  if (args.code) {
    if (!roots.length) throw new Error('Add at least one --root path. The companion will reject work outside those folders.');
    const result = await request(server, '/api/runtime/pair', undefined, {
      code: args.code,
      name: args.name || `${os.hostname()} Codex runtime`,
      platform: `${process.platform}/${process.arch}`,
      hostname: os.hostname(),
      allowedRoots: roots
    });
    const configuration = { server, token: result.token, connectionId: result.connection.id, allowedRoots: roots };
    await writeFile(CONFIG_PATH, `${JSON.stringify(configuration, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return configuration;
  }
  if (args.roots.length) throw new Error('To change allowed project roots, generate a new pairing code and pair this computer again.');
  if (!stored.token || stored.server !== server) throw new Error('No paired runtime was found. Generate a pairing code in Profile → Local runtime, then run the displayed command.');
  return { ...stored, server, allowedRoots: roots };
}

function resolveCodexInvocation() {
  return studioCodexInvocation(RUNTIME_PACKAGE_ROOT, ['app-server', '--listen', 'stdio://']);
}

function safeDeclineResponse(method) {
  if (method === 'item/permissions/requestApproval') return { permissions: {}, scope: 'turn' };
  if (method === 'mcpServer/elicitation/request') return { action: 'decline', content: null };
  return { decision: 'decline' };
}

export class AppServerClient {
  constructor(cwd, onNotification, onServerRequest = async (message) => safeDeclineResponse(message.method)) {
    const invocation = resolveCodexInvocation();
    this.child = spawn(invocation.executable, invocation.args, { cwd, shell: false, windowsHide: true, env: studioRuntimeEnvironment() });
    activeClients.add(this);
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.onNotification = onNotification;
    this.onServerRequest = onServerRequest;
    this.child.stdout.on('data', (chunk) => this.consume(chunk.toString()));
    this.child.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim();
      if (message && !message.includes('shell_snapshot')) onNotification({ type: 'app-server.stderr', message: message.slice(0, 500) });
    });
    this.child.on('error', (error) => this.rejectAll(error));
    this.child.on('close', (code) => this.rejectAll(new Error(`Codex App Server exited with code ${code ?? 'unknown'}.`)));
  }

  async initialize() {
    await this.request('initialize', {
      clientInfo: { name: 'workflow_studio_runtime', title: 'Workflow Studio Runtime', version: COMPANION_APP_VERSION },
      capabilities: { experimentalApi: true, optOutNotificationMethods: ['remoteControl/status/changed', 'mcpServer/startupStatus/updated'] }
    });
    this.write({ method: 'initialized', params: {} });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex request timed out.')); }, 30_000);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      this.write({ id, method, params });
    });
  }

  stop() { activeClients.delete(this); this.rejectAll(new Error("Runtime stopped.")); this.child.kill(); }
  write(message) { this.child.stdin.write(`${JSON.stringify(message)}\n`); }

  consume(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    for (const line of lines.filter(Boolean)) {
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id !== undefined && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || 'Codex App Server request failed.'));
        else pending.resolve(message.result);
        continue;
      }
      if (message.id !== undefined && message.method) {
        void Promise.resolve(this.onServerRequest(message)).then((result) => this.write({ id: message.id, result })).catch((error) => {
          this.onNotification({ type: 'runtime.approval.failed', message: error instanceof Error ? error.message : 'Runtime approval failed.' });
          this.write({ id: message.id, result: safeDeclineResponse(message.method) });
        });
      }
      this.onNotification(message);
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function approvalDescriptor(message) {
  const params = message.params || {};
  if (message.method === 'item/commandExecution/requestApproval') return {
    kind: params.networkApprovalContext ? 'permissions' : 'command',
    title: params.networkApprovalContext ? 'Allow network access' : 'Run a local command',
    reason: params.reason,
    command: Array.isArray(params.command) ? params.command.join(' ') : typeof params.command === 'string' ? params.command : undefined,
    cwd: params.cwd
  };
  if (message.method === 'item/fileChange/requestApproval') return { kind: 'file-change', title: 'Apply local file changes', reason: params.reason, cwd: params.grantRoot };
  if (message.method === 'item/permissions/requestApproval') return { kind: 'permissions', title: 'Grant temporary runtime permissions', reason: params.reason, cwd: params.cwd };
  if (message.method === 'mcpServer/elicitation/request') return { kind: 'user-input', title: params.message || 'Provide information to a connected tool', reason: params.reason, cwd: params.cwd };
  return { kind: 'other', title: 'Approve a local Codex action', reason: params.reason, cwd: params.cwd };
}

async function bridgeRuntimeApproval(configuration, jobId, message, publishEvent) {
  if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'mcpServer/elicitation/request'].includes(message.method)) return safeDeclineResponse(message.method);
  const descriptor = approvalDescriptor(message);
  const pathname = `/api/runtime/agent/jobs/${encodeURIComponent(jobId)}/approvals`;
  const created = await request(configuration.server, pathname, configuration.token, {
    serverRequestId: String(message.id), requestMethod: message.method, ...descriptor, details: message.params || {}
  });
  const approval = created.approval;
  await publishEvent({ type: 'runtime.approval.requested', message: `${descriptor.title} is waiting for approval.`, approvalId: approval.id });
  try {
    await waitForRuntimeEvent(configuration.server, configuration.token, (type, data) => type === 'approval-decided' && data.jobId === jobId && data.approvalId === approval.id, { jobId, approvalId: approval.id, signal: AbortSignal.timeout(10 * 60_000) });
  } catch (error) {
    if (error?.name !== 'TimeoutError') throw error;
  }
  const current = (await readRequest(configuration.server, `${pathname}?approvalId=${encodeURIComponent(approval.id)}`, configuration.token)).approval;
  if (current.status === 'accepted') {
    if (message.method === 'item/permissions/requestApproval') return { permissions: message.params?.permissions ?? {}, scope: 'turn' };
    if (message.method === 'mcpServer/elicitation/request') return { action: 'accept', content: current.response ?? {} };
    return { decision: 'accept' };
  }
  if (current.status === 'declined') return { decision: 'decline' };
  if (current.status === 'cancelled' || current.status === 'expired') return { decision: 'cancel' };
  return { decision: 'cancel' };
}

async function authorizedWorkingDirectory(cwd, allowedRoots) {
  assertStudioProject(cwd);
  const info = await stat(cwd);
  if (!info.isDirectory()) throw new Error('The requested workspace is not a directory.');
  const resolved = await realpath(cwd);
  for (const root of allowedRoots) {
    try {
      const resolvedRoot = await realpath(root);
      const relative = path.relative(resolvedRoot, resolved);
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) return resolved;
    } catch {}
  }
  throw new Error('The requested workspace is outside the folders allowed when this runtime was paired.');
}

async function inspectWorkspace(rootPath, allowedRoots) {
  const root = await authorizedWorkingDirectory(rootPath, allowedRoots);
  const entries = await readdir(root, { withFileTypes: true });
  const directoryCount = entries.filter((entry) => entry.isDirectory()).length;
  const fileCount = entries.filter((entry) => entry.isFile()).length;
  const hasGitMetadata = entries.some((entry) => entry.name.toLowerCase() === '.git');
  return {
    rootPath: root,
    workspaceKind: entries.length === 0 ? 'empty' : hasGitMetadata ? 'repository' : 'workspace',
    entryCount: entries.length,
    directoryCount,
    fileCount,
    hasGitMetadata,
    inspectionMode: 'read-only',
    inspectedAt: new Date().toISOString()
  };
}

async function runWorkspaceTask(task, allowedRoots) {
  if (task.operation === 'inspect') return { inspection: await inspectWorkspace(task.rootPath, allowedRoots) };
  if (task.operation === 'list') {
    const root = await authorizedWorkingDirectory(task.rootPath || allowedRoots[0], allowedRoots);
    const entries = await readdir(root, { withFileTypes: true });
    const parent = path.dirname(root);
    let parentPath = null;
    if (parent !== root) {
      try { parentPath = await authorizedWorkingDirectory(parent, allowedRoots); } catch {}
    }
    return {
      listing: {
        rootPath: root,
        parentPath,
        directories: entries.filter((entry) => entry.isDirectory()).map((entry) => ({ name: entry.name, path: path.join(root, entry.name) })).sort((left, right) => left.name.localeCompare(right.name)),
        inspectionMode: 'read-only'
      }
    };
  }
  if (task.operation === 'create') {
    const parent = await authorizedWorkingDirectory(task.parentPath, allowedRoots);
    const folderName = String(task.folderName || '').trim();
    if (!folderName || folderName === '.' || folderName === '..' || /[\\/:*?"<>|]/.test(folderName)) throw new Error('New folder name must be a single valid directory name.');
    const created = path.join(parent, folderName);
    if (path.dirname(created) !== parent) throw new Error('New project folder must be created directly inside the selected directory.');
    await mkdir(created, { recursive: false });
    return { inspection: await inspectWorkspace(created, allowedRoots) };
  }
  throw new Error('Unsupported local workspace operation.');
}

async function readArtifactTask(task, allowedRoots) {
  const requestedRoot = await authorizedWorkingDirectory(task.rootPath, allowedRoots);
  const requestedPath = await realpath(path.resolve(String(task.path || '')));
  const relative = path.relative(requestedRoot, requestedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Artifact is outside the approved project root.');
  const info = await stat(requestedPath);
  if (!info.isFile() || info.size > 25 * 1024 * 1024) throw new Error('Artifact is unavailable or exceeds the 25 MB preview limit.');
  return { artifact: { contentBase64: (await readFile(requestedPath)).toString('base64'), size: info.size } };
}

function frontmatterValue(source, key) {
  const frontmatter = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return (match?.[1] || '').trim().replace(/^['"]|['"]$/g, '');
}

function validSkillId(value) {
  return value.trim().replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
}

async function findSkillFiles(root, depth = 0) {
  if (depth > 7) return [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const entry of entries) {
    if (files.length >= 500) break;
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name === 'SKILL.md') files.push(candidate);
    else if (entry.isDirectory()) files.push(...await findSkillFiles(candidate, depth + 1));
  }
  return files.slice(0, 500);
}

async function discoverCodexSkills() {
  const home = ensureStudioHome();
  const roots = [home.skills, path.join(home.codex, 'skills')];
  const files = (await Promise.all([...new Set(roots)].map((root) => findSkillFiles(root)))).flat().slice(0, 500);
  const skills = [];
  const seen = new Set();
  for (const file of files) {
    try {
      const source = await readFile(file, 'utf8');
      const id = validSkillId(frontmatterValue(source, 'name') || path.basename(path.dirname(file)));
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const name = frontmatterValue(source, 'name') || id;
      skills.push({ id, name, description: frontmatterValue(source, 'description') || `Installed Codex skill ${id}.`, source: 'installed-codex', skillPath: file });
    } catch {}
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

function readableEvent(message, threadId) {
  const method = message.method || 'app-server.message';
  if (method === 'remoteControl/status/changed' || method === 'mcpServer/startupStatus/updated') return null;
  const params = message.params || {};
  if (method === 'thread/started') return { type: method, message: 'Codex App Server thread started.', threadId };
  if (method === 'turn/started') return { type: method, message: 'Codex turn started.', threadId };
  if (method === 'turn/completed') return { type: method, message: `Codex turn ${params.turn?.status || 'completed'}.`, threadId };
  if (method === 'item/started' || method === 'item/completed') return { type: method, message: `${method === 'item/started' ? 'Started' : 'Completed'} ${params.item?.type || 'item'}.`, threadId };
  if (method === 'app-server.stderr') return message;
  return null;
}

export function codexRuntimePolicy(task) {
  return {
    approvalPolicy: task.requireRuntimeApprovals ? 'on-request' : 'never',
    sandbox: task.permission === 'workspace' ? 'workspace-write' : 'read-only'
  };
}

export async function runCodexTask(task, allowedRoots, publishEvent, requestApproval, runtimeControl) {
  const cwd = await authorizedWorkingDirectory(task.cwd, allowedRoots);
  const deliverables = task.serviceName === 'workflow_studio_execution' ? await createProjectDeliverables({
    rootPath: cwd, writeAllowed: task.permission === 'workspace',
    approvedSourceRoots: await loadArtifactSourceRoots(path.join(ensureStudioHome().home, 'runtime', 'artifact-sources.json')), inputs: task.artifactInputs ?? {},
    trace: { runId: task.metadata.workflow_studio_run_id, taskId: task.metadata.workflow_studio_task_id,
      nodeId: task.metadata.workflow_studio_node_id, sourcePlanId: task.metadata.workflow_studio_plan_id,
      workflowId: task.metadata.workflow_studio_workflow_id, assignmentId: task.metadata.workflow_studio_assignment_id,
      projectId: task.metadata.workflow_studio_project_id },
    attempt: task.metadata.workflow_studio_attempt, iteration: task.metadata.workflow_studio_iteration
  }) : undefined;
  let finalMessage = '';
  let streamedMessage = '';
  let threadId;
  let resolveCompletion;
  let rejectCompletion;
  let finished = false;
  let cancellationController;
  const completion = new Promise((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
  // A fast turn failure can arrive before initialization has reached Promise.race.
  void completion.catch(() => undefined);
  const client = new AppServerClient(cwd, (message) => {
    const params = message.params || {};
    if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') streamedMessage += params.delta;
    if (message.method === 'item/completed' && params.item?.type === 'agentMessage' && typeof params.item.text === 'string') finalMessage = params.item.text;
    if (message.method === 'turn/completed') {
      if (params.turn?.status === 'completed') resolveCompletion();
      else rejectCompletion(new Error(params.turn?.error?.message || `Codex turn ${params.turn?.status || 'failed'}.`));
    }
    const event = readableEvent(message, threadId);
    if (event) void publishEvent(event).catch((error) => console.warn(`Runtime progress upload: ${error.message}`));
  }, requestApproval);
  try {
    await client.initialize();
    const accountResult = await client.request('account/read', { refreshToken: true });
    if (accountResult?.account?.type !== 'chatgpt') throw new Error('This runtime is not signed in with a ChatGPT Codex account. Run npm run runtime:login with the same --home folder, then restart the companion.');
    const { approvalPolicy, sandbox } = codexRuntimePolicy(task);
    const thread = await client.request('thread/start', {
      cwd, approvalPolicy, sandbox,
      ephemeral: true, serviceName: task.serviceName,
      ...(task.modelSettings?.model ? { model: task.modelSettings.model } : {}),
      config: {
        ...(task.modelSettings?.reasoningEffort ? { model_reasoning_effort: task.modelSettings.reasoningEffort } : {}),
        ...(task.modelSettings?.verbosity ? { model_verbosity: task.modelSettings.verbosity } : {})
      }
    });
    threadId = thread?.thread?.id;
    if (!threadId) throw new Error('Codex App Server did not return a thread id.');
    await client.request('turn/start', {
      threadId, input: [{ type: 'text', text: task.prompt }], cwd,
      approvalPolicy, outputSchema: task.outputSchema,
      ...(task.metadata ? { responsesapiClientMetadata: task.metadata } : {})
    });
    cancellationController = new AbortController();
    const cancellation = waitForRuntimeEvent(runtimeControl.server, runtimeControl.token,
      (type, data) => type === 'job-cancelled' && data.jobId === runtimeControl.jobId,
      { jobId: runtimeControl.jobId, signal: cancellationController.signal }
    ).then(async () => {
      await client.request('turn/interrupt', { threadId });
      throw new Error('Workflow run was cancelled.');
    });
    const leaseRenewal = (async () => {
        while (!finished) {
          await delay(20_000);
          if (finished) break;
          let cancelled = false;
          try {
            cancelled = await runtimeControl.renewLease();
          } catch (error) {
            if (error?.status === 409) throw new Error('Runtime job lease was reclaimed; stopping stale local work.');
            // A temporary network interruption must not abort a running Codex turn.
            // The durable job lease and the next poll provide recovery.
            continue;
          }
          if (cancelled) {
            await client.request('turn/interrupt', { threadId });
            throw new Error('Workflow run was cancelled.');
          }
        }
    })();
    let providerTimer;
    try {
      const executionTimeoutMs = Math.min(900_000, Math.max(1000, Number(task.executionTimeoutMs) || 900_000));
      await Promise.race([completion, cancellation, leaseRenewal,
        new Promise((_, reject) => { providerTimer = setTimeout(() => reject(new Error(`Provider execution exceeded ${executionTimeoutMs} ms.`)), executionTimeoutMs); })]);
    } finally { if (providerTimer) clearTimeout(providerTimer); }
    finished = true;
    cancellationController.abort();
    const raw = finalMessage.trim() || streamedMessage.trim();
    if (!raw) throw new Error('Codex completed without a final structured message.');
    const providerCompletedAt = new Date().toISOString();
    try {
      await runtimeControl.saveRaw?.({ raw, providerThreadId: threadId, timings: { providerCompletedAt } }, deliverables?.snapshot());
    } catch (cause) {
      const error = new Error(`Provider completed, but local result persistence failed: ${cause.message}. Repair local storage and reconcile this job before any retry.`);
      error.providerCompleted = true;
      throw error;
    }
    await publishEvent({ type: 'runtime.result.saved', message: 'Provider result is saved durably on the companion.', threadId }).catch(() => undefined);
    const verificationStartedAt = new Date().toISOString();
    const verifiedRaw = deliverables ? await deliverables.finish(raw) : raw;
    const verificationCompletedAt = new Date().toISOString();
    await publishEvent({ type: 'runtime.result.verified', message: 'Local result verification finished; uploading the saved result.', threadId }).catch(() => undefined);
    return { raw: verifiedRaw, providerThreadId: threadId, account: accountResult.account, timings: { providerCompletedAt, verificationStartedAt, verificationCompletedAt } };
  } finally { finished = true; cancellationController?.abort(); client.stop(); }
}

export async function probeCodexAccount(root) {
  const cwd = await authorizedWorkingDirectory(root, [root]);
  const client = new AppServerClient(cwd, () => {});
  try {
    await client.initialize();
    const result = await client.request('account/read', { refreshToken: true });
    return result?.account || null;
  } finally { client.stop(); }
}

export async function probeCodexCapabilities(root) {
  const cwd = await authorizedWorkingDirectory(root, [root]);
  const client = new AppServerClient(cwd, () => {});
  try {
    await client.initialize();
    const result = await client.request('model/list', {});
    const entries = Array.isArray(result?.data) ? result.data : Array.isArray(result?.models) ? result.models : [];
    const supportedModels = entries.map((entry) => entry?.id || entry?.model || entry?.slug).filter((value) => typeof value === 'string');
    return { supportedModels, supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] };
  } catch { return { supportedModels: [], supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }; }
  finally { client.stop(); }
}

export async function runRuntime(argv = process.argv.slice(2), onStatus = () => {}) {
  stopping = false;
  shutdown = new AbortController();
  const args = argumentsFrom(argv);
  if (args.home) process.env.WORKFLOW_STUDIO_HOME = args.home;
  const home = ensureStudioHome();
  CONFIG_PATH = home.connection;
  if (args.login) {
    const invocation = studioCodexInvocation(RUNTIME_PACKAGE_ROOT, ['login']);
    const child = spawn(invocation.executable, invocation.args, { cwd: home.projects, env: studioRuntimeEnvironment(), stdio: 'inherit', shell: false, windowsHide: true });
    await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code) => code === 0 ? resolve() : reject(new Error('Workflow Studio Codex login failed.'))); });
    return;
  }
  const configuration = await loadConfiguration(args);
  const spool = await createResultSpool(path.join(home.home, 'runtime', 'results'), `${configuration.server}:${configuration.token}`);
  if (args.reconcile) {
    const entry = await spool.read(args.reconcile);
    if (!entry || entry.stage !== 'blocked') throw new Error('No blocked result with this job id exists for the current paired identity.');
    await spool.put(entry.job, entry.body, 'raw');
  }
  let account = null;
  let capabilities = { supportedModels: [], supportedReasoningEfforts: [] };
  try { account = await probeCodexAccount(configuration.allowedRoots[0]); } catch (error) { console.warn(`Codex account check: ${error.message}`); }
  try { capabilities = await probeCodexCapabilities(configuration.allowedRoots[0]); } catch (error) { console.warn(`Codex capability check: ${error.message}`); }
  if (account?.type !== 'chatgpt') console.warn(`Sign in with npm run runtime:login -- --home "${home.home}", then restart this companion.`);
  console.log(`Workflow Studio runtime connected to ${configuration.server}`);
  console.log(`Allowed project roots: ${configuration.allowedRoots.join(', ')}`);

  let heartbeatBusy = false;
  const heartbeat = async () => {
    if (heartbeatBusy || stopping) return;
    heartbeatBusy = true;
    try {
      await request(configuration.server, '/api/runtime/agent/heartbeat', configuration.token, {
        authMode: account?.type === 'chatgpt' ? 'chatgpt' : 'unavailable',
        codexAccountLabel: account?.email || account?.planType || undefined,
        protocolVersion: COMPANION_PROTOCOL_VERSION, companionVersion: COMPANION_APP_VERSION, ...capabilities
      });
    } finally { heartbeatBusy = false; }
  };
  const stopHeartbeat = startRuntimeHeartbeat(heartbeat, (error) => {
      console.warn(`Runtime heartbeat: ${error.message}`);
      if ([401, 403, 426].includes(error.status)) {
        onStatus({ status: 'error', paired: false, message: 'Runtime authorization or compatibility changed. Reconnect from Workflow Studio.' });
        stopRuntime();
      }
  });
  const completeJob = async (job, result) => {
    const saved = await spool.put(job, result);
    while (!stopping) {
      try {
        await request(configuration.server, `/api/runtime/agent/jobs/${encodeURIComponent(job.id)}/complete`, configuration.token, { leaseId: job.leaseId, ...result });
        await spool.acknowledge(job.id, saved.digest);
        return;
      } catch (error) {
        if (error.status >= 400 && error.status < 500 && error.status !== 429) throw error;
        onStatus({ status: 'reconnecting', message: 'Saving the completed task after a connection interruption.' });
        console.warn(`Runtime result upload: ${error.message}`);
        await delay(3000);
      }
    }
  };
  const recoverRawResult = async (job, body) => {
    const task = job.payload;
    const cwd = await authorizedWorkingDirectory(task.cwd, configuration.allowedRoots);
    const delivery = task.serviceName === 'workflow_studio_execution' ? await createProjectDeliverables({
      rootPath: cwd, writeAllowed: task.permission === 'workspace',
      approvedSourceRoots: await loadArtifactSourceRoots(path.join(home.home, 'runtime', 'artifact-sources.json')),
      inputs: task.artifactInputs ?? {}, trace: { runId: task.metadata.workflow_studio_run_id, taskId: task.metadata.workflow_studio_task_id,
        nodeId: task.metadata.workflow_studio_node_id, sourcePlanId: task.metadata.workflow_studio_plan_id, workflowId: task.metadata.workflow_studio_workflow_id,
        assignmentId: task.metadata.workflow_studio_assignment_id, projectId: task.metadata.workflow_studio_project_id }, baselineSnapshot: body.deliveryBaseline
    }) : undefined;
    const result = body.result;
    const verificationStartedAt = new Date().toISOString();
    const raw = delivery ? await delivery.finish(result.raw) : result.raw;
    await completeJob(job, { result: { ...result, raw, timings: { ...result.timings, verificationStartedAt, verificationCompletedAt: new Date().toISOString() } } });
  };
  const blockSavedResult = async (job, body) => {
    if (body) await spool.put(job, body, 'blocked');
    await request(configuration.server, `/api/runtime/agent/jobs/${encodeURIComponent(job.id)}/events`, configuration.token,
      { leaseId: job.leaseId, sequence: null, event: { type: 'runtime.delivery.blocked', message: 'Provider completed; local persistence or verification needs repair. Regeneration is blocked.' } }).catch(() => undefined);
    onStatus({ status: 'error', message: `Result ${job.id} needs local persistence/verification repair. ${body ? `Correct the files/configuration, then use --reconcile ${job.id}.` : 'Local persistence failed; inspect the provider thread and original files before explicitly retrying.'} Provider work was not repeated.` });
  };
  const activeJobs = new Set();
  async function workLoop(index) {
  while (!stopping) {
    try {
      for (const saved of index === 0 ? await spool.pending() : []) {
        if (saved.stage === 'blocked' || activeJobs.has(saved.job.id)) continue;
        try {
          if (saved.stage === 'raw') await recoverRawResult(saved.job, saved.body);
          else await completeJob(saved.job, saved.body);
        }
        catch (error) {
          if (error.status === 401 || error.status === 403 || error.status === 426) throw error;
          if (saved.stage === 'raw' && !error.status) {
            await blockSavedResult(saved.job, saved.body);
          } else if (error.status !== 409) throw error;
          // Keep stale-lease results for explicit reconciliation or a reclaimed
          // lease of the same job. Never deliver them to another task.
        }
      }
      await request(configuration.server, '/api/runtime/agent/heartbeat', configuration.token, {
        authMode: account?.type === 'chatgpt' ? 'chatgpt' : 'unavailable',
        codexAccountLabel: account?.email || account?.planType || undefined,
        protocolVersion: COMPANION_PROTOCOL_VERSION,
        companionVersion: COMPANION_APP_VERSION
        ,...capabilities
      });
      onStatus({ status: account?.type === 'chatgpt' ? 'online' : 'sign-in-required', accountLabel: account?.email || account?.planType || '', server: configuration.server });
      await spool.assertCapacity();
      const { job } = await request(configuration.server, '/api/runtime/agent/jobs/next', configuration.token, {});
      if (!job) {
        // Periodically reconcile the durable queue even when a notification is lost.
        await waitForRuntimeEvent(configuration.server, configuration.token, (type) => type === 'job', { signal: AbortSignal.timeout(20_000) }).catch((error) => {
          if (!['TimeoutError', 'AbortError'].includes(error.name)) throw error;
        });
        continue;
      }
      activeJobs.add(job.id);
      try {
      const savedResult = await spool.read(job.id);
      if (savedResult?.stage === 'verified') {
        await completeJob(job, savedResult.body);
        continue;
      }
      if (savedResult?.stage === 'raw') {
        await recoverRawResult(job, savedResult.body);
        continue;
      }
      if (savedResult?.stage === 'blocked') throw new Error('This saved result requires manual reconciliation; provider work will not be repeated.');
      onStatus({ status: 'working', message: 'Running a workflow task.' });
      let sequence = 0;
      const publishEvent = (event) => request(configuration.server, `/api/runtime/agent/jobs/${encodeURIComponent(job.id)}/events`, configuration.token, { leaseId: job.leaseId, sequence: sequence++, event });
      try {
        if (job.kind === 'skill-discovery') {
          await completeJob(job, { result: { skills: await discoverCodexSkills() } });
          continue;
        }
        if (job.kind === 'workspace-inspection') {
          const result = await runWorkspaceTask(job.payload, configuration.allowedRoots);
          await completeJob(job, { result });
          continue;
        }
        if (job.kind === 'artifact-read') {
          const result = await readArtifactTask(job.payload, configuration.allowedRoots);
          await completeJob(job, { result });
          continue;
        }
        const result = await runCodexTask(
          job.payload,
          configuration.allowedRoots,
          publishEvent,
          async (message) => {
            if (job.kind !== 'planning') return bridgeRuntimeApproval(configuration, job.id, message, publishEvent);
            await publishEvent({
              type: 'planning.input.deferred',
              message: message.method === 'mcpServer/elicitation/request'
                ? 'Codex requested clarification. It will be returned as an open question for review.'
                : 'Codex requested an action during read-only planning. The action was declined.'
            });
            return safeDeclineResponse(message.method);
          },
          {
            server: configuration.server,
            token: configuration.token,
            jobId: job.id,
            saveRaw: async (result, deliveryBaseline) => { await spool.put(job, { result, deliveryBaseline }, 'raw'); },
            renewLease: async () => (await readRequest(configuration.server, `/api/runtime/agent/jobs/${encodeURIComponent(job.id)}?leaseId=${encodeURIComponent(job.leaseId)}`, configuration.token)).job.status === 'cancelled'
          }
        );
        account = result.account;
        await completeJob(job, { result: { raw: result.raw, providerThreadId: result.providerThreadId, timings: result.timings } });
      } catch (error) {
        // A verified result belongs to delivery, not another provider attempt.
        // Keep it durable on upload/acknowledgement failure.
        const pendingResult = await spool.read(job.id);
        if (pendingResult?.stage === 'verified') throw error;
        if (pendingResult?.stage === 'raw' || error.providerCompleted) {
          await blockSavedResult(job, pendingResult?.body);
          continue;
        }
        const current = await readRequest(configuration.server, `/api/runtime/agent/jobs/${encodeURIComponent(job.id)}`, configuration.token).catch(() => null);
        if (current?.job?.status !== 'cancelled' && current?.job?.leaseId === job.leaseId) await completeJob(job, { error: error instanceof Error ? error.message : 'Local runtime task failed.' });
      }
      } finally { activeJobs.delete(job.id); }
    } catch (error) {
      if (stopping) break;
      if (error.status === 401 || error.status === 403) { onStatus({ status: 'error', paired: false, message: 'This connection is no longer authorized. Generate a new pairing code on your website.' }); stopRuntime(); break; }
      if (error.status === 426) { onStatus({ status: 'error', paired: false, message: 'This companion version is no longer compatible. Download the current companion ZIP from Workflow Studio.' }); stopRuntime(); break; }
      onStatus({ status: 'reconnecting', message: error.message });
      console.warn(`Runtime connection: ${error.message}`);
      await delay(3_000);
    }
  }
  }
  const concurrency = Math.min(10, Math.max(1, Number(process.env.WORKFLOW_STUDIO_COMPANION_CONCURRENCY) || 4));
  try { await Promise.all(Array.from({ length: concurrency }, (_, index) => workLoop(index))); }
  finally { stopHeartbeat(); }
}

export function stopRuntime() {
  stopping = true;
  shutdown.abort();
  for (const client of activeClients) client.stop();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on('SIGINT', stopRuntime);
  process.on('SIGTERM', stopRuntime);
  runRuntime().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
