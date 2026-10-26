import { NextResponse } from 'next/server';
import { releaseManifest } from '@/src/domain/release-manifest';

export function GET() {
  return NextResponse.json(releaseManifest(), { headers: { 'cache-control': 'no-store' } });
}
