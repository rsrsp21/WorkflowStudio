import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/src/proxy';

describe('Phase 8 request security boundary', () => {
  it('allows reads and same-origin mutations', () => {
    const read = proxy(new NextRequest('https://studio.example/api/workflows', { headers: { 'x-request-id': 'request-1234' } }));
    expect(read.status).toBe(200);
    expect(read.headers.get('x-request-id')).toBe('request-1234');
    expect(proxy(new NextRequest('https://studio.example/api/workflows', { method: 'POST', headers: { origin: 'https://studio.example', 'sec-fetch-site': 'same-origin' } })).status).toBe(200);
  });

  it('rejects cross-site browser mutations and mismatched origins', async () => {
    const crossSite = proxy(new NextRequest('https://studio.example/api/workflows', { method: 'POST', headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' } }));
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toMatchObject({ error: expect.stringContaining('Cross-site') });
    const wrongOrigin = proxy(new NextRequest('https://studio.example/api/workflows', { method: 'DELETE', headers: { origin: 'https://other.example', 'sec-fetch-site': 'same-origin' } }));
    expect(wrongOrigin.status).toBe(403);
  });

  it('allows authenticated non-browser companion requests without browser fetch headers', () => {
    expect(proxy(new NextRequest('https://studio.example/api/runtime/agent/jobs/next', { method: 'POST', headers: { authorization: 'Bearer local-runtime-token' } })).status).toBe(200);
  });
});
