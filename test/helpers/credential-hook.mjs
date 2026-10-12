import { registerHooks } from 'node:module';
import fs from 'node:fs';

if (process.env.CREDENTIAL_TEST_NATIVE !== '1') {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@napi-rs/keyring') return { url: new URL('./credential-stub.mjs', import.meta.url).href, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
}

globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  // Dummy HTTPS endpoints only; never use the network, including in native tests.
  // Firebase URLs are answered here and never leave the process.
  if (!['credential-test.invalid', 'another-test.invalid', 'identitytoolkit.googleapis.com', 'securetoken.googleapis.com'].includes(parsed.hostname)) throw new Error('Unexpected network request');
  const body = !options.body ? null
    : options.body instanceof URLSearchParams ? Object.fromEntries(options.body) : JSON.parse(options.body);
  fs.appendFileSync(process.env.CREDENTIAL_TEST_LOG, JSON.stringify({ path: parsed.pathname, method: options.method || 'GET', body }) + '\n');
  const session = {
    accessToken: process.env.CREDENTIAL_TEST_LARGE ? 'a'.repeat(1800) : 'dummy-access',
    refreshToken: process.env.CREDENTIAL_TEST_LARGE ? 'r'.repeat(300) : 'dummy-refresh', uid: 'dummy-user',
    email: 'dummy@example.invalid', expiresAt: process.env.CREDENTIAL_TEST_EXPIRED ? Date.now() - 1000 : Date.now() + 3_600_000,
  };
  let result;
  let status = 200;
  const expiresIn = String(Math.round((session.expiresAt - Date.now()) / 1000));
  if (parsed.pathname === '/v1/accounts:signInWithPassword') {
    result = { idToken: session.accessToken, refreshToken: session.refreshToken, localId: session.uid, email: session.email, expiresIn };
  } else if (parsed.pathname === '/v1/token') {
    if (process.env.CREDENTIAL_TEST_REFRESH_REJECTED) {
      result = { error: { code: 400, message: 'TOKEN_EXPIRED' } }; status = 400;
    } else result = { id_token: 'dummy-new-access', refresh_token: 'dummy-new-refresh', user_id: session.uid, expires_in: '3600' };
  } else if (parsed.pathname === '/db/users/dummy-user.json') result = { email: session.email, name: 'dummy' };
  else throw new Error('Unexpected backend operation');
  return new Response(JSON.stringify(result), { status, headers: { 'content-type': 'application/json' } });
};
