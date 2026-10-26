import { writeFile } from 'node:fs/promises';

const instanceA = new URL(process.env.WORKFLOW_STUDIO_INSTANCE_A || 'http://127.0.0.1:3100').origin;
const instanceB = new URL(process.env.WORKFLOW_STUDIO_INSTANCE_B || 'http://127.0.0.1:3101').origin;
const reportFile = process.env.WORKFLOW_STUDIO_QUALIFICATION_REPORT?.trim();
const checks = [];
const startedAt = new Date().toISOString();

async function request(origin, pathname, init = {}) {
  const started = performance.now();
  const response = await fetch(new URL(pathname, origin), { ...init, signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
  return { response, body, durationMs: Math.round(performance.now() - started) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks.push(message);
}

async function main() {
  const [healthA, healthB] = await Promise.all([request(instanceA, '/api/health'), request(instanceB, '/api/health')]);
  assert(healthA.response.ok && healthA.body.status === 'ready', 'Instance A is database-ready.');
  assert(healthB.response.ok && healthB.body.status === 'ready', 'Instance B is database-ready.');
  const [versionA, versionB] = await Promise.all([request(instanceA, '/api/version'), request(instanceB, '/api/version')]);
  assert(versionA.response.ok && versionB.response.ok, 'Both instances publish a release manifest.');
  assert(JSON.stringify(versionA.body) === JSON.stringify(versionB.body), 'Both instances report the same release and compatibility manifest.');

  const identity = crypto.randomUUID();
  const signup = await request(instanceA, '/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Multi-instance qualification', position: 'Release verifier', email: `qualification-${identity}@example.invalid`, password: `Qualification-${identity}!` }) });
  assert(signup.response.status === 201 && typeof signup.body.user?.id === 'string', 'Account creation succeeds on instance A.');
  const cookie = signup.response.headers.get('set-cookie')?.split(';')[0];
  assert(Boolean(cookie), 'Instance A issues an HTTP-only session cookie.');

  const sessionOnB = await request(instanceB, '/api/auth/me', { headers: { cookie } });
  assert(sessionOnB.response.ok && sessionOnB.body.user?.id === signup.body.user.id, 'The PostgreSQL session created on A is accepted by B.');

  const pairing = await request(instanceA, '/api/runtime/connections', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Qualification runtime' }) });
  const code = pairing.body.pairing?.pairingCode;
  assert(pairing.response.status === 201 && typeof code === 'string', 'Instance A creates a one-time pairing code.');

  const claimBody = { code, name: 'Qualification runtime', platform: 'qualification', hostname: 'shared-db-test', allowedRoots: ['C:\\WorkflowStudio\\projects'] };
  const claims = await Promise.all([instanceA, instanceB].map((origin) => request(origin, '/api/runtime/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(claimBody) })));
  const winners = claims.filter((claim) => claim.response.status === 200);
  const losers = claims.filter((claim) => claim.response.status === 401);
  assert(winners.length === 1 && losers.length === 1, 'Concurrent cross-instance pairing has exactly one winner.');
  const token = winners[0].body.token;
  assert(typeof token === 'string', 'The winning claim returns one runtime bearer credential.');

  const heartbeat = await request(instanceB, '/api/runtime/agent/heartbeat', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1, companionVersion: '0.1.0', authMode: 'chatgpt' }) });
  assert(heartbeat.response.ok && heartbeat.body.connection?.status === 'online', 'A runtime claimed through either instance can heartbeat through instance B.');

  const [connectionsA, connectionsB] = await Promise.all([request(instanceA, '/api/runtime/connections', { headers: { cookie } }), request(instanceB, '/api/runtime/connections', { headers: { cookie } })]);
  const connectionId = heartbeat.body.connection.id;
  assert(connectionsA.body.connections?.some((item) => item.id === connectionId && item.status === 'online'), 'Instance A observes the shared online runtime.');
  assert(connectionsB.body.connections?.some((item) => item.id === connectionId && item.status === 'online'), 'Instance B observes the same shared online runtime.');

  const revoked = await request(instanceA, `/api/runtime/connections?id=${encodeURIComponent(connectionId)}`, { method: 'DELETE', headers: { cookie } });
  assert(revoked.response.ok, 'Instance A revokes the shared runtime credential.');
  const staleHeartbeat = await request(instanceB, '/api/runtime/agent/heartbeat', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1, companionVersion: '0.1.0' }) });
  assert(staleHeartbeat.response.status === 401, 'Instance B rejects the revoked credential immediately.');

  const report = { ready: true, startedAt, completedAt: new Date().toISOString(), instances: [instanceA, instanceB], release: versionA.body, checks, latencyMs: { healthA: healthA.durationMs, healthB: healthB.durationMs, crossInstanceSession: sessionOnB.durationMs, heartbeat: heartbeat.durationMs } };
  if (reportFile) await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(async (error) => {
  const report = { ready: false, startedAt, completedAt: new Date().toISOString(), instances: [instanceA, instanceB], checks, error: error instanceof Error ? error.message : String(error) };
  if (reportFile) await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8').catch(() => undefined);
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
});
