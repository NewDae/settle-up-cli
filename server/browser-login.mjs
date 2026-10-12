const PROTOCOL_VERSION = 2;
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
// keys, and hashed poll credentials. Firebase verification and session
// encryption happen in the browser; this service never receives credentials.
export async function handleBrowserLogin(request, env) {
  const url = new URL(request.url);
  const action = url.pathname.split('/').pop();
  if (!['start', 'context', 'complete', 'poll', 'cancel'].includes(action)) return reject('Unknown login endpoint', 404);
  if (request.method !== 'POST') return reject('Method not allowed', 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return reject('Cross-origin login is not allowed', 403);
  if (['context', 'complete'].includes(action) && origin !== url.origin) return reject('Open the login page to continue', 403);
  if (!env.LOGIN_DB) return reject('Browser login is not configured', 503, 'API_REQUEST_FAILED');
  let input;
  try { input = await body(request); } catch { return reject('Invalid login request'); }
  const fields = { start: ['publicKey', 'protocolVersion'], context: ['browserId'], complete: ['browserId', 'envelope'], poll: ['deviceToken'], cancel: ['deviceToken'] }[action];
  if (Object.keys(input).some(key => !fields.includes(key))) return reject('Unexpected login field');
  const db = env.LOGIN_DB;
  const now = Date.now();
  try {
    await db.prepare('DELETE FROM browser_logins WHERE expires_at <= ?').bind(now).run();
    if (action === 'start') {
      if (input.protocolVersion !== PROTOCOL_VERSION) return reject('Update settle-up-cli to 0.4.0 or newer to sign in', 400);
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
      return json({ ok: true, data: { browserId, deviceToken, expiresAt, interval: 3, protocolVersion: PROTOCOL_VERSION } });
    }
    if (['context', 'complete'].includes(action)) {
      if (!validToken(input.browserId)) return reject('Invalid login link');
      const row = await db.prepare('SELECT public_key, expires_at, envelope FROM browser_logins WHERE browser_id = ?').bind(input.browserId).first();
      if (!row || row.envelope) return reject('This login link has expired or was already used', 410, 'AUTH_INVALID');
      if (action === 'context') return json({ ok: true, data: { publicKey: row.public_key, expiresAt: row.expires_at, protocolVersion: PROTOCOL_VERSION } });
      const e = input.envelope;
      if (!e || typeof e !== 'object' || Array.isArray(e)
          || Object.keys(e).some(key => !['publicKey', 'iv', 'ciphertext'].includes(key))
          || !publicKey(e.publicKey) || typeof e.iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(e.iv)
          || typeof e.ciphertext !== 'string' || e.ciphertext.length < 24 || e.ciphertext.length > 12_288
          || e.ciphertext.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(e.ciphertext)) return reject('Invalid encrypted session');
      try { await crypto.subtle.importKey('raw', Uint8Array.from(atob(e.publicKey), c => c.charCodeAt(0)), { name: 'ECDH', namedCurve: 'P-256' }, false, []); } catch { return reject('Invalid encrypted session'); }
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
