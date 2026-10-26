import { ensureStudioHome } from '@/scripts/studio-home.cjs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { inspectProjectFolder, projectFolderErrorStatus } from '@/src/storage/project-folders';
import { getRequestUser } from '@/src/auth/auth';
import { dispatchPairedRuntimeJob, shouldUsePairedRuntime } from '@/src/adapters/paired-runtime-adapter';
import { getOnlineRuntimeConnection } from '@/src/storage/runtime-connection-repository';
import type { ProjectFolderInspection } from '@/src/domain/workspace';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  try {
    if (shouldUsePairedRuntime()) {
      const connection = await getOnlineRuntimeConnection(user.id);
      const rootPath = connection?.allowedRoots[0];
      if (!rootPath) return NextResponse.json({ error: 'Connect your local runtime and allow a projects folder first.' }, { status: 409 });
      const result = await dispatchPairedRuntimeJob<{ inspection: ProjectFolderInspection }>(user.id, 'workspace-inspection', { operation: 'inspect', rootPath });
      return NextResponse.json({ projectName: result.inspection.rootPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'Projects', inspection: result.inspection });
    }
    const rootPath = ensureStudioHome().projects;
    return NextResponse.json({ projectName: path.basename(rootPath), inspection: await inspectProjectFolder(rootPath) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Default project folder inspection failed.' }, { status: projectFolderErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  try {
    const body = (await request.json()) as { rootPath?: unknown };
    if (typeof body.rootPath !== 'string') return NextResponse.json({ error: 'Project folder path is required.' }, { status: 400 });
    if (shouldUsePairedRuntime()) return NextResponse.json(await dispatchPairedRuntimeJob<{ inspection: ProjectFolderInspection }>(user.id, 'workspace-inspection', { operation: 'inspect', rootPath: body.rootPath }));
    return NextResponse.json({ inspection: await inspectProjectFolder(body.rootPath) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Project folder inspection failed.' }, { status: projectFolderErrorStatus(error) });
  }
}
