import { describe, expect, it } from 'vitest';
import { parsePlanningMessage } from '@/src/adapters/codex-cli-adapter';
import { validResponse } from './fixtures';

describe('Codex planning response parser', () => {
  it('preserves planning identifiers for valid structured output', () => {
    const result = parsePlanningMessage(JSON.stringify(validResponse()), 'request-runtime', 'thread-runtime');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.trace).toEqual({ planningRequestId: 'request-runtime', planningThreadId: 'thread-runtime', planId: 'plan-1' });
  });

  it('rejects free-form provider prose', () => {
    const result = parsePlanningMessage('Here is the plan you requested.', 'request-1');
    expect(result).toMatchObject({ ok: false, error: { code: 'MALFORMED_RESPONSE' } });
  });

  it('rejects malformed JSON', () => {
    const result = parsePlanningMessage('{"plan":', 'request-1');
    expect(result).toMatchObject({ ok: false, error: { code: 'MALFORMED_RESPONSE' } });
  });

  it('rejects responses missing warnings and openQuestions', () => {
    const result = parsePlanningMessage(JSON.stringify({ plan: validResponse().plan }), 'request-1');
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_PLAN' } });
  });
});
