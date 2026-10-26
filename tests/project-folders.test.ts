import { ensureStudioHome } from '@/scripts/studio-home.cjs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProjectFolder, inspectProjectFolder, listProjectFolders } from '@/src/storage/project-folders';

const temporaryDirectories: string[] = [];

async function temporaryRoot() {
  const directory = await mkdtemp(path.join(tmpdir(), 'workflow-studio-folders-'));
  temporaryDirectories.push(directory);
  vi.stubEnv('WORKFLOW_STUDIO_HOME', directory);
  return ensureStudioHome().projects;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('project folder inspection', () => {
  it('distinguishes empty folders, repositories, and general workspaces', async () => {
    const root = await temporaryRoot();
    const emptyFolder = path.join(root, 'empty');
    const repository = path.join(root, 'repository');
    const workspace = path.join(root, 'documents');
    await Promise.all([mkdir(emptyFolder), mkdir(path.join(repository, '.git'), { recursive: true }), mkdir(workspace)]);
    await writeFile(path.join(workspace, 'brief.md'), 'unchanged source content', 'utf8');

    expect((await inspectProjectFolder(emptyFolder)).workspaceKind).toBe('empty');
    expect((await inspectProjectFolder(repository)).workspaceKind).toBe('repository');
    expect((await inspectProjectFolder(workspace)).workspaceKind).toBe('workspace');
  });

  it('inspects metadata without reading or changing file contents', async () => {
    const root = await temporaryRoot();
    const sourceFile = path.join(root, 'customer-notes.txt');
    const original = 'private document body remains untouched';
    await writeFile(sourceFile, original, 'utf8');

    const inspection = await inspectProjectFolder(root);

    expect(inspection.inspectionMode).toBe('read-only');
    expect(inspection.fileCount).toBe(1);
    expect(await readFile(sourceFile, 'utf8')).toBe(original);
  });

  it('lists directories only for controlled browser navigation', async () => {
    const root = await temporaryRoot();
    await Promise.all([mkdir(path.join(root, 'Alpha')), mkdir(path.join(root, 'Beta')), writeFile(path.join(root, 'secret.txt'), 'not listed', 'utf8')]);

    const listing = await listProjectFolders(root);

    expect(listing.inspectionMode).toBe('read-only');
    expect(listing.directories.map((directory) => directory.name)).toEqual(['Alpha', 'Beta']);
    expect(JSON.stringify(listing)).not.toContain('secret.txt');
  });

  it('creates an explicitly named empty project folder and blocks traversal', async () => {
    const root = await temporaryRoot();
    const inspection = await createEmptyProjectFolder(root, 'New project');

    expect(inspection.workspaceKind).toBe('empty');
    expect(inspection.rootPath).toBe(path.join(root, 'New project'));
    await expect(createEmptyProjectFolder(root, '..')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(createEmptyProjectFolder(root, 'nested/folder')).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('rejects relative paths and files', async () => {
    const root = await temporaryRoot();
    const filePath = path.join(root, 'not-a-folder.txt');
    await writeFile(filePath, 'content', 'utf8');

    await expect(inspectProjectFolder('relative/path')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(inspectProjectFolder(filePath)).rejects.toMatchObject({ code: 'NOT_DIRECTORY' });
  });
});
