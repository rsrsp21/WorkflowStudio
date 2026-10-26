import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const runtimeUrl = pathToFileURL(path.resolve('scripts/workflow-studio-runtime.mjs')).href;

describe('companion Codex approval-policy compatibility', () => {
  it('uses the supported interactive policy without widening the read-only sandbox', async () => {
    const { codexRuntimePolicy } = await import(runtimeUrl);
    expect(codexRuntimePolicy({ requireRuntimeApprovals: true, permission: 'read-only' })).toEqual({ approvalPolicy: 'on-request', sandbox: 'read-only' });
    expect(codexRuntimePolicy({ requireRuntimeApprovals: true, permission: 'workspace' })).toEqual({ approvalPolicy: 'on-request', sandbox: 'workspace-write' });
  });

  it('does not enable approval escalation for noninteractive planning', async () => {
    const { codexRuntimePolicy } = await import(runtimeUrl);
    expect(codexRuntimePolicy({ requireRuntimeApprovals: false, permission: 'read-only' })).toEqual({ approvalPolicy: 'never', sandbox: 'read-only' });
  });

  it('passes the same policy to thread and turn requests and keeps the approval handler', async () => {
    const source = await readFile('scripts/workflow-studio-runtime.mjs', 'utf8');
    expect(source).not.toContain('unlessTrusted');
    expect(source).toContain('const { approvalPolicy, sandbox } = codexRuntimePolicy(task)');
    expect(source).toMatch(/request\('thread\/start', \{\s*cwd, approvalPolicy, sandbox/);
    expect(source).toMatch(/request\('turn\/start', \{\s*threadId,[\s\S]*?approvalPolicy, outputSchema/);
    expect(source).toContain('}, requestApproval);');
  });
});
