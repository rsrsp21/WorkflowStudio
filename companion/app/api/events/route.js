import { getService } from '../../../service.cjs';
export const dynamic = 'force-dynamic';
const encoder = new TextEncoder();
export async function GET(request) {
  const service = getService();
  await service.initialize();
  return new Response(new ReadableStream({ start(controller) {
    let closed = false;
    const send = (state) => { if (!closed) controller.enqueue(encoder.encode(`event: state\ndata: ${JSON.stringify(state)}\n\n`)); };
    const unsubscribe = service.subscribe(send);
    const keepalive = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(': keepalive\n\n')); }, 20_000);
    request.signal.addEventListener('abort', () => { closed = true; clearInterval(keepalive); unsubscribe(); try { controller.close(); } catch {} }, { once: true });
  }}), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
