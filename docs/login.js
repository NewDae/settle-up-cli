const byId = id => document.getElementById(id);
const browserId = location.hash.slice(1);
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
  if (!/^[a-f0-9]{64}$/.test(browserId)) {
    status('Open the private login link from your agent to connect.');
    byId('start-help').hidden = false;
    return;
  }
  try {
    context = await request('context', { browserId });
    byId('login-form').hidden = false;
    status('');
    const remaining = Math.max(0, context.expiresAt - Date.now());
    window.setTimeout(() => {
      if (!connected) { byId('login-form').hidden = true; status('This login link has expired. Ask your agent for a new link.', true); }
    }, remaining);
  } catch (error) { status(error.message, true); byId('start-help').hidden = false; }
}
byId('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!context || Date.now() >= context.expiresAt) return;
  byId('sign-in').disabled = true;
  status('Signing in…');
  const credentials = { browserId, email: byId('email').value.trim(), password: byId('password').value };
  try {
    // The same-origin endpoint calls the existing hosted auth Worker using an
    // internal service binding. No Firebase API key is delivered to the page.
    await request('complete', credentials);
    connected = true;
    byId('login-form').hidden = true;
    byId('success').hidden = false;
    status('');
    byId('migration-note')?.setAttribute('hidden', '');
  } catch (error) {
    status(error.message || 'Could not connect. Please try again.', true);
  } finally { credentials.password = ''; byId('password').value = ''; byId('sign-in').disabled = false; }
});
initialize();
