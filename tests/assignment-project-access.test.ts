import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyProjectRoot } from '@/src/components/assignment-modal';

afterEach(() => vi.unstubAllGlobals());

describe('assignment project access checks', () => {
  it('checks the saved root through the current runtime without creating an assignment', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ inspection: { rootPath: 'C:\\WorkflowStudio\\projects\\demo' } }));
    vi.stubGlobal('fetch', fetcher);
    await verifyProjectRoot('C:\\WorkflowStudio\\projects\\demo');
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/projects/inspect', expect.objectContaining({ method: 'POST', body: JSON.stringify({ rootPath: 'C:\\WorkflowStudio\\projects\\demo' }) }));
  });

  it('surfaces the companion root restriction instead of accepting an old saved project', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Choose a project inside C:\\WorkflowStudio\\projects.' }, { status: 403 })));
    await expect(verifyProjectRoot('C:\\Users\\srelangi\\WorkflowStudio\\projects')).rejects.toThrow('Choose a project inside C:\\WorkflowStudio\\projects.');
  });

  it('handles runtime error arrays and disconnections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ errors: ['Connect your local runtime.'] }, { status: 409 })));
    await expect(verifyProjectRoot('C:\\WorkflowStudio\\projects')).rejects.toThrow('Connect your local runtime.');
  });

  it('guards saved selection and rechecks before posting the assignment', async () => {
    const source = await readFile('src/components/assignment-modal.tsx', 'utf8');
    expect(source).toContain('await verifyProjectRoot(nextProject.rootPath);');
    const creation = source.slice(source.indexOf('async function createAssignment()'));
    expect(creation.indexOf('await verifyProjectRoot(project.rootPath)')).toBeLessThan(creation.indexOf("fetch('/api/assignments'"));
    expect(source).toContain('onClick={() => void selectSavedProject(item)}');
  });
});
