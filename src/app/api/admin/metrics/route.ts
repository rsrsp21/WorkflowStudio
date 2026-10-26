import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { operationsSnapshot } from '@/src/storage/operations-metrics';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (user.role !== 'administrator') return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  return NextResponse.json({ metrics: await operationsSnapshot() }, { headers: { 'cache-control': 'no-store' } });
}
