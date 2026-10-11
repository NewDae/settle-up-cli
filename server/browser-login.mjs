import { encryptLogin } from '../bin/lib/browser-crypto.mjs';

const TTL = 10 * 60_000;
const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(value => value.toString(16).padStart(2, '0')).join('');
const validToken = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const publicKey = value => typeof value === 'string' && /^B[A-Za-z0-9+/]{86}=$/.test(value);
function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } });
}
function reject(message, status = 400, code = 'INVALID_INPUT') {
  return json({ ok: false, error: { code, message } }, status);
}
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('Invalid input');
  if (Number(request.headers.get('content-length')) > 16_384) throw new Error('Invalid input');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Invalid input');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16_384) { await reader.cancel(); throw new Error('Invalid input'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid input');
  return value;
}
// A same-origin Pages Function. The database stores only ciphertext, public
// keys, and hashed poll credentials. Password verification stays in the
// existing auth Worker; no passwords or readable tokens are persisted here.
export async function handleBrowserLogin(request, env) {
  const url = new URL(request.url);
  const action = url.pathname.split('/').pop();
  if (!['start', 'context', 'complete', 'poll', 'cancel'].includes(action)) return reject('Unknown login endpoint', 404);
  if (request.method !== 'POST') return reject('Method not allowed', 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return reject('Cross-origin login is not allowed', 403);
  if (['context', 'complete'].includes(action) && origin !== url.origin) return reject('Open the login page to continue', 403);
  if (!env.LOGIN_DB || !env.AUTH_SERVICE) return reject('Browser login is not configured', 503, 'API_REQUEST_FAILED');
  let input;
  try { input = await body(request); } catch { return reject('Invalid login request'); }
  const fields = { start: ['publicKey'], context: ['browserId'], complete: ['browserId', 'email', 'password'], poll: ['deviceToken'], cancel: ['deviceToken'] }[action];
  if (Object.keys(input).some(key => !fields.includes(key))) return reject('Unexpected login field');
  const db = env.LOGIN_DB;
  const now = Date.now();
  try {
    await db.prepare('DELETE FROM browser_logins WHERE expires_at <= ?').bind(now).run();
    if (action === 'start') {
      if (!publicKey(input.publicKey)) return reject('Invalid login public key');
      try { await crypto.subtle.importKey('raw', Uint8Array.from(atob(input.publicKey), c => c.charCodeAt(0)), { name: 'ECDH', namedCurve: 'P-256' }, false, []); } catch { return reject('Invalid login public key'); }
      // A bounded, per-IP quota; no plaintext IPs are persisted.
      const bucket = await hash(`${request.headers.get('cf-connecting-ip') || 'local'}:${Math.floor(now / 60_000)}`);
      await db.prepare('DELETE FROM login_limits WHERE expires_at <= ?').bind(now).run();
      const count = await db.prepare('INSERT INTO login_limits (bucket, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count').bind(bucket, now + 120_000).first();
      if (count.count > 10) return reject('Too many login requests; wait a minute', 429, 'API_RATE_LIMITED');
      const browserId = token();
      const deviceToken = token();
      const expiresAt = now + TTL;
      await db.prepare('INSERT INTO browser_logins (browser_id, device_hash, public_key, expires_at) VALUES (?, ?, ?, ?)').bind(browserId, await hash(deviceToken), input.publicKey, expiresAt).run();
      return json({ ok: true, data: { browserId, deviceToken, expiresAt, interval: 3 } });
    }
    if (['context', 'complete'].includes(action)) {
      if (!validToken(input.browserId)) return reject('Invalid login link');
      const row = await db.prepare('SELECT public_key, expires_at, envelope FROM browser_logins WHERE browser_id = ?').bind(input.browserId).first();
      if (!row || row.envelope) return reject('This login link has expired or was already used', 410, 'AUTH_INVALID');
      if (action === 'context') return json({ ok: true, data: { publicKey: row.public_key, expiresAt: row.expires_at } });
      if (typeof input.email !== 'string' || !input.email || input.email.length > 254 || typeof input.password !== 'string' || !input.password || input.password.length > 4096) return reject('Enter your email and password');
      // Internal service binding to the existing hosted Worker. Its Firebase
      // API key stays in that Worker's secret configuration.
      let upstream;
      try {
        upstream = await env.AUTH_SERVICE.fetch(new Request('https://auth.internal/auth/login', {
          method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': request.headers.get('cf-connecting-ip') || 'local' },
          body: JSON.stringify({ email: input.email, password: input.password }), signal: AbortSignal.timeout(20_000),
        }));
      } finally { input.password = ''; }
      if (upstream.status === 429) return reject('Too many attempts; wait before trying again', 429, 'API_RATE_LIMITED');
      if ([400, 401, 403].includes(upstream.status)) return reject('Sign-in failed; check your email/password and account migration', 401, 'AUTH_INVALID');
      if (!upstream.ok) return reject('Sign-in is temporarily unavailable', 503, 'API_REQUEST_FAILED');
      const result = await upstream.json();
      const auth = result?.ok === true ? result.data : null;
      if (typeof auth?.accessToken !== 'string' || !auth.accessToken || typeof auth.refreshToken !== 'string' || !auth.refreshToken || typeof auth.uid !== 'string' || !auth.uid || typeof auth.email !== 'string' || !auth.email || !Number.isFinite(auth.expiresAt) || auth.expiresAt <= Date.now()) return reject('Sign-in returned an incomplete session', 502, 'AUTH_INVALID');
      const e = await encryptLogin({ accessToken: auth.accessToken, refreshToken: auth.refreshToken, uid: auth.uid, email: auth.email, expiresAt: auth.expiresAt }, row.public_key, input.browserId);
      const saved = await db.prepare('UPDATE browser_logins SET envelope = ? WHERE browser_id = ? AND envelope IS NULL AND expires_at > ? RETURNING browser_id').bind(JSON.stringify(e), input.browserId, Date.now()).first();
      if (!saved) return reject('This login link has expired or was already used', 410, 'AUTH_INVALID');
      return json({ ok: true, data: { status: 'ready' } });
    }
    if (!validToken(input.deviceToken)) return reject('Invalid login request');
    const deviceHash = await hash(input.deviceToken);
    if (action === 'cancel') {
      await db.prepare('DELETE FROM browser_logins WHERE device_hash = ?').bind(deviceHash).run();
      return json({ ok: true, data: { status: 'cancelled' } });
    }
    // DELETE ... RETURNING consumes the ciphertext atomically; concurrent
    // pollers cannot receive the same session twice.
    const ready = await db.prepare('DELETE FROM browser_logins WHERE device_hash = ? AND envelope IS NOT NULL AND expires_at > ? RETURNING envelope').bind(deviceHash, Date.now()).first();
    if (ready) return json({ ok: true, data: { status: 'ready', envelope: JSON.parse(ready.envelope) } });
    const pending = await db.prepare('SELECT expires_at FROM browser_logins WHERE device_hash = ?').bind(deviceHash).first();
    if (!pending) return reject('Login expired or already completed; start again', 410, 'AUTH_INVALID');
    return json({ ok: true, data: { status: 'pending' } });
  } catch {
    // Never surface request bodies, provider responses, or database errors.
    return reject('Browser login is temporarily unavailable', 503, 'API_REQUEST_FAILED');
  }
}
