import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { ensureStudioHome, studioRuntimeEnvironment } from '@/scripts/studio-home.cjs';
import { resolveCodexInvocation } from '@/src/adapters/codex-runtime';

it('the pinned native runtime enables only skills inside the private app home', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'studio-native-isolation-'));
  vi.stubEnv('WORKFLOW_STUDIO_HOME', temporary);
  const home = ensureStudioHome();
  const skill = path.join(home.codex, 'skills', 'studio-private-test');
  await mkdir(skill, { recursive: true });
  await writeFile(path.join(skill, 'SKILL.md'), '---\nname: studio-private-test\ndescription: A private test skill.\n---\nPrivate instructions.');
  const invocation = resolveCodexInvocation(['app-server', '--listen', 'stdio://']);
  const child = spawn(invocation.executable, invocation.args, { cwd: home.projects, env: studioRuntimeEnvironment(), windowsHide: true });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  type NativeSkill = { name: string; path: string; enabled: boolean };
  try {
    const skills = await new Promise<NativeSkill[]>((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('Native skill inspection timed out.')), 15_000);
      const finish = (error?: Error, result?: NativeSkill[]) => { clearTimeout(timer); if (error) reject(error); else resolve(result ?? []); };
      child.once('error', (error) => finish(error));
      child.once('close', () => finish(new Error('Native runtime closed before inspection.')));
      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        for (const line of lines.filter(Boolean)) {
          const message = JSON.parse(line);
          if (message.error) { finish(new Error(message.error.message)); continue; }
          if (message.id === 1) {
            child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
            child.stdin.write(`${JSON.stringify({ id: 2, method: 'skills/list', params: { cwds: [home.projects], forceReload: true } })}\n`);
          }
          if (message.id === 2) finish(undefined, message.result.data.flatMap((entry: { skills: NativeSkill[] }) => entry.skills));
        }
      });
      child.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'studio_isolation_test', version: '1.0.0' }, capabilities: { experimentalApi: true } } })}\n`);
    });
    const enabled = skills.filter((skill) => skill.enabled);
    expect(enabled.some((skill) => skill.name === 'studio-private-test')).toBe(true);
    for (const skill of enabled) {
      const relative = path.relative(realpathSync.native(home.home), realpathSync.native(skill.path));
      expect(relative.startsWith('..') || path.isAbsolute(relative), skill.path).toBe(false);
    }
  } finally {
    child.kill();
    await closed;
    vi.unstubAllEnvs();
    await rm(temporary, { recursive: true, force: true });
  }
});
