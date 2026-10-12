import { encryptLogin } from './browser-crypto.mjs';

// Only Firebase receives the API key, email, and password. The caller gets
// ciphertext for the CLI, never a readable session to send to the relay.
export async function createFirebaseHandoff({ apiKey, email, password, publicKey, browserId }, fetchImpl = fetch) {
  if (typeof apiKey !== 'string' || !/^[A-Za-z0-9_-]{20,256}$/.test(apiKey)
      || typeof email !== 'string' || !email || email.length > 254
      || typeof password !== 'string' || !password || password.length > 4096) {
    throw new Error('Enter your Settle Up Firebase API key, email, and password.');
  }
  let response;
  try {
    response = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new Error('Could not reach Firebase. Please try again.'); }
  if (response.status === 429) throw new Error('Too many attempts. Wait before trying again.');
  if ([400, 401, 403].includes(response.status)) throw new Error('Sign-in failed. Check your Firebase API key, email/password, and account migration.');
  if (!response.ok) throw new Error('Firebase sign-in is temporarily unavailable.');
  let data;
  try { data = await response.json(); } catch { throw new Error('Firebase returned an invalid sign-in response.'); }
  const expiresIn = Number(data?.expiresIn);
  if (typeof data?.idToken !== 'string' || !data.idToken || typeof data?.refreshToken !== 'string' || !data.refreshToken
      || typeof data?.localId !== 'string' || !data.localId || !Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 86400) {
    throw new Error('Firebase returned an incomplete session.');
  }
  return encryptLogin({
    accessToken: data.idToken, refreshToken: data.refreshToken, uid: data.localId,
    email: typeof data.email === 'string' && data.email ? data.email : email,
    expiresAt: Date.now() + expiresIn * 1000, firebaseApiKey: apiKey,
  }, publicKey, browserId);
}
