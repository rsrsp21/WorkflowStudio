'use client';

import { useCallback, useEffect, useState } from 'react';
import UiIcon from './ui-icon';

type ReviewItem = {
  kind: 'definition' | 'assignment' | 'run-gate'; id: string; name: string; version: number; updatedAt: string;
  owner?: { id: string; name: string; email: string }; errors?: string[]; nodeId?: string; nodeName?: string; approvalId?: string;
  options?: Array<{ id: string; label: string; keyword: string }>;
  artifacts?: Array<{ id: string; description: string }>;
};

async function fetchReviewItems() {
  const response = await fetch('/api/reviews', { cache: 'no-store' });
  if (!response.ok) throw new Error('Review queue is unavailable.');
  const result = await response.json() as { reviews?: ReviewItem[] };
  return result.reviews ?? [];
}

export default function ReviewQueue() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try { setItems(await fetchReviewItems()); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Review queue is unavailable.'); }
  }, []);
  useEffect(() => {
    let active = true;
    void fetchReviewItems().then((result) => { if (active) setItems(result); }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : 'Review queue is unavailable.'); });
    return () => { active = false; };
  }, []);

  async function decide(item: ReviewItem, choice?: { keyword?: string; decision?: string }) {
    setBusy(`${item.kind}:${item.id}`); setMessage('');
    try {
      const response = await fetch('/api/reviews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: item.kind, id: item.id, ownerUserId: item.owner?.id, expectedUpdatedAt: item.updatedAt, nodeId: item.nodeId, approvalId: item.approvalId, ...choice }) });
      const result = await response.json() as { error?: string; errors?: string[] };
      if (!response.ok) throw new Error(result.errors?.join(' ') || result.error || 'Review decision failed.');
      setMessage(`${item.name} reviewed.`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Review decision failed.'); }
    finally { setBusy(''); }
  }

  return <section className="profile-settings-section">
    <div className="profile-section-heading"><UiIcon name="lock" /><div><h3>Review queue</h3><p>Approve submitted definitions, assignments, and active workflow gates.</p></div></div>
    {message && <p className="profile-form-message" role="status">{message}</p>}
    {!items.length ? <p className="profile-review-empty">No items are waiting for review.</p> : <div className="profile-review-list">{items.map((item) => {
      const key = `${item.kind}:${item.id}`; const invalid = Boolean(item.errors?.length);
      return <article key={key}><div><span>{item.kind === 'run-gate' ? item.nodeName : item.kind}</span><strong>{item.name}</strong><small>{item.owner?.name ?? 'Unknown owner'} · v{item.version}</small>{item.artifacts?.map((artifact) => <a key={artifact.id} href={`/api/reviews/artifacts?ownerUserId=${encodeURIComponent(item.owner?.id ?? '')}&runId=${encodeURIComponent(item.id)}&artifactId=${encodeURIComponent(artifact.id)}`} target="_blank" rel="noreferrer">Review {artifact.description || artifact.id}</a>)}{invalid && <small className="profile-review-error">{item.errors?.[0]}</small>}</div><div className="profile-review-actions">
        {item.kind !== 'run-gate' && <button className="dash-button primary" type="button" disabled={busy === key || invalid} onClick={() => void decide(item)}>{busy === key ? 'Approving…' : 'Approve'}</button>}
        {item.kind === 'run-gate' && item.options?.map((option) => <button className="dash-button secondary" type="button" key={option.id} disabled={busy === key} onClick={() => void decide(item, { keyword: option.keyword })}>{option.label}</button>)}
        {item.kind === 'run-gate' && !item.options?.length && <><button className="dash-button primary" type="button" disabled={busy === key} onClick={() => void decide(item, { decision: 'approved' })}>Approve</button><button className="dash-button secondary" type="button" disabled={busy === key} onClick={() => void decide(item, { decision: 'revision-requested' })}>Request revision</button><button className="dash-button danger" type="button" disabled={busy === key} onClick={() => void decide(item, { decision: 'rejected' })}>Reject</button></>}
      </div></article>;
    })}</div>}
  </section>;
}
