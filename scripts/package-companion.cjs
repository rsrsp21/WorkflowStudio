const fs = require('node:fs');
const path = require('node:path');
const { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const version = require('../companion/package.json').version;
const qualification = process.argv.includes('--qualification');
const output = path.join(root, 'release', qualification ? 'companion-qualification' : 'companion-next');
const stage = path.join(output, `stage-${Date.now()}`);
const packageRoot = path.join(stage, 'Workflow-Studio-Companion');
const bundle = path.join(packageRoot, 'app');
async function main() {
  fs.mkdirSync(output, { recursive: true });
  for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^stage-\d+$/.test(entry.name)) continue;
    const candidate = path.resolve(output, entry.name);
    if (path.dirname(candidate) !== path.resolve(output)) throw new Error(`Refusing to clean unexpected staging path: ${candidate}`);
    fs.rmSync(candidate, { recursive: true, force: true });
  }
  fs.mkdirSync(bundle, { recursive: true });
  for (const entry of ['app', 'public', 'studio-theme.css', 'package.json', 'package-lock.json', 'next.config.js', 'styles.css', 'policy.cjs', 'control.cjs', 'service.cjs', 'runtime-loader.cjs', 'worker.cjs', 'worker-supervisor.cjs', 'launcher.cjs', 'start.cjs']) fs.cpSync(path.join(root, 'companion', entry), path.join(bundle, entry), { recursive: true });
  fs.mkdirSync(path.join(bundle, 'scripts'));
  for (const entry of ['studio-home.cjs', 'project-deliverables.cjs', 'runtime-result-spool.cjs', 'workflow-studio-runtime.mjs']) fs.copyFileSync(path.join(root, 'scripts', entry), path.join(bundle, 'scripts', entry));
  fs.copyFileSync(path.join(root, 'docs', 'companion-distribution.md'), path.join(bundle, 'README.md'));
  fs.writeFileSync(path.join(packageRoot, 'start.cjs'), [
    "const path = require('node:path');",
    "const applicationRoot = path.join(__dirname, 'app');",
    "process.env.npm_execpath ||= path.join(applicationRoot, 'tools', 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js');",
    'process.chdir(applicationRoot);',
    "require(path.join(applicationRoot, 'start.cjs'));",
    ''
  ].join('\r\n'));
  fs.writeFileSync(path.join(packageRoot, 'start.bat'), [
    '@echo off',
    'setlocal',
    'title Workflow Studio Companion',
    'set "NODE=%~dp0app\\tools\\node\\node.exe"',
    'if not exist "%NODE%" (',
    '  echo The bundled Node.js runtime is missing. Extract the entire ZIP before starting.',
    '  pause',
    '  exit /b 1',
    ')',
    '"%NODE%" "%~dp0start.cjs"',
    'if errorlevel 1 (',
    '  echo.',
    '  echo The companion could not start. Check the error above or contact your IT team.',
    '  pause',
    ')',
    ''
  ].join('\r\n'));
  fs.writeFileSync(path.join(packageRoot, 'stop.bat'), [
    '@echo off',
    'setlocal',
    '"%~dp0app\\tools\\node\\node.exe" "%~dp0app\\launcher.cjs" --stop',
    'if errorlevel 1 pause',
    ''
  ].join('\r\n'));
  fs.writeFileSync(path.join(packageRoot, 'RUNNING-INSTRUCTIONS.txt'), [
    'WORKFLOW STUDIO COMPANION',
    '',
    'START WITHOUT A BAT FILE (RECOMMENDED)',
    '1. Extract this entire ZIP to a normal folder. Do not run it from inside the ZIP.',
    '2. Open PowerShell inside the extracted Workflow-Studio-Companion folder.',
    '3. Run this one command:',
    '   & ".\\app\\tools\\node\\node.exe" ".\\start.cjs"',
    '4. Keep PowerShell open while using Workflow Studio.',
    '',
    'OPTIONAL BAT STARTUP',
    'If company policy allows BAT files, double-click start.bat.',
    'Use stop.bat to stop it, or use the red Stop companion button.',
    '',
    'WHAT THE START COMMAND DOES',
    'The first run installs dependencies, builds the local app, and opens the Companion UI.',
    'Later runs skip installation and building unless their generated files are missing.',
    '',
    'FIRST-TIME CONNECTION',
    '1. In the Companion UI, select the dedicated folder that will contain WorkflowStudio.',
    '2. Sign in with Codex in the browser.',
    '3. On the deployed Workflow Studio website, open Profile > Local runtime and generate a pairing code.',
    '4. Enter the website address and pairing code in the Companion UI, then click Connect.',
    '5. Wait until the Companion UI shows Connected.',
    '',
    'Keep the app folder and the four files beside it together.',
    ''
  ].join('\r\n'));
  const nodeVersion = '24.15.0';
  const filename = `node-v${nodeVersion}-win-x64.zip`;
  const base = `https://nodejs.org/dist/v${nodeVersion}/`;
  const cachedArchive = path.join(output, filename);
  const qualifiedNodeDirectory = process.env.WORKFLOW_STUDIO_COMPANION_NODE_DIR && path.resolve(process.env.WORKFLOW_STUDIO_COMPANION_NODE_DIR);
  if (qualifiedNodeDirectory) {
    const nodeExecutable = path.join(qualifiedNodeDirectory, 'node.exe');
    if (!fs.existsSync(nodeExecutable)) throw new Error('Qualified companion Node directory does not contain node.exe.');
    const reportedVersion = execFileSync(nodeExecutable, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
    if (reportedVersion !== `v${nodeVersion}`) throw new Error(`Qualified companion Node must be v${nodeVersion}; received ${reportedVersion}.`);
    fs.cpSync(qualifiedNodeDirectory, path.join(bundle, 'tools', 'node'), { recursive: true });
    fs.writeFileSync(path.join(bundle, 'NODE-SOURCE.txt'), `Node.js ${reportedVersion}\nQualified source directory supplied by release operator.\n`);
  } else {
    console.log('Downloading official portable Node.js and verifying SHA-256…');
    const checksums = await fetch(`${base}SHASUMS256.txt`).then((response) => { if (!response.ok) throw new Error('Node checksum download failed.'); return response.text(); });
    const expected = checksums.split(/\r?\n/).find((line) => line.trim().endsWith(` ${filename}`))?.split(/\s+/)[0];
    if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Official Node checksum is missing.');
    let bytes;
    if (fs.existsSync(cachedArchive)) bytes = fs.readFileSync(cachedArchive);
    else {
      const response = await fetch(`${base}${filename}`);
      if (!response.ok) throw new Error(`Node download failed: ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Node archive checksum mismatch.');
    fs.writeFileSync(cachedArchive, bytes);
    const unpacked = path.join(stage, 'node');
    fs.mkdirSync(unpacked);
    execFileSync('tar.exe', ['-xf', cachedArchive, '-C', unpacked], { windowsHide: true, stdio: 'inherit' });
    fs.cpSync(path.join(unpacked, `node-v${nodeVersion}-win-x64`), path.join(bundle, 'tools', 'node'), { recursive: true });
    fs.writeFileSync(path.join(bundle, 'NODE-SHA256.txt'), `${expected}  ${filename}\nSource: ${base}\n`);
  }
  const zip = path.join(output, `Workflow-Studio-Companion-${version}-win-x64.zip`);
  execFileSync('tar.exe', ['-a', '-cf', zip, '-C', stage, path.basename(packageRoot)], { windowsHide: true, stdio: 'inherit' });
  const zipBytes = fs.readFileSync(zip);
  const zipHash = createHash('sha256').update(zipBytes).digest('hex');
  fs.writeFileSync(`${zip}.sha256`, `${zipHash}  ${path.basename(zip)}\n`);
  const publicDownloads = qualification ? path.join(output, 'downloads') : path.join(root, 'public', 'downloads');
  fs.mkdirSync(publicDownloads, { recursive: true });
  fs.copyFileSync(zip, path.join(publicDownloads, 'workflow-studio-companion.zip'));
  fs.copyFileSync(`${zip}.sha256`, path.join(publicDownloads, 'workflow-studio-companion.zip.sha256'));
  const signingKeyFile = process.env.WORKFLOW_STUDIO_COMPANION_SIGNING_KEY_FILE;
  if (signingKeyFile || qualification) {
    const privateKey = qualification ? generateKeyPairSync('ed25519').privateKey : createPrivateKey(fs.readFileSync(path.resolve(signingKeyFile)));
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Companion signing key must be an Ed25519 private key.');
    const signature = sign(null, zipBytes, privateKey).toString('base64');
    const signatureDocument = { schemaVersion: 1, algorithm: 'Ed25519', artifact: path.basename(zip), sha256: zipHash, signature };
    const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
    fs.writeFileSync(`${zip}.sig.json`, `${JSON.stringify(signatureDocument, null, 2)}\n`);
    fs.writeFileSync(`${zip}.public.pem`, publicKey);
    fs.copyFileSync(`${zip}.sig.json`, path.join(publicDownloads, 'workflow-studio-companion.zip.sig.json'));
    fs.copyFileSync(`${zip}.public.pem`, path.join(publicDownloads, 'workflow-studio-companion.public.pem'));
  } else {
    for (const file of [`${zip}.sig.json`, `${zip}.public.pem`]) fs.rmSync(file, { force: true });
    for (const file of ['workflow-studio-companion.zip.sig.json', 'workflow-studio-companion.public.pem']) fs.rmSync(path.join(publicDownloads, file), { force: true });
    console.warn('Companion package is checksummed but unsigned. Set WORKFLOW_STUDIO_COMPANION_SIGNING_KEY_FILE for a production release.');
  }
  fs.rmSync(stage, { recursive: true, force: true });
  fs.rmSync(cachedArchive, { force: true });
  console.log(`Companion package: ${zip}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
