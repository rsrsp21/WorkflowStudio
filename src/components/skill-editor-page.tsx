'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Skill } from '@/src/domain/workspace';
import { SKILL_CREATION_EXAMPLES } from '@/src/domain/creation-examples';
import StudioPageShell from './studio-page-shell';
import BackButton from './back-button';
import SelectField from './select-field';

type SkillForm = {
  id?: string; name: string; description: string; instructions: string; triggers: string; requiredContext: string;
  inputs: string; outputs: string; requiredPermissions: string; validationCriteria: string; source: string; author: string;
  compatibility: string; estimatedContextTokens: number; status?: Skill['status']; version?: number;
};

function splitLines(value: string) { return value.split(/[,\n]/).map((line) => line.trim()).filter(Boolean); }

function toForm(skill: Skill): SkillForm {
  return { id: skill.id, name: skill.name, description: skill.description, instructions: skill.instructions, triggers: skill.triggers.join(', '), requiredContext: skill.requiredContext.join(', '), inputs: skill.inputs.join(', '), outputs: skill.outputs.join(', '), requiredPermissions: skill.requiredPermissions.join(', '), validationCriteria: skill.validationCriteria.join(', '), source: skill.source, author: skill.author, compatibility: skill.compatibility.join(', '), estimatedContextTokens: skill.estimatedContextTokens, status: skill.status, version: skill.version };
}

const EMPTY_FORM: SkillForm = { name: '', description: '', instructions: '', triggers: '', requiredContext: '', inputs: '', outputs: '', requiredPermissions: '', validationCriteria: '', source: 'Local registry', author: 'Workspace user', compatibility: 'Codex App Server', estimatedContextTokens: 500 };

export default function SkillEditorPage({ skillId, suggestedName = '', returnTo = '/skills' }: { skillId?: string; suggestedName?: string; returnTo?: string }) {
  const router = useRouter();
  const safeReturnTo = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/skills';
  const returningToGraph = safeReturnTo.includes('/graph');
  const [form, setForm] = useState<SkillForm>({ ...EMPTY_FORM, name: suggestedName.replaceAll('-', ' '), instructions: suggestedName ? `Apply ${suggestedName} with explicit inputs, outputs, and validation.` : '' });
  const [loading, setLoading] = useState(Boolean(skillId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [skillExampleId, setSkillExampleId] = useState('');

  useEffect(() => {
    if (!skillId) return;
    void fetch('/api/skills').then((response) => response.json()).then((result) => {
      const skill = (result.skills as Skill[] | undefined)?.find((candidate) => candidate.id === skillId);
      if (!skill) throw new Error('Skill was not found.');
      setForm(toForm(skill));
    }).catch((caught) => setError(caught instanceof Error ? caught.message : 'Skill could not be loaded.')).finally(() => setLoading(false));
  }, [skillId]);

  function update<K extends keyof SkillForm>(field: K, value: SkillForm[K]) { setForm((current) => ({ ...current, [field]: value })); }

  function applySkillExample(exampleId: string) {
    setSkillExampleId(exampleId);
    const example = SKILL_CREATION_EXAMPLES.find((candidate) => candidate.id === exampleId);
    if (!example) return;
    setForm({ name: example.name, description: example.description, instructions: example.instructions, triggers: example.triggers, requiredContext: example.requiredContext, inputs: example.inputs, outputs: example.outputs, requiredPermissions: example.requiredPermissions, validationCriteria: example.validationCriteria, source: example.source, author: example.author, compatibility: example.compatibility, estimatedContextTokens: example.estimatedContextTokens });
    setError('');
  }

  async function save(publishAfterSave = false) {
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/skills', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...form, triggers: splitLines(form.triggers), requiredContext: splitLines(form.requiredContext), inputs: splitLines(form.inputs), outputs: splitLines(form.outputs), requiredPermissions: splitLines(form.requiredPermissions), validationCriteria: splitLines(form.validationCriteria), compatibility: splitLines(form.compatibility) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.[0] || 'Skill could not be saved.');
      if (publishAfterSave) {
        const publishResponse = await fetch('/api/skills', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: result.skill.id, action: 'publish' }) });
        const publishResult = await publishResponse.json();
        if (!publishResponse.ok) throw new Error(publishResult.errors?.[0] || 'Skill was saved but could not be published.');
      }
      router.push(safeReturnTo);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Skill could not be saved.'); }
    finally { setSaving(false); }
  }

  const publishLabel = form.status === 'published' ? 'Save new version and publish' : 'Save and publish';
  return <StudioPageShell>
    <section className="route-heading"><div><BackButton onClick={() => router.push(safeReturnTo)}>Back</BackButton><h1>{skillId ? `Edit ${form.name || 'skill'}` : 'Create skill'}</h1><p>{form.status === 'published' ? `Version ${form.version} is immutable. Saving creates version ${(form.version ?? 0) + 1}.` : returningToGraph ? 'Review this generated skill, then publish it so it can be selected for the assignment.' : 'Define the capability contract, metadata, permissions, and validation criteria.'}</p></div></section>
    {error && <p className="route-banner error">{error}</p>}
    {loading ? <div className="route-state"><strong>Loading skill…</strong></div> : <section className="skill-page-editor">
      {!skillId && <div className="editor-example-bar"><div><strong>Start from a skill example</strong><p>Choose a reusable capability pattern, then adapt its contract before publishing.</p></div><div className="example-select skill-example-select"><SelectField ariaLabel="Use a skill creation example" value={skillExampleId} options={[{ value: '', label: 'Use skill example' }, ...SKILL_CREATION_EXAMPLES.map((example) => ({ value: example.id, label: example.label }))]} onChange={applySkillExample} /></div></div>}
      <div className="skill-form">
        <div><label htmlFor="skill-name">Name</label><input id="skill-name" value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. Requirements quality review" /></div>
        <div><label htmlFor="skill-description">Description</label><input id="skill-description" value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="What this skill does and when to use it" /></div>
        <div className="wide"><label htmlFor="skill-instructions">Instructions</label><textarea id="skill-instructions" rows={10} value={form.instructions} onChange={(event) => { update('instructions', event.target.value); if (!skillId) update('estimatedContextTokens', Math.max(1, Math.ceil(event.target.value.length / 4))); }} placeholder="Describe the steps, decisions, boundaries, and evidence this skill must follow." /></div>
        <div><label htmlFor="skill-triggers">Triggers</label><input id="skill-triggers" value={form.triggers} onChange={(event) => update('triggers', event.target.value)} placeholder="review, validate" /></div>
        <div><label htmlFor="skill-validation">Validation criteria</label><input id="skill-validation" value={form.validationCriteria} onChange={(event) => update('validationCriteria', event.target.value)} placeholder="e.g. Every finding cites evidence" /></div>
        <div><label htmlFor="skill-inputs">Inputs</label><input id="skill-inputs" value={form.inputs} onChange={(event) => update('inputs', event.target.value)} placeholder="requirements, supporting context" /></div>
        <div><label htmlFor="skill-outputs">Outputs</label><input id="skill-outputs" value={form.outputs} onChange={(event) => update('outputs', event.target.value)} placeholder="quality report, unresolved questions" /></div>
        <div><label htmlFor="skill-context">Required context</label><input id="skill-context" value={form.requiredContext} onChange={(event) => update('requiredContext', event.target.value)} placeholder="Files, decisions, or project information needed" /></div>
        <div><label htmlFor="skill-permissions">Required permissions</label><input id="skill-permissions" value={form.requiredPermissions} onChange={(event) => update('requiredPermissions', event.target.value)} placeholder="read workspace, image generation" /></div>
        <div><label htmlFor="skill-source">Source</label><input id="skill-source" value={form.source} onChange={(event) => update('source', event.target.value)} placeholder="e.g. Local registry" /></div>
        <div><label htmlFor="skill-author">Author</label><input id="skill-author" value={form.author} onChange={(event) => update('author', event.target.value)} placeholder="Your name or team" /></div>
        <div><label htmlFor="skill-compatibility">Compatibility</label><input id="skill-compatibility" value={form.compatibility} onChange={(event) => update('compatibility', event.target.value)} placeholder="e.g. Codex App Server" /></div>
        <div><label htmlFor="skill-context-size">Estimated context tokens</label><input id="skill-context-size" type="number" min="1" value={form.estimatedContextTokens} onChange={(event) => update('estimatedContextTokens', Number(event.target.value))} /></div>
      </div>
      <footer><button className="dash-button secondary" type="button" onClick={() => router.push(safeReturnTo)}>Cancel</button>{!returningToGraph && <button className="dash-button secondary" type="button" disabled={saving || !form.name.trim() || !form.instructions.trim()} onClick={() => void save(false)}>{saving ? 'Saving…' : form.status === 'published' ? 'Save as new draft version' : 'Save draft'}</button>}<button className="dash-button primary" type="button" disabled={saving || !form.name.trim() || !form.instructions.trim()} onClick={() => void save(true)}>{saving ? 'Saving…' : publishLabel}</button></footer>
    </section>}
  </StudioPageShell>;
}
