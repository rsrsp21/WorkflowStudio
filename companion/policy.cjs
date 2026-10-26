function serverOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter your Workflow Studio website address.');
  const url = new URL(value.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('Use an HTTPS website address.');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Enter the website origin, without a page path.');
  return url.origin;
}

function pairingCode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(value.trim())) throw new Error('Paste the pairing code from your Workflow Studio profile.');
  return value.trim();
}

function loginUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || !['auth.openai.com', 'auth0.openai.com', 'chatgpt.com'].includes(url.hostname)) throw new Error('Codex returned an unexpected sign-in address.');
  return url.href;
}

module.exports = { serverOrigin, pairingCode, loginUrl };
