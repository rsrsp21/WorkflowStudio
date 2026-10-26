import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { WorkflowRepository } from '@/src/storage/workflow-repository';
import { redactValue } from '@/src/server/redaction';
import { appendAuditEvent } from '@/src/storage/audit-repository';

export const dynamic = 'force-dynamic';

function safeFilename(value: string) { return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'workflow'; }

export async function GET(request: Request, context: { params: Promise<{ workflowId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { workflowId } = await context.params;
  const workflow = (await new WorkflowRepository().readAll(user.id)).find((candidate) => candidate.id === workflowId);
  if (!workflow) return NextResponse.json({ error: 'Workflow was not found.' }, { status: 404 });
  await appendAuditEvent({ userId: user.id, actor: { id: user.id, name: user.name, role: user.role }, action: 'workflow.export', resourceType: 'workflow', resourceId: workflowId, decision: 'exported', correlationId: workflowId, details: { version: workflow.version ?? 1 } });
  return new Response(JSON.stringify({ schemaVersion: 1, product: 'Workflow Studio', exportedAt: new Date().toISOString(), workflow: redactValue(workflow) }, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${safeFilename(workflow.name)}-v${workflow.version ?? 1}.json"`, 'cache-control': 'no-store' } });
}
