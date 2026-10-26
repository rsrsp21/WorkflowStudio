import { NextResponse } from 'next/server';
import { claimRuntimePairing } from '@/src/storage/runtime-connection-repository';
import { consumeRateLimit, rateLimitHeaders, rateLimitKey } from '@/src/server/rate-limit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    code?: unknown; name?: unknown; platform?: unknown; hostname?: unknown; allowedRoots?: unknown;
  };
  if (typeof body.code !== 'string' || !body.code.trim()) return NextResponse.json({ errors: ['Pairing code is required.'] }, { status: 400 });
  const limit = await consumeRateLimit(rateLimitKey(request, 'runtime-pair'), 20, 10 * 60);
  if (!limit.allowed) return NextResponse.json({ errors: ['Too many pairing attempts. Try again later.'] }, { status: 429, headers: rateLimitHeaders(limit) });
  const allowedRoots = Array.isArray(body.allowedRoots) ? body.allowedRoots.filter((root): root is string => typeof root === 'string') : [];
  if (!allowedRoots.length || allowedRoots.length > 20 || allowedRoots.some((root) => !root.trim() || root.length > 1024)) {
    return NextResponse.json({ errors: ['Pair with between 1 and 20 valid allowed project folders.'] }, { status: 400 });
  }
  const claimed = await claimRuntimePairing({
    code: body.code,
    ...(typeof body.name === 'string' ? { name: body.name } : {}),
    ...(typeof body.platform === 'string' ? { platform: body.platform } : {}),
    ...(typeof body.hostname === 'string' ? { hostname: body.hostname } : {}),
    allowedRoots
  });
  if (!claimed) return NextResponse.json({ errors: ['Pairing code is invalid, expired, or already used.'] }, { status: 401 });
  return NextResponse.json({ token: claimed.token, connection: claimed.connection });
}
