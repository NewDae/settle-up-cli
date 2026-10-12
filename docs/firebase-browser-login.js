import { encryptLogin } from './login-crypto.js';

const failure = (message, field) => Object.assign(new Error(message), { field });
function firebaseFailure(data, status) {
  // Use only known codes to select our own copy. Never display provider text,
  // metadata, email addresses, keys, or tokens from an error response.
  const message = data?.error?.message;
  const code = typeof message === 'string' ? message.split(':', 1)[0].trim() : '';
  const reasons = Array.isArray(data?.error?.details) ? data.error.details.map(detail => detail?.reason) : [];
  const has = (...codes) => codes.includes(code) || reasons.some(reason => codes.includes(reason));
  if (has('API_KEY_INVALID', 'INVALID_API_KEY', 'API_KEY_EXPIRED', 'API_KEY_NOT_FOUND')) {
    return failure('Firebase rejected this API key. Copy the complete Firebase Web API key for Settle Up’s auth project and try again. Changing your password won’t fix an invalid key.', 'api-key');
  }
  if (has('API_KEY_SERVICE_BLOCKED')) {
    return failure('This key does not allow the Firebase Authentication API. Ask the key owner to allow it, or use another key for the same Settle Up auth project.', 'api-key');
  }
  if (has('API_KEY_HTTP_REFERRER_BLOCKED', 'API_KEY_IP_ADDRESS_BLOCKED', 'API_KEY_ANDROID_APP_BLOCKED', 'API_KEY_IOS_APP_BLOCKED')) {
    return failure('This key’s application restrictions block sign-in from this website. Ask the key owner for a browser-compatible key for the same Settle Up auth project.', 'api-key');
  }
  if (has('OPERATION_NOT_ALLOWED')) {
    return failure('Email/password sign-in is disabled for this key’s Firebase project. Use a key for Settle Up’s auth project; if it is already the correct project, ask the key owner to enable email/password sign-in.', 'api-key');
  }
  if (has('CONFIGURATION_NOT_FOUND', 'PROJECT_NOT_FOUND', 'SERVICE_DISABLED')) {
    return failure('Firebase Authentication is not configured or enabled for this key’s project. Use a key for Settle Up’s auth project, or ask the key owner to check its Authentication setup.', 'api-key');
  }
  if (has('INVALID_EMAIL')) return failure('The email address is not valid. Enter your Settle Up email address and try again.', 'email');
  if (has('INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD', 'EMAIL_NOT_FOUND')) {
    return failure('Firebase did not accept this email/password for the project selected by your key. Re-enter your Settle Up details. If they work in Settle Up, check that the key belongs to its auth project. Google/Apple accounts need migration to email/password first.', 'credentials');
  }
  if (has('USER_DISABLED')) return failure('Firebase reports this account is disabled. If you used a Settle Up auth-project key, contact Settle Up support to restore access. Retrying won’t re-enable the account.');
  if (status === 429 || has('TOO_MANY_ATTEMPTS_TRY_LATER', 'QUOTA_EXCEEDED', 'RATE_LIMIT_EXCEEDED')) {
    return failure('Firebase has temporarily limited sign-in attempts. Wait before retrying. If this continues, ask the key owner to check the Authentication quota.');
  }
  if (status >= 500) return failure('Firebase sign-in is temporarily unavailable. Try again in a few minutes.');
  return failure('Firebase rejected the sign-in request without a specific reason. Try again; if it continues, contact the integration maintainer.');
}

// Only Firebase receives the API key, email, and password. The caller gets
// ciphertext for the CLI, never a readable session to send to the relay.
export async function createFirebaseHandoff({ apiKey, email, password, publicKey, browserId }, fetchImpl = fetch) {
  if (typeof apiKey !== 'string' || !/^[A-Za-z0-9_-]{20,256}$/.test(apiKey)) throw failure('Enter the complete Firebase Web API key for Settle Up’s auth project, without spaces or quotes.', 'api-key');
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
  } catch { throw new Error('Could not reach Firebase. Check your internet connection and try again. If it continues, contact the integration maintainer to check browser access.'); }
  let data;
  try { data = await response.json(); } catch { if (response.ok) throw new Error('Firebase returned an invalid sign-in response. Try again; if it continues, contact the integration maintainer.'); }
  if (!response.ok) throw firebaseFailure(data, response.status);
  const expiresIn = Number(data?.expiresIn);
  if (typeof data?.idToken !== 'string' || !data.idToken || typeof data?.refreshToken !== 'string' || !data.refreshToken
      || typeof data?.localId !== 'string' || !data.localId || !Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 86400) {
    throw new Error('Firebase returned an incomplete session. Try again; if it continues, contact the integration maintainer.');
  }
  return encryptLogin({
    accessToken: data.idToken, refreshToken: data.refreshToken, uid: data.localId,
    email: typeof data.email === 'string' && data.email ? data.email : email,
    expiresAt: Date.now() + expiresIn * 1000, firebaseApiKey: apiKey,
  }, publicKey, browserId);
}
