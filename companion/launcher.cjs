const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const root = __dirname;
const stateDir = process.env.WORKFLOW_STUDIO_COMPANION_STATE_DIR || path.join(os.homedir(), 'WorkflowStudio', 'runtime', 'companion');
fs.mkdirSync(stateDir, { recursive: true });
const recordPath = path.join(stateDir, 'launcher.json');
const noBrowser = process.argv.includes('--no-browser');
const stopping = process.argv.includes('--stop');
let child;
function openBrowser(url) {
  if (noBrowser) return;
  const opened = process.platform === 'win32' ? spawn('cmd.exe', ['/d', '/c', 'start', '""', url], { windowsHide: true, stdio: 'ignore' }) : spawn('xdg-open', [url], { stdio: 'ignore' });
  opened.on('error', () => console.log('Open the local address shown above in your browser.'));
}
async function request(record, action, method = 'GET') {
  return fetch(`http://127.0.0.1:${record.port}/api/${action}`, { method, headers: { cookie: `workflow_studio_companion=${record.token}`, 'x-companion-request': '1', 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}), signal: AbortSignal.timeout(2000) });
}
async function main() {
  let previous;
  try { previous = JSON.parse(fs.readFileSync(recordPath, 'utf8')); } catch { /* First launch. */ }
  if (previous) {
    const response = await request(previous, 'health').catch(() => null);
    if (response?.ok) {
      if (stopping) { await request(previous, 'shutdown', 'POST'); console.log('Companion stopped.'); }
      else { console.log('The companion is already running.'); openBrowser(`http://127.0.0.1:${previous.port}/connect?token=${previous.token}`); }
      return;
    }
  }
  if (stopping) { console.log('The companion is not running.'); return; }
  const port = await new Promise((resolve, reject) => { const listener = net.createServer(); listener.on('error', reject); listener.listen(0, '127.0.0.1', () => { const value = listener.address().port; listener.close(() => resolve(value)); }); });
  const token = randomBytes(32).toString('hex');
  const record = { port, token };
  const runtimeRoot = fs.existsSync(path.join(root, 'scripts', 'studio-home.cjs')) ? root : path.resolve(root, '..');
  const next = require.resolve('next/dist/bin/next');
  child = spawn(process.execPath, [next, process.argv.includes('--dev') ? 'dev' : 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: root, env: { ...process.env, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || '1', PORT: String(port), HOSTNAME: '127.0.0.1', NEXT_TELEMETRY_DISABLED: '1', WORKFLOW_STUDIO_COMPANION_TOKEN: token, WORKFLOW_STUDIO_COMPANION_ROOT: root, WORKFLOW_STUDIO_RUNTIME_ROOT: runtimeRoot, WORKFLOW_STUDIO_COMPANION_STATE_DIR: stateDir }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let exitCode;
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.on('error', (error) => { console.error(error.message); exitCode = 1; });
  child.on('exit', (code) => { exitCode = code ?? 1; try { if (JSON.parse(fs.readFileSync(recordPath, 'utf8')).token === token) fs.unlinkSync(recordPath); } catch {} });
  for (let attempt = 0; attempt < 90; attempt++) {
    if (exitCode !== undefined) throw new Error('The local website could not start. See the message above.');
    const response = await request(record, 'health').catch(() => null);
    if (response?.ok) {
      fs.writeFileSync(recordPath, JSON.stringify(record), { mode: 0o600 });
      const url = `http://127.0.0.1:${port}/connect?token=${token}`;
      console.log(`\nCompanion ready: ${url}\nKeep this window open. Press Ctrl+C to stop.\n`);
      openBrowser(url);
      const stop = () => { void request(record, 'shutdown', 'POST').catch(() => child.kill()); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill(); throw new Error('The companion did not start within the startup timeout.');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
