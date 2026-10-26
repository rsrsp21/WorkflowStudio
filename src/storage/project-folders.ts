import { assertStudioProject, ensureStudioHome } from '@/scripts/studio-home.cjs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectFolderInspection, ProjectFolderListing } from '@/src/domain/workspace';

export class ProjectFolderError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_PATH' | 'NOT_FOUND' | 'NOT_DIRECTORY' | 'ALREADY_EXISTS' | 'ACCESS_DENIED'
  ) {
    super(message);
    this.name = 'ProjectFolderError';
  }
}

function resolveAbsoluteDirectoryPath(value: string): string {
  const candidate = value.trim();
  if (!candidate || !path.isAbsolute(candidate)) throw new ProjectFolderError('Project folder path must be absolute.', 'INVALID_PATH');
  try { return assertStudioProject(candidate); } catch (error) { throw new ProjectFolderError(error instanceof Error ? error.message : 'Project is outside Workflow Studio.', 'ACCESS_DENIED'); }
}

function mapFileSystemError(error: unknown, rootPath: string): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') throw new ProjectFolderError(`Project folder does not exist: ${rootPath}.`, 'NOT_FOUND');
  if (code === 'EACCES' || code === 'EPERM') throw new ProjectFolderError(`Project folder cannot be inspected with current permissions: ${rootPath}.`, 'ACCESS_DENIED');
  if (code === 'EEXIST') throw new ProjectFolderError(`Project folder already exists: ${rootPath}.`, 'ALREADY_EXISTS');
  throw error;
}

async function assertDirectory(rootPath: string): Promise<void> {
  try {
    const metadata = await stat(rootPath);
    if (!metadata.isDirectory()) throw new ProjectFolderError(`Selected path is not a directory: ${rootPath}.`, 'NOT_DIRECTORY');
  } catch (error) {
    if (error instanceof ProjectFolderError) throw error;
    mapFileSystemError(error, rootPath);
  }
}

export async function inspectProjectFolder(value: string): Promise<ProjectFolderInspection> {
  const rootPath = resolveAbsoluteDirectoryPath(value);
  await assertDirectory(rootPath);
  try {
    const entries = await readdir(/* turbopackIgnore: true */ rootPath, { withFileTypes: true });
    const directoryCount = entries.filter((entry) => entry.isDirectory()).length;
    const fileCount = entries.filter((entry) => entry.isFile()).length;
    const hasGitMetadata = entries.some((entry) => entry.name.toLowerCase() === '.git');
    return {
      rootPath,
      workspaceKind: entries.length === 0 ? 'empty' : hasGitMetadata ? 'repository' : 'workspace',
      entryCount: entries.length,
      directoryCount,
      fileCount,
      hasGitMetadata,
      inspectionMode: 'read-only',
      inspectedAt: new Date().toISOString()
    };
  } catch (error) {
    mapFileSystemError(error, rootPath);
  }
}

export async function listProjectFolders(value: string): Promise<ProjectFolderListing> {
  const rootPath = resolveAbsoluteDirectoryPath(value);
  await assertDirectory(rootPath);
  try {
    const entries = await readdir(/* turbopackIgnore: true */ rootPath, { withFileTypes: true });
    const parent = path.dirname(rootPath);
    return {
      rootPath,
      parentPath: rootPath === ensureStudioHome().projects ? null : parent,
      directories: entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({ name: entry.name, path: path.join(/* turbopackIgnore: true */ rootPath, entry.name) }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      inspectionMode: 'read-only'
    };
  } catch (error) {
    mapFileSystemError(error, rootPath);
  }
}

export async function createEmptyProjectFolder(parentValue: string, folderNameValue: string): Promise<ProjectFolderInspection> {
  const parentPath = resolveAbsoluteDirectoryPath(parentValue);
  await assertDirectory(parentPath);
  const folderName = folderNameValue.trim();
  if (!folderName || folderName === '.' || folderName === '..' || /[\\/:*?"<>|]/.test(folderName)) {
    throw new ProjectFolderError('New folder name must be a single valid directory name.', 'INVALID_PATH');
  }
  const rootPath = path.join(/* turbopackIgnore: true */ parentPath, folderName);
  if (path.dirname(rootPath) !== parentPath) throw new ProjectFolderError('New project folder must be created directly inside the current directory.', 'INVALID_PATH');
  try {
    await mkdir(rootPath, { recursive: false });
  } catch (error) {
    mapFileSystemError(error, rootPath);
  }
  return inspectProjectFolder(rootPath);
}

export function projectFolderErrorStatus(error: unknown): number {
  if (!(error instanceof ProjectFolderError)) return 500;
  if (error.code === 'NOT_FOUND') return 404;
  if (error.code === 'ALREADY_EXISTS') return 409;
  if (error.code === 'ACCESS_DENIED') return 403;
  return 400;
}
