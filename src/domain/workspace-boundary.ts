import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import type { HarnessPolicy } from './models';

export type RuntimeSandbox = 'read-only' | 'workspace-write';

export interface RuntimeWorkspaceBoundary {
  rootPath: string;
  sandbox: RuntimeSandbox;
  writeAllowed: boolean;
}

function pathApi(value: string): typeof path.win32 | typeof path.posix {
  return /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) ? path.win32 : path.posix;
}

function comparable(value: string): string {
  const api = pathApi(value);
  const normalized = api.normalize(value);
  return api === path.win32 ? normalized.toLowerCase() : normalized;
}

export function canonicalWorkspacePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('\0')) throw new Error('Runtime workspace path is invalid.');
  const api = pathApi(trimmed);
  if (!api.isAbsolute(trimmed)) throw new Error(`Runtime workspace path must be absolute: ${value}.`);
  return api.normalize(trimmed);
}

export function isWithinWorkspaceRoot(candidate: string, root: string): boolean {
  let child: string;
  let parent: string;
  try {
    child = comparable(canonicalWorkspacePath(candidate));
    parent = comparable(canonicalWorkspacePath(root));
  } catch {
    return false;
  }
  const api = pathApi(parent);
  const relative = api.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !api.isAbsolute(relative));
}

export function runtimeSandbox(harness: Pick<HarnessPolicy, 'sandboxMode'>): RuntimeSandbox {
  return harness.sandboxMode === 'workspace' ? 'workspace-write' : 'read-only';
}

export function assertRuntimeWorkspaceBoundary(rootPath: string, harness: HarnessPolicy): RuntimeWorkspaceBoundary {
  const root = canonicalWorkspacePath(rootPath);
  if (harness.allowedWorkspacePaths.length !== 1 || comparable(canonicalWorkspacePath(harness.allowedWorkspacePaths[0])) !== comparable(root)) {
    throw new Error('Runtime workspace access must be restricted to the approved project root.');
  }
  const sandbox = runtimeSandbox(harness);
  return { rootPath: root, sandbox, writeAllowed: sandbox === 'workspace-write' };
}

export function resolveArtifactPath(artifactPath: string, rootPath: string): string {
  const root = canonicalWorkspacePath(rootPath);
  const trimmed = artifactPath.trim();
  if (!trimmed || trimmed.includes('\0')) throw new Error('Focused node artifact path is invalid.');
  const api = pathApi(root);
  const resolved = api.isAbsolute(trimmed) ? api.normalize(trimmed) : api.resolve(root, trimmed);
  if (!isWithinWorkspaceRoot(resolved, root)) throw new Error(`Focused node artifact is outside the approved project root: ${artifactPath}.`);
  assertNoSymlinkEscape(resolved, root);
  return resolved;
}

export function assertNoSymlinkEscape(candidatePath: string, rootPath: string): void {
  const root = canonicalWorkspacePath(rootPath);
  const candidate = canonicalWorkspacePath(candidatePath);
  if (!existsSync(root)) return;
  const realRoot = realpathSync.native(root);
  const api = pathApi(candidate);
  let existingAncestor = candidate;
  while (!existsSync(existingAncestor)) {
    const parent = api.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }
  if (!existsSync(existingAncestor)) throw new Error('Focused node artifact path has no accessible ancestor.');
  const realAncestor = realpathSync.native(existingAncestor);
  if (!isWithinWorkspaceRoot(realAncestor, realRoot)) throw new Error(`Focused node artifact resolves outside the approved project root: ${candidatePath}.`);
}
