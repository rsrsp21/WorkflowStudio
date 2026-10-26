import { NextResponse } from 'next/server';
import { databaseHealth } from '@/src/storage/async-database';
import { releaseManifest } from '@/src/domain/release-manifest';

export async function GET() {
  try {
    const health = await databaseHealth();
    return NextResponse.json({ status: 'ready', service: 'workflow-studio', schemaVersion: 2, release: releaseManifest(), database: { provider: health.provider, migrationCount: health.migrations.length, quarantinedRecords: health.quarantinedRecords } }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ status: 'unavailable', service: 'workflow-studio', schemaVersion: 2 }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
