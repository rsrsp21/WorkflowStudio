import { NextResponse } from 'next/server';
import control from '../../control.cjs';
export const dynamic = 'force-dynamic';
export function GET(request) {
  if (!control.localRequest(request) || !control.sameSecret(new URL(request.url).searchParams.get('token'), process.env.WORKFLOW_STUDIO_COMPANION_TOKEN)) return new Response('Open this page using start.cjs as described in RUNNING-INSTRUCTIONS.txt.', { status: 403 });
  const response = NextResponse.redirect(`http://127.0.0.1:${process.env.PORT}/`);
  response.cookies.set(control.COOKIE, process.env.WORKFLOW_STUDIO_COMPANION_TOKEN, { httpOnly: true, sameSite: 'strict', path: '/' });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
