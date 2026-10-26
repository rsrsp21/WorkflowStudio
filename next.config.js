/** @type {import('next').NextConfig} */
const scriptSource = process.env.NODE_ENV === 'development'
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

const nextConfig = {
  output: 'standalone',
  // Managed Windows devices can block child-process workers. Keep build work
  // inside one worker thread so production verification remains available.
  experimental: { cpus: 1, workerThreads: true },
  // `npm run build` runs `tsc --noEmit` first. Skip Next's duplicate checker,
  // which launches a child process blocked by managed-device policy.
  typescript: { ignoreBuildErrors: true },
  // Keep dev hot-reload chunks separate from production build artifacts.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  // The App Server runtime is launched dynamically, so Next cannot discover
  // it through static imports while producing the standalone deployment.
  outputFileTracingIncludes: {
    '/*': ['./scripts/postgres-*.cjs', './scripts/postgres-schema.sql', './node_modules/pg*/**/*', './node_modules/postgres-*/**/*', './node_modules/pgpass/**/*', './node_modules/split2/**/*', './node_modules/xtend/**/*'],
    '/api/planning': ['./node_modules/@openai/codex/**/*', './node_modules/@openai/codex-*/**/*'],
    '/api/planning/stream': ['./node_modules/@openai/codex/**/*', './node_modules/@openai/codex-*/**/*']
  },
  // Authentication, sessions, and thread locks are runtime state. They must
  // never be inspected or copied into a standalone application build.
  outputFileTracingExcludes: {
    '*': ['./.codex-runtime/**/*']
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Content-Security-Policy', value: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; ${scriptSource}; connect-src 'self' https: wss:` },
      ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : [])
    ] }];
  }
};

module.exports = nextConfig;
