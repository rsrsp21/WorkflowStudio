import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { RunRepository } from '@/src/storage/run-repository';
import { listRuntimeConnections, listRuntimeJobDiagnosticsForRun } from '@/src/storage/runtime-connection-repository';
import { databaseHealth, getDatabase } from '@/src/storage/async-database';
import { redactValue } from '@/src/server/redaction';
import { listAuditEvents } from '@/src/storage/audit-repository';
import { mastraRuntimeDiagnostics } from '@/src/adapters/mastra-adapter';
import { runtimeRolloutConfiguration } from '@/src/domain/runtime-rollout';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const runs = await new RunRepository().readAll(user.id);
  const health = await databaseHealth();
  const runtimeConnections = await listRuntimeConnections(user.id);
  const recentRuns = await Promise.all(runs.slice(0, 20).map(async (run) => ({
    id: run.id, status: run.status, schemaVersion: run.schemaVersion, workflowVersion: run.workflowVersion,
    stateRevision: run.stateRevision ?? 0, executionRequested: Boolean(run.executionRequested),
    reconciliation: await (await getDatabase()).get(`SELECT state_revision, acknowledged_revision, available_at, lease_until, last_error
      FROM run_reconciliation WHERE run_id = ? AND user_id = ?`, [run.id, user.id]),
    engine: run.mastra ? { name: 'mastra', boundaryVersion: run.runtimeEngine?.version, packageVersion: run.mastra.engineVersion, workflowId: run.mastra.workflowId, stepId: run.mastra.activeStepId, snapshotStatus: run.mastra.status } : { name: 'legacy', boundaryVersion: run.runtimeEngine?.version },
    createdAt: run.createdAt, updatedAt: run.updatedAt, durationMs: Math.max(0, Date.parse(run.updatedAt) - Date.parse(run.createdAt)),
    eventCount: run.events.length, verificationCount: run.verificationResults.length,
    nodes: run.nodeRuns.map((node) => ({ nodeId: node.nodeId, taskId: node.taskId, attempt: node.attempt, iteration: node.iteration, status: node.status, runtimeJobId: node.runtimeJobId, runtimeConnectionId: node.runtimeConnectionId, providerThreadId: node.providerThreadId, deliveryStage: node.deliveryStage, failureKind: node.failureKind, error: node.error })),
    companionJobs: await listRuntimeJobDiagnosticsForRun(user.id, run.id)
  })));
  const bundle = redactValue({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, runtimeMode: process.env.CODEX_RUNTIME_MODE ?? (process.env.NODE_ENV === 'production' ? 'paired' : 'local'), workflowEngine: mastraRuntimeDiagnostics(), rollout: runtimeRolloutConfiguration() },
    storage: { ...health, runCount: runs.length },
    runtimes: runtimeConnections.map((connection) => ({ ...connection, codexAccountLabel: connection.codexAccountLabel ? '[account present]' : undefined, allowedRoots: connection.allowedRoots.map(() => '[approved root]') })),
    recentRuns,
    audit: await listAuditEvents(user.id, 100)
  });
  return new Response(JSON.stringify(bundle, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="workflow-studio-support-${new Date().toISOString().slice(0, 10)}.json"`, 'cache-control': 'no-store' } });
}
