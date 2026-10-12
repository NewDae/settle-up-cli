import { encryptLogin } from './browser-crypto.mjs';

// Every Google Web API key, including Firebase's, has this shape.
export const FIREBASE_WEB_API_KEY = /^AIza[0-9A-Za-z_-]{35}$/;

// Firebase answers 400/403 for both a bad key and bad credentials. Saying
// which is safe for the key (it is not account-specific), never for the account.
const KEY_REJECTED = /API key not valid|API_KEY_INVALID|API_KEY_\w*BLOCKED|are blocked/i;

// Only Firebase receives the API key, email, and password. The caller gets
// ciphertext for the CLI, never a readable session to send to the relay.
export async function createFirebaseHandoff({ apiKey, email, password, publicKey, browserId }, fetchImpl = fetch) {
  if (typeof apiKey !== 'string' || !FIREBASE_WEB_API_KEY.test(apiKey)) {
    throw new Error('That doesn’t look like a Firebase API key. It starts with “AIza” and is 39 characters long.');
  }
  if (typeof email !== 'string' || !email || email.length > 254
      || typeof password !== 'string' || !password || password.length > 4096) {
    throw new Error('Enter your Settle Up email and password.');
  }
  let response;
  try {
    response = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new Error('Couldn’t reach the sign-in service. Check your connection and try again.'); }
  if (response.status === 429) throw new Error('Too many attempts. Wait a few minutes, then try again.');
  if ([400, 401, 403].includes(response.status)) {
    const detail = await response.text().catch(() => '');
    if (KEY_REJECTED.test(detail)) throw new Error('That API key wasn’t accepted. Check that you copied the Settle Up key in full.');
    throw new Error('Sign-in failed. Check your email and password, and that the API key is the Settle Up key.');
  }
  if (!response.ok) throw new Error('Sign-in is temporarily unavailable. Try again in a few minutes.');
  let data;
  try { data = await response.json(); } catch { throw new Error('Sign-in returned an unexpected response. Please try again.'); }
  const expiresIn = Number(data?.expiresIn);
  if (typeof data?.idToken !== 'string' || !data.idToken || typeof data?.refreshToken !== 'string' || !data.refreshToken
      || typeof data?.localId !== 'string' || !data.localId || !Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 86400) {
    throw new Error('Sign-in returned an incomplete session. Please try again.');
  }
  return encryptLogin({
    accessToken: data.idToken, refreshToken: data.refreshToken, uid: data.localId,
    email: typeof data.email === 'string' && data.email ? data.email : email,
    expiresAt: Date.now() + expiresIn * 1000, firebaseApiKey: apiKey,
  }, publicKey, browserId);
}
