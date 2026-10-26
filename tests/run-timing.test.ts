import { describe, expect, it } from 'vitest';
import { isTerminalRunStatus, runElapsedEndTime } from '@/src/domain/run-timing';
import type { WorkflowRun } from '@/src/domain/runtime';

function timing(status: WorkflowRun['status'], events: WorkflowRun['events'] = []): Pick<WorkflowRun, 'status' | 'updatedAt' | 'events'> {
  return { status, updatedAt: '2026-10-22T12:30:00.000Z', events };
}

describe('run elapsed time', () => {
  it.each(['completed', 'failed', 'cancelled'] as const)('freezes %s at its durable terminal event despite later updates', (status) => {
    const timestamp = '2026-10-22T12:10:00.000Z';
    const run = timing(status, [{ type: `run.${status}`, timestamp } as WorkflowRun['events'][number]]);
    expect(isTerminalRunStatus(status)).toBe(true);
    expect(runElapsedEndTime(run, Date.parse('2026-10-22T14:00:00Z'))).toBe(Date.parse(timestamp));
    expect(runElapsedEndTime(run, Date.parse('2026-10-23T14:00:00Z'))).toBe(Date.parse(timestamp));
  });

  it('falls back to persisted updatedAt for older terminal runs without events', () => {
    const run = timing('completed');
    expect(runElapsedEndTime(run, Date.now())).toBe(Date.parse(run.updatedAt));
  });

  it('uses the latest completion after same-run recovery', () => {
    const events = [
      { type: 'run.failed', timestamp: '2026-10-22T12:01:00Z' },
      { type: 'run.completed', timestamp: '2026-10-22T12:10:00Z' },
      { type: 'run.completed', timestamp: '2026-10-22T12:20:00Z' }
    ] as WorkflowRun['events'];
    expect(runElapsedEndTime(timing('completed', events), 0)).toBe(Date.parse(events[2].timestamp));
    expect(runElapsedEndTime(timing('running', events), 12345)).toBe(12345);
    expect(isTerminalRunStatus('running')).toBe(false);
  });
});
