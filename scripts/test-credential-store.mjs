import assert from 'node:assert/strict';
import fs from 'node:fs';
import { authHarness, session } from '../test/helpers/auth-session-harness.mjs';

const h = authHarness({ native: true });
const unavailable = process.argv.includes('--unavailable');
const success = result => assert.equal(result.status, 0, JSON.stringify(result.output));
try {
  if (unavailable) {
    const changes = { DBUS_SESSION_BUS_ADDRESS: `unix:path=${h.directory}/missing-bus` };
    const result = h.run(['auth', 'status'], { changes });
    assert.equal(result.output.error.code, 'AUTH_STORAGE_FAILED');
    assert.equal(fs.existsSync(h.configDir), false);
    success(h.login({ changes: { ...changes, SETTLEUP_AUTH_STORAGE: 'file' } }));
    success(h.run(['auth', 'logout'], { changes: { ...changes, SETTLEUP_AUTH_STORAGE: 'file' } }));
    console.log('PASS: unavailable OS store fails clearly; explicit file mode works.');
  } else {
    success(h.login({ changes: { CREDENTIAL_TEST_EXPIRED: '1' } }));
    assert.equal(fs.existsSync(h.configDir), false);
    let result = h.run(['auth', 'status']); success(result);
    assert.equal(result.output.data.storage, 'keyring'); assert.equal(result.output.data.authenticated, true);
    success(h.run(['users', 'me']));
    // Refresh goes directly to Firebase with the key saved alongside the session.
    assert.deepEqual(h.requests().find(r => r.path === '/v1/token').body, { grant_type: 'refresh_token', refresh_token: 'dummy-refresh' });
    assert.equal(h.requests().some(r => r.path.startsWith('/auth/')), false);
    assert.equal(h.run(['auth', 'status'], { changes: { SETTLEUP_ENV: 'other' } }).output.data.authenticated, false);
    success(h.run(['auth', 'logout']));
    success(h.run(['auth', 'logout']));
    result = h.run(['auth', 'status']); success(result); assert.equal(result.output.data.authenticated, false);
    success(h.login({ changes: { CREDENTIAL_TEST_LARGE: '1' } }));
    result = h.run(['auth', 'status']); success(result); assert.equal(result.output.data.authenticated, true);
    success(h.run(['users', 'me']));
    success(h.run(['auth', 'logout']));
    const legacy = h.legacy(session);
    result = h.run(['auth', 'status']); success(result); assert.equal(result.output.data.authenticated, true);
    assert.equal(fs.existsSync(legacy), false);
    console.log(`PASS: ${process.platform} native OS-store login, cross-process read, refresh, logout, isolation, realistic-sized session, and migration (dummy tokens; no network).`);
  }
} finally {
  // Remove only the uniquely scoped dummy credential; never use the real profile.
  if (!unavailable) {
    const cleanup = h.run(['auth', 'logout']);
    if (cleanup.status !== 0) {
      console.error(`Dummy credential cleanup failed; test config retained at ${h.configDir}`);
      process.exitCode = 1;
    } else h.cleanup();
  } else h.cleanup();
}
