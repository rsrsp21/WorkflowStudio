import { studioCodexInvocation } from '@/scripts/studio-home.cjs';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface CodexInvocation {
  executable: string;
  args: string[];
}

/**
 * Prefer the project-pinned Codex runtime so shared builds do not depend on a
 * global npm install or its configuration.
 */
export function resolveCodexInvocation(cliArgs: string[]): CodexInvocation {
  const localEntrypoints = [
    path.join(process.cwd(), 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
    path.join(process.cwd(), '.next', 'standalone', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  ];
  const localEntrypoint = localEntrypoints.find((candidate) => existsSync(candidate));
  if (localEntrypoint) return studioCodexInvocation(path.resolve(path.dirname(localEntrypoint), '../../../..'), cliArgs);

  throw new Error('The project-pinned Codex runtime is missing. Run npm install in Workflow Studio.');
}
