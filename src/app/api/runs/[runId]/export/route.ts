import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { RunRepository } from '@/src/storage/run-repository';
import { listRuntimeToolApprovalsForRun } from '@/src/storage/runtime-connection-repository';
import { redactValue } from '@/src/server/redaction';
import { appendAuditEvent } from '@/src/storage/audit-repository';
import type { WorkflowRun } from '@/src/domain/runtime';
import type { RuntimeToolApproval } from '@/src/domain/runtime-connection';

export const dynamic = 'force-dynamic';

function safeFilename(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'workflow-run';
}

function markdown(run: WorkflowRun, actions: RuntimeToolApproval[]) {
  const lines = [
    `# Workflow run ${run.id}`,
    '',
    `- Status: ${run.status}`,
    `- Workflow: ${run.workflowId} v${run.workflowVersion}`,
    `- Assignment: ${run.assignmentId}`,
    `- Project: ${run.projectId}`,
    `- Engine: ${run.mastra ? `Mastra ${run.mastra.engineVersion}` : 'Legacy runtime'}`,
    `- Project root: ${run.rootPath}`,
    `- Created: ${run.createdAt}`,
    `- Updated: ${run.updatedAt}`,
    '',
    '## Stages',
    ''
  ];
  for (const node of run.compiledWorkflow.nodes) {
    const state = run.nodeRuns.find((candidate) => candidate.nodeId === node.id);
    lines.push(`### ${node.name}`, '', `- Type: ${node.type}`, `- Status: ${state?.status ?? 'unknown'}`, `- Skills: ${node.skillVersions.map((skill) => `${skill.skillId}@${skill.version}`).join(', ') || 'None'}`, `- Attempts: ${state?.attempt ?? 0}`, `- Companion job: ${state?.runtimeJobId ?? 'None'}`, `- Codex thread: ${state?.providerThreadId ?? 'None'}`, `- Summary: ${state?.summary ?? 'None'}`, '');
  }
  lines.push('## Artifacts', '');
  for (const artifact of run.artifacts) lines.push(`- ${artifact.description}: ${artifact.path} (node ${artifact.nodeId})`);
  if (!run.artifacts.length) lines.push('- None');
  lines.push('', '## Workflow decisions', '');
  for (const approval of run.approvalRecords) lines.push(`- ${approval.nodeId}: ${approval.keyword ?? approval.decision ?? 'pending'}${approval.feedback ? ` — ${approval.feedback}` : ''}`);
  if (!run.approvalRecords.length) lines.push('- None');
  lines.push('', '## Governed local actions', '');
  for (const action of actions) lines.push(`- ${action.title}: ${action.status} (${action.kind})${action.command ? ` — ${action.command}` : ''}`);
  if (!actions.length) lines.push('- None');
  lines.push('', '## Event journal', '');
  for (const event of run.events) lines.push(`${event.sequence}. ${event.timestamp} — ${event.message}`);
  return `${lines.join('\n')}\n`;
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { runId } = await context.params;
  const run = await new RunRepository().read(user.id, runId);
  if (!run) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
  const safeRun = redactValue(run) as typeof run;
  const actions = redactValue(await listRuntimeToolApprovalsForRun(user.id, runId)) as RuntimeToolApproval[];
  const format = new URL(request.url).searchParams.get('format') === 'markdown' ? 'markdown' : 'json';
  const filename = safeFilename(`${run.workflowId}-${run.id}`);
  await appendAuditEvent({ userId: user.id, actor: { id: user.id, name: user.name, role: user.role }, action: 'run.export', resourceType: 'run', resourceId: runId, decision: 'exported', correlationId: runId, details: { format } });
  if (format === 'markdown') return new Response(markdown(safeRun, actions), { headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${filename}.md"`, 'cache-control': 'no-store' } });
  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), run: safeRun, governedLocalActions: actions }, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${filename}.json"`, 'cache-control': 'no-store' } });
}
