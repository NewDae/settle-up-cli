import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createFirebaseHandoff } from '../bin/lib/firebase-browser-login.mjs';
import { createLoginKey, decryptLogin } from '../bin/lib/browser-crypto.mjs';

const apiKey = 'test-firebase-api-key-12345';
const email = 'person@example.invalid';
const password = 'private-test-password';
const browserId = 'a'.repeat(64);
const providerSession = () => ({ idToken: 'private-access-token', refreshToken: 'private-refresh-token', localId: 'test-user', email, expiresIn: '3600' });

test('browser authenticates only with Firebase and encrypts tokens and refresh key for the CLI', async () => {
  const keys = await createLoginKey();
  const calls = [];
  const envelope = await createFirebaseHandoff({ apiKey, email, password, publicKey: keys.publicKey, browserId }, async (url, options) => {
    calls.push({ url, options }); return Response.json(providerSession());
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { email, password, returnSecureToken: true });
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  const session = await decryptLogin(envelope, keys.privateKey, browserId);
  assert.equal(session.firebaseApiKey, apiKey);
  assert.equal(session.refreshToken, providerSession().refreshToken);
  assert.equal(session.uid, 'test-user');
  assert.equal(session.email, email);
  assert.equal(session.password, undefined);
  for (const secret of [apiKey, email, password, session.accessToken, session.refreshToken]) assert.ok(!JSON.stringify(envelope).includes(secret));
});

test('Firebase failures and malformed success responses do not expose provider details or credentials', async () => {
  const keys = await createLoginKey();
  const input = { apiKey, email, password, publicKey: keys.publicKey, browserId };
  const secret = `${apiKey} ${password} private-refresh-token EMAIL_NOT_FOUND`;
  for (const status of [400, 401, 403, 429, 500]) {
    await assert.rejects(createFirebaseHandoff(input, async () => Response.json({ error: { message: secret } }, { status })), error => {
      for (const word of [apiKey, password, 'private-refresh-token', 'EMAIL_NOT_FOUND']) assert.ok(!error.message.includes(word));
      return true;
    });
  }
  await assert.rejects(createFirebaseHandoff(input, async () => { throw new Error(secret); }), /Could not reach Firebase/);
  await assert.rejects(createFirebaseHandoff(input, async () => new Response(secret)), /invalid sign-in response/);
  for (const value of [null, {}, { ...providerSession(), refreshToken: '' }, { ...providerSession(), expiresIn: '-1' }, { ...providerSession(), expiresIn: 'Infinity' }]) {
    await assert.rejects(createFirebaseHandoff(input, async () => Response.json(value)), /incomplete session/);
  }
  await assert.rejects(createFirebaseHandoff({ ...input, apiKey: '' }, async () => { throw new Error('Must not send'); }), /Enter the complete Firebase Web API key/);
});

test('Firebase error categories explain the problem and next step without displaying raw provider text', async () => {
  const keys = await createLoginKey();
  const input = { apiKey, email, password, publicKey: keys.publicKey, browserId };
  const cases = [
    ['API_KEY_INVALID', 400, /rejected this API key.*Copy the complete/s, 'api-key'],
    ['INVALID_API_KEY', 400, /rejected this API key/, 'api-key'],
    ['API_KEY_SERVICE_BLOCKED', 403, /does not allow.*Ask the key owner/s, 'api-key'],
    ['API_KEY_HTTP_REFERRER_BLOCKED', 403, /restrictions block.*browser-compatible key/s, 'api-key'],
    ['OPERATION_NOT_ALLOWED', 400, /Email\/password sign-in is disabled.*key owner/s, 'api-key'],
    ['CONFIGURATION_NOT_FOUND', 400, /not configured or enabled.*key owner/s, 'api-key'],
    ['INVALID_EMAIL', 400, /email address is not valid.*Enter your Settle Up/s, 'email'],
    ['USER_DISABLED', 400, /account is disabled.*contact Settle Up support/s, undefined],
    ['TOO_MANY_ATTEMPTS_TRY_LATER', 400, /temporarily limited.*Wait before retrying/s, undefined],
  ];
  for (const [code, status, expected, field] of cases) {
    for (const error of [{ message: `${code} : ${password}` }, { message: password, details: [{ reason: code, metadata: { key: apiKey } }] }]) {
      await assert.rejects(createFirebaseHandoff(input, async () => Response.json({ error }, { status })), failure => {
        assert.match(failure.message, expected);
        assert.equal(failure.field, field);
        assert.ok(!failure.message.includes(apiKey)); assert.ok(!failure.message.includes(password));
        return true;
      });
    }
  }
  const accountMessages = [];
  for (const code of ['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD']) {
    await assert.rejects(createFirebaseHandoff(input, async () => Response.json({ error: { message: code } }, { status: 400 })), failure => {
      assert.match(failure.message, /did not accept this email\/password.*Re-enter.*auth project/s);
      assert.equal(failure.field, 'credentials'); accountMessages.push(failure.message); return true;
    });
  }
  assert.equal(new Set(accountMessages).size, 1);
});

test('actual login-page controller sends credentials to Firebase and only ciphertext to its backend', async () => {
  const keys = await createLoginKey();
  const calls = [];
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: true, dataset: {}, textContent: '', disabled: false,
      addEventListener(name, handler) { this[name] = handler; }, setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; }, focus() { this.focused = true; } });
    return elements.get(id);
  };
  let rejectKey = true;
  const fetchImpl = async (url, options) => {
    calls.push({ url, data: JSON.parse(options.body) });
    if (url === '/api/login/context') return Response.json({ ok: true, data: { publicKey: keys.publicKey, expiresAt: Date.now() + 600_000, protocolVersion: 2 } });
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) return rejectKey ? Response.json({error:{details:[{reason:'API_KEY_INVALID'}]}},{status:400}) : Response.json(providerSession());
    if (url === '/api/login/complete') return Response.json({ ok: true, data: { status: 'ready' } });
    throw new Error('Unexpected destination');
  };
  const source = fs.readFileSync(new URL('../docs/login.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/m, '');
  vm.runInNewContext(source, {
    document: { getElementById: element }, location: { hash: `#${browserId}.${encodeURIComponent(keys.publicKey)}`, pathname: '/login' },
    history: { replaceState() {} }, window: { setTimeout() {}, addEventListener() {} }, AbortSignal, Date, fetch: fetchImpl,
    createFirebaseHandoff: input => createFirebaseHandoff(input, fetchImpl),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('login-form').hidden, false);
  element('api-key').value = apiKey; element('email').value = email; element('password').value = password;
  await element('login-form').submit({ preventDefault() {} });
  assert.match(element('status').textContent, /Firebase rejected this API key/);
  assert.equal(element('api-key')['aria-invalid'], 'true');
  assert.equal(element('api-key').focused, true);
  assert.equal(element('password').value, '');
  assert.ok(!calls.some(call => call.url === '/api/login/complete'));
  rejectKey = false; element('password').value = password;
  await element('login-form').submit({ preventDefault() {} });
  assert.equal(element('api-key')['aria-invalid'], undefined);
  assert.deepEqual(calls.map(call => call.url), ['/api/login/context', `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, '/api/login/complete']);
  const handoff = calls.at(-1).data;
  assert.deepEqual(Object.keys(handoff).sort(), ['browserId', 'envelope']);
  for (const secret of [apiKey, email, password, 'private-access-token', 'private-refresh-token']) assert.ok(!JSON.stringify(handoff).includes(secret));
  assert.equal((await decryptLogin(handoff.envelope, keys.privateKey, browserId)).firebaseApiKey, apiKey);
  assert.equal(element('success').hidden, false);
  assert.equal(element('password').value, '');
  assert.equal(element('api-key').value, '');
});

test('login page rejects a relay that substitutes the CLI public key before collecting credentials', async () => {
  const keys = await createLoginKey();
  const substituted = await createLoginKey();
  const elements = {};
  const getElementById = id => elements[id] ||= { hidden: true, dataset: {}, textContent: '', addEventListener() {} };
  const source = fs.readFileSync(new URL('../docs/login.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/m, '');
  vm.runInNewContext(source, {
    document: { getElementById }, location: { hash: `#${browserId}.${encodeURIComponent(keys.publicKey)}`, pathname: '/login' },
    history: { replaceState() {} }, window: { setTimeout() {}, addEventListener() {} }, AbortSignal, Date,
    fetch: async url => {
      assert.equal(url, '/api/login/context');
      return Response.json({ ok: true, data: { publicKey: substituted.publicKey, expiresAt: Date.now() + 600_000, protocolVersion: 2 } });
    },
    createFirebaseHandoff: () => { throw new Error('Must not authenticate'); },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(getElementById('login-form').hidden, true);
  assert.match(elements.status.textContent, /does not match your CLI/);
});
