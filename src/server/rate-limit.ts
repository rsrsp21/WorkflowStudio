import { createHash } from 'node:crypto';
import { getDatabase } from '@/src/storage/async-database';

export interface RateLimitDecision { allowed: boolean; limit: number; remaining: number; retryAfterSeconds: number }

function requestIdentity(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown-client';
}

export function rateLimitKey(request: Request, operation: string, subject = '') {
  return createHash('sha256').update(`${operation}:${requestIdentity(request)}:${subject.trim().toLowerCase()}`).digest('hex');
}

export async function consumeRateLimit(bucketKey: string, limit: number, windowSeconds: number, nowMs = Date.now()): Promise<RateLimitDecision> {
  const windowStart = Math.floor(nowMs / (windowSeconds * 1000)) * windowSeconds;
  const row = await (await getDatabase()).get<{ window_start: number; request_count: number }>(`INSERT INTO rate_limit_buckets (bucket_key, window_start, request_count) VALUES (?, ?, 1)
    ON CONFLICT(bucket_key) DO UPDATE SET
      request_count = CASE WHEN rate_limit_buckets.window_start = excluded.window_start THEN rate_limit_buckets.request_count + 1 ELSE 1 END,
      window_start = excluded.window_start
    RETURNING window_start, request_count`, [bucketKey, windowStart]);
  if (!row) throw new Error('Rate-limit update did not return a row.');
  const count = Number(row.request_count);
  const retryAfterSeconds = Math.max(1, Number(row.window_start) + windowSeconds - Math.floor(nowMs / 1000));
  return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), retryAfterSeconds };
}

export function rateLimitHeaders(decision: RateLimitDecision) {
  return { 'x-ratelimit-limit': String(decision.limit), 'x-ratelimit-remaining': String(decision.remaining), ...(decision.allowed ? {} : { 'retry-after': String(decision.retryAfterSeconds) }) };
}
