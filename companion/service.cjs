const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { createRequire } = require('node:module');
const { serverOrigin, pairingCode, loginUrl } = require('./policy.cjs');
const { superviseWorker } = require('./worker-supervisor.cjs');

function createService() {
  const root = process.env.WORKFLOW_STUDIO_COMPANION_ROOT;
  const runtimeRoot = process.env.WORKFLOW_STUDIO_RUNTIME_ROOT;
  if (!root || !runtimeRoot) throw new Error('Start the companion using start.cjs as described in RUNNING-INSTRUCTIONS.txt.');
  const load = createRequire(path.join(runtimeRoot, 'package.json'));
  const { ensureStudioHome } = load('./scripts/studio-home.cjs');
  const runtimeModule = () => load(path.join(root, 'runtime-loader.cjs'))(runtimeRoot);
  const settingsPath = path.join(process.env.WORKFLOW_STUDIO_COMPANION_STATE_DIR, 'settings.json');
  let settings = {}, worker, auth, loginTimer, initializing;
  const listeners = new Set();
  let state = { status: 'setup', home: '', server: '', signedIn: false, paired: false, accountLabel: '', message: '' };
  const publish = (update) => { state = { ...state, ...update }; for (const listener of listeners) listener(state); };
  function save() { fs.mkdirSync(path.dirname(settingsPath), { recursive: true }); fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 }); }
  function cancelLogin() { clearTimeout(loginTimer); auth?.stop(); auth = undefined; }

  async function chooseFolder(home) {
    if (worker || auth) throw new Error('Pause the runtime and finish sign-in before changing folders.');
    if (typeof home !== 'string' || !path.isAbsolute(home)) throw new Error('Enter an absolute folder path.');
    const previous = process.env.WORKFLOW_STUDIO_HOME;
    process.env.WORKFLOW_STUDIO_HOME = home;
    let paths;
    try { paths = ensureStudioHome(); } catch (error) { if (previous === undefined) delete process.env.WORKFLOW_STUDIO_HOME; else process.env.WORKFLOW_STUDIO_HOME = previous; throw error; }
    let stored;
    try { stored = JSON.parse(fs.readFileSync(paths.connection, 'utf8')); } catch { /* New folder. */ }
    settings.home = paths.home;
    publish({ status: 'ready', home: paths.home, server: stored?.server ? serverOrigin(stored.server) : '', signedIn: false, paired: Boolean(stored?.token), accountLabel: '', message: 'Folder ready. Sign in to your private Codex runtime.' });
    save();
    const { probeCodexAccount } = await runtimeModule();
    const account = await probeCodexAccount(paths.projects);
    publish({ signedIn: account?.type === 'chatgpt', accountLabel: account?.email || account?.planType || '' });
    return state;
  }
  async function signIn() {
    if (!state.home) throw new Error('Choose a Workflow Studio folder first.');
    if (worker) throw new Error('Pause the runtime before changing its Codex account.');
    cancelLogin();
    publish({ status: 'signing-in', signedIn: false, accountLabel: '', message: 'Complete Codex sign-in in the browser tab.' });
    const { AppServerClient } = await runtimeModule();
    const client = new AppServerClient(ensureStudioHome().projects, (event) => {
      if (event.method !== 'account/login/completed' || auth !== client) return;
      void (async () => {
        if (!event.params?.success) throw new Error(event.params?.error || 'Sign-in was cancelled.');
        const result = await client.request('account/read', { refreshToken: true });
        if (result.account?.type !== 'chatgpt') throw new Error('Use a ChatGPT-backed Codex account.');
        if (auth === client) publish({ status: 'ready', signedIn: true, accountLabel: result.account.email || result.account.planType || 'Codex account', message: 'Signed in. Paste a pairing code from your website.' });
      })().catch((error) => { if (auth === client) publish({ status: 'error', message: error.message }); }).finally(() => { if (auth === client) cancelLogin(); });
    });
    auth = client;
    try {
      await client.initialize();
      const result = await client.request('account/login/start', { type: 'chatgpt' });
      loginTimer = setTimeout(() => { cancelLogin(); publish({ status: 'error', message: 'Sign-in timed out. Try again.' }); }, 10 * 60_000);
      return { authUrl: loginUrl(result.authUrl) };
    } catch (error) { cancelLogin(); throw error; }
  }
  async function stopWorker() {
    const current = worker;
    if (!current) return;
    worker = undefined;
    await current.stop();
  }
  async function connect(server, code) {
    if (!state.signedIn) throw new Error('Sign in to Codex first.');
    const origin = serverOrigin(server);
    const validated = code ? pairingCode(code) : undefined;
    await stopWorker(); cancelLogin();
    settings.server = origin; settings.autoConnect = true; save();
    publish({ status: 'connecting', server: origin, message: 'Connecting securely to your website…' });
    let firstLaunch = true;
    worker = superviseWorker({
      stateDir: process.env.WORKFLOW_STUDIO_COMPANION_STATE_DIR,
      onState: (value) => publish({ ...value, ...(value.status === 'online' ? { paired: true, message: 'Connected. Run workflows from your website.' } : {}) }),
      spawnWorker: () => {
        const current = fork(/* turbopackIgnore: true */ path.join(root, 'worker.cjs'), [], { cwd: state.home, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        // A pairing code is one-use. Restarts load the saved connection instead.
        const args = ['--home', state.home, '--server', origin, ...(firstLaunch && validated ? ['--code', validated] : [])];
        firstLaunch = false;
        current.send({ type: 'start', runtimeRoot, args });
        return current;
      }
    });
    return state;
  }
  async function initialize() {
    if (!initializing) initializing = (async () => {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* First launch. */ }
      if (settings.home) {
        try { await chooseFolder(settings.home); if (settings.autoConnect && state.paired && state.signedIn) await connect(state.server); }
        catch (error) { publish({ status: 'error', message: error.message }); }
      }
    })();
    await initializing;
  }
  async function browse(value) {
    const candidate = value || state.home || os.homedir();
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) throw new Error('Folder path must be absolute.');
    let existing = path.resolve(/* turbopackIgnore: true */ candidate);
    while (!fs.existsSync(/* turbopackIgnore: true */ existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error('No accessible parent folder was found.');
      existing = parent;
    }
    const current = await fsp.realpath(/* turbopackIgnore: true */ existing);
    const entries = await fsp.readdir(current, { withFileTypes: true });
    const drives = process.platform === 'win32' ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`).filter((drive) => fs.existsSync(drive)) : ['/'];
    return { path: current, parent: path.dirname(current) === current ? null : path.dirname(current), drives, directories: entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => ({ name: entry.name, path: path.join(current, entry.name) })).sort((a, b) => a.name.localeCompare(b.name)) };
  }
  return {
    initialize, state: () => state, subscribe: (listener) => { listeners.add(listener); listener(state); return () => listeners.delete(listener); }, browse, chooseFolder, signIn, connect,
    cancelSignIn: () => { cancelLogin(); publish({ status: 'ready', message: 'Sign-in cancelled.' }); return state; },
    resume: () => connect(state.server),
    pause: async () => { settings.autoConnect = false; save(); await stopWorker(); publish({ status: 'paused', message: 'Runtime paused. Your pairing is saved.' }); return state; },
    shutdown: async () => { settings.autoConnect = false; save(); cancelLogin(); await stopWorker(); },
    fail: (error) => publish({ message: error.message })
  };
}
function getService() { return globalThis.__workflowStudioCompanionService ??= createService(); }
module.exports = { getService };
