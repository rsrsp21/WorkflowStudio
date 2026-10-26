const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

function inside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function component(value) { const result = String(value).replace(/[^a-z0-9._-]/gi, '_').slice(0, 100); return !result || result === '.' || result === '..' ? 'step' : result; }
function strings(value, visit, key = '', depth = 0) {
  if (depth > 30) throw new Error('Deliverable references exceed the nesting limit.');
  if (typeof value === 'string') visit(value, key);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, visit, key, depth + 1));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => strings(item, visit, name, depth + 1));
}

/** Trusted local runtime configuration; never accept export roots from model output. */
async function loadArtifactSourceRoots(configFile) {
  let config;
  try { config = JSON.parse(await fs.readFile(configFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (!config || !Array.isArray(config.roots) || config.roots.length > 20
    || config.roots.some((root) => typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) === path.parse(path.resolve(root)).root)) {
    throw new Error('Artifact source configuration requires up to 20 explicit absolute folders, not filesystem roots.');
  }
  return [...new Set(config.roots.map((root) => path.resolve(root)))];
}

/** File-type-neutral delivery of declared artifacts from approved source folders. */
async function createProjectDeliverables(context) {
  const root = path.resolve(context.rootPath);
  const realRoot = await fs.realpath(root);
  const sources = (context.approvedSourceRoots ?? []).map((source) => {
    if (!path.isAbsolute(source) || path.resolve(source) === path.parse(path.resolve(source)).root) throw new Error('Artifact source must be an explicit absolute folder, not a filesystem root.');
    return path.resolve(source);
  });
  const baseline = new Map();
  const supplied = new Set();
  strings(context.inputs ?? {}, (value) => {
    if (path.isAbsolute(value) && sources.some((source) => inside(path.resolve(value), source))) supplied.add(path.resolve(value));
  });
  async function scan(directory, depth = 0) {
    if (depth > 16) throw new Error('Artifact source exceeds the inspection depth limit.');
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await scan(file, depth + 1);
      else if (entry.isFile()) {
        if (baseline.size >= 10000) throw new Error('Artifact sources are too large to inspect safely.');
        const info = await fs.stat(file);
        baseline.set(file, `${info.size}:${info.mtimeMs}`);
      }
    }
  }
  if (context.baselineSnapshot !== undefined) {
    if (!Array.isArray(context.baselineSnapshot) || context.baselineSnapshot.length > 10000) throw new Error('Saved artifact baseline is invalid.');
    for (const entry of context.baselineSnapshot) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string'
        || !sources.some((source) => inside(path.resolve(entry[0]), source))) throw new Error('Saved artifact baseline escapes its approved source.');
      baseline.set(entry[0], entry[1]);
    }
  } else if (context.writeAllowed) for (const source of sources) {
    try {
      if (!inside(await fs.realpath(source), await fs.realpath(path.dirname(source)))) throw new Error('Artifact source folder escapes its configured parent.');
      await scan(source);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  return { snapshot() { return [...baseline]; }, async finish(raw) { try {
    const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    let response;
    try { response = JSON.parse(cleaned); } catch { throw new Error('Focused task did not return valid JSON.'); }
    if (!response || !Array.isArray(response.outputs) || !Array.isArray(response.artifacts)) throw new Error('Focused task deliverables are malformed.');
    for (const [key, value] of Object.entries(context.trace)) if (response.trace?.[key] !== value) throw new Error(`Focused task deliverable trace does not match ${key}.`);
    const outputs = response.outputs.map((item) => {
      if (typeof item?.key !== 'string' || typeof item.valueJson !== 'string') throw new Error('Focused task output entry is invalid.');
      return { item, value: JSON.parse(item.valueJson) };
    });
    const candidates = new Map();
    for (const artifact of response.artifacts) {
      if (typeof artifact?.path !== 'string' || !artifact.path.trim() || typeof artifact.description !== 'string') throw new Error('Focused task artifact entry is invalid.');
      candidates.set(artifact.path, artifact.description);
    }
    if (candidates.size > 50) throw new Error('A step may deliver at most 50 files. Split larger deliveries into separate steps.');
    const resolved = new Map();
    const copies = [];
    let totalBytes = 0;
    // Validate every source before writing any exported files.
    for (const [file, description] of candidates) {
      const lexical = path.resolve(root, file);
      const source = await fs.realpath(lexical).catch(() => { throw new Error(`Declared deliverable does not exist: ${file}`); });
      const info = await fs.stat(source);
      if (!info.isFile()) throw new Error(`Deliverable must be a file: ${file}`);
      if (inside(lexical, root) || inside(lexical, realRoot)) {
        if (!inside(source, realRoot)) throw new Error(`Deliverable resolves outside the approved project: ${file}`);
        const projectFile = path.join(root, path.relative(realRoot, source));
        resolved.set(file, projectFile);
        // Relative references to an explicitly declared project file are aliases,
        // not additional inferred deliverables.
        const relative = path.relative(root, projectFile);
        resolved.set(relative, projectFile);
        resolved.set(`.${path.sep}${relative}`, projectFile);
        continue;
      }
      const approvedSource = sources.find((folder) => inside(lexical, folder));
      if (!approvedSource) throw new Error(`Deliverable is outside the approved project folder and configured artifact sources: ${file}`);
      if (!context.writeAllowed) throw new Error('Saving generated files into the project requires an approved workspace-write assignment.');
      if ((await fs.lstat(lexical)).isSymbolicLink()) throw new Error('Generated deliverables must not be symbolic links.');
      const realSourceRoot = await fs.realpath(approvedSource);
      const realSourceParent = await fs.realpath(path.dirname(approvedSource));
      if (!inside(realSourceRoot, realSourceParent) || !inside(source, realSourceRoot)) throw new Error('Deliverable resolves outside the configured artifact source.');
      if (!supplied.has(lexical) && baseline.get(lexical) === `${info.size}:${info.mtimeMs}`) throw new Error(`File was not generated by this task or supplied as an input: ${file}`);
      totalBytes += info.size;
      if (info.size > 100 * 1024 * 1024 || totalBytes > 250 * 1024 * 1024) throw new Error('Generated-file delivery exceeds the size limit.');
      copies.push({ file, source, description });
    }
    for (const copy of copies) {
      const bytes = await fs.readFile(copy.source);
      const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
      const destination = path.join(root, 'artifacts', component(context.trace.runId), component(context.trace.nodeId),
        `attempt-${component(context.attempt ?? 1)}-iteration-${component(context.iteration ?? 0)}`, `${digest}-${component(path.basename(copy.source))}`);
      let ancestor = path.dirname(destination);
      while (true) {
        try { if (!inside(await fs.realpath(ancestor), realRoot)) throw new Error('Deliverable destination escapes the approved project.'); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor); }
      }
      await fs.mkdir(path.dirname(destination), { recursive: true });
      if (!inside(await fs.realpath(path.dirname(destination)), realRoot)) throw new Error('Deliverable destination escapes the approved project.');
      try { await fs.writeFile(destination, bytes, { flag: 'wx' }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await fs.realpath(destination);
        if (!inside(existing, realRoot) || !(await fs.stat(existing)).isFile()
          || !bytes.equals(await fs.readFile(existing))) throw new Error('Existing deliverable conflicts with generated output.');
      }
      resolved.set(copy.file, destination);
    }
    function rewrite(value) {
      if (typeof value === 'string') return resolved.get(value) ?? value;
      if (Array.isArray(value)) return value.map(rewrite);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]));
      return value;
    }
    for (const { item, value } of outputs) item.valueJson = JSON.stringify(rewrite(value));
    response.artifacts = response.artifacts.map((artifact) => ({ ...artifact, path: resolved.get(artifact.path) }));
    const reported = new Set(response.artifacts.map((artifact) => artifact.path));
    for (const [file, description] of candidates) if (!reported.has(resolved.get(file))) {
      response.artifacts.push({ path: resolved.get(file), description }); reported.add(resolved.get(file));
    }
    return JSON.stringify(response);
  } catch (error) {
    const failure = new Error(`Project deliverable verification failed: ${error.message}`, { cause: error });
    failure.code = 'PROJECT_DELIVERABLE_INVALID';
    throw failure;
  } } };
}

module.exports = { createProjectDeliverables, loadArtifactSourceRoots };
