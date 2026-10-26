import { describe, expect, it } from 'vitest';
import { modelSettingsErrors, resolveModelSettings, validModelSettings } from '@/src/domain/model-settings';
import { companionSupportsVerbosity } from '@/src/domain/runtime-connection';

describe('Codex execution settings', () => {
  it('resolves model, reasoning, and verbosity independently through the settings hierarchy', () => {
    expect(resolveModelSettings({ verbosity: 'low' }, { model: 'gpt-5.6-sol', reasoningEffort: 'high', verbosity: 'medium' }, { model: 'gpt-5.6-terra', verbosity: 'high' })).toMatchObject({ model: 'gpt-5.6-sol', reasoningEffort: 'high', verbosity: 'low', modelSource: 'workflow', reasoningSource: 'workflow', verbositySource: 'node' });
    expect(resolveModelSettings(undefined, undefined, { verbosity: 'high' })).toMatchObject({ verbosity: 'high', verbositySource: 'organization' });
    expect(resolveModelSettings(undefined, undefined, undefined)).not.toHaveProperty('verbosity');
  });

  it('rejects unsupported sampling and malformed settings instead of silently ignoring them', () => {
    for (const key of ['temperature', 'top_p', 'topP', 'seed', 'max_output_tokens']) expect(modelSettingsErrors({ [key]: 0.5 })).toEqual([`${key} is not supported by the Codex execution backend.`]);
    for (const value of [null, [], 'high', { verbosity: 'extreme' }, { model: 7 }, { reasoningEffort: 'unknown' }]) expect(modelSettingsErrors(value).length).toBeGreaterThan(0);
    expect(validModelSettings({ verbosity: 'medium' })).toBe(true);
  });

  it('requires an updated companion before sending verbosity', () => {
    expect(companionSupportsVerbosity(undefined)).toBe(false);
    expect(companionSupportsVerbosity('0.1.0')).toBe(false);
    expect(companionSupportsVerbosity('0.1.1')).toBe(true);
    expect(companionSupportsVerbosity('1.0.0')).toBe(true);
  });
});
