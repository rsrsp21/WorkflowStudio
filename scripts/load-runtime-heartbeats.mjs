const origins = [process.env.WORKFLOW_STUDIO_INSTANCE_A || 'http://127.0.0.1:3100', process.env.WORKFLOW_STUDIO_INSTANCE_B || process.env.WORKFLOW_STUDIO_INSTANCE_A || 'http://127.0.0.1:3100'].map((value) => new URL(value).origin);
const cookie = process.env.WORKFLOW_STUDIO_LOAD_COOKIE?.trim();
const total = Math.max(1, Number(process.env.WORKFLOW_STUDIO_LOAD_REQUESTS || 1000));
const concurrency = Math.max(1, Math.min(200, Number(process.env.WORKFLOW_STUDIO_LOAD_CONCURRENCY || 50)));
const p95LimitMs = Math.max(1, Number(process.env.WORKFLOW_STUDIO_LOAD_P95_MS || 2000));
if (!cookie) throw new Error('WORKFLOW_STUDIO_LOAD_COOKIE is required. Use a disposable staging account session.');

async function json(origin, pathname, init) {
  const response = await fetch(new URL(pathname, origin), { ...init, signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

const pairing = await json(origins[0], '/api/runtime/connections', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Reconnect load runtime' }) });
if (pairing.response.status !== 201) throw new Error(`Pairing-code creation failed with ${pairing.response.status}.`);
const claim = await json(origins[1], '/api/runtime/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.body.pairing.pairingCode, name: 'Reconnect load runtime', platform: 'load-test', hostname: 'load-test', allowedRoots: ['C:\\WorkflowStudio\\projects'] }) });
if (!claim.response.ok || !claim.body.token) throw new Error(`Runtime pairing failed with ${claim.response.status}.`);

const durations = [];
let next = 0;
let failures = 0;
async function worker() {
  while (true) {
    const index = next++;
    if (index >= total) return;
    const started = performance.now();
    try {
      const heartbeat = await json(origins[index % origins.length], '/api/runtime/agent/heartbeat', { method: 'POST', headers: { authorization: `Bearer ${claim.body.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1, companionVersion: '0.1.0', authMode: 'chatgpt' }) });
      if (!heartbeat.response.ok || heartbeat.body.connection?.id !== claim.body.connection.id) failures += 1;
    } catch { failures += 1; }
    durations.push(performance.now() - started);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
durations.sort((left, right) => left - right);
const at = (value) => durations[Math.min(durations.length - 1, Math.ceil(durations.length * value) - 1)] ?? 0;
await json(origins[0], `/api/runtime/connections?id=${encodeURIComponent(claim.body.connection.id)}`, { method: 'DELETE', headers: { cookie } });
const report = { ready: failures === 0 && at(0.95) <= p95LimitMs, origins, requests: total, concurrency, failures, p50Ms: Math.round(at(0.5)), p95Ms: Math.round(at(0.95)), p99Ms: Math.round(at(0.99)), p95LimitMs };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ready) process.exitCode = 1;
