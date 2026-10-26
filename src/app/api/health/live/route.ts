import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ status: 'alive', service: 'workflow-studio' }, { headers: { 'cache-control': 'no-store' } });
}
