import { ensureStudioHome } from '@/scripts/studio-home.cjs';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

import { CodexCliAdapter } from '@/src/adapters/codex-cli-adapter';
import { DEFAULT_PLANNING_EXECUTION_SETTINGS } from '@/src/domain/planning';

describe('Codex provider timeout', () => {
  afterEach(() => { delete process.env.CODEX_TIMEOUT_MS; spawnMock.mockReset(); });

  it('kills the CLI process and returns a typed timeout error', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(),
      stdin: { end: vi.fn() }, kill: vi.fn()
    });
    spawnMock.mockReturnValue(child);
    process.env.CODEX_TIMEOUT_MS = '5';
    const result = await new CodexCliAdapter(spawnMock as never).createPlanningThread({
      workflowName: 'Timeout test', planningPrompt: 'Return a plan.', workspacePath: ensureStudioHome().projects,
      constraints: [], outputRequirements: [], executionSettings: DEFAULT_PLANNING_EXECUTION_SETTINGS
    });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
  });
});
