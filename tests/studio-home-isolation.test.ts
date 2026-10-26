import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertStudioProject, ensureStudioHome, studioRuntimeEnvironment } from '@/scripts/studio-home.cjs';
import { discoverInstalledCodexSkills } from '@/src/storage/codex-skill-catalog';
import { createEmptyProjectFolder, inspectProjectFolder, listProjectFolders } from '@/src/storage/project-folders';

let temporary: string;
beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'studio-isolation-'));
  vi.stubEnv('WORKFLOW_STUDIO_HOME', path.join(temporary, 'studio'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(temporary, { recursive: true, force: true });
});

describe('Workflow Studio home isolation', () => {
  it('does not accept the global profile or Codex folder as the app home', () => {
    for (const directory of [os.homedir(), path.join(os.homedir(), '.codex'), path.join(os.homedir(), '.agents')]) {
      vi.stubEnv('WORKFLOW_STUDIO_HOME', directory);
      expect(() => ensureStudioHome()).toThrow('dedicated Workflow Studio folder');
    }
  });

  it('uses only app skills despite an inherited global Codex home', async () => {
    const home = ensureStudioHome();
    const globalHome = path.join(temporary, 'global-codex');
    vi.stubEnv('CODEX_HOME', globalHome);
    for (const [directory, name] of [[path.join(globalHome, 'skills', 'global-only'), 'global-only'], [path.join(home.skills, 'app-only'), 'app-only']]) {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Test skill\n---\nDo the work.`);
    }
    const skills = await discoverInstalledCodexSkills();
    expect(skills.map((skill) => skill.id)).toEqual(['app-only']);
    const environment = studioRuntimeEnvironment();
    expect(environment.CODEX_HOME).toBe(home.codex);
    expect(environment.HOME).toBe(home.home);
    expect(environment.USERPROFILE).toBe(home.home);
    expect(process.env.CODEX_HOME).toBe(globalHome);
  });

  it('creates projects inside the app and stops browsing at the projects root', async () => {
    const home = ensureStudioHome();
    const project = await createEmptyProjectFolder(home.projects, 'Example');
    expect(project.rootPath).toBe(path.join(home.projects, 'Example'));
    expect((await listProjectFolders(home.projects)).parentPath).toBeNull();
    await expect(inspectProjectFolder(temporary)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(() => assertStudioProject(path.join(home.projects, '..', 'outside'))).toThrow();
    expect(() => assertStudioProject(`${home.projects}-other`)).toThrow();
  });

  it('rejects a project junction that escapes the app folder', async () => {
    const home = ensureStudioHome();
    const outside = path.join(temporary, 'outside');
    await mkdir(outside);
    const link = path.join(home.projects, 'escape');
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => assertStudioProject(link)).toThrow('outside');
    expect(() => assertStudioProject(path.join(link, 'new-folder'))).toThrow('outside');
  });
});
