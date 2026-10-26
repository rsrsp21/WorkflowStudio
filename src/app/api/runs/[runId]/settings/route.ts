import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { canPerformGovernedAction } from '@/src/domain/authorization';
import { modelSettingsErrors, type ModelSettings } from '@/src/domain/model-settings';
import { executionHarness, runtimeHarnessErrors, updateRunExecutionSettings } from '@/src/domain/run-execution-settings';
import { validateWorkflowRun } from '@/src/domain/runtime';
import { RunRepository } from '@/src/storage/run-repository';
import { acquireRunExecutionLock, releaseRunExecutionLock } from '@/src/storage/run-execution-lock';
import { getOnlineRuntimeConnection } from '@/src/storage/runtime-connection-repository';
import { companionSupportsVerbosity } from '@/src/domain/runtime-connection';
import { shouldUsePairedRuntime } from '@/src/adapters/paired-runtime-adapter';

export const dynamic = 'force-dynamic';
const runs = new RunRepository();

export async function PATCH(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!canPerformGovernedAction(user, 'decide-workflow-gate')) return NextResponse.json({ errors: ['Reviewer or administrator role is required to change execution settings.'] }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Array.isArray(body) || !body.modelSettings || !body.harness || typeof body.harness !== 'object' || Array.isArray(body.harness) || !Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) return NextResponse.json({ errors: ['Provide model settings, harness settings, and the current revision.'] }, { status: 400 });
  const errors = modelSettingsErrors(body.modelSettings);
  const editableHarnessKeys = ['sandboxMode', 'allowedTools', 'requireApprovalForDestructiveActions', 'maxRetries', 'maxLoopIterations', 'maxConcurrentNodes', 'parallelFailureMode'];
  if (Object.keys(body.harness).some((key) => !editableHarnessKeys.includes(key))) errors.push('Only sandbox, tools, approvals, retries, and loop limits can change during execution.');
  if (errors.length) return NextResponse.json({ errors }, { status: 400 });
  const { runId } = await context.params;
  const lock = await acquireRunExecutionLock(user.id, runId);
  if (!lock) return NextResponse.json({ errors: ['The run is advancing. Wait for the current operation to finish.'] }, { status: 409 });
  try {
    const run = await runs.read(user.id, runId);
    if (!run) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
    const gate = run.approvalRecords.findLast((approval) => !approval.decision && !approval.resumedAt);
    if (run.status === 'paused' && (!gate || body.approvalId !== gate.id)) return NextResponse.json({ errors: ['The approval gate changed. Reload before changing execution settings.'] }, { status: 409 });
    if ((body.modelSettings as ModelSettings).verbosity && shouldUsePairedRuntime()) {
      const connection = await getOnlineRuntimeConnection(user.id);
      if (connection && !companionSupportsVerbosity(connection.companionVersion)) return NextResponse.json({ errors: ['Update and restart the companion to version 0.1.1 or later before setting output verbosity.'] }, { status: 409 });
    }
    const harness = { ...executionHarness(run), ...body.harness };
    const harnessErrors = runtimeHarnessErrors(harness, run.rootPath);
    if (harnessErrors.length) return NextResponse.json({ errors: harnessErrors }, { status: 400 });
    const missingTools = run.compiledWorkflow.nodes.flatMap((node) => (node.skillSnapshots ?? []).flatMap((skill) => skill.requiredPermissions)).filter((tool) => !tool.startsWith('credential:') && !harness.allowedTools.includes(tool));
    if (missingTools.length) return NextResponse.json({ errors: [`Selected skills require these tools: ${Array.from(new Set(missingTools)).join(', ')}.`] }, { status: 400 });
    const actor = { id: user.id, name: user.name, role: user.role };
    const updated = updateRunExecutionSettings(run, { modelSettings: body.modelSettings as ModelSettings, harness }, actor, Number(body.expectedRevision), { workspaceWrite: body.confirmWorkspaceWrite === true, destructiveBypass: body.confirmDestructiveBypass === true });
    const runErrors = validateWorkflowRun(updated);
    if (runErrors.length) return NextResponse.json({ errors: runErrors }, { status: 400 });
    await runs.upsert(user.id, updated);
    return NextResponse.json({ run: updated });
  } catch (cause) {
    return NextResponse.json({ errors: [cause instanceof Error ? cause.message : 'Execution settings could not be updated.'] }, { status: 409 });
  } finally {
    await releaseRunExecutionLock(user.id, runId, lock);
  }
}
