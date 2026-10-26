import React, { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RunExecutionControl from '@/src/components/run-execution-control';
import type { WorkflowRun } from '@/src/domain/runtime';
import { NO_EXECUTION_PROGRESS } from '@/src/domain/execution-progress';

const hooks = vi.hoisted(() => ({ refs: [] as Array<{ current: unknown }>, states: [] as unknown[], effects: [] as Array<() => unknown>, refIndex: 0, stateIndex: 0, refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useRef: (value: unknown) => { const index = hooks.refIndex++; return hooks.refs[index] ??= { current: value }; },
  useState: (value: unknown) => { const index = hooks.stateIndex++; if (!(index in hooks.states)) hooks.states[index] = value; return [hooks.states[index], (next: unknown) => { hooks.states[index] = next; }]; },
  useEffect: (callback: () => unknown) => { hooks.effects.push(callback); }
}));

function run(status = 'running', attempt = 0): WorkflowRun {
  return { id: 'run-client', status, nodeRuns: [{ nodeId: 'step', status: status === 'completed' ? 'completed' : 'pending', attempt, iteration: 0 }], edgeRuns: [], approvalRecords: [], loopIterations: {}, events: [] } as unknown as WorkflowRun;
}
function render(autoStartKey = 0) {
  hooks.refIndex = 0; hooks.stateIndex = 0; hooks.effects = [];
  return RunExecutionControl({ runId: 'run-client', status: 'running', active: false, interrupted: false, pending: 1, autoStartKey, onRunUpdated: vi.fn() });
}
function findButton(tree: ReactNode): (() => void) | undefined {
  if (Array.isArray(tree)) return tree.map(findButton).find(Boolean);
  if (!React.isValidElement<{ children?: ReactNode; onClick?: () => void }>(tree)) return undefined;
  if (tree.type === 'button' && tree.props.children === 'Run workflow') return tree.props.onClick;
  return findButton(tree.props.children);
}
beforeEach(() => { hooks.refs = []; hooks.states = []; hooks.effects = []; hooks.refresh.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('automatic workflow continuation guards', () => {
  it('hands authorized continuation to the server without another browser execute loop', async () => {
    const authorized = { ...run('running', 1), executionRequested: true };
    const fetcher = vi.fn().mockResolvedValue(Response.json({ run: authorized }));
    vi.stubGlobal('fetch', fetcher);
    findButton(render())!();
    await vi.waitFor(() => expect(hooks.states[0]).toBe(false));
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.useFakeTimers(); vi.stubGlobal('window', { setTimeout, clearTimeout });
    hooks.refIndex = 0; hooks.stateIndex = 0; hooks.effects = [];
    RunExecutionControl({ runId: 'run-client', status: 'running', serverOwned: true, active: false, interrupted: false, pending: 1, autoStartKey: 2 });
    hooks.effects.forEach((effect) => effect());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('continues through advancing states to completion without additional clicks or route refreshes', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ run: run('running', 1) }))
      .mockResolvedValueOnce(Response.json({ run: run('running', 2) }))
      .mockResolvedValueOnce(Response.json({ run: run('completed', 3) }));
    vi.stubGlobal('fetch', fetcher);
    findButton(render())!();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(hooks.refresh).not.toHaveBeenCalled();
  });
  it('stops unchanged successful responses instead of flooding the execution endpoint', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ run: run() }));
    vi.stubGlobal('fetch', fetcher);
    const click = findButton(render())!;
    click(); click(); // An immediate second click must not launch another runner.
    await vi.waitFor(() => expect(hooks.states).toContain(NO_EXECUTION_PROGRESS));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(hooks.states).toContain(false);
  });
  it('stops on 429 and honors Retry-After without automatic request retries', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ errors: ['Too many execution requests.'] }, { status: 429, headers: { 'Retry-After': '120' } }));
    vi.stubGlobal('fetch', fetcher);
    const before = Date.now(); findButton(render())!();
    await vi.waitFor(() => expect(hooks.states.some((value) => typeof value === 'string' && value.includes('Automatic execution has stopped'))).toBe(true));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(hooks.states.some((value) => typeof value === 'number' && value >= before + 120_000)).toBe(true);
  });
  it('consumes a gate continuation signal only once, even on subsequent renders', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ run: run('completed', 1) }));
    vi.stubGlobal('fetch', fetcher);
    render(1); hooks.effects.at(-1)!();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    render(1); hooks.effects.at(-1)!();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    render(2); hooks.effects.at(-1)!();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('continues a node completed through live updates without another Run click', async () => {
    vi.useFakeTimers(); vi.stubGlobal('window', { setTimeout, clearTimeout });
    const activeRun = run('running', 1); activeRun.nodeRuns[0].status = 'running';
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ run: activeRun }))
      .mockResolvedValueOnce(Response.json({ run: run('completed', 1) }));
    vi.stubGlobal('fetch', fetcher);
    findButton(render())!();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Live events have now cleared the active-node prop; effect continuation
    // uses the same runner instead of asking the user to start it again.
    render(); hooks.effects.forEach((effect) => effect());
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('continues approved automatic retries rather than pausing after a transient tool failure', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ run: run('running', 1), transition: { kind: 'retried' } }))
      .mockResolvedValueOnce(Response.json({ run: run('completed', 2) }));
    vi.stubGlobal('fetch', fetcher); findButton(render())!();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
});
