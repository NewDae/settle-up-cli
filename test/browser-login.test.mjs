import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { handleBrowserLogin } from '../server/browser-login.mjs';
import { createLoginKey, encryptLogin, decryptLogin } from '../bin/lib/browser-crypto.mjs';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(new URL('../migrations/0001_browser_login.sql', import.meta.url), 'utf8'));
  const db = { prepare(sql) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async run() { return sqlite.prepare(sql).run(...values); },
    };
  } };
  return { db, sqlite };
}
function harness() {
  const { db, sqlite } = database();
  const requests = [];
  let authResponse = session();
  const env = { LOGIN_DB: db, AUTH_SERVICE: { async fetch(request) {
    const input = await request.json();
    requests.push({ path: new URL(request.url).pathname, method: request.method, input });
    if (input.password !== 'test-password') return Response.json({ ok: false }, { status: 401 });
    return Response.json({ ok: true, data: authResponse });
  } } };
  return { sqlite, env, requests, setSession(value) { authResponse = value; }, async call(action, body, { origin = 'https://login.test', method = 'POST', ip = '192.0.2.1' } = {}) {
    const response = await handleBrowserLogin(new Request(`https://login.test/api/login/${action}`, {
      method, headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), 'cf-connecting-ip': ip },
      ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}),
    }), env);
    return { status: response.status, body: await response.json(), headers: response.headers };
  } };
}
const session = () => ({ accessToken: 'private-access-token', refreshToken: 'private-refresh-token', uid: 'test-user', email: 'person@example.invalid', expiresAt: Date.now() + 3_600_000 });

test('encrypted handoff binds the browser link and decrypts only with the originating CLI key', async () => {
  const keys = await createLoginKey();
  const other = await createLoginKey();
  const value = session();
  const encrypted = await encryptLogin(value, keys.publicKey, 'link-1');
  assert.deepEqual(await decryptLogin(encrypted, keys.privateKey, 'link-1'), value);
  await assert.rejects(decryptLogin(encrypted, other.privateKey, 'link-1'));
  await assert.rejects(decryptLogin(encrypted, keys.privateKey, 'different-link'));
  const changed = { ...encrypted, iv: encrypted.iv === 'AAAAAAAAAAAAAAAA' ? 'BBBBBBBBBBBBBBBB' : 'AAAAAAAAAAAAAAAA' };
  await assert.rejects(decryptLogin(changed, keys.privateKey, 'link-1'));
});

test('database holds ciphertext and hashed poll credential; completion and polling are one-use', async t => {
  const h = harness(); t.after(() => h.sqlite.close());
  const keys = await createLoginKey();
  const started = await h.call('start', { publicKey: keys.publicKey }, { origin: null });
  assert.equal(started.status, 200);
  assert.equal(started.headers.get('cache-control'), 'no-store');
  const { browserId, deviceToken } = started.body.data;
  const context = await h.call('context', { browserId });
  assert.equal(context.body.data.publicKey, keys.publicKey);
  assert.deepEqual(Object.keys(context.body.data).sort(), ['expiresAt', 'publicKey']);
  assert.equal((await h.call('poll', { deviceToken }, { origin: null })).body.data.status, 'pending');
  assert.equal((await h.call('poll', { deviceToken: browserId })).status, 410);
  const value = session();
  h.setSession(value);
  const credentials = { browserId, email: value.email, password: 'test-password' };
  assert.equal((await h.call('complete', credentials)).status, 200);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].path, '/auth/login');
  assert.deepEqual(h.requests[0].input, { email: credentials.email, password: credentials.password });
  const envelope = JSON.parse(h.sqlite.prepare('SELECT envelope FROM browser_logins').get().envelope);
  assert.deepEqual(await decryptLogin(envelope, keys.privateKey, browserId), value);
  assert.equal((await h.call('complete', credentials)).status, 410);
  const stored = JSON.stringify(h.sqlite.prepare('SELECT * FROM browser_logins').all());
  for (const secret of [deviceToken, 'private-access-token', 'private-refresh-token', 'person@example.invalid', 'test-password']) assert.ok(!stored.includes(secret));
  const results = await Promise.all([h.call('poll', { deviceToken }), h.call('poll', { deviceToken })]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 410]);
  assert.deepEqual(results.find(result => result.status === 200).body.data.envelope, envelope);
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM browser_logins').get().n, 0);
});

test('expiry, cancellation, rate limiting, and missing configuration fail safely', async t => {
  const h = harness(); t.after(() => h.sqlite.close());
  const keys = await createLoginKey();
  const start = async () => (await h.call('start', { publicKey: keys.publicKey })).body.data;
  const expired = await start();
  h.sqlite.prepare('UPDATE browser_logins SET expires_at = 0').run();
  assert.equal((await h.call('context', { browserId: expired.browserId })).status, 410);
  assert.equal((await h.call('poll', { deviceToken: expired.deviceToken })).status, 410);
  const cancelled = await start();
  assert.equal((await h.call('cancel', { deviceToken: cancelled.deviceToken })).status, 200);
  assert.equal((await h.call('context', { browserId: cancelled.browserId })).status, 410);
  for (let i = 0; i < 8; i++) assert.equal((await h.call('start', { publicKey: keys.publicKey })).status, 200);
  assert.equal((await h.call('start', { publicKey: keys.publicKey })).status, 429);
  const response = await handleBrowserLogin(new Request('https://login.test/api/login/start', { method: 'POST' }), {});
  assert.equal(response.status, 503);
});

test('reject cross-origin requests, credentials on pairing endpoints, missing browser origin, malformed keys, and oversized bodies', async t => {
  const h = harness(); t.after(() => h.sqlite.close());
  const keys = await createLoginKey();
  assert.equal((await h.call('start', { publicKey: keys.publicKey }, { origin: 'https://attacker.test' })).status, 403);
  assert.equal((await h.call('context', { browserId: 'a'.repeat(64) }, { origin: null })).status, 403);
  assert.equal((await h.call('start', { publicKey: keys.publicKey, password: 'never-accepted' })).status, 400);
  assert.equal((await h.call('start', { publicKey: 'invalid' })).status, 400);
  assert.equal((await h.call('start', { publicKey: keys.publicKey, junk: 'a'.repeat(20_000) })).status, 400);
  assert.equal((await h.call('start', {}, { method: 'GET' })).status, 405);
});

test('hosted auth failures expose no provider details, passwords, tokens, or API keys and allow retry', async t => {
  const h = harness(); t.after(() => h.sqlite.close());
  const keys = await createLoginKey();
  const { browserId } = (await h.call('start', { publicKey: keys.publicKey })).body.data;
  const invalid = await h.call('complete', { browserId, email: 'person@example.invalid', password: 'wrong-password' });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.body.error.code, 'AUTH_INVALID');
  assert.ok(!JSON.stringify(invalid.body).includes('wrong-password'));
  assert.equal((await h.call('context', { browserId })).status, 200);
  const service = h.env.AUTH_SERVICE;
  for (const providerStatus of [429, 500]) {
    h.env.AUTH_SERVICE = { fetch: async () => Response.json({ secret: 'provider-secret' }, { status: providerStatus }) };
    const result = await h.call('complete', { browserId, email: 'person@example.invalid', password: 'test-password' });
    assert.equal(result.status, providerStatus === 429 ? 429 : 503);
    assert.ok(!JSON.stringify(result.body).includes('provider-secret'));
  }
  h.env.AUTH_SERVICE = service;
  assert.deepEqual((await h.call('complete', { browserId, email: 'person@example.invalid', password: 'test-password' })).body, { ok: true, data: { status: 'ready' } });
});

async function cliHarness(t) {
  const h = harness();
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await handleBrowserLogin(new Request(`http://127.0.0.1:${server.address().port}${req.url}`, {
      method: req.method, headers: req.headers, body: Buffer.concat(chunks),
    }), h.env);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'settleup-browser-test-'));
  const hook = path.join(directory, 'fetch.mjs');
  fs.writeFileSync(hook, `
const original = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).startsWith('${base}/')) return original(url, options);
  if (String(url).startsWith('https://db.test/users/test-user.json')) return Response.json({ name: 'Test user' });
  if (String(url) === 'https://hosted.test/auth/refresh') {
    if (JSON.parse(options.body).refreshToken !== 'private-refresh-token') throw new Error('Incorrect refresh body');
    return Response.json({ ok: true, data: { accessToken: 'new-access-token', refreshToken: 'new-refresh-token', uid: 'test-user', expiresAt: Date.now() + 3600000 } });
  }
  throw new Error('Unexpected network request');
};
`);
  t.after(async () => { await new Promise(resolve => server.close(resolve)); h.sqlite.close(); fs.rmSync(directory, { force: true, recursive: true }); });
  const config = path.join(directory, 'config');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SETTLEUP_') && key !== 'NODE_OPTIONS'));
  return { ...h, base, config, async run(args, changes = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', pathToFileURL(hook).href, fileURLToPath(new URL('../bin/settleup.mjs', import.meta.url)), ...args], {
        cwd: directory, env: { ...env, SETTLEUP_ENV: 'test', SETTLEUP_API_BASE_URL: 'https://db.test', SETTLEUP_AUTH_BASE_URL: 'https://hosted.test', SETTLEUP_LOGIN_BASE_URL: base, SETTLEUP_AUTH_STORAGE: 'file', SETTLEUP_CLI_CONFIG_DIR: config, ...changes },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', text => { stdout += text; }); child.stderr.on('data', text => { stderr += text; });
      const timer = setTimeout(() => { child.kill(); reject(new Error('CLI timed out')); }, 20_000);
      child.on('error', reject); child.on('close', code => { clearTimeout(timer); try { resolve({ code, output: JSON.parse(stdout), stdout, stderr }); } catch (error) { reject(error); } });
    });
  }, async browser(action, data) {
    const response = await fetch(`${base}/api/login/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  } };
}

test('real CLI start, pending, encrypted completion, status, hosted Worker refresh, and logout', async t => {
  const h = await cliHarness(t);
  const started = await h.run(['auth', 'login', '--browser']);
  assert.equal(started.code, 0, started.stdout);
  assert.equal(started.output.data.status, 'pending');
  const browserId = new URL(started.output.data.loginUrl).hash.slice(1);
  const files = fs.readdirSync(path.join(h.config, 'test'));
  const pendingPath = path.join(h.config, 'test', files.find(name => name.startsWith('browser-login-')));
  const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
  assert.ok(!started.stdout.includes(pending.deviceToken));
  assert.ok(!started.stdout.includes(pending.privateKey.d));
  if (process.platform !== 'win32') assert.equal(fs.statSync(pendingPath).mode & 0o777, 0o600);
  assert.equal((await h.run(['auth', 'login', '--complete'])).output.data.status, 'pending');
  assert.equal((await h.run(['auth', 'login', '--browser'])).output.error.code, 'INVALID_INPUT');
  const context = (await h.browser('context', { browserId })).body.data;
  assert.ok(context.expiresAt > Date.now());
  const value = session();
  // Expiring soon forces the very next authenticated command to refresh.
  value.expiresAt = Date.now() + 50_000;
  h.setSession(value);
  assert.equal((await h.browser('complete', { browserId, email: value.email, password: 'test-password' })).status, 200);
  const completed = await h.run(['auth', 'login', '--complete']);
  assert.equal(completed.code, 0, completed.stdout);
  assert.equal(completed.output.data.email, value.email);
  assert.ok(!completed.stdout.includes(value.accessToken));
  assert.ok(!completed.stdout.includes(value.refreshToken));
  assert.equal(fs.existsSync(pendingPath), false);
  assert.equal((await h.run(['auth', 'status'])).output.data.authenticated, true);
  assert.equal((await h.run(['users', 'me'])).code, 0);
  const saved = fs.readdirSync(path.join(h.config, 'test')).find(name => name.startsWith('auth-'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.config, 'test', saved))).accessToken, 'new-access-token');
  assert.equal((await h.run(['auth', 'logout'])).code, 0);
  assert.equal((await h.run(['auth', 'status'])).output.data.authenticated, false);
  assert.equal((await h.run(['auth', 'login', '--complete'])).output.error.code, 'AUTH_REQUIRED');
});

test('CLI blocks unsafe config and conflicting flags; logout cancels the browser link', async t => {
  const h = await cliHarness(t);
  for (const args of [['--browser', '--complete'], ['--wait']]) assert.equal((await h.run(['auth', 'login', ...args])).output.error.code, 'INVALID_INPUT');
  assert.equal((await h.run(['auth', 'login', '--browser'], { SETTLEUP_LOGIN_BASE_URL: 'http://unsafe.test' })).output.error.code, 'INVALID_INPUT');
  assert.equal((await h.run(['auth', 'login', '--browser'], { SETTLEUP_LOGIN_BASE_URL: 'not-a-url' })).output.error.code, 'INVALID_INPUT');
  assert.equal((await h.run(['auth', 'login', '--browser'], { SETTLEUP_LOGIN_BASE_URL: '' })).output.error.code, 'INVALID_INPUT');
  const start = await h.run(['auth', 'login', '--browser']);
  const browserId = new URL(start.output.data.loginUrl).hash.slice(1);
  assert.equal((await h.run(['auth', 'logout'])).code, 0);
  assert.equal((await h.browser('context', { browserId })).status, 410);
  assert.deepEqual(fs.readdirSync(path.join(h.config, 'test')), []);
});
