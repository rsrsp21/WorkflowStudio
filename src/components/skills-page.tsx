'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Skill, SkillStatus } from '@/src/domain/workspace';
import SelectField from './select-field';
import BackButton from './back-button';
import StudioPageShell from './studio-page-shell';
import UiIcon from './ui-icon';

const STATUS_LABEL: Record<SkillStatus, string> = { draft: 'Needs review', published: 'Available', archived: 'Archived' };

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | SkillStatus>('all');
  const [scope, setScope] = useState<'all' | Skill['scope']['kind']>('all');
  const [referenceTime, setReferenceTime] = useState(0);

  async function refresh() {
    const response = await fetch('/api/skills'); const result = await response.json();
    if (!response.ok) throw new Error('Skills could not be loaded.');
    setSkills(result.skills ?? []);
  }

  useEffect(() => { const timer = window.setTimeout(() => { setReferenceTime(Date.now()); void refresh().catch((caught) => setError(caught instanceof Error ? caught.message : 'Skills could not be loaded.')).finally(() => setLoading(false)); }, 0); return () => window.clearTimeout(timer); }, []);

  const filtered = useMemo(() => skills.filter((skill) => {
    const searchable = [skill.name, skill.description, skill.author, skill.source, ...skill.triggers, ...skill.compatibility].join(' ').toLowerCase();
    return (status === 'all' || skill.status === status) && (scope === 'all' || skill.scope.kind === scope) && searchable.includes(query.trim().toLowerCase());
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [query, scope, skills, status]);

  async function action(id: string, lifecycleAction: 'publish' | 'archive' | 'restore' | 'duplicate') {
    setError('');
    const response = await fetch('/api/skills', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action: lifecycleAction }) });
    const result = await response.json();
    if (!response.ok) { setError(result.errors?.[0] || 'Skill could not be updated.'); return; }
    await refresh();
  }

  async function removeSkill(id: string) {
    const response = await fetch(`/api/skills?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) { setError('Skill could not be deleted.'); return; }
    setDeleteId(null); await refresh();
  }

  return <StudioPageShell>
    <section className="route-heading"><div><BackButton href="/studio">Studio</BackButton><h1>Skill registry</h1><p>Manage immutable versions, compatibility, permissions, and reusable capability contracts.</p></div><Link className="dash-button primary" href="/skills/new"><UiIcon name="plus" />Create skill</Link></section>
    {error && <p className="route-banner error">{error}</p>}
    <div className="library-controls skill-library-controls"><label className="library-search"><UiIcon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills, authors, sources, or triggers" aria-label="Search skills" /></label><SelectField ariaLabel="Filter skill scope" value={scope} onChange={(value) => setScope(value as typeof scope)} options={[{ value: 'all', label: 'All scopes' }, { value: 'global', label: 'Shared' }, { value: 'project', label: 'Project-owned' }, { value: 'workflow', label: 'Workflow-owned' }]} /><SelectField ariaLabel="Filter skill status" value={status} onChange={(value) => setStatus(value as typeof status)} options={[{ value: 'all', label: 'All states' }, { value: 'published', label: 'Available' }, { value: 'draft', label: 'Needs review' }, { value: 'archived', label: 'Archived' }]} /><span>{filtered.length} of {skills.length}</span></div>
    {loading ? <div className="route-state"><strong>Loading skills…</strong></div> : filtered.length ? <div className="skill-cards routed-skill-cards">{filtered.map((skill) => {
      const versions = skills.filter((candidate) => candidate.familyId === skill.familyId).sort((left, right) => right.version - left.version);
      const stale = referenceTime > 0 && referenceTime - Date.parse(skill.updatedAt) > 180 * 24 * 60 * 60 * 1000;
      return <article className="dash-skill-card registry-card" key={skill.id}><div className="skill-card-top"><span className={`registry-status ${skill.status}`}>{STATUS_LABEL[skill.status]}</span><button className="dash-icon-button destructive-icon-button" type="button" aria-label={`Delete ${skill.name}`} onClick={() => setDeleteId(skill.id)}><UiIcon name="remove" /></button></div><span>{skill.scope.kind === 'workflow' ? 'Workflow-owned' : skill.scope.kind === 'project' ? 'Project-owned' : 'Shared'} · Version {skill.version}</span><h3>{skill.name}</h3><p>{skill.description || 'No description provided.'}</p><dl className="skill-metadata"><div><dt>Source</dt><dd>{skill.source}</dd></div><div><dt>Author</dt><dd>{skill.author}</dd></div><div><dt>Context</dt><dd>{skill.estimatedContextTokens.toLocaleString()} tokens</dd></div><div><dt>Updated</dt><dd>{skill.updatedAt.slice(0, 10)}{stale ? ' · stale' : ''}</dd></div></dl><div className="compatibility-list">{skill.compatibility.map((item) => <span key={item}>{item}</span>)}</div>{versions.length > 1 && <details className="version-history"><summary>{versions.length} versions</summary>{versions.map((version) => <span key={version.id}>v{version.version} · {STATUS_LABEL[version.status]} · {version.updatedAt.slice(0, 10)}</span>)}</details>}
        {deleteId === skill.id ? <div className="delete-panel"><p>Delete this version and detach its references?</p><div><button className="text-button" type="button" onClick={() => setDeleteId(null)}>Cancel</button><button className="dash-button danger" type="button" onClick={() => void removeSkill(skill.id)}>Delete version</button></div></div> : <div className="registry-actions"><Link className="text-button" href={`/skills/${encodeURIComponent(skill.id)}/edit`}>Edit</Link><button className="text-button" type="button" onClick={() => void action(skill.id, 'duplicate')}>Duplicate</button>{skill.status === 'draft' && <button className="text-button" type="button" onClick={() => void action(skill.id, 'publish')}>Publish</button>}{skill.status !== 'archived' && <button className="text-button" type="button" onClick={() => void action(skill.id, 'archive')}>Archive</button>}{skill.status === 'archived' && <button className="text-button" type="button" onClick={() => void action(skill.id, 'restore')}>Restore as draft</button>}</div>}
      </article>;
    })}</div> : <div className="library-empty"><h3>No matching skills</h3><p>Adjust the search or create a reusable skill.</p></div>}
  </StudioPageShell>;
}
