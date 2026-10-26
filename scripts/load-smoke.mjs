const baseUrl = (process.env.WORKFLOW_STUDIO_LOAD_URL || 'http://localhost:3000').replace(/\/$/, '');
const total = Math.max(1, Number(process.env.WORKFLOW_STUDIO_LOAD_REQUESTS || 1000));
const concurrency = Math.max(1, Math.min(200, Number(process.env.WORKFLOW_STUDIO_LOAD_CONCURRENCY || 50)));
const p95LimitMs = Math.max(1, Number(process.env.WORKFLOW_STUDIO_LOAD_P95_MS || 2000));
const paths = (process.env.WORKFLOW_STUDIO_LOAD_PATHS || '/api/health').split(',').map((value) => value.trim()).filter((value) => value.startsWith('/'));
const cookie = process.env.WORKFLOW_STUDIO_LOAD_COOKIE?.trim();
const durations = [];
const endpointResults = Object.fromEntries(paths.map((path) => [path, { requests: 0, failures: 0, durations: [] }]));
let next = 0;
let failures = 0;

async function worker() {
  while (true) {
    const index = next++;
    if (index >= total) return;
    const started = performance.now();
    const path = paths[index % paths.length];
    try {
      const response = await fetch(`${baseUrl}${path}`, { headers: { 'user-agent': 'workflow-studio-load-smoke/2', ...(cookie ? { cookie } : {}) } });
      const body = await response.json();
      if (!response.ok || (path === '/api/health' && body.status !== 'ready')) { failures += 1; endpointResults[path].failures += 1; }
    } catch { failures += 1; endpointResults[path].failures += 1; }
    const duration = performance.now() - started;
    durations.push(duration); endpointResults[path].durations.push(duration); endpointResults[path].requests += 1;
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
durations.sort((a, b) => a - b);
const percentile = (value) => durations[Math.min(durations.length - 1, Math.ceil(durations.length * value) - 1)] ?? 0;
const endpointSummary = Object.fromEntries(Object.entries(endpointResults).map(([path, stats]) => {
  stats.durations.sort((a, b) => a - b);
  const at = (value) => stats.durations[Math.min(stats.durations.length - 1, Math.ceil(stats.durations.length * value) - 1)] ?? 0;
  return [path, { requests: stats.requests, failures: stats.failures, p50Ms: Math.round(at(0.5)), p95Ms: Math.round(at(0.95)), p99Ms: Math.round(at(0.99)) }];
}));
const result = { baseUrl, requests: total, concurrency, failures, p50Ms: Math.round(percentile(0.5)), p95Ms: Math.round(percentile(0.95)), p99Ms: Math.round(percentile(0.99)), endpoints: endpointSummary };
const output = `${JSON.stringify(result, null, 2)}\n`;
process.stdout.write(output);
if (process.env.WORKFLOW_STUDIO_LOAD_REPORT) {
  const reportPath = path.resolve(process.env.WORKFLOW_STUDIO_LOAD_REPORT);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, output);
}
if (failures || result.p95Ms > p95LimitMs) process.exitCode = 1;
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
