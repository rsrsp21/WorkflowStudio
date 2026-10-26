import { studioPaths } from '@/scripts/studio-home.cjs';
import { NextResponse } from 'next/server';
import { createCodexPlanningAdapter } from '@/src/adapters/codex-app-server-adapter';
import { validatePlanningRequest, type PlanningError, type PlanningRequest } from '@/src/domain/planning';
import { createValidatedPlanningPlan } from '@/src/domain/planning-orchestrator';
import { buildPlanningSkillCatalog, discoverUserCodexSkills } from '@/src/storage/codex-skill-catalog';
import { createWorkspaceStores } from '@/src/storage/workspace-stores';
import { getRequestUser } from '@/src/auth/auth';
import { consumeRateLimit, rateLimitHeaders, rateLimitKey } from '@/src/server/rate-limit';

export const dynamic = 'force-dynamic';
const dataDirectory = process.env.WORKFLOW_STUDIO_DATA_DIR ?? studioPaths().data;

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: 'Sign in before creating a workflow plan.' } }, { status: 401 });
  const limit = await consumeRateLimit(rateLimitKey(request, 'planning-stream', user.id), 20, 15 * 60);
  if (!limit.allowed) return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many planning requests. Try again later.' } }, { status: 429, headers: rateLimitHeaders(limit) });
  const stores = createWorkspaceStores(dataDirectory, user.id);
  let body: unknown;
  try { body = await request.json(); } catch { const error: PlanningError = { code: 'INVALID_REQUEST', message: 'Planning request must contain valid JSON.' }; return NextResponse.json({ error }, { status: 400 }); }
  const fieldErrors = validatePlanningRequest(body);
  if (Object.keys(fieldErrors).length) { const error: PlanningError = { code: 'INVALID_REQUEST', message: 'Planning request validation failed.', fieldErrors }; return NextResponse.json({ error }, { status: 400 }); }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      void (async () => {
        send({ type: 'planning.started', message: 'Codex App Server planning started.' });
        const availableSkills = await buildPlanningSkillCatalog(await stores.skills.readAll(), await discoverUserCodexSkills(user.id));
        const requestWithSkills: PlanningRequest = { ...(body as PlanningRequest), graphRepairFeedback: undefined, availableSkills };
        const result = await createValidatedPlanningPlan(createCodexPlanningAdapter({ userId: user.id }), requestWithSkills, (event) => send(event));
        if (result.ok) {
          send({ type: 'planning.completed', result: { ...result.value, skillMatches: result.skillMatches, repairAttempts: result.repairAttempts } });
        } else send({ type: 'planning.failed', error: result.error });
        controller.close();
      })().catch((error) => { send({ type: 'planning.failed', error: { code: 'PROVIDER_FAILURE', message: error instanceof Error ? error.message : 'Planning failed.' } }); controller.close(); });
    }
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', ...rateLimitHeaders(limit) } });
}
