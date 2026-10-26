export function eventStream(request: Request, subscribe: (notify: () => void) => Promise<() => void>, snapshot: () => Promise<unknown>) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      const send = async () => {
        try { if (!closed) controller.enqueue(encoder.encode(`event: update\ndata: ${JSON.stringify(await snapshot())}\n\n`)); }
        catch { if (!closed) controller.enqueue(encoder.encode('event: error\ndata: {}\n\n')); }
      };
      const close = () => { if (closed) return; closed = true; clearInterval(keepalive); unsubscribe(); try { controller.close(); } catch {} };
      const keepalive = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(': keepalive\n\n')); }, 20_000);
      request.signal.addEventListener('abort', close, { once: true });
      try { unsubscribe = await subscribe(() => void send()); await send(); } catch { close(); }
    }
  }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
