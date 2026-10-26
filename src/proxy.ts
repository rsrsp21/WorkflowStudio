import { NextRequest, NextResponse } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function proxy(request: NextRequest) {
  const suppliedId = request.headers.get('x-request-id');
  const requestId = suppliedId && /^[A-Za-z0-9._:-]{8,128}$/.test(suppliedId) ? suppliedId : crypto.randomUUID();
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set('x-request-id', requestId);
  const next = () => {
    const response = NextResponse.next({ request: { headers: forwardedHeaders } });
    response.headers.set('x-request-id', requestId);
    return response;
  };
  if (SAFE_METHODS.has(request.method)) return next();
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return NextResponse.json({ error: 'Cross-site mutation requests are rejected.' }, { status: 403, headers: { 'x-request-id': requestId } });
  }
  const origin = request.headers.get('origin');
  if (origin) {
    const configuredOrigin = process.env.WORKFLOW_STUDIO_PUBLIC_ORIGIN?.replace(/\/$/, '');
    const allowed = new Set([request.nextUrl.origin, ...(configuredOrigin ? [configuredOrigin] : [])]);
    if (!allowed.has(origin.replace(/\/$/, ''))) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403, headers: { 'x-request-id': requestId } });
  }
  return next();
}

export const config = { matcher: '/api/:path*' };
