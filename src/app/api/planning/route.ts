import { studioPaths } from '@/scripts/studio-home.cjs';
import { NextResponse } from 'next/server';
import { createCodexPlanningAdapter } from '@/src/adapters/codex-app-server-adapter';
import { validatePlanningRequest, type PlanningRequest, type PlanningError } from '@/src/domain/planning';
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
  const limit = await consumeRateLimit(rateLimitKey(request, 'planning', user.id), 20, 15 * 60);
  if (!limit.allowed) return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many planning requests. Try again later.' } }, { status: 429, headers: rateLimitHeaders(limit) });
  const stores = createWorkspaceStores(dataDirectory, user.id);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const error: PlanningError = { code: 'INVALID_REQUEST', message: 'Planning request must contain valid JSON.' };
    return NextResponse.json({ error }, { status: 400 });
  }

  const fieldErrors = validatePlanningRequest(body);
  if (Object.keys(fieldErrors).length) {
    const error: PlanningError = { code: 'INVALID_REQUEST', message: 'Planning request validation failed.', fieldErrors };
    return NextResponse.json({ error }, { status: 400 });
  }

  let availableSkills;
  try {
    availableSkills = await buildPlanningSkillCatalog(await stores.skills.readAll(), await discoverUserCodexSkills(user.id));
  } catch (error) {
    const providerError: PlanningError = { code: 'PROVIDER_FAILURE', message: error instanceof Error ? error.message : 'The paired Codex runtime could not provide its skill catalog.' };
    return NextResponse.json({ error: providerError }, { status: 503 });
  }
  const requestWithSkills: PlanningRequest = { ...(body as PlanningRequest), graphRepairFeedback: undefined, availableSkills };
  const result = await createValidatedPlanningPlan(createCodexPlanningAdapter({ userId: user.id }), requestWithSkills);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error.code === 'INVALID_PLAN' ? 422 : 503 });
  return NextResponse.json({ ...result.value, skillMatches: result.skillMatches, repairAttempts: result.repairAttempts }, { status: 200, headers: rateLimitHeaders(limit) });
}
