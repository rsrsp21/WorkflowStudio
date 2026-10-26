import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
const { createResultSpool } = createRequire(import.meta.url)('../scripts/runtime-result-spool.cjs');
let directory = '';
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'workflow-spool-')); });
afterEach(async () => { if (!path.basename(directory).startsWith('workflow-spool-')) throw new Error('Invalid test cleanup target.'); await rm(directory, { recursive: true, force: true }); });

describe('durable companion result spool', () => {
  it('preserves the existing 25 MiB artifact preview contract after base64 expansion', async () => {
    const spool = await createResultSpool(directory, 'preview-owner');
    const result = { artifact: { contentBase64: Buffer.alloc(25 * 1024 * 1024).toString('base64') } };
    const saved = await spool.put({ id: 'preview', leaseId: 'lease' }, { result });
    expect((await spool.read('preview')).body.result.artifact.contentBase64.length).toBe(result.artifact.contentBase64.length);
    await spool.acknowledge('preview', saved.digest);
    expect(await spool.pending()).toEqual([]);
  });

  it('recovers a saved result after the writing process is killed before acknowledgement', async () => {
    const modulePath = path.resolve('scripts/runtime-result-spool.cjs');
    const child = spawn(process.execPath, ['-e', `const { createResultSpool } = require(process.argv[1]);
      (async () => { const spool = await createResultSpool(process.argv[2], 'crash-test');
        await spool.put({ id: 'crashed-job', leaseId: 'lease' }, { result: { raw: 'completed once' } });
        process.stdout.write('durable'); setInterval(() => {}, 1000);
      })().catch(() => process.exit(1));`, modulePath, directory], { windowsHide: true });
    const closed = once(child, 'close');
    try {
      await Promise.race([once(child.stdout!, 'data'), closed.then(() => { throw new Error('Writer exited before persistence.'); })]);
      child.kill('SIGKILL'); await closed;
      const restarted = await createResultSpool(directory, 'crash-test');
      const pending = await restarted.pending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ stage: 'verified', body: { result: { raw: 'completed once' } } });
      await restarted.acknowledge(pending[0].job.id, pending[0].digest);
      expect(await restarted.pending()).toEqual([]);
    } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; } }
  });

  it('reopens raw and verified results after process restart without persisting the connection credential', async () => {
    const identity = 'https://studio.example:PRIVATE-CONNECTION-TOKEN';
    const spool = await createResultSpool(directory, identity);
    const job = { id: 'runtime_job_one', leaseId: 'lease_one', payload: { cwd: 'C:\\project' } };
    const body = { result: { raw: '{"result":"done"}', providerThreadId: 'thread-one' } };
    await spool.put(job, body, 'raw');
    const restarted = await createResultSpool(directory, identity);
    expect(await restarted.read(job.id)).toMatchObject({ stage: 'raw', body });
    await restarted.put(job, body);
    const again = await createResultSpool(directory, identity);
    const saved = await again.read(job.id);
    expect(saved).toMatchObject({ stage: 'verified', body, rawBody: body });
    const folders = await readdir(directory);
    const files = await readdir(path.join(directory, folders[0]));
    expect(await readFile(path.join(directory, folders[0], files[0]), 'utf8')).not.toContain('PRIVATE-CONNECTION-TOKEN');
    await again.acknowledge(job.id, saved.digest);
    expect(await again.pending()).toEqual([]);
  });

  it('keeps exact upload replays idempotent and rejects conflicting output or acknowledgements', async () => {
    const spool = await createResultSpool(directory, 'owner');
    const job = { id: 'job', leaseId: 'lease' };
    const saved = await spool.put(job, { result: 'one' });
    expect((await spool.put(job, { result: 'one' })).digest).toBe(saved.digest);
    await expect(spool.put(job, { result: 'two' })).rejects.toThrow('different result');
    await expect(spool.acknowledge(job.id, 'wrong')).rejects.toThrow('does not match');
    expect(await spool.read(job.id)).not.toBeNull();
  });

  it('does not leak one pairing identity into another or silently evict pending results at capacity', async () => {
    const spool = await createResultSpool(directory, 'owner-a', { maxRecords: 1 });
    await spool.put({ id: 'one', leaseId: 'first' }, { result: 'pending' });
    await expect(spool.put({ id: 'two', leaseId: 'second' }, { result: 'new' })).rejects.toThrow('full');
    expect(await spool.read('one')).not.toBeNull();
    expect(await (await createResultSpool(directory, 'owner-b')).pending()).toEqual([]);
  });

  it('retains blocked raw output for explicit reconciliation instead of rerunning a provider', async () => {
    const spool = await createResultSpool(directory, 'owner');
    const job = { id: 'blocked', leaseId: 'lease' };
    const raw = { result: { raw: 'saved provider result' } };
    await spool.put(job, raw, 'raw');
    await spool.put(job, raw, 'blocked');
    expect(await spool.read(job.id)).toMatchObject({ stage: 'blocked', body: raw });
    await spool.put(job, raw, 'raw');
    expect(await spool.read(job.id)).toMatchObject({ stage: 'raw', body: raw });
  });
});
