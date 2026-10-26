import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
const runtimeUrl = pathToFileURL(path.resolve('scripts/workflow-studio-runtime.mjs')).href;
afterEach(() => vi.useRealTimers());

it('heartbeats independently while work is pending, handles outages, and stops cleanly', async () => {
  const { startRuntimeHeartbeat } = await import(runtimeUrl);
  vi.useFakeTimers();
  let release!: () => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })).mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValue(undefined);
  const onError = vi.fn();
  const stop = startRuntimeHeartbeat(send, onError, 100);
  await vi.advanceTimersByTimeAsync(300);
  expect(send).toHaveBeenCalledTimes(1);
  release();
  await vi.advanceTimersByTimeAsync(100);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Network unavailable' }));
  await vi.advanceTimersByTimeAsync(100);
  expect(send).toHaveBeenCalledTimes(3);
  stop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(send).toHaveBeenCalledTimes(3);
});
