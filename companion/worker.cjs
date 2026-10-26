const { pathToFileURL } = require('node:url');
const path = require('node:path');

let runtime;
let stopping = false;
process.on('disconnect', () => { stopping = true; runtime?.stopRuntime(); });
process.on('message', async (data) => {
  if (data.type === 'stop') { stopping = true; runtime?.stopRuntime(); return; }
  if (data.type !== 'start' || runtime || stopping) return;
  try {
    runtime = await import(pathToFileURL(path.join(data.runtimeRoot, 'scripts', 'workflow-studio-runtime.mjs')).href);
    if (stopping) return;
    await runtime.runRuntime(data.args, (state) => process.send?.({ type: 'state', state }));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
    if (!stopping) process.send?.({ type: 'state', state: { status: 'error', message: error.message } });
  } finally { if (process.connected) process.disconnect(); }
});
