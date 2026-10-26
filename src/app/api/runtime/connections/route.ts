import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { createRuntimePairing, listRuntimeConnections, revokeRuntimeConnection } from '@/src/storage/runtime-connection-repository';
import { shouldUsePairedRuntime } from '@/src/adapters/paired-runtime-adapter';
import { consumeRateLimit, rateLimitHeaders, rateLimitKey } from '@/src/server/rate-limit';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ errors: ['Sign in to manage local runtimes.'] }, { status: 401 });
  return NextResponse.json({ connections: await listRuntimeConnections(user.id), mode: shouldUsePairedRuntime() ? 'paired' : 'local' });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ errors: ['Sign in to pair a local runtime.'] }, { status: 401 });
  const limit = await consumeRateLimit(rateLimitKey(request, 'pairing-create', user.id), 10, 10 * 60);
  if (!limit.allowed) return NextResponse.json({ errors: ['Too many pairing codes were created. Try again later.'] }, { status: 429, headers: rateLimitHeaders(limit) });
  const body = await request.json().catch(() => ({})) as { name?: unknown };
  const name = typeof body.name === 'string' ? body.name : 'Local Codex runtime';
  return NextResponse.json({ pairing: await createRuntimePairing(user.id, name) }, { status: 201, headers: rateLimitHeaders(limit) });
}

export async function DELETE(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ errors: ['Sign in to disconnect a local runtime.'] }, { status: 401 });
  const connectionId = new URL(request.url).searchParams.get('id');
  if (!connectionId) return NextResponse.json({ errors: ['Runtime connection id is required.'] }, { status: 400 });
  return await revokeRuntimeConnection(user.id, connectionId)
    ? NextResponse.json({ disconnected: true })
    : NextResponse.json({ errors: ['Runtime connection was not found.'] }, { status: 404 });
}
