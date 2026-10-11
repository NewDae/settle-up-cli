import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { authHarness, session } from './helpers/auth-session-harness.mjs';

function setup(t) { const h = authHarness(); t.after(() => h.cleanup()); return h; }
function successful(result) { assert.equal(result.status, 0, JSON.stringify(result.output)); assert.equal(result.output.ok, true); }
function storageFailure(result) {
  assert.equal(result.status, 1); assert.equal(result.output.error.code, 'AUTH_STORAGE_FAILED');
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET-MUST-NOT-LEAK|dummy-refresh/);
  assert.match(result.output.error.details.help, /No automatic fallback/);
}

test('default OS session survives processes, refreshes without password, and logs out', t => {
  const h = setup(t);
  successful(h.login({ changes: { CREDENTIAL_TEST_EXPIRED: '1' } }));
  const saved = JSON.parse(Object.values(h.entries())[0]);
  assert.equal(saved.refreshToken, 'dummy-refresh'); assert.equal('password' in saved, false);
  assert.equal(fs.existsSync(h.configDir), false);
  successful(h.run(['users', 'me']));
  const refreshed = JSON.parse(Object.values(h.entries())[0]);
  assert.equal(refreshed.accessToken, 'dummy-new-access'); assert.equal(refreshed.refreshToken, 'dummy-new-refresh');
  const requests = h.requests();
  assert.deepEqual(requests.find(r => r.path.endsWith('/refresh')).body, { refreshToken: 'dummy-refresh' });
  assert.equal(requests.filter(r => r.path.endsWith('/login')).length, 1);
  const status = h.run(['auth', 'status']); successful(status);
  assert.equal(status.output.data.authenticated, true); assert.equal(status.output.data.storage, 'keyring');
  assert.doesNotMatch(status.stdout, /dummy-new-access|dummy-new-refresh|dummy-password/);
  successful(h.run(['auth', 'logout'])); successful(h.run(['auth', 'logout']));
  assert.equal(h.run(['auth', 'status']).output.data.authenticated, false);
  assert.equal(h.run(['users', 'me']).output.error.code, 'AUTH_REQUIRED');
  assert.deepEqual(h.entries(), {});
});

for (const operation of ['construct', 'read', 'save']) {
  test(`login reports ${operation} failure without plaintext fallback`, t => {
    const h = setup(t);
    storageFailure(h.login({ changes: { CREDENTIAL_TEST_FAIL: operation } }));
    assert.equal(fs.existsSync(h.configDir), false);
    if (operation !== 'save') assert.deepEqual(h.requests(), []);
  });
}

test('logout failure retains session and legacy file; failed deletion is never success', t => {
  const h = setup(t); successful(h.login());
  const legacy = h.legacy();
  storageFailure(h.run(['auth', 'logout'], { changes: { CREDENTIAL_TEST_FAIL: 'delete' } }));
  assert.equal(fs.existsSync(legacy), true);
  storageFailure(h.run(['auth', 'logout'], { changes: { CREDENTIAL_TEST_DELETE_NOOP: '1' } }));
  assert.equal(h.run(['auth', 'status']).output.data.authenticated, true);
  successful(h.run(['auth', 'logout'])); assert.equal(fs.existsSync(legacy), false);
});

test('legacy migration verifies OS storage before removing the plaintext session', t => {
  const h = setup(t); const legacy = h.legacy({ ...session, password: 'must-not-persist' });
  const result = h.run(['auth', 'status']); successful(result);
  assert.equal(result.output.data.authenticated, true); assert.equal(fs.existsSync(legacy), false);
  assert.equal(JSON.parse(Object.values(h.entries())[0]).password, undefined);
  assert.deepEqual(h.requests(), []);
});

for (const changes of [{ CREDENTIAL_TEST_FAIL: 'save' }, { CREDENTIAL_TEST_BAD_READBACK: '1' }, { CREDENTIAL_TEST_FAIL: 'read' }]) {
  test(`migration preserves legacy file when storage fails: ${JSON.stringify(changes)}`, t => {
    const h = setup(t); const legacy = h.legacy(); const before = fs.readFileSync(legacy, 'utf8');
    storageFailure(h.run(['auth', 'status'], { changes }));
    assert.equal(fs.readFileSync(legacy, 'utf8'), before);
    assert.deepEqual(h.requests(), []);
  });
}

test('secure session takes precedence over a stale legacy file', t => {
  const h = setup(t); successful(h.login()); h.legacy({ ...session, uid: 'stale-user' });
  assert.equal(h.run(['auth', 'status']).output.data.uid, 'dummy-user');
});

test('corrupt legacy session reports storage failure and is preserved', t => {
  const h = setup(t); const legacy = h.legacy(); fs.writeFileSync(legacy, '{');
  storageFailure(h.run(['auth', 'status'])); assert.equal(fs.readFileSync(legacy, 'utf8'), '{');
});

test('revoked refresh token stops before database access', t => {
  const h = setup(t); successful(h.login({ changes: { CREDENTIAL_TEST_EXPIRED: '1' } }));
  const before = h.requests().length;
  const result = h.run(['users', 'me'], { changes: { CREDENTIAL_TEST_REFRESH_REJECTED: '1' } });
  assert.equal(result.output.error.code, 'AUTH_REFRESH_FAILED');
  assert.equal(h.requests().length, before + 1);
});

test('refresh storage failures preserve AUTH_STORAGE_FAILED and do not query the database', t => {
  const h = setup(t); successful(h.login({ changes: { CREDENTIAL_TEST_EXPIRED: '1' } }));
  const before = h.requests().length;
  storageFailure(h.run(['users', 'me'], { changes: { CREDENTIAL_TEST_FAIL: 'save' } }));
  assert.equal(h.requests().length, before + 1);
});

test('environment, config directory, and backend each isolate native sessions', t => {
  const h = setup(t); successful(h.login());
  for (const changes of [
    { SETTLEUP_ENV: 'staging' },
    { SETTLEUP_CLI_CONFIG_DIR: path.join(h.directory, 'other-config') },
    { SETTLEUP_API_BASE_URL: 'https://another-test.invalid/db' },
    { SETTLEUP_AUTH_BASE_URL: 'https://another-test.invalid/auth' },
  ]) {
    assert.equal(h.run(['auth', 'status'], { changes }).output.data.authenticated, false);
    successful(h.login({ changes }));
  }
  assert.equal(Object.keys(h.entries()).length, 5);
  successful(h.run(['auth', 'logout'])); assert.equal(Object.keys(h.entries()).length, 4);
});

test('file storage is explicit, isolates backends, and restricts Unix permissions', t => {
  const h = setup(t); const changes = { SETTLEUP_AUTH_STORAGE: 'file', CREDENTIAL_TEST_FAIL: 'construct' };
  successful(h.login({ changes }));
  assert.deepEqual(h.entries(), {});
  const directory = path.join(h.configDir, 'test');
  const files = fs.readdirSync(directory); assert.equal(files.length, 1);
  const filename = path.join(directory, files[0]);
  assert.equal(JSON.parse(fs.readFileSync(filename, 'utf8')).password, undefined);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(h.configDir).mode & 0o777, 0o700);
    fs.chmodSync(filename, 0o644); successful(h.login({ changes }));
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  }
  const other = { ...changes, SETTLEUP_API_BASE_URL: 'https://another-test.invalid/db' };
  assert.equal(h.run(['auth', 'status'], { changes: other }).output.data.authenticated, false);
  successful(h.login({ changes: other })); assert.equal(fs.readdirSync(directory).length, 2);
  successful(h.run(['auth', 'logout'], { changes }));
  assert.equal(h.run(['auth', 'status'], { changes }).output.data.authenticated, false);
  assert.equal(h.run(['auth', 'status'], { changes: other }).output.data.authenticated, true);
});

test('file storage migrates legacy sessions and logout prevents their re-import', t => {
  const h = setup(t); const legacy = h.legacy(); const changes = { SETTLEUP_AUTH_STORAGE: 'file' };
  successful(h.run(['auth', 'status'], { changes })); assert.equal(fs.existsSync(legacy), false);
  successful(h.run(['auth', 'logout'], { changes }));
  assert.equal(h.run(['auth', 'status'], { changes }).output.data.authenticated, false);
});

test('invalid storage selection fails clearly without a network request', t => {
  const h = setup(t);
  const result = h.login({ changes: { SETTLEUP_AUTH_STORAGE: 'plaintext' } });
  assert.equal(result.output.error.code, 'INVALID_INPUT'); assert.deepEqual(h.requests(), []);
});

test('help does not load an unavailable native credential module', t => {
  const h = setup(t); successful(h.run(['--help'], { changes: { CREDENTIAL_TEST_FAIL: 'construct' } }));
});


test('retry completes a migration interrupted after writing the OS session', t => {
  const h = setup(t); const legacy = h.legacy();
  storageFailure(h.run(['auth', 'status'], { changes: { CREDENTIAL_TEST_BAD_READBACK: '1' } }));
  assert.equal(fs.existsSync(legacy), true);
  const result = h.run(['auth', 'status']); successful(result);
  assert.equal(result.output.data.authenticated, true); assert.equal(fs.existsSync(legacy), false);
});

test('file write errors are reported without overwriting the legacy session', t => {
  const h = setup(t); const legacy = h.legacy();
  // A regular file in place of the config directory prevents creating sessions.
  const other = path.join(h.directory, 'blocked-config'); fs.writeFileSync(other, 'blocked');
  const result = h.login({ changes: { SETTLEUP_AUTH_STORAGE: 'file', SETTLEUP_CLI_CONFIG_DIR: other } });
  assert.equal(result.output.error.code, 'AUTH_STORAGE_FAILED');
  assert.equal(fs.existsSync(legacy), true); assert.equal(fs.readFileSync(other, 'utf8'), 'blocked');
});
