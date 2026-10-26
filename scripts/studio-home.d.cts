export interface StudioPaths { home: string; projects: string; data: string; codex: string; skills: string; agents: string; temporary: string; connection: string }
export function studioPaths(): StudioPaths;
export function ensureStudioHome(): StudioPaths;
export function assertStudioProject(value: string): string;
export function studioRuntimeEnvironment(): NodeJS.ProcessEnv;
export function studioCodexArguments(): string[];
export function studioCodexInvocation(packageRoot: string, args: string[]): { executable: string; args: string[] };
