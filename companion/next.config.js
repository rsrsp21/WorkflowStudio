const path = require('node:path');
module.exports = {
  experimental: { cpus: 1, workerThreads: true },
  outputFileTracingRoot: path.resolve(__dirname, '..'),
  // Runtime scripts and credentials are loaded only by the local launcher.
  outputFileTracingExcludes: { '*': ['../.codex-runtime/**/*', '../data/**/*', '../release/**/*'] }
};
