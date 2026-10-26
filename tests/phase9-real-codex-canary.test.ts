import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

it.skipIf(process.env.WORKFLOW_STUDIO_REAL_CODEX_CANARY !== 'true')('executes the real companion provider bridge and durably captures its final result', async () => {
  const { studioPaths } = createRequire(import.meta.url)('../scripts/studio-home.cjs');
  const base = studioPaths().projects as string;
  const directory = await mkdtemp(path.join(base, 'workflow-qualification-'));
  // Import the same portable worker module, not a second Codex implementation.
  const runtime = await import(/* @vite-ignore */ pathToFileURL(path.join(process.cwd(), 'scripts/workflow-studio-runtime.mjs')).href);
  const { createResultSpool } = createRequire(import.meta.url)('../scripts/runtime-result-spool.cjs');
  const spool = await createResultSpool(path.join(directory, 'spool'), 'isolated-canary');
  const job = { id: `runtime_job_${crypto.randomUUID()}`, leaseId: 'canary-lease' };
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: URL | string, init: RequestInit) => {
    if (!String(url).startsWith('http://127.0.0.1:1/')) return originalFetch(url, init);
    return new Response(new ReadableStream({ start(controller) {
      init.signal?.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')), { once: true });
    } }), { headers: { 'content-type': 'text/event-stream' } });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const capabilities = await runtime.probeCodexCapabilities(directory);
    const model = capabilities.supportedModels.find((value: string) => value === 'gpt-5.6-luna') ?? capabilities.supportedModels[0];
    if (!model) throw new Error('No authenticated Codex model was available for the canary.');
    const nonce = crypto.randomUUID();
    const task = { cwd: directory, permission: 'read-only', serviceName: 'workflow_studio_canary', requireRuntimeApprovals: false,
      modelSettings: { model, reasoningEffort: 'low' },
      prompt: `Do not use tools, run commands, or change files. Return only JSON with the field nonce exactly equal to ${JSON.stringify(nonce)}.`,
      outputSchema: { type: 'object', additionalProperties: false, required: ['nonce'], properties: { nonce: { type: 'string' } } } };
    const result = await Promise.race([
      runtime.runCodexTask(task, [directory], async () => {}, async () => ({ decision: 'decline' }), {
        server: 'http://127.0.0.1:1', token: 'not-a-real-credential', jobId: job.id, renewLease: async () => false,
        saveRaw: async (result: unknown) => { await spool.put(job, { result }, 'raw'); }
      }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { runtime.stopRuntime(); reject(new Error('Real provider canary timed out.')); }, 120_000); })
    ]);
    expect(JSON.parse(result.raw)).toEqual({ nonce });
    expect(await spool.read(job.id)).toMatchObject({ stage: 'raw' });
    await spool.put(job, { result: { raw: result.raw, providerThreadId: result.providerThreadId } });
    console.log(`Real companion provider canary passed with ${model}; no project files or existing runs were changed.`);
  } finally {
    if (timer) clearTimeout(timer); runtime.stopRuntime(); vi.unstubAllGlobals();
    if (path.dirname(directory) !== path.resolve(base) || !path.basename(directory).startsWith('workflow-qualification-')) throw new Error('Unsafe canary cleanup path.');
    await rm(directory, { recursive: true, force: true });
  }
}, 150_000);
