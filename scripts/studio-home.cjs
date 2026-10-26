const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function studioPaths() {
  const root = process.env.WORKFLOW_STUDIO_HOME || path.join(os.homedir(), 'WorkflowStudio');
  if (!path.isAbsolute(root)) throw new Error('WORKFLOW_STUDIO_HOME must be an absolute folder path.');
  const home = path.resolve(/* turbopackIgnore: true */ root);
  assertDedicatedHome(home);
  return { home, projects: path.join(home, 'projects'), data: path.join(home, 'data'),
    codex: path.join(home, '.codex'), skills: path.join(home, '.agents', 'skills'),
    agents: path.join(home, '.codex', 'agents'), temporary: path.join(home, 'runtime', 'tmp'), connection: path.join(home, 'runtime', 'connection.json') };
}

function within(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertDedicatedHome(home) {
  const userHome = os.homedir();
  if (path.relative(userHome, home) === '' || path.parse(home).root === home
    || within(home, path.join(userHome, '.codex')) || within(home, path.join(userHome, '.agents'))) {
    throw new Error('Choose a dedicated Workflow Studio folder, not your user profile or global Codex folders.');
  }
}

function ensureStudioHome() {
  const paths = studioPaths();
  fs.mkdirSync(paths.home, { recursive: true });
  const realHome = fs.realpathSync.native(paths.home);
  assertDedicatedHome(realHome);
  for (const directory of [paths.projects, paths.data, paths.codex, path.join(paths.codex, 'skills'), paths.skills, paths.agents, paths.temporary, path.dirname(paths.connection)]) {
    // Check existing ancestors before creating anything through a junction.
    let ancestor = directory;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    if (!within(fs.realpathSync.native(ancestor), realHome)) throw new Error('Workflow Studio folders must not link outside its home.');
    fs.mkdirSync(directory, { recursive: true });
    if (!within(fs.realpathSync.native(directory), realHome)) throw new Error('Workflow Studio folders must not link outside its home.');
  }
  const marker = path.join(paths.home, '.workflow-studio-root');
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, '', { flag: 'wx' });
  return paths;
}

function assertStudioProject(value) {
  const paths = ensureStudioHome();
  if (!path.isAbsolute(value) || !within(path.resolve(value), paths.projects)) throw new Error(`Choose a project inside ${paths.projects}.`);
  let ancestor = path.resolve(value);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (!within(fs.realpathSync.native(ancestor), fs.realpathSync.native(paths.projects))) throw new Error('Project folder resolves outside Workflow Studio projects.');
  return path.resolve(value);
}

function studioRuntimeEnvironment() {
  const paths = ensureStudioHome();
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('CODEX_')));
  return { ...environment, WORKFLOW_STUDIO_HOME: paths.home, CODEX_HOME: paths.codex,
    HOME: paths.home, USERPROFILE: paths.home, GIT_CEILING_DIRECTORIES: paths.home };
}

// Stop repository discovery at the app home, including when projects are not Git repositories.
function studioCodexArguments() {
  const paths = ensureStudioHome();
  const disabled = [];
  const visited = new Set();
  // Codex uses the Windows Known Folder API for user skills, which ignores
  // HOME/USERPROFILE. Enumerate paths only and disable those skills in this
  // child process. Never read their instructions or modify global config.
  function exclude(root) {
    if (!fs.existsSync(root)) return;
    const canonical = fs.realpathSync.native(root);
    if (within(canonical, fs.realpathSync.native(paths.home)) || visited.has(canonical)) return;
    visited.add(canonical);
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      const metadata = fs.statSync(file);
      if (metadata.isDirectory()) exclude(file);
      else if (entry.name === 'SKILL.md') disabled.push(fs.realpathSync.native(file));
    }
  }
  exclude(path.join(os.homedir(), '.agents', 'skills'));
  if (process.platform !== 'win32') exclude('/etc/codex/skills');
  const rules = disabled.map((file) => `{path=${JSON.stringify(file)},enabled=false}`).join(',');
  return ['-c', 'project_root_markers=[".workflow-studio-root", ".git"]', '-c', 'cli_auth_credentials_store="file"',
    '-c', `skills.config=[${rules}]`];
}

function studioCodexInvocation(packageRoot, args) {
  const entrypoint = path.join(packageRoot, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (!fs.existsSync(entrypoint)) throw new Error('The project-pinned Codex runtime is missing. Run npm install in Workflow Studio.');
  if (process.platform === 'win32') {
    // Killing the Node wrapper on Windows leaves the native child alive.
    const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
    const executable = path.join(packageRoot, 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', triple, 'bin', 'codex.exe');
    if (!fs.existsSync(executable)) throw new Error('The pinned native Codex runtime is missing. Run npm install in Workflow Studio.');
    return { executable, args: [...studioCodexArguments(), ...args] };
  }
  return { executable: process.execPath, args: [entrypoint, ...studioCodexArguments(), ...args] };
}

module.exports = { studioPaths, ensureStudioHome, assertStudioProject, studioRuntimeEnvironment, studioCodexArguments, studioCodexInvocation };
