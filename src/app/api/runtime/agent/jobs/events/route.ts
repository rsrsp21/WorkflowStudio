import { NextResponse } from 'next/server';
import { runtimeFromRequest } from '@/src/server/runtime-auth';
import { getRuntimeJob, getRuntimeToolApprovalForAgent, hasQueuedRuntimeJob, heartbeatRuntime } from '@/src/storage/runtime-connection-repository';
import { subscribeRuntimeJobs } from '@/src/server/runtime-job-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

export async function GET(request: Request) {
  const authenticated = await runtimeFromRequest(request);
  if (!authenticated) return NextResponse.json({ errors: ['Runtime authentication failed.'] }, { status: 401 });
  const connectionId = authenticated.connection.id;
  const search = new URL(request.url).searchParams;
  const jobId = search.get('jobId')?.trim();
  const approvalId = search.get('approvalId')?.trim();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      const send = (event: string, data: string) => {
        if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      };
      const close = async () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
        try { controller.close(); } catch { /* Stream may already be closed. */ }
      };
      const keepAlive = setInterval(() => {
        void heartbeatRuntime(connectionId, {}).then(() => send('keepalive', Date.now().toString())).catch(() => void close());
      }, 20_000);
      request.signal.addEventListener('abort', () => void close(), { once: true });
      try {
        unsubscribe = await subscribeRuntimeJobs(connectionId, (event) => send(event.type, JSON.stringify(event)));
        send('ready', 'connected');
        if (await hasQueuedRuntimeJob(connectionId)) send('job', 'available');
        if (jobId) {
          const job = await getRuntimeJob(authenticated.userId, jobId);
          if (job?.connectionId === connectionId && job.status === 'cancelled') send('job-cancelled', JSON.stringify({ type: 'job-cancelled', jobId }));
          if (approvalId) {
            const approval = await getRuntimeToolApprovalForAgent(connectionId, jobId, approvalId);
            if (approval && approval.status !== 'pending') send('approval-decided', JSON.stringify({ type: 'approval-decided', jobId, approvalId }));
          }
        }
      } catch {
        await close();
      }
    },
    cancel() { /* The request abort handler releases the PostgreSQL listener. */ }
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  } });
}
