import { NextResponse } from 'next/server';
import { runtimeFromRequest } from '@/src/server/runtime-auth';
import { heartbeatRuntime } from '@/src/storage/runtime-connection-repository';
import { COMPANION_PROTOCOL_VERSION } from '@/src/domain/runtime-connection';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const authenticated = await runtimeFromRequest(request);
  if (!authenticated) return NextResponse.json({ errors: ['Runtime authentication failed.'] }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { authMode?: unknown; codexAccountLabel?: unknown; protocolVersion?: unknown; companionVersion?: unknown; supportedModels?: unknown; supportedReasoningEfforts?: unknown };
  if (body.protocolVersion !== COMPANION_PROTOCOL_VERSION) return NextResponse.json({ errors: [`Companion update required. Server protocol is ${COMPANION_PROTOCOL_VERSION}.`] }, { status: 426 });
  const connection = await heartbeatRuntime(authenticated.connection.id, {
    ...(typeof body.authMode === 'string' ? { authMode: body.authMode } : {}),
    ...(typeof body.codexAccountLabel === 'string' ? { codexAccountLabel: body.codexAccountLabel } : {}),
    protocolVersion: body.protocolVersion,
    ...(typeof body.companionVersion === 'string' ? { companionVersion: body.companionVersion } : {}),
    ...(Array.isArray(body.supportedModels) ? { supportedModels: body.supportedModels.filter((value): value is string => typeof value === 'string').slice(0, 100) } : {}),
    ...(Array.isArray(body.supportedReasoningEfforts) ? { supportedReasoningEfforts: body.supportedReasoningEfforts.filter((value): value is string => typeof value === 'string').slice(0, 20) } : {})
  });
  return connection ? NextResponse.json({ connection }) : NextResponse.json({ errors: ['Runtime connection was revoked.'] }, { status: 401 });
}
