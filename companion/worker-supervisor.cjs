const fs = require('node:fs');
const path = require('node:path');

function superviseWorker({ spawnWorker, onState, stateDir, schedule = setTimeout, cancel = clearTimeout }) {
  let child, timer, stopped = false, failures = 0;
  const logPath = path.join(stateDir, 'runtime.log');
  function log(message) {
    const safe = String(message).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/([?&]token=)[^\s&]+/gi, '$1[redacted]').slice(0, 8000);
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) {
        fs.copyFileSync(logPath, `${logPath}.previous`);
        fs.truncateSync(logPath, 0);
      }
      fs.appendFileSync(logPath, `${new Date().toISOString()} ${safe}\n`, { mode: 0o600 });
    } catch { console.warn('Could not write the Companion diagnostic log.'); }
  }
  function retry() {
    if (stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
    onState({ status: 'reconnecting', message: `Runtime stopped unexpectedly. Reconnecting in ${delay / 1000}s. Details: ${logPath}` });
    timer = schedule(start, delay);
  }
  function start() {
    if (stopped) return;
    timer = undefined;
    try { child = spawnWorker(); } catch (error) { log(`Worker launch failed: ${error.message}`); retry(); return; }
    const current = child;
    log(`Worker started (pid ${current.pid ?? 'unknown'}).`);
    current.stdout?.on('data', (chunk) => log(chunk.toString()));
    current.stderr?.on('data', (chunk) => log(chunk.toString()));
    current.on('message', (message) => {
      if (stopped || child !== current || message.type !== 'state') return;
      if (message.state.status === 'online') failures = 0;
      // Revoked credentials and incompatible versions require user action.
      if (message.state.paired === false || message.state.status === 'sign-in-required') stopped = true;
      if (message.state.status === 'error') log(`Worker reported: ${message.state.message}`);
      onState(message.state);
    });
    current.on('error', (error) => {
      log(`Worker error: ${error.stack || error.message}`);
      if (!current.pid && child === current) { child = undefined; retry(); }
    });
    current.once('exit', (code, signal) => {
      log(`Worker exited (code ${code}, signal ${signal || 'none'}).`);
      if (child !== current) return;
      child = undefined;
      retry();
    });
  }
  start();
  return {
    logPath,
    async stop() {
      stopped = true;
      if (timer !== undefined) cancel(timer);
      const current = child;
      child = undefined;
      if (!current) return;
      await new Promise((resolve) => {
        const timeout = schedule(() => { current.kill(); resolve(); }, 5000);
        current.once('exit', () => { cancel(timeout); resolve(); });
        if (current.connected) current.send({ type: 'stop' }); else current.kill();
      });
    }
  };
}
module.exports = { superviseWorker };
