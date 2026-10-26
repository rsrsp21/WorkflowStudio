import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  online: vi.fn(), connections: vi.fn(), enqueue: vi.fn(), job: vi.fn(), cancel: vi.fn(), events: vi.fn()
}));
vi.mock('@/src/storage/runtime-connection-repository', () => ({
  getOnlineRuntimeConnection: mocks.online, listRuntimeConnections: mocks.connections,
  enqueueRuntimeJob: mocks.enqueue, getRuntimeJob: mocks.job, cancelRuntimeJob: mocks.cancel,
  listRuntimeJobEvents: mocks.events
}));
vi.mock('@/src/server/runtime-job-events', () => ({ subscribeRuntimeJobUpdates: async () => () => {} }));
import { dispatchPairedRuntimeJob } from '@/src/adapters/paired-runtime-adapter';

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.online.mockResolvedValue({ id: 'runtime_a', status: 'online', authMode: 'chatgpt' });
  mocks.connections.mockResolvedValue([{ id: 'runtime_a', status: 'online' }]);
  mocks.enqueue.mockResolvedValue({ id: 'runtime_job_a' });
  mocks.events.mockResolvedValue([]);
  mocks.job.mockResolvedValue({ id: 'runtime_job_a', connectionId: 'runtime_a', status: 'queued' });
});
afterEach(() => vi.useRealTimers());

it('defers offline dispatch without queueing or cancelling work', async () => {
  mocks.online.mockResolvedValue(null);
  await expect(dispatchPairedRuntimeJob('user_a', 'focused-task', {})).rejects.toMatchObject({ code: 'RUNTIME_UNAVAILABLE' });
  expect(mocks.enqueue).not.toHaveBeenCalled();
  expect(mocks.cancel).not.toHaveBeenCalled();
});

it('retains the existing job on disconnect and consumes its saved result on reconnect', async () => {
  mocks.connections.mockResolvedValue([{ id: 'runtime_a', status: 'offline' }]);
  const payload = { metadata: { workflow_studio_run_id: 'run_a', workflow_studio_attempt: '1' } };
  await expect(dispatchPairedRuntimeJob('user_a', 'focused-task', payload)).rejects.toMatchObject({ code: 'RUNTIME_UNAVAILABLE' });
  expect(mocks.cancel).not.toHaveBeenCalled();
  mocks.connections.mockResolvedValue([{ id: 'runtime_a', status: 'online' }]);
  mocks.job.mockResolvedValue({ id: 'runtime_job_a', connectionId: 'runtime_a', status: 'completed', result: { raw: 'saved output' } });
  await expect(dispatchPairedRuntimeJob('user_a', 'focused-task', payload)).resolves.toMatchObject({ raw: 'saved output', runtimeJobId: 'runtime_job_a' });
  expect(mocks.enqueue.mock.calls[0]).toEqual(mocks.enqueue.mock.calls[1]);
});

it('still times out actual online work instead of waiting indefinitely', async () => {
  const outcome = expect(dispatchPairedRuntimeJob('user_a', 'focused-task', {}, { timeoutMs: 100 })).rejects.toMatchObject({ code: 'JOB_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(101);
  await outcome;
  expect(mocks.cancel).toHaveBeenCalledWith('user_a', 'runtime_job_a');
});

it('does not cancel a durable attempt when completion notifications are lost at the server deadline', async () => {
  mocks.online.mockResolvedValue({ id: 'runtime_a', status: 'online', companionVersion: '0.2.0' });
  mocks.job.mockResolvedValue({ id: 'runtime_job_a', connectionId: 'runtime_a', status: 'leased' });
  const outcome = expect(dispatchPairedRuntimeJob('user_a', 'focused-task', {}, { timeoutMs: 100, requireDurableResults: true }))
    .rejects.toMatchObject({ code: 'RUNTIME_UNAVAILABLE' });
  await vi.advanceTimersByTimeAsync(101); await outcome;
  expect(mocks.cancel).not.toHaveBeenCalled();
});

it('consumes a result committed at the timeout boundary instead of reporting a false timeout', async () => {
  const deadline = Date.now() + 100;
  const provider = vi.fn().mockResolvedValue({ raw: 'verified final result' });
  const result = await provider();
  mocks.job.mockImplementation(async () => ({ id: 'runtime_job_a', connectionId: 'runtime_a',
    status: Date.now() >= deadline ? 'completed' : 'leased', result }));
  // The real cancellation UPDATE only targets queued/leased jobs, so it cannot
  // cancel a completion that won the database race.
  const pending = dispatchPairedRuntimeJob('user_a', 'focused-task', {}, { timeoutMs: 100 });
  const outcome = expect(pending).resolves.toMatchObject({ raw: result.raw, runtimeJobId: 'runtime_job_a' });
  await vi.advanceTimersByTimeAsync(101);
  await outcome;
  expect(provider).toHaveBeenCalledTimes(1);
  expect(mocks.enqueue).toHaveBeenCalledTimes(1);
});

it('consumes completion that wins immediately before the conditional cancellation', async () => {
  let completed = false;
  mocks.job.mockImplementation(async () => ({ id: 'runtime_job_a', connectionId: 'runtime_a',
    status: completed ? 'completed' : 'leased', result: { raw: 'committed during deadline reconciliation' } }));
  mocks.cancel.mockImplementation(async () => { completed = true; });
  const outcome = expect(dispatchPairedRuntimeJob('user_a', 'focused-task', {}, { timeoutMs: 100 }))
    .resolves.toMatchObject({ raw: 'committed during deadline reconciliation' });
  await vi.advanceTimersByTimeAsync(101);
  await outcome;
});

it('waits for delivery without accepting progress as success or regenerating provider work', async () => {
  mocks.events.mockResolvedValue([{ sequence: 0, payload: { type: 'turn/completed', message: 'Codex turn completed.' } }]);
  mocks.job.mockResolvedValue({ id: 'runtime_job_a', connectionId: 'runtime_a', status: 'leased' });
  const outcome = expect(dispatchPairedRuntimeJob('user_a', 'focused-task', {}, { timeoutMs: 100 }))
    .rejects.toMatchObject({ code: 'RUNTIME_UNAVAILABLE' });
  await vi.advanceTimersByTimeAsync(101);
  await outcome;
  expect(mocks.cancel).not.toHaveBeenCalled();
});

it('preserves a committed verification failure at the deadline rather than replacing it with timeout', async () => {
  const deadline = Date.now() + 100;
  mocks.job.mockImplementation(async () => ({ id: 'runtime_job_a', connectionId: 'runtime_a',
    status: Date.now() >= deadline ? 'failed' : 'leased', error: 'Declared artifact is missing.' }));
  const outcome = expect(dispatchPairedRuntimeJob('user_a', 'focused-task', {}, { timeoutMs: 100 }))
    .rejects.toMatchObject({ code: 'JOB_FAILED', message: 'Declared artifact is missing.' });
  await vi.advanceTimersByTimeAsync(101);
  await outcome;
});
