import { NextResponse } from 'next/server';
import { countUsers, getRequestUser, listUsers, setUserRole } from '@/src/auth/auth';
import { validateManagedRole } from '@/src/domain/authorization';
import { appendAuditEvent } from '@/src/storage/audit-repository';

async function administrator(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return { response: NextResponse.json({ error: 'Authentication required.' }, { status: 401 }) };
  if (user.role !== 'administrator') return { response: NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 }) };
  return { user };
}

export async function GET(request: Request) {
  const auth = await administrator(request);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? '50');
  const offset = Number(url.searchParams.get('offset') ?? '0');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) return NextResponse.json({ errors: ['User pagination is invalid.'] }, { status: 400 });
  return NextResponse.json({ users: await listUsers(limit, offset), total: await countUsers(), limit, offset }, { headers: { 'cache-control': 'no-store' } });
}

export async function PATCH(request: Request) {
  const auth = await administrator(request);
  if (auth.response || !auth.user) return auth.response;
  const body = await request.json().catch(() => ({})) as { userId?: unknown; role?: unknown };
  if (typeof body.userId !== 'string' || !validateManagedRole(body.role)) return NextResponse.json({ errors: ['A valid user and managed role are required.'] }, { status: 400 });
  if (body.userId === auth.user.id && body.role !== 'administrator') return NextResponse.json({ errors: ['Administrators cannot remove their own administrator role.'] }, { status: 409 });
  const updated = await setUserRole(body.userId, body.role);
  if (!updated) return NextResponse.json({ error: 'User was not found.' }, { status: 404 });
  await appendAuditEvent({ userId: updated.id, actor: { id: auth.user.id, name: auth.user.name, role: auth.user.role }, action: 'account.role-change', resourceType: 'user', resourceId: updated.id, decision: 'approved', correlationId: `role:${updated.id}`, details: { role: updated.role } });
  return NextResponse.json({ user: updated });
}
