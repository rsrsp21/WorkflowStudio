import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getRequestUser } from '@/src/auth/auth';
import { RunRepository } from '@/src/storage/run-repository';
import { isWithinWorkspaceRoot } from '@/src/domain/workspace-boundary';
import { dispatchPairedRuntimeJob, shouldUsePairedRuntime } from '@/src/adapters/paired-runtime-adapter';

export const dynamic = 'force-dynamic';

function contentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  return ({ '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.html': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'text/plain; charset=utf-8', '.pdf': 'application/pdf' } as Record<string, string>)[extension] ?? 'application/octet-stream';
}

export async function GET(request: Request, context: { params: Promise<{ runId: string; artifactId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { runId, artifactId } = await context.params;
  return artifactResponseForUser(user.id, runId, artifactId);
}

export async function artifactResponseForUser(userId: string, runId: string, artifactId: string) {
  const run = await new RunRepository().read(userId, runId);
  if (!run) return NextResponse.json({ error: 'Run was not found.' }, { status: 404 });
  const artifact = run.artifacts.find((candidate) => candidate.id === artifactId);
  if (!artifact) return NextResponse.json({ error: 'Artifact was not found.' }, { status: 404 });
  const filePath = path.resolve(artifact.path);
  if (!isWithinWorkspaceRoot(filePath, path.resolve(artifact.rootPath))) return NextResponse.json({ error: 'Artifact is outside the approved project root.' }, { status: 403 });
  try {
    if (shouldUsePairedRuntime()) {
      const result = await dispatchPairedRuntimeJob<{ artifact: { contentBase64: string; size: number } }>(userId, 'artifact-read', { path: filePath, rootPath: artifact.rootPath, runId, artifactId });
      if (!result.artifact || typeof result.artifact.contentBase64 !== 'string' || !Number.isInteger(result.artifact.size) || result.artifact.size < 0 || result.artifact.size > 25 * 1024 * 1024) throw new Error('Companion returned an invalid artifact preview.');
      const body = Buffer.from(result.artifact.contentBase64, 'base64');
      if (body.byteLength !== result.artifact.size) throw new Error('Companion artifact size does not match its content.');
      return new NextResponse(body, { headers: { 'content-type': contentType(filePath), 'content-disposition': 'inline', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
    }
    const info = await stat(filePath);
    if (!info.isFile() || info.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'Artifact is too large to preview.' }, { status: 413 });
    return new NextResponse(await readFile(filePath), { headers: { 'content-type': contentType(filePath), 'content-disposition': 'inline', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  } catch {
    return NextResponse.json({ error: 'Artifact is not available in the approved project folder.' }, { status: 404 });
  }
}
