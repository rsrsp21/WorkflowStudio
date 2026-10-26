const secretKey = /token|password|secret|authorization|cookie|api[-_]?key|credential|session/i;

export function redactValue(value: unknown, key = '', depth = 0): unknown {
  if (depth > 10) return '[truncated]';
  if (secretKey.test(key)) return '[redacted]';
  if (typeof value === 'string') return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|sess|pat|ghp|github_pat)_[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/([?&](?:token|key|secret|password)=)[^&#\s]+/gi, '$1[redacted]')
    .slice(0, 20_000);
  if (Array.isArray(value)) return value.slice(0, 10_000).map((item) => redactValue(item, key, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 2_000).map(([childKey, child]) => [childKey, redactValue(child, childKey, depth + 1)]));
  return value;
}
