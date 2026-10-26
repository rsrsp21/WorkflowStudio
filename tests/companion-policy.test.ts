import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { serverOrigin, pairingCode, loginUrl } = require('../companion/policy.cjs');

describe('standalone companion input boundaries', () => {
  it('accepts HTTPS origins and localhost development without credentials or arbitrary paths', () => {
    expect(serverOrigin('https://studio.example.com/')).toBe('https://studio.example.com');
    expect(serverOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    for (const value of ['http://studio.example.com', 'file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com/settings', 'https://example.com/?token=secret']) expect(() => serverOrigin(value)).toThrow();
  });
  it('validates pairing codes and opens only Codex authentication hosts', () => {
    expect(pairingCode(' ABCD-1234-5678 ')).toBe('ABCD-1234-5678');
    for (const value of ['', '$(whoami)', 'code with spaces']) expect(() => pairingCode(value)).toThrow();
    expect(loginUrl('https://auth.openai.com/authorize?state=example')).toContain('auth.openai.com');
    for (const value of ['file:///C:/Windows', 'https://auth.openai.com.evil.test', 'http://auth.openai.com', 'https://evil.test']) expect(() => loginUrl(value)).toThrow();
  });
});
