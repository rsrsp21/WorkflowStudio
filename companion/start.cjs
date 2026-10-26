const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const npmCli = process.env.npm_execpath;

function runNpm(args) {
  if (!npmCli) {
    console.error('npm could not be located. Start the companion with the bundled command shown in RUNNING-INSTRUCTIONS.txt.');
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!fs.existsSync(path.join(root, 'node_modules', '.companion-ready'))) {
  console.log('Setting up Workflow Studio Companion. This may take a few minutes...');
  runNpm(['install', '--no-audit', '--no-fund']);
  fs.writeFileSync(path.join(root, 'node_modules', '.companion-ready'), 'ready\n');
}

if (!fs.existsSync(path.join(root, '.next', 'BUILD_ID'))) {
  console.log('Building the local companion website...');
  runNpm(['run', 'build']);
}

require('./launcher.cjs');
