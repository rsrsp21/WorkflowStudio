export const CODEX_MODELS = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'] as const;

/** Use the connected runtime's catalog, not the static catalog, for a new assignment default. */
export function companionDefaultModel(models: readonly string[], preferred?: string): string | undefined {
  return preferred && models.includes(preferred) ? preferred : models[0];
}
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];
export const OUTPUT_VERBOSITIES = ['low', 'medium', 'high'] as const;
export type OutputVerbosity = typeof OUTPUT_VERBOSITIES[number];
export type ModelSettingSource = 'node' | 'workflow' | 'organization' | 'system' | 'run';
export interface ModelSettings { model?: string; reasoningEffort?: ReasoningEffort; verbosity?: OutputVerbosity }
export interface ResolvedModelSettings { model: string; reasoningEffort: ReasoningEffort; verbosity?: OutputVerbosity; modelSource: ModelSettingSource; reasoningSource: ModelSettingSource; verbositySource?: ModelSettingSource }
const MODEL_REASONING: Record<string, readonly ReasoningEffort[]> = {
  'gpt-6-astra': REASONING_EFFORTS,
  'gpt-5.6-sol': REASONING_EFFORTS,
  'gpt-5.6-terra': REASONING_EFFORTS,
  'gpt-5.6-luna': ['low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.5': ['low', 'medium', 'high', 'xhigh']
};

export function modelSettingsErrors(value: unknown): string[] {
  if (value === undefined) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Model settings must be an object.'];
  const settings = value as Record<string, unknown>;
  const errors: string[] = [];
  const allowed = ['model', 'reasoningEffort', 'verbosity', 'modelSource', 'reasoningSource', 'verbositySource'];
  for (const key of Object.keys(settings)) if (!allowed.includes(key) && settings[key] !== undefined) errors.push(`${key} is not supported by the Codex execution backend.`);
  if (settings.model !== undefined && (typeof settings.model !== 'string' || !/^[a-zA-Z0-9._-]{2,100}$/.test(settings.model))) errors.push('Model id is invalid.');
  if (settings.reasoningEffort !== undefined && !REASONING_EFFORTS.includes(settings.reasoningEffort as ReasoningEffort)) errors.push('Reasoning effort is invalid.');
  if (settings.verbosity !== undefined && !OUTPUT_VERBOSITIES.includes(settings.verbosity as OutputVerbosity)) errors.push('Output verbosity must be low, medium, or high.');
  return errors;
}

export function validModelSettings(value?: ModelSettings) {
  return modelSettingsErrors(value).length === 0;
}

export function resolveModelSettings(node: ModelSettings | undefined, workflow: ModelSettings | undefined, organization: ModelSettings | undefined): ResolvedModelSettings {
  const system = { model: process.env.CODEX_DEFAULT_MODEL || 'gpt-5.6-sol', reasoningEffort: (REASONING_EFFORTS.includes(process.env.CODEX_DEFAULT_REASONING_EFFORT as ReasoningEffort) ? process.env.CODEX_DEFAULT_REASONING_EFFORT : 'medium') as ReasoningEffort };
  const modelSource = node?.model ? 'node' : workflow?.model ? 'workflow' : organization?.model ? 'organization' : 'system';
  const reasoningSource = node?.reasoningEffort ? 'node' : workflow?.reasoningEffort ? 'workflow' : organization?.reasoningEffort ? 'organization' : 'system';
  const verbosity = node?.verbosity ?? workflow?.verbosity ?? organization?.verbosity;
  return { model: node?.model || workflow?.model || organization?.model || system.model, reasoningEffort: node?.reasoningEffort || workflow?.reasoningEffort || organization?.reasoningEffort || system.reasoningEffort, modelSource, reasoningSource, ...(verbosity ? { verbosity, verbositySource: node?.verbosity ? 'node' : workflow?.verbosity ? 'workflow' : 'organization' } : {}) };
}

export function supportsModelReasoning(model: string, effort: ReasoningEffort) {
  return !MODEL_REASONING[model] || MODEL_REASONING[model].includes(effort);
}
