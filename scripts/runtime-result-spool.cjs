/* eslint-disable @typescript-eslint/no-require-imports -- Shared CommonJS module for the portable companion. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Local, credential-free write-ahead result delivery. Pending entries are never silently evicted. */
async function createResultSpool(base, identity, limits = {}) {
  const root = path.resolve(base, digest(identity));
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('Result spool must not be a symbolic link.');
  const maxBytes = limits.maxBytes ?? 400 * 1024 * 1024;
  const maxRecords = limits.maxRecords ?? 200;
  // A permitted 25 MiB artifact preview expands to about 34 MiB as base64.
  const maxRecordBytes = Math.min(limits.maxRecordBytes ?? 40 * 1024 * 1024, maxBytes);
  for (const name of await fs.readdir(root)) {
    if (!/^[a-f0-9-]{36}\.tmp$/.test(name)) continue;
    const file = path.join(root, name);
    const info = await fs.lstat(file);
    if (info.isFile() && Date.now() - info.mtimeMs > 24 * 60 * 60 * 1000) await fs.unlink(file);
  }
  let queue = Promise.resolve();
  const serial = (operation) => {
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  };
  const fileFor = (id) => path.join(root, `${digest(id)}.json`);
  async function read(id) {
    const file = fileFor(id);
    try {
      if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Result spool entry must not be a symbolic link.');
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      if (value.version !== 1 || value.job.id !== id || value.digest !== digest(value.body)
        || !['raw', 'verified', 'blocked'].includes(value.stage)) throw new Error('Result spool entry is corrupt; manual reconciliation is required.');
      return value;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  return {
    read,
    async assertCapacity() {
      const names = (await fs.readdir(root)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
      let bytes = 0;
      for (const name of names) bytes += (await fs.lstat(path.join(root, name))).size;
      if (bytes + Math.min(10 * maxRecordBytes, maxBytes) > maxBytes || names.length + Math.min(10, Math.max(1, Math.floor(maxRecords / 2))) > maxRecords) {
        throw new Error('Result spool capacity must be reconciled before starting more provider work.');
      }
    },
    async pending() {
      const names = (await fs.readdir(root)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
      const entries = [];
      for (const name of names) {
        const file = path.join(root, name);
        if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Result spool entry must not be a symbolic link.');
        const header = JSON.parse(await fs.readFile(file, 'utf8'));
        const entry = await read(header.job?.id);
        if (entry) entries.push(entry);
      }
      return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    put(job, body, stage = 'verified') { return serial(async () => {
      if (!job?.id || !job.leaseId || !['raw', 'verified', 'blocked'].includes(stage)) throw new Error('Invalid result spool identity or stage.');
      const prior = await read(job.id);
      const fingerprint = digest(body);
      if (prior?.stage === 'verified' && prior.digest !== fingerprint) throw new Error('A different result is already saved for this job.');
      const value = { version: 1, job, body, digest: fingerprint, stage, createdAt: prior?.createdAt ?? new Date().toISOString(),
        ...(prior?.stage === 'raw' ? { rawBody: prior.body } : prior?.rawBody ? { rawBody: prior.rawBody } : {}) };
      const bytes = Buffer.from(JSON.stringify(value));
      if (bytes.length > maxRecordBytes) throw new Error('Result spool entry exceeds the local record size limit.');
      const names = (await fs.readdir(root)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
      let total = bytes.length;
      for (const name of names) if (name !== path.basename(fileFor(job.id))) total += (await fs.lstat(path.join(root, name))).size;
      if (total > maxBytes || (!prior && names.length >= maxRecords)) throw new Error('Result spool is full. Reconcile pending results before starting more work.');
      const temporary = path.join(root, `${randomUUID()}.tmp`);
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, fileFor(job.id));
      try { const directory = await fs.open(root, 'r'); try { await directory.sync(); } finally { await directory.close(); } }
      catch (error) { if (!['EISDIR', 'EPERM', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error; }
      return value;
    }); },
    acknowledge(id, fingerprint) { return serial(async () => {
      const entry = await read(id);
      if (!entry) return;
      if (entry.digest !== fingerprint || entry.stage !== 'verified') throw new Error('Result acknowledgement does not match the saved result.');
      await fs.unlink(fileFor(id));
    }); }
  };
}
module.exports = { createResultSpool };
