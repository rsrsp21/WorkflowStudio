import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
const { superviseWorker } = createRequire(import.meta.url)('../companion/worker-supervisor.cjs');
const directories: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  vi.useFakeTimers();
  const stateDir = mkdtempSync(path.join(tmpdir(), 'companion-supervisor-'));
  directories.push(stateDir);
  const children: Array<ReturnType<typeof child>> = [];
  function child() {
    const value = Object.assign(new EventEmitter(), { pid: 123, connected: true, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(), send: vi.fn() });
    value.send.mockImplementation(() => { value.emit('exit', 0, null); });
    return value;
  }
  const spawnWorker = vi.fn(() => { const value = child(); children.push(value); return value; });
  const onState = vi.fn();
  const supervisor = superviseWorker({ spawnWorker, onState, stateDir });
  return { supervisor, children, spawnWorker, onState };
}

it('logs errors and exit codes, redacts bearer tokens, and restarts with increasing delays', async () => {
  const f = fixture();
  f.children[0].stderr.emit('data', Buffer.from('Request failed: Bearer secret-token'));
  f.children[0].emit('exit', 1, null);
  expect(f.onState).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'reconnecting' }));
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.spawnWorker).toHaveBeenCalledTimes(2);
  f.children[1].emit('exit', 2, null);
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.spawnWorker).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.spawnWorker).toHaveBeenCalledTimes(3);
  const log = readFileSync(f.supervisor.logPath, 'utf8');
  expect(log).toContain('code 1');
  expect(log).toContain('Bearer [redacted]');
  expect(log).not.toContain('secret-token');
  await f.supervisor.stop();
});

it('does not restart after an intentional stop or revoked pairing', async () => {
  const f = fixture();
  f.children[0].emit('exit', 1, null);
  await f.supervisor.stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.spawnWorker).toHaveBeenCalledTimes(1);
  const revoked = fixture();
  revoked.children[0].emit('message', { type: 'state', state: { status: 'error', paired: false, message: 'Revoked.' } });
  revoked.children[0].emit('exit', 0, null);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(revoked.spawnWorker).toHaveBeenCalledTimes(1);
  await revoked.supervisor.stop();
});
