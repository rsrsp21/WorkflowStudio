import { NextResponse } from 'next/server';
import { createSession, createUser, initialSignupRole, SESSION_COOKIE, sessionCookieOptions, validateSignup } from '@/src/auth/auth';
import { importLegacyWorkflowsForFirstUser } from '@/src/storage/workflow-repository';
import { consumeRateLimit, rateLimitHeaders, rateLimitKey } from '@/src/server/rate-limit';
import { migrateLegacyWorkspaceForSoleUser } from '@/src/storage/workspace-stores';
import { studioPaths } from '@/scripts/studio-home.cjs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { name?: unknown; email?: unknown; password?: unknown; role?: unknown; position?: unknown };
  const errors = validateSignup(body);
  if (errors.length) return NextResponse.json({ errors }, { status: 400 });
  const limit = await consumeRateLimit(rateLimitKey(request, 'signup', String(body.email ?? '')), 5, 60 * 60);
  if (!limit.allowed) return NextResponse.json({ errors: ['Too many account creation attempts. Try again later.'] }, { status: 429, headers: rateLimitHeaders(limit) });
  const user = await createUser({ name: body.name as string, email: body.email as string, password: body.password as string, role: initialSignupRole(body.email as string), position: body.position as string });
  if (!user) return NextResponse.json({ errors: ['An account already exists for this email address.'] }, { status: 409 });
  const importedWorkflows = await importLegacyWorkflowsForFirstUser();
  await migrateLegacyWorkspaceForSoleUser(process.env.WORKFLOW_STUDIO_DATA_DIR ?? studioPaths().data, user.id);
  const session = await createSession(user.id);
  const response = NextResponse.json({ user, importedWorkflows }, { status: 201 });
  response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  for (const [name, value] of Object.entries(rateLimitHeaders(limit))) response.headers.set(name, value);
  return response;
}
