import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
const { authorized } = createRequire(import.meta.url)('../companion/control.cjs');
afterEach(() => vi.unstubAllEnvs());
it('requires the launcher cookie and rejects foreign origins and missing mutation headers', () => {
  vi.stubEnv('PORT', '45678'); vi.stubEnv('WORKFLOW_STUDIO_COMPANION_TOKEN', 'a'.repeat(64));
  const request = (headers = {}) => new Request('http://127.0.0.1:45678/api/folder', { headers: { host: '127.0.0.1:45678', cookie: `workflow_studio_companion=${'a'.repeat(64)}`, ...headers } });
  expect(authorized(request())).toBe(true);
  expect(authorized(request(), true)).toBe(false);
  expect(authorized(request({ 'x-companion-request': '1' }), true)).toBe(true);
  expect(authorized(request({ origin: 'https://attacker.example', 'x-companion-request': '1' }), true)).toBe(false);
  expect(authorized(request({ host: 'attacker.example' }))).toBe(false);
  expect(authorized(request({ cookie: '' }))).toBe(false);
});
