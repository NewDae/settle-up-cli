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
  if (!['credential-test.invalid', 'another-test.invalid'].includes(parsed.hostname)) throw new Error('Unexpected network request');
  const body = options.body ? JSON.parse(options.body) : null;
  fs.appendFileSync(process.env.CREDENTIAL_TEST_LOG, JSON.stringify({ path: parsed.pathname, method: options.method || 'GET', body }) + '\n');
  const session = {
    accessToken: process.env.CREDENTIAL_TEST_LARGE ? 'a'.repeat(1800) : 'dummy-access',
    refreshToken: process.env.CREDENTIAL_TEST_LARGE ? 'r'.repeat(300) : 'dummy-refresh', uid: 'dummy-user',
    email: 'dummy@example.invalid', expiresAt: process.env.CREDENTIAL_TEST_EXPIRED ? Date.now() - 1000 : Date.now() + 3_600_000,
  };
  let result;
  let status = 200;
  if (parsed.pathname === '/auth/auth/login') result = { ok: true, data: session };
  else if (parsed.pathname === '/auth/auth/refresh') {
    if (process.env.CREDENTIAL_TEST_REFRESH_REJECTED) {
      result = { ok: false, error: { code: 'AUTH_INVALID', message: 'Dummy session revoked' } }; status = 401;
    } else result = { ok: true, data: { ...session, accessToken: 'dummy-new-access', refreshToken: 'dummy-new-refresh', expiresAt: Date.now() + 3_600_000 } };
  } else if (parsed.pathname === '/db/users/dummy-user.json') result = { email: session.email, name: 'dummy' };
  else throw new Error('Unexpected backend operation');
  return new Response(JSON.stringify(result), { status, headers: { 'content-type': 'application/json' } });
};
