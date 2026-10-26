import { NextResponse } from 'next/server';
import { authenticateUserAsync, createSession, SESSION_COOKIE, sessionCookieOptions } from '@/src/auth/auth';
import { consumeRateLimit, rateLimitHeaders, rateLimitKey } from '@/src/server/rate-limit';
import { migrateLegacyWorkspaceForSoleUser } from '@/src/storage/workspace-stores';
import { studioPaths } from '@/scripts/studio-home.cjs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { email?: unknown; password?: unknown };
  if (typeof body.email !== 'string' || typeof body.password !== 'string') return NextResponse.json({ errors: ['Email and password are required.'] }, { status: 400 });
  const limit = await consumeRateLimit(rateLimitKey(request, 'login', body.email), 10, 15 * 60);
  if (!limit.allowed) return NextResponse.json({ errors: ['Too many sign-in attempts. Try again later.'] }, { status: 429, headers: rateLimitHeaders(limit) });
  const user = await authenticateUserAsync(body.email, body.password);
  if (!user) return NextResponse.json({ errors: ['Email or password is incorrect.'] }, { status: 401 });
  await migrateLegacyWorkspaceForSoleUser(process.env.WORKFLOW_STUDIO_DATA_DIR ?? studioPaths().data, user.id);
  const session = await createSession(user.id);
  const response = NextResponse.json({ user });
  response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  for (const [name, value] of Object.entries(rateLimitHeaders(limit))) response.headers.set(name, value);
  return response;
}
