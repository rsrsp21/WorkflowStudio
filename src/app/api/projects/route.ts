import { studioPaths } from '@/scripts/studio-home.cjs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { createProject, validateProject, type Project } from '@/src/domain/workspace';
import { inspectProjectFolder, projectFolderErrorStatus } from '@/src/storage/project-folders';
import { createWorkspaceStores } from '@/src/storage/workspace-stores';
import { getRequestUser } from '@/src/auth/auth';
import { dispatchPairedRuntimeJob, shouldUsePairedRuntime } from '@/src/adapters/paired-runtime-adapter';
import type { ProjectFolderInspection } from '@/src/domain/workspace';
import { claimLegacyProjectsForSoleUser, claimProjectOwnership, ownedProjectIds } from '@/src/storage/project-ownership-repository';

export const dynamic = 'force-dynamic';

const dataDirectory = process.env.WORKFLOW_STUDIO_DATA_DIR ?? studioPaths().data;

function sameRoot(left: string, right: string): boolean {
  if (/^(?:[A-Za-z]:[\\/]|\\\\)/.test(left) || /^(?:[A-Za-z]:[\\/]|\\\\)/.test(right)) {
    return left.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() === right.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  }
  const normalize = (value: string) => {
    const normalized = path.resolve(value);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  return normalize(left) === normalize(right);
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ errors: ['Authentication required.'] }, { status: 401 });
  const store = createWorkspaceStores(dataDirectory, user.id).projects;
  const projects = await store.readAll();
  claimLegacyProjectsForSoleUser(user.id, projects.map((project) => project.id));
  const ownedIds = await ownedProjectIds(user.id);
  return NextResponse.json({ projects: projects.filter((project) => ownedIds.has(project.id)) });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ errors: ['Authentication required.'] }, { status: 401 });
  const store = createWorkspaceStores(dataDirectory, user.id).projects;
  try {
    const body = (await request.json()) as { name?: unknown; rootPath?: unknown };
    if (typeof body.name !== 'string' || !body.name.trim() || typeof body.rootPath !== 'string') {
      return NextResponse.json({ errors: ['Project name and root path are required.'] }, { status: 400 });
    }
    const inspection = shouldUsePairedRuntime()
      ? (await dispatchPairedRuntimeJob<{ inspection: ProjectFolderInspection }>(user.id, 'workspace-inspection', { operation: 'inspect', rootPath: body.rootPath })).inspection
      : await inspectProjectFolder(body.rootPath);
    const projects = await store.readAll();
    claimLegacyProjectsForSoleUser(user.id, projects.map((project) => project.id));
    const ownedIds = await ownedProjectIds(user.id);
    const existing = projects.find((project) => ownedIds.has(project.id) && sameRoot(project.rootPath, inspection.rootPath));
    if (existing) return NextResponse.json({ project: existing, inspection, created: false });
    const project: Project = createProject({ name: body.name, rootPath: inspection.rootPath, workspaceKind: inspection.workspaceKind });
    const errors = validateProject(project);
    if (errors.length) return NextResponse.json({ errors }, { status: 400 });
    await store.upsert(project);
    if (!await claimProjectOwnership(user.id, project.id)) {
      await store.remove(project.id);
      return NextResponse.json({ errors: ['Project ownership could not be recorded.'] }, { status: 409 });
    }
    return NextResponse.json({ project, inspection, created: true }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Project confirmation failed.' }, { status: projectFolderErrorStatus(error) });
  }
}
