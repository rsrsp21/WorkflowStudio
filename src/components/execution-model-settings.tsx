'use client';

import { CODEX_MODELS, OUTPUT_VERBOSITIES, REASONING_EFFORTS, type ModelSettings } from '@/src/domain/model-settings';

export default function ExecutionModelSettings({ id, settings, onChange, inheritLabel = 'Use default', availableModels }: { id: string; settings: ModelSettings; onChange: (settings: ModelSettings) => void; inheritLabel?: string; availableModels?: readonly string[] }) {
  const models = availableModels ?? CODEX_MODELS;
  return <fieldset className="execution-model-settings"><legend>Execution model settings</legend>
    <label htmlFor={`${id}-model`}>Model</label><select id={`${id}-model`} value={settings.model ?? ''} onChange={(event) => onChange({ ...settings, model: event.target.value || undefined })}><option value="">{inheritLabel}</option>{settings.model && !models.includes(settings.model) && <option value={settings.model} disabled>{settings.model}{availableModels ? ' (unavailable in companion)' : ''}</option>}{models.map((model) => <option key={model} value={model}>{model}</option>)}</select>
    {availableModels && settings.model && !models.includes(settings.model) && <p className="field-help" role="alert">This model is unavailable in the connected companion. Choose an available model.</p>}
    <label htmlFor={`${id}-reasoning`}>Reasoning effort</label><select id={`${id}-reasoning`} value={settings.reasoningEffort ?? ''} onChange={(event) => onChange({ ...settings, reasoningEffort: event.target.value as ModelSettings['reasoningEffort'] || undefined })}><option value="">{inheritLabel}</option>{REASONING_EFFORTS.map((effort) => <option key={effort} value={effort}>{effort}</option>)}</select>
    <label htmlFor={`${id}-verbosity`}>Output verbosity</label><select id={`${id}-verbosity`} value={settings.verbosity ?? ''} onChange={(event) => onChange({ ...settings, verbosity: event.target.value as ModelSettings['verbosity'] || undefined })}><option value="">{inheritLabel}</option>{OUTPUT_VERBOSITIES.map((verbosity) => <option key={verbosity} value={verbosity}>{verbosity}</option>)}</select>
    <details><summary>Sampling controls</summary><label htmlFor={`${id}-temperature`}>Temperature</label><input id={`${id}-temperature`} disabled value="Unavailable with Codex" readOnly /><label htmlFor={`${id}-top-p`}>Top-p</label><input id={`${id}-top-p`} disabled value="Unavailable with Codex" readOnly /><p className="field-help">This companion uses Codex, which does not expose temperature or top-p. Reasoning effort controls thinking depth; verbosity controls output detail.</p></details>
  </fieldset>;
}
