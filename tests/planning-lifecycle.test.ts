import { describe, expect, it } from 'vitest';
import { canRetryPlanning, isPlanningActive } from '@/src/domain/planning-lifecycle';

describe('planning lifecycle safety', () => {
  it('prevents duplicate submission while submitting or receiving', () => {
    expect(isPlanningActive('submitting')).toBe(true);
    expect(isPlanningActive('receiving')).toBe(true);
    expect(isPlanningActive('success')).toBe(false);
  });

  it('allows retry only after failure or timeout', () => {
    expect(canRetryPlanning('failure')).toBe(true);
    expect(canRetryPlanning('timeout')).toBe(true);
    expect(canRetryPlanning('receiving')).toBe(false);
    expect(canRetryPlanning('success')).toBe(false);
  });
});
