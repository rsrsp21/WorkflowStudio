'use client';

import { useEffect, useState } from 'react';
import type { AuthUser, UserRole } from '@/src/auth/auth';
import UiIcon from './ui-icon';

type ReviewerAssignment = { ownerUserId: string; reviewerUserId: string; assignedBy: string; createdAt: string };

const PAGE_SIZE = 25;

export default function AdminUserManagement() {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState('');
  const [reviewers, setReviewers] = useState<AuthUser[]>([]);
  const [assignments, setAssignments] = useState<ReviewerAssignment[]>([]);
  useEffect(() => {
    let active = true;
    void Promise.all([fetch(`/api/admin/users?limit=${PAGE_SIZE}&offset=${offset}`, { cache: 'no-store' }), fetch('/api/admin/reviewer-assignments', { cache: 'no-store' })]).then(async ([userResponse, assignmentResponse]) => {
      const result = await userResponse.json() as { users?: AuthUser[]; total?: number; error?: string };
      const delegation = await assignmentResponse.json() as { assignments?: ReviewerAssignment[]; reviewers?: AuthUser[]; error?: string };
      if (!userResponse.ok || !result.users) throw new Error(result.error || 'Users could not be loaded.');
      if (!assignmentResponse.ok) throw new Error(delegation.error || 'Reviewer assignments could not be loaded.');
      if (active) { setUsers(result.users); setTotal(result.total ?? result.users.length); setAssignments(delegation.assignments ?? []); setReviewers(delegation.reviewers ?? []); }
    }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : 'Users could not be loaded.'); });
    return () => { active = false; };
  }, [offset]);

  async function changeRole(user: AuthUser, role: UserRole) {
    setMessage('');
    const response = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: user.id, role }) });
    const result = await response.json() as { user?: AuthUser; errors?: string[]; error?: string };
    if (!response.ok || !result.user) { setMessage(result.errors?.join(' ') || result.error || 'Role could not be changed.'); return; }
    setUsers((current) => current.map((item) => item.id === result.user?.id ? result.user : item));
    setMessage(`${result.user.name} is now ${result.user.role}.`);
  }

  async function changeReviewer(owner: AuthUser, reviewerUserId: string) {
    setMessage('');
    const current = assignments.find((assignment) => assignment.ownerUserId === owner.id);
    if (current?.reviewerUserId === reviewerUserId) return;
    if (current) {
      const removed = await fetch('/api/admin/reviewer-assignments', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ownerUserId: owner.id, reviewerUserId: current.reviewerUserId }) });
      if (!removed.ok) { setMessage('The previous reviewer assignment could not be removed.'); return; }
    }
    if (!reviewerUserId) { setAssignments((items) => items.filter((item) => item.ownerUserId !== owner.id)); setMessage(`Reviewer removed from ${owner.name}.`); return; }
    const response = await fetch('/api/admin/reviewer-assignments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ownerUserId: owner.id, reviewerUserId }) });
    const result = await response.json() as { assignment?: ReviewerAssignment; error?: string; errors?: string[] };
    if (!response.ok || !result.assignment) { setMessage(result.errors?.join(' ') || result.error || 'Reviewer could not be assigned.'); return; }
    setAssignments((items) => [...items.filter((item) => item.ownerUserId !== owner.id), result.assignment!]);
    setMessage(`${reviewers.find((reviewer) => reviewer.id === reviewerUserId)?.name ?? 'Reviewer'} can now review ${owner.name}.`);
  }

  return <section className="profile-settings-section admin-users-section">
    <div className="profile-section-heading"><UiIcon name="user" /><div><h3>User access</h3><p>Assign governed product roles. Users cannot change their own role.</p></div></div>
    <div className="admin-user-list">{users.map((user) => <div key={user.id} className="admin-user-row"><label><span><strong>{user.name}</strong><small>{user.email}</small></span><select aria-label={`Role for ${user.name}`} value={user.role} onChange={(event) => void changeRole(user, event.target.value as UserRole)}><option value="builder">Builder</option><option value="reviewer">Reviewer</option><option value="administrator">Administrator</option></select></label><label><span><small>Delegated reviewer</small></span><select aria-label={`Reviewer for ${user.name}`} value={assignments.find((assignment) => assignment.ownerUserId === user.id)?.reviewerUserId ?? ''} onChange={(event) => void changeReviewer(user, event.target.value)}><option value="">No delegated reviewer</option>{reviewers.filter((reviewer) => reviewer.id !== user.id).map((reviewer) => <option value={reviewer.id} key={reviewer.id}>{reviewer.name}</option>)}</select></label></div>)}</div>
    <div className="profile-form-actions"><span className="profile-form-message" role="status">{message || `${total} accounts`}</span><span><button className="dash-button secondary" type="button" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}>Previous</button><button className="dash-button secondary" type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset((value) => value + PAGE_SIZE)}>Next</button></span></div>
  </section>;
}
