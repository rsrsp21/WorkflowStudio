import control from '../../../control.cjs';
import serviceModule from '../../../service.cjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request, context) {
  if (!control.authorized(request)) return json({ ok: false, error: 'Open the companion using start.cjs as described in RUNNING-INSTRUCTIONS.txt.' }, 403);
  const { action } = await context.params;
  if (action === 'health') return json({ ok: true });
  try {
    const service = serviceModule.getService(); await service.initialize();
    if (action === 'state') return json({ ok: true, value: service.state() });
    if (action === 'browse') return json({ ok: true, value: await service.browse(new URL(request.url).searchParams.get('path')) });
    return json({ ok: false, error: 'Unknown action.' }, 404);
  } catch (error) { return json({ ok: false, error: error.message }, 400); }
}
export async function POST(request, context) {
  if (!control.authorized(request, true)) return json({ ok: false, error: 'Local companion authorization required.' }, 403);
  try {
    const { action } = await context.params;
    const body = await request.json();
    const service = serviceModule.getService(); await service.initialize();
    let value;
    if (action === 'folder') value = await service.chooseFolder(body.home);
    else if (action === 'signin') value = await service.signIn();
    else if (action === 'cancel-signin') value = service.cancelSignIn();
    else if (action === 'connect') { if (!body.code) throw new Error('Paste a pairing code.'); value = await service.connect(body.server, body.code); }
    else if (action === 'pause') value = await service.pause();
    else if (action === 'resume') value = await service.resume();
    else if (action === 'shutdown') { await service.shutdown(); setTimeout(() => process.exit(0), 500); }
    else return json({ ok: false, error: 'Unknown action.' }, 404);
    return json({ ok: true, value: value ?? service.state() });
  } catch (error) { return json({ ok: false, error: error.message }, 400); }
}
