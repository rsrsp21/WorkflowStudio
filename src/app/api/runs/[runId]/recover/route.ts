import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { SequentialRuntime } from '@/src/domain/runtime-engine';
import { RunRepository } from '@/src/storage/run-repository';
import { CodexNodeExecutor } from '@/src/adapters/codex-node-executor';
import { createCodexPlanningAdapter } from '@/src/adapters/codex-app-server-adapter';
import { createWorkspaceStores } from '@/src/storage/workspace-stores';
import { studioPaths } from '@/scripts/studio-home.cjs';
import { acquireRunExecutionLock, releaseRunExecutionLock, renewRunExecutionLock } from '@/src/storage/run-execution-lock';

export const dynamic = 'force-dynamic';
const runs = new RunRepository();

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { runId } = await context.params;
  if (!await runs.read(user.id, runId)) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
  const lock = await acquireRunExecutionLock(user.id, runId);
  if (!lock) return NextResponse.json({ error: 'This run is actively executing. Wait for the current operation before recovering it.' }, { status: 409 });
  const renewal = setInterval(() => { void renewRunExecutionLock(user.id, runId, lock).catch(() => undefined); }, 60_000);
  renewal.unref?.();
  try {
    const runs = new RunRepository({ userId: user.id, runId, token: lock });
    const current = await runs.read(user.id, runId);
    if (!current) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
    if (current.mastra) {
      const stores = createWorkspaceStores(process.env.WORKFLOW_STUDIO_DATA_DIR ?? studioPaths().data, user.id);
      const skills = await stores.skills.readAll();
      const { LocalMastraAdapter } = await import('@/src/adapters/mastra-adapter');
      const codexExecutor = new CodexNodeExecutor(createCodexPlanningAdapter({ userId: user.id }), skills);
      const adapter = new LocalMastraAdapter({ executor: { execute: async (task) => {
        await runs.assertExecutionOwnership();
        return codexExecutor.execute(task);
      } }, store: runs });
      try { await adapter.recover(user.id, runId); }
      finally { await adapter.close(); }
      const updated = await runs.read(user.id, runId);
      if (!updated) throw new Error('Mastra recovery completed without durable state.');
      return NextResponse.json({ run: updated, transition: { kind: updated.status === 'paused' ? 'waiting-approval' : updated.status === 'completed' ? 'run-completed' : updated.status === 'failed' ? 'run-failed' : 'retried' }, engine: 'mastra' });
    }
    const transition = await new SequentialRuntime(runs).recover(user.id, runId);
    return NextResponse.json({ run: transition.run, transition: { kind: transition.kind, nodeRun: transition.nodeRun }, engine: 'legacy' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Run could not be recovered.' }, { status: 409 });
  } finally { clearInterval(renewal); await releaseRunExecutionLock(user.id, runId, lock); }
}
