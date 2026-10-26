import { NextResponse } from 'next/server';
import { changeUserPassword, getRequestUser, updateUserProfile, validateProfile } from '@/src/auth/auth';

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  return user ? NextResponse.json({ user }) : NextResponse.json({ user: null }, { status: 401 });
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ errors: ['Sign in to update your profile.'] }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { action?: unknown; name?: unknown; role?: unknown; position?: unknown; currentPassword?: unknown; newPassword?: unknown };
  if (body.action === 'profile') {
    const errors = validateProfile(body);
    if (errors.length) return NextResponse.json({ errors }, { status: 400 });
    const updated = await updateUserProfile(user.id, { name: body.name as string, position: body.position as string });
    return updated ? NextResponse.json({ user: updated }) : NextResponse.json({ errors: ['Account was not found.'] }, { status: 404 });
  }
  if (body.action === 'password') {
    if (typeof body.currentPassword !== 'string' || !body.currentPassword) return NextResponse.json({ errors: ['Enter your current password.'] }, { status: 400 });
    if (typeof body.newPassword !== 'string' || body.newPassword.length < 8) return NextResponse.json({ errors: ['New password must contain at least 8 characters.'] }, { status: 400 });
    const result = await changeUserPassword(user.id, body.currentPassword, body.newPassword);
    if (result === 'invalid-current') return NextResponse.json({ errors: ['Current password is incorrect.'] }, { status: 400 });
    if (result === 'unchanged') return NextResponse.json({ errors: ['New password must be different from the current password.'] }, { status: 400 });
    if (result === 'not-found') return NextResponse.json({ errors: ['Account was not found.'] }, { status: 404 });
    return NextResponse.json({ updated: true });
  }
  return NextResponse.json({ errors: ['Choose a valid profile action.'] }, { status: 400 });
}
