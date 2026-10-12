import { createFirebaseHandoff } from './firebase-browser-login.js';

const byId = id => document.getElementById(id);
const [browserId, encodedKey] = location.hash.slice(1).split('.');
let cliPublicKey;
try { cliPublicKey = decodeURIComponent(encodedKey || ''); } catch {}
// The fragment is never sent to the server, analytics, or referrers.
history.replaceState(null, '', location.pathname);
let context;
let connected = false;
function status(text, isError = false) {
  byId('status').textContent = text;
  byId('status').dataset.error = String(isError);
}
async function request(action, data) {
  const response = await fetch(`/api/login/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
    cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('Login is unavailable. Please try again later.'); }
  if (!response.ok || !result.ok) throw new Error(result?.error?.message || 'Login is unavailable. Please try again.');
  return result.data;
}
async function initialize() {
  if (!/^[a-f0-9]{64}$/.test(browserId) || !/^B[A-Za-z0-9+/]{86}=$/.test(cliPublicKey || '')) {
    status('Open the private login link from your agent to connect.');
    byId('start-help').hidden = false;
    return;
  }
  try {
    context = await request('context', { browserId });
    if (context.protocolVersion !== 2) throw new Error('This login service needs an update. Please try again later.');
    if (context.publicKey !== cliPublicKey) throw new Error('This login link does not match your CLI. Ask your agent for a new link.');
    byId('login-form').hidden = false;
    status('');
    byId('expiry').textContent = `This link expires at ${new Date(context.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
    const remaining = Math.max(0, context.expiresAt - Date.now());
    window.setTimeout(() => {
      if (!connected) { byId('login-form').hidden = true; byId('password').value = ''; byId('api-key').value = ''; status('This login link has expired. Ask your agent for a new link.', true); }
    }, remaining);
  } catch (error) { status(error.message, true); byId('start-help').hidden = false; }
}
byId('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!context || Date.now() >= context.expiresAt) return;
  byId('sign-in').disabled = true;
  status('Signing in…');
  const credentials = { apiKey: byId('api-key').value.trim(), email: byId('email').value.trim(), password: byId('password').value, publicKey: cliPublicKey, browserId };
  try {
    const envelope = await createFirebaseHandoff(credentials);
    await request('complete', { browserId, envelope });
    connected = true;
    byId('api-key').value = '';
    byId('login-form').hidden = true;
    byId('success').hidden = false;
    status('');
    byId('migration-note')?.setAttribute('hidden', '');
  } catch (error) {
    status(error.message || 'Could not connect. Please try again.', true);
  } finally { credentials.password = ''; credentials.apiKey = ''; byId('password').value = ''; byId('sign-in').disabled = false; }
});
initialize();
