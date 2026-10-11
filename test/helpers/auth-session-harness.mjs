import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../bin/settleup.mjs', import.meta.url));
const hook = new URL('./credential-hook.mjs', import.meta.url).href;
export const session = {
  accessToken: 'dummy-access', idToken: 'dummy-access', refreshToken: 'dummy-refresh',
  uid: 'dummy-user', email: 'dummy@example.invalid', expiresAt: Date.now() + 3_600_000,
};

export function authHarness({ native = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'settleup-credential-test-'));
  const configDir = path.join(directory, 'config');
  const storePath = path.join(directory, 'credential-stub.json');
  const logPath = path.join(directory, 'requests.jsonl');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith('SETTLEUP_') && !key.startsWith('CREDENTIAL_TEST_') && key !== 'NODE_OPTIONS'));
  return {
    directory, configDir,
    run(args, { input, changes = {} } = {}) {
      const result = spawnSync(process.execPath, ['--import', hook, cli, ...args], {
        cwd: directory, encoding: 'utf8', input, timeout: 30_000,
        env: {
          ...env, SETTLEUP_ENV: 'test', SETTLEUP_CLI_CONFIG_DIR: configDir,
          SETTLEUP_API_BASE_URL: 'https://credential-test.invalid/db',
          SETTLEUP_AUTH_BASE_URL: 'https://credential-test.invalid/auth',
          CREDENTIAL_TEST_NATIVE: native ? '1' : '',
          CREDENTIAL_TEST_STORE: storePath, CREDENTIAL_TEST_LOG: logPath,
          ...changes,
        },
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null, result.stderr);
      return { status: result.status, output: JSON.parse(result.stdout), stdout: result.stdout, stderr: result.stderr };
    },
    login(options = {}) { return this.run(['auth', 'login'], { input: 'dummy@example.invalid\ndummy-password\n', ...options }); },
    entries() { return fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, 'utf8')) : {}; },
    requests() { return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []; },
    legacy(auth = session, environment = 'test') {
      const dir = path.join(configDir, environment);
      fs.mkdirSync(dir, { recursive: true });
      const filename = path.join(dir, 'auth.json');
      fs.writeFileSync(filename, JSON.stringify(auth));
      return filename;
    },
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }); },
  };
}
