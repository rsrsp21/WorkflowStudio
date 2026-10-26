import React, { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeApprovalRecord, WorkflowRun } from '@/src/domain/runtime';
import RuntimeApprovalControl from '@/src/components/runtime-approval-control';

// Keep the component's ref across gate visits without needing a browser renderer.
const hooks = vi.hoisted(() => ({ keys: { current: {} as Record<string, string> }, setState: vi.fn() }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: () => hooks.keys,
  useState: (value: unknown) => [value, hooks.setState]
}));

const run = { id: 'approval-run', compiledWorkflow: { nodes: [{ id: 'direction', approvalOptions: [{ id: 'approve', label: 'Approve direction', keyword: 'approve_direction', action: 'continue' }] }] } } as unknown as WorkflowRun;
const approval: RuntimeApprovalRecord = { id: 'gate-first', nodeId: 'direction', taskId: 'task', attempt: 1, iteration: 0, requestedAt: '2026-10-22T00:00:00Z' };

function button(tree: ReactNode): (() => void) | undefined {
  if (Array.isArray(tree)) return tree.map(button).find(Boolean);
  if (!React.isValidElement<{ children?: ReactNode; onClick?: () => void }>(tree)) return undefined;
  if (tree.type === 'button') return tree.props.onClick;
  return button(tree.props.children);
}

function clickGate(record: RuntimeApprovalRecord, onRunUpdated: (run: WorkflowRun) => void) {
  const click = button(RuntimeApprovalControl({ run, approval: record, onRunUpdated }));
  if (!click) throw new Error('Approval button missing.');
  click();
}

beforeEach(() => { hooks.keys.current = {}; hooks.setState.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('approval decision request keys', () => {
  it('disables only revision at the loop limit while leaving continue and stop available', () => {
    const limited = { ...run, loopIterations: { revise: 2 }, compiledWorkflow: {
      maxLoopIterations: 2,
      nodes: [{ id: 'direction', type: 'approval', approvalOptions: [
        { id: 'continue', label: 'Continue with screens', keyword: 'continue', action: 'continue' },
        { id: 'revise', label: 'Revise selected screens', keyword: 'revise', action: 'revise' },
        { id: 'stop', label: 'Stop', keyword: 'stop', action: 'stop' }
      ] }, { id: 'revise', type: 'loop' }],
      edges: [{ from: 'direction', to: 'revise', condition: 'revise' }]
    } } as unknown as WorkflowRun;
    const disabled: boolean[] = [];
    function inspect(tree: ReactNode) {
      if (Array.isArray(tree)) { tree.forEach(inspect); return; }
      if (!React.isValidElement<{ children?: ReactNode; disabled?: boolean }>(tree)) return;
      if (tree.type === 'button') disabled.push(Boolean(tree.props.disabled));
      inspect(tree.props.children);
    }
    inspect(RuntimeApprovalControl({ run: limited, approval, onRunUpdated: vi.fn() }));
    expect(disabled).toEqual([false, true, false]);
  });
  it('sends a fresh valid key after success, including another visit to the same gate', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ run }));
    vi.stubGlobal('fetch', fetcher);
    const onRunUpdated = vi.fn();
    clickGate(approval, onRunUpdated);
    await vi.waitFor(() => expect(onRunUpdated).toHaveBeenCalledTimes(1));
    clickGate({ ...approval, id: 'gate-revisited', iteration: 1 }, onRunUpdated);
    await vi.waitFor(() => expect(onRunUpdated).toHaveBeenCalledTimes(2));
    // Even repeated clicks against the old view must never send an empty key.
    clickGate(approval, onRunUpdated);
    await vi.waitFor(() => expect(onRunUpdated).toHaveBeenCalledTimes(3));
    const keys = fetcher.mock.calls.map(([, request]) => JSON.parse(request.body).idempotencyKey as string);
    expect(keys.every((key) => key.trim().length > 0 && key.length <= 128)).toBe(true);
    expect(new Set(keys).size).toBe(3);
  });

  it('reuses the pending key when retrying a request after a connection failure', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce(Response.json({ run }));
    vi.stubGlobal('fetch', fetcher);
    const onRunUpdated = vi.fn();
    clickGate(approval, onRunUpdated);
    await vi.waitFor(() => expect(hooks.setState).toHaveBeenCalledWith('Connection interrupted'));
    clickGate(approval, onRunUpdated);
    await vi.waitFor(() => expect(onRunUpdated).toHaveBeenCalledTimes(1));
    const keys = fetcher.mock.calls.map(([, request]) => JSON.parse(request.body).idempotencyKey);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('does not reuse a previous gate visit key for a later visit after an uncertain response', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce(Response.json({ run }));
    vi.stubGlobal('fetch', fetcher);
    const onRunUpdated = vi.fn();
    clickGate(approval, onRunUpdated);
    await vi.waitFor(() => expect(hooks.setState).toHaveBeenCalledWith('Connection interrupted'));
    clickGate({ ...approval, id: 'gate-second', iteration: 1 }, onRunUpdated);
    await vi.waitFor(() => expect(onRunUpdated).toHaveBeenCalledTimes(1));
    const keys = fetcher.mock.calls.map(([, request]) => JSON.parse(request.body).idempotencyKey);
    expect(keys[1]).not.toBe(keys[0]);
  });
});
