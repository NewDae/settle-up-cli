import { encryptLogin } from './browser-crypto.mjs';

// Every Google Web API key, including Firebase's, has this shape.
export const FIREBASE_WEB_API_KEY = /^AIza[0-9A-Za-z_-]{35}$/;

const failure = (message, field) => Object.assign(new Error(message), { field });
function firebaseFailure(data, status) {
  // Use only known codes to select our own copy. Never display provider text,
  // metadata, email addresses, keys, or tokens from an error response.
  const message = data?.error?.message;
  const code = typeof message === 'string' ? message.split(':', 1)[0].trim() : '';
  const reasons = Array.isArray(data?.error?.details) ? data.error.details.map(detail => detail?.reason) : [];
  const has = (...codes) => codes.includes(code) || reasons.some(reason => codes.includes(reason));
  if (has('API_KEY_INVALID', 'INVALID_API_KEY', 'API_KEY_EXPIRED', 'API_KEY_NOT_FOUND') || /^API key not valid/i.test(code)) {
    return failure('That API key wasn’t accepted. Check that you copied the Settle Up key in full.', 'api-key');
  }
  if (has('API_KEY_SERVICE_BLOCKED', 'API_KEY_HTTP_REFERRER_BLOCKED', 'API_KEY_IP_ADDRESS_BLOCKED', 'API_KEY_ANDROID_APP_BLOCKED', 'API_KEY_IOS_APP_BLOCKED')) {
    return failure('This API key can’t be used to sign in from here. Check that it’s the Settle Up key.', 'api-key');
  }
  if (has('OPERATION_NOT_ALLOWED', 'CONFIGURATION_NOT_FOUND', 'PROJECT_NOT_FOUND', 'SERVICE_DISABLED')) {
    return failure('This API key is for a different service. Check that it’s the Settle Up key.', 'api-key');
  }
  if (has('INVALID_EMAIL')) return failure('That email address isn’t valid. Check it and try again.', 'email');
  // Unknown email and wrong password share one message so it can't reveal
  // whether an account exists.
  if (has('INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD', 'EMAIL_NOT_FOUND')) {
    return failure('Sign-in failed. Check your email and password, and that the API key is the Settle Up key. Use Google or Apple to sign in? Switch your account to email/password first.', 'credentials');
  }
  if (has('USER_DISABLED')) return failure('This Settle Up account has been disabled. Contact Settle Up support to restore it.');
  if (status === 429 || has('TOO_MANY_ATTEMPTS_TRY_LATER', 'QUOTA_EXCEEDED', 'RATE_LIMIT_EXCEEDED')) {
    return failure('Too many sign-in attempts. Wait a few minutes, then try again.');
  }
  if (status >= 500) return failure('Sign-in is temporarily unavailable. Try again in a few minutes.');
  return failure('Sign-in didn’t work. Please try again.');
}

// Only Firebase receives the API key, email, and password. The caller gets
// ciphertext for the CLI, never a readable session to send to the relay.
export async function createFirebaseHandoff({ apiKey, email, password, publicKey, browserId }, fetchImpl = fetch) {
  if (typeof apiKey !== 'string' || !FIREBASE_WEB_API_KEY.test(apiKey)) {
    throw failure('That doesn’t look like the API key. It should start with “AIza” (capital I) and be 39 characters long.', 'api-key');
  }
  if (typeof email !== 'string' || !email || email.length > 254) throw failure('Enter your Settle Up email address.', 'email');
  if (typeof password !== 'string' || !password || password.length > 4096) throw failure('Enter your Settle Up password.', 'password');
  let response;
  try {
    response = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new Error('Couldn’t reach the sign-in service. Check your connection and try again.'); }
  let data;
  try { data = await response.json(); } catch { if (response.ok) throw new Error('Sign-in returned an unexpected response. Please try again.'); }
  if (!response.ok) throw firebaseFailure(data, response.status);
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
