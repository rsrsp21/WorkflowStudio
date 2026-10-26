import { createHash, timingSafeEqual } from 'node:crypto';

export function metricsRequestAuthorized(request: Request, environment: Record<string, string | undefined> = process.env) {
  const configured = environment.WORKFLOW_STUDIO_METRICS_TOKEN?.trim();
  const authorization = request.headers.get('authorization');
  const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!configured || configured.length < 32 || !supplied) return false;
  const expected = createHash('sha256').update(configured).digest();
  const candidate = createHash('sha256').update(supplied).digest();
  return timingSafeEqual(expected, candidate);
}
