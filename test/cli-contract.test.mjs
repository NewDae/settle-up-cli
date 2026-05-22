import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repoRoot, 'bin', 'settleup.mjs');

function runCli(args, { input } = {}) {
  const configDir = mkdtempSync(path.join(tmpdir(), 'settleup-cli-test-'));
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      SETTLEUP_CLI_CONFIG_DIR: configDir,
      SETTLEUP_ENV: 'test',
      SETTLEUP_API_BASE_URL: '',
      SETTLEUP_FIREBASE_API_KEY: '',
    },
  });

  return {
    status: result.status,
    stderr: result.stderr,
    output: JSON.parse(result.stdout),
  };
}

function runCliAsync(args, { input = '', cwd = repoRoot, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => {
      try {
        resolve({ status, stderr, output: JSON.parse(stdout) });
      } catch (error) {
        reject(new Error(`Could not parse CLI output: ${error.message}\nstdout=${stdout}\nstderr=${stderr}`));
      }
    });
    child.stdin.end(input);
  });
}

function createFetchMock() {
  const dir = mkdtempSync(path.join(tmpdir(), 'settleup-fetch-mock-'));
  const logPath = path.join(dir, 'requests.jsonl');
  const modulePath = path.join(dir, 'mock-fetch.mjs');
  writeFileSync(modulePath, `
import fs from 'node:fs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

globalThis.fetch = async (url, options = {}) => {
  const bodyText = options.body ? String(options.body) : '';
  const entry = {
    url: String(url),
    method: options.method || 'GET',
    headers: options.headers || {},
    body: bodyText ? JSON.parse(bodyText) : null,
  };
  fs.appendFileSync(process.env.SETTLEUP_MOCK_LOG, JSON.stringify(entry) + '\\n');

  if (entry.url.endsWith('/auth/login')) {
    return json({
      ok: true,
      data: {
        accessToken: 'token-1',
        refreshToken: 'refresh-1',
        uid: 'u1',
        email: entry.body.email,
        expiresAt: 1777872000000,
      },
      meta: { environment: 'staging' },
    });
  }

  if (entry.url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword')) {
    return json({
      idToken: 'env-token',
      refreshToken: 'env-refresh',
      localId: 'u-env',
      email: entry.body.email,
      expiresIn: '3600',
    });
  }

  if (entry.url.startsWith('https://securetoken.googleapis.com/v1/token')) {
    return json({
      id_token: 'new-token',
      refresh_token: 'refresh-2',
      user_id: 'u1',
      expires_in: '3600',
    });
  }

  if (entry.url.endsWith('/auth/refresh')) {
    return json({
      ok: true,
      data: {
        accessToken: 'new-token',
        refreshToken: 'refresh-2',
        uid: 'u1',
        email: 'me@example.com',
        expiresAt: 1777872000000,
      },
      meta: { environment: 'staging' },
    });
  }

  if (entry.url.endsWith('/users/u1.json?auth=token-1') || entry.url.endsWith('/users/u1.json?auth=new-token')) {
    return json({ email: 'me@example.com', name: 'me' });
  }

  if (entry.url.endsWith('/users/u-env.json?auth=env-token')) {
    return json({ email: 'env@example.com', name: 'env' });
  }

  return json({ error: 'not found' }, 404);
};
`);
  return {
    baseUrl: 'https://mock-settleup.test',
    env: {
      NODE_OPTIONS: `--import ${modulePath}`,
      SETTLEUP_MOCK_LOG: logPath,
    },
    requests: () => {
      try {
        return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },
  };
}

test('auth status is deterministic without a saved session', () => {
  const { status, output } = runCli(['auth', 'status']);

  assert.equal(status, 0);
  assert.deepEqual(output, {
    ok: true,
    data: {
      authenticated: false,
      uid: null,
      email: null,
      expiresAt: null,
    },
    meta: {
      environment: 'test',
    },
  });
});

test('authenticated commands fail locally with AUTH_REQUIRED before network access', () => {
  const { status, output } = runCli(['groups', 'list']);

  assert.equal(status, 1);
  assert.equal(output.ok, false);
  assert.equal(output.error.code, 'AUTH_REQUIRED');
  assert.match(output.error.message, /auth login/);
  assert.deepEqual(output.meta, { environment: 'test' });
});

test('unknown commands return the stable invalid-input envelope', () => {
  const { status, output } = runCli(['wat']);

  assert.equal(status, 1);
  assert.equal(output.ok, false);
  assert.equal(output.error.code, 'INVALID_INPUT');
  assert.equal(output.error.message, 'Unknown command: wat');
  assert.deepEqual(output.meta, { environment: 'test' });
});

test('schema command returns write-input examples as JSON', () => {
  const { status, output } = runCli(['schema', 'expenses.create']);

  assert.equal(status, 0);
  assert.equal(output.ok, true);
  assert.equal(output.data.command, 'expenses.create');
  assert.deepEqual(output.data.required, ['type', 'purpose', 'currencyCode', 'dateTime', 'whoPaid', 'items']);
  assert.equal(output.data.example.type, 'expense');
  assert.equal(output.data.example.whoPaid[0].memberId, 'member_id_1');
});

test('auth login calls the configured auth wrapper and stores staging session separately', async () => {
  const configDir = mkdtempSync(path.join(tmpdir(), 'settleup-cli-auth-'));
  const mock = createFetchMock();

  const result = await runCliAsync(['auth', 'login'], {
    input: 'me@example.com\nsecret\n',
    env: {
      ...mock.env,
      SETTLEUP_CLI_CONFIG_DIR: configDir,
      SETTLEUP_ENV: 'staging',
      SETTLEUP_API_BASE_URL: mock.baseUrl,
      SETTLEUP_FIREBASE_API_KEY: '',
    },
  });

  assert.equal(result.status, 0, JSON.stringify(result.output));
  assert.equal(result.output.ok, true);
  assert.equal(result.output.data.uid, 'u1');
  const requests = mock.requests();
  assert.equal(requests[0].url, `${mock.baseUrl}/auth/login`);
  assert.deepEqual(requests[0].body, { email: 'me@example.com', password: 'secret' });

  const authPath = path.join(configDir, 'staging', 'auth.json');
  const auth = JSON.parse(readFileSync(authPath, 'utf8'));
  assert.equal(auth.accessToken, 'token-1');

  const productionStatus = await runCliAsync(['auth', 'status'], {
    env: {
      SETTLEUP_CLI_CONFIG_DIR: configDir,
      SETTLEUP_ENV: 'production',
    },
  });
  assert.equal(productionStatus.output.data.authenticated, false);
});

test('expired sessions refresh through the auth wrapper before backend access', async () => {
  const configDir = mkdtempSync(path.join(tmpdir(), 'settleup-cli-refresh-'));
  const authDir = path.join(configDir, 'staging');
  mkdirSync(authDir, { recursive: true });
  writeFileSync(path.join(authDir, 'auth.json'), JSON.stringify({
    accessToken: 'old-token',
    refreshToken: 'refresh-1',
    uid: 'u1',
    email: 'me@example.com',
    expiresAt: Date.now() - 1000,
  }));

  const mock = createFetchMock();

  const result = await runCliAsync(['users', 'me'], {
    env: {
      ...mock.env,
      SETTLEUP_CLI_CONFIG_DIR: configDir,
      SETTLEUP_ENV: 'staging',
      SETTLEUP_API_BASE_URL: mock.baseUrl,
      SETTLEUP_FIREBASE_API_KEY: '',
    },
  });

  assert.equal(result.status, 0, JSON.stringify(result.output));
  assert.equal(result.output.data.uid, 'u1');
  const requests = mock.requests();
  assert.equal(requests[0].url, `${mock.baseUrl}/auth/refresh`);
  assert.equal(requests[1].url, `${mock.baseUrl}/users/u1.json?auth=new-token`);
});

test('.env local development uses Firebase auth directly and shell env wins', async () => {
  const configDir = mkdtempSync(path.join(tmpdir(), 'settleup-cli-dotenv-config-'));
  const cwd = mkdtempSync(path.join(tmpdir(), 'settleup-cli-dotenv-cwd-'));
  const mock = createFetchMock();

  writeFileSync(path.join(cwd, '.env'), [
    'SETTLEUP_ENV=staging',
    `SETTLEUP_API_BASE_URL=${mock.baseUrl}`,
    'SETTLEUP_FIREBASE_API_KEY=from-dotenv',
    '',
  ].join('\n'));

  const result = await runCliAsync(['auth', 'login'], {
    cwd,
    input: 'env@example.com\nsecret\n',
    env: {
      ...mock.env,
      SETTLEUP_MOCK_MODE: 'dotenv',
      SETTLEUP_CLI_CONFIG_DIR: configDir,
      SETTLEUP_FIREBASE_API_KEY: 'from-shell',
    },
  });

  assert.equal(result.status, 0);
  assert.equal(result.output.meta.environment, 'staging');
  const requests = mock.requests();
  assert.match(requests[0].url, /identitytoolkit\.googleapis\.com/);
  assert.match(requests[0].url, /key=from-shell/);
  assert.deepEqual(requests[0].body, {
    email: 'env@example.com',
    password: 'secret',
    returnSecureToken: true,
  });
  assert.equal(requests[1].url, `${mock.baseUrl}/users/u-env.json?auth=env-token`);
});
