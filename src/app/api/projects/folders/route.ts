import { NextRequest, NextResponse } from 'next/server';
import { createEmptyProjectFolder, listProjectFolders, projectFolderErrorStatus } from '@/src/storage/project-folders';
import { getRequestUser } from '@/src/auth/auth';
import { dispatchPairedRuntimeJob, shouldUsePairedRuntime } from '@/src/adapters/paired-runtime-adapter';
import type { ProjectFolderInspection, ProjectFolderListing } from '@/src/domain/workspace';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  try {
    const rootPath = request.nextUrl.searchParams.get('path');
    if (shouldUsePairedRuntime()) return NextResponse.json(await dispatchPairedRuntimeJob<{ listing: ProjectFolderListing }>(user.id, 'workspace-inspection', { operation: 'list', ...(rootPath ? { rootPath } : {}) }));
    if (!rootPath) return NextResponse.json({ error: 'An absolute folder path is required.' }, { status: 400 });
    return NextResponse.json({ listing: await listProjectFolders(rootPath) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Folder listing failed.' }, { status: projectFolderErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  try {
    const body = (await request.json()) as { parentPath?: unknown; folderName?: unknown };
    if (typeof body.parentPath !== 'string' || typeof body.folderName !== 'string') {
      return NextResponse.json({ error: 'Parent path and folder name are required.' }, { status: 400 });
    }
    if (shouldUsePairedRuntime()) {
      const result = await dispatchPairedRuntimeJob<{ inspection: ProjectFolderInspection }>(user.id, 'workspace-inspection', { operation: 'create', parentPath: body.parentPath, folderName: body.folderName });
      return NextResponse.json(result, { status: 201 });
    }
    return NextResponse.json({ inspection: await createEmptyProjectFolder(body.parentPath, body.folderName) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Folder creation failed.' }, { status: projectFolderErrorStatus(error) });
  }
}
