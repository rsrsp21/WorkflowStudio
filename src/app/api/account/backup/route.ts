import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { createUserBackup, restoreUserBackup } from '@/src/storage/user-backup';
import { RunRepository } from '@/src/storage/run-repository';
import { appendAuditEvent } from '@/src/storage/audit-repository';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const backup = await createUserBackup(user.id);
  await appendAuditEvent({ userId: user.id, actor: { id: user.id, name: user.name, role: user.role }, action: 'account.backup', resourceType: 'account', resourceId: user.id, decision: 'exported', correlationId: `backup:${user.id}` });
  return new Response(JSON.stringify(backup, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="workflow-studio-backup-${new Date().toISOString().slice(0, 10)}.json"`, 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  try { const restored = await restoreUserBackup(user.id, body); await appendAuditEvent({ userId: user.id, actor: { id: user.id, name: user.name, role: user.role }, action: 'account.restore', resourceType: 'account', resourceId: user.id, decision: 'restored', correlationId: `restore:${user.id}`, details: restored }); return NextResponse.json({ restored }); }
  catch (error) { return NextResponse.json({ errors: [error instanceof Error ? error.message : 'Backup could not be restored.'] }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const days = Number(new URL(request.url).searchParams.get('olderThanDays') ?? '90');
  if (!Number.isInteger(days) || days < 30 || days > 3650) return NextResponse.json({ errors: ['Retention period must be between 30 and 3,650 days.'] }, { status: 400 });
  const removedRunIds = await new RunRepository().pruneTerminalHistory(user.id, new Date(Date.now() - days * 24 * 60 * 60 * 1000));
  await appendAuditEvent({ userId: user.id, actor: { id: user.id, name: user.name, role: user.role }, action: 'history.retention', resourceType: 'account', resourceId: user.id, decision: 'deleted', correlationId: `retention:${user.id}`, details: { days, removedRunIds } });
  return NextResponse.json({ removedRunIds, retentionDays: days });
}
