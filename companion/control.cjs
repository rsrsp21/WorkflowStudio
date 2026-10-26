const { timingSafeEqual } = require('node:crypto');
const COOKIE = 'workflow_studio_companion';

function sameSecret(value, expected) {
  return typeof value === 'string' && typeof expected === 'string' && expected.length >= 32
    && Buffer.byteLength(value) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
function localRequest(request) {
  const host = request.headers.get('host');
  return host === `127.0.0.1:${process.env.PORT}`;
}
function authorized(request, mutation = false) {
  if (!localRequest(request)) return false;
  const cookie = (request.headers.get('cookie') || '').split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!sameSecret(cookie, process.env.WORKFLOW_STUDIO_COMPANION_TOKEN)) return false;
  const origin = request.headers.get('origin');
  if (origin && origin !== `http://127.0.0.1:${process.env.PORT}`) return false;
  return !mutation || request.headers.get('x-companion-request') === '1';
}
module.exports = { COOKIE, sameSecret, localRequest, authorized };
