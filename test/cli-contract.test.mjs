import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync as makeTempDir, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repoRoot, 'bin', 'settleup.mjs');

// Every temporary directory is removed after the file's tests finish.
const tempDirs = [];
function mkdtempSync(prefix) {
  const dir = makeTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}
after(() => { for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true }); });

function runCli(args, { input } = {}) {
  const configDir = mkdtempSync(path.join(tmpdir(), 'settleup-cli-test-'));
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      SETTLEUP_AUTH_STORAGE: 'file',
      SETTLEUP_CLI_CONFIG_DIR: configDir,
      SETTLEUP_ENV: 'test',
      SETTLEUP_API_BASE_URL: '',
      SETTLEUP_AUTH_BASE_URL: '',
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
      SETTLEUP_AUTH_STORAGE: 'file',
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

  const mode = process.env.SETTLEUP_MOCK_MODE;
  if (entry.url.endsWith('/auth/login') && mode === 'login-rejected-envelope') {
    return json({ ok: false, error: { code: 'AUTH_INVALID', message: 'Invalid email or password' } }, 401);
  }
  if (entry.url.endsWith('/auth/login') && mode === 'login-rejected-plain') {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (entry.url.endsWith('/auth/login') && mode === 'login-unavailable') {
    return json({ error: 'Service unavailable' }, 503);
  }
  if (entry.url.startsWith('https://identitytoolkit.googleapis.com/') && entry.body.email.startsWith('wrong')) {
    return json({ error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } }, 400);
  }
  if (mode === 'new-user' && entry.url.includes('/users/u1.json')) {
    return json(entry.method === 'PUT' ? entry.body : null);
  }

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
      NODE_OPTIONS: `--import ${pathToFileURL(modulePath).href}`,
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
      storage: 'file',
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
  const apiBaseUrl = `${mock.baseUrl}/db`;
  const authBaseUrl = `${mock.baseUrl}/auth-service`;

  const result = await runCliAsync(['auth', 'login'], {
    input: 'me@example.com\nsecret\n',
    env: {
      ...mock.env,
      SETTLEUP_CLI_CONFIG_DIR: configDir,
      SETTLEUP_ENV: 'staging',
      SETTLEUP_API_BASE_URL: apiBaseUrl,
      SETTLEUP_AUTH_BASE_URL: authBaseUrl,
      SETTLEUP_FIREBASE_API_KEY: '',
    },
  });

  assert.equal(result.status, 0, JSON.stringify(result.output));
  assert.equal(result.output.ok, true);
  assert.equal(result.output.data.uid, 'u1');
  const requests = mock.requests();
  assert.equal(requests[0].url, `${authBaseUrl}/auth/login`);
  assert.deepEqual(requests[0].body, { email: 'me@example.com', password: 'secret' });
  assert.equal(requests[1].url, `${apiBaseUrl}/users/u1.json?auth=token-1`);

  const authPath = path.join(configDir, 'staging', readdirSync(path.join(configDir, 'staging')).find(name => name.startsWith('auth-')));
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

test('production login works from a clean directory without user configuration', async () => {
  const configDir = mkdtempSync(path.join(tmpdir(), 'settleup-cli-default-auth-'));
  const cwd = mkdtempSync(path.join(tmpdir(), 'settleup-cli-default-cwd-'));
  const mock = createFetchMock();
  const result = await runCliAsync(['auth', 'login'], {
    cwd,
    input: 'me@example.com\nsecret\n',
    env: {
      ...mock.env,
      SETTLEUP_CLI_CONFIG_DIR: configDir,
      SETTLEUP_ENV: 'production',
      SETTLEUP_API_BASE_URL: '',
      SETTLEUP_AUTH_BASE_URL: '',
      SETTLEUP_FIREBASE_API_KEY: '',
    },
  });
  assert.equal(result.status, 0, JSON.stringify(result.output));
  const requests = mock.requests();
  assert.equal(requests[0].url, 'https://settleup-production.newdae.workers.dev/auth/login');
  assert.equal(requests[1].url, 'https://settle-up-live.firebaseio.com/users/u1.json?auth=token-1');
});

test('unconfigured staging login fails before reaching production', async () => {
  const mock = createFetchMock();
  const result = await runCliAsync(['auth', 'login'], {
    input: 'me@example.com\nsecret\n',
    env: {
      ...mock.env,
      SETTLEUP_ENV: 'staging',
      SETTLEUP_API_BASE_URL: '',
      SETTLEUP_AUTH_BASE_URL: '',
      SETTLEUP_FIREBASE_API_KEY: '',
    },
  });
  assert.equal(result.status, 1);
  assert.equal(result.output.error.code, 'INVALID_INPUT');
  assert.deepEqual(mock.requests(), []);
});

test('expired sessions refresh through the auth wrapper before backend access', async () => {
  const configDir = mkdtempSync(path.join(tmpdir(), 'settleup-cli-refresh-'));
  const mock = createFetchMock();
  const apiBaseUrl = `${mock.baseUrl}/db`;
  const authBaseUrl = `${mock.baseUrl}/auth-service`;
  const authDir = path.join(configDir, 'staging');
  mkdirSync(authDir, { recursive: true });
  writeFileSync(path.join(authDir, 'auth.json'), JSON.stringify({
    accessToken: 'old-token',
    refreshToken: 'refresh-1',
    uid: 'u1',
    email: 'me@example.com',
    expiresAt: Date.now() - 1000,
  }));

  const result = await runCliAsync(['users', 'me'], {
    env: {
      ...mock.env,
      SETTLEUP_CLI_CONFIG_DIR: configDir,
      SETTLEUP_ENV: 'staging',
      SETTLEUP_API_BASE_URL: apiBaseUrl,
      SETTLEUP_AUTH_BASE_URL: authBaseUrl,
      SETTLEUP_FIREBASE_API_KEY: '',
    },
  });

  assert.equal(result.status, 0, JSON.stringify(result.output));
  assert.equal(result.output.data.uid, 'u1');
  const requests = mock.requests();
  assert.equal(requests[0].url, `${authBaseUrl}/auth/refresh`);
  assert.equal(requests[1].url, `${apiBaseUrl}/users/u1.json?auth=new-token`);
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

function hostedLogin(mode, input = 'me@example.com\nsecret\n') {
  const configDir = mkdtempSync(path.join(tmpdir(), 'settleup-cli-login-'));
  const mock = createFetchMock();
  return runCliAsync(['auth', 'login'], {
    input,
    env: {
      ...mock.env, SETTLEUP_MOCK_MODE: mode, SETTLEUP_CLI_CONFIG_DIR: configDir, SETTLEUP_ENV: 'staging',
      SETTLEUP_API_BASE_URL: `${mock.baseUrl}/db`, SETTLEUP_AUTH_BASE_URL: `${mock.baseUrl}/auth-service`, SETTLEUP_FIREBASE_API_KEY: '',
    },
  }).then((result) => ({ ...result, requests: mock.requests(), configDir }));
}

for (const mode of ['login-rejected-envelope', 'login-rejected-plain']) {
  test(`hosted sign-in rejection (${mode}) is AUTH_INVALID with sign-in guidance and no saved session`, async () => {
    const result = await hostedLogin(mode);
    assert.equal(result.status, 1);
    assert.equal(result.output.error.code, 'AUTH_INVALID');
    assert.match(result.output.error.details.help, /email\/password sign-in/);
    assert.equal(result.requests.length, 1);
    assert.equal(JSON.stringify(result.output).includes('secret'), false);
  });
}

test('a hosted auth outage stays API_REQUEST_FAILED rather than blaming credentials', async () => {
  const result = await hostedLogin('login-unavailable');
  assert.equal(result.output.error.code, 'API_REQUEST_FAILED');
  assert.equal(result.output.error.details.status, 503);
});

test('direct Firebase sign-in rejection is AUTH_INVALID, not a connectivity error', async () => {
  const mock = createFetchMock();
  const result = await runCliAsync(['auth', 'login'], {
    input: 'wrong@example.com\nsecret\n',
    env: {
      ...mock.env, SETTLEUP_CLI_CONFIG_DIR: mkdtempSync(path.join(tmpdir(), 'settleup-cli-login-')),
      SETTLEUP_ENV: 'staging', SETTLEUP_API_BASE_URL: mock.baseUrl, SETTLEUP_FIREBASE_API_KEY: 'test-key',
    },
  });
  assert.equal(result.output.error.code, 'AUTH_INVALID');
  assert.equal(result.output.error.details.status, 400);
  assert.equal(mock.requests().length, 1);
});

test('first sign-in creates the missing app-level user profile', async () => {
  const result = await hostedLogin('new-user');
  assert.equal(result.status, 0, JSON.stringify(result.output));
  const [, read, write] = result.requests;
  assert.equal(read.method, 'GET');
  assert.equal(write.method, 'PUT');
  assert.match(write.url, /\/users\/u1\.json\?auth=token-1$/);
  assert.equal(write.body.email, 'me@example.com');
});

for (const [label, expiresIn, refreshes] of [['within the final minute', 30_000, true], ['with time remaining', 600_000, false]]) {
  test(`a session ${label} ${refreshes ? 'refreshes' : 'is used without refreshing'}`, async () => {
    const configDir = mkdtempSync(path.join(tmpdir(), 'settleup-cli-refresh-window-'));
    const mock = createFetchMock();
    mkdirSync(path.join(configDir, 'staging'), { recursive: true });
    writeFileSync(path.join(configDir, 'staging', 'auth.json'), JSON.stringify({
      accessToken: 'token-1', refreshToken: 'refresh-1', uid: 'u1', email: 'me@example.com', expiresAt: Date.now() + expiresIn,
    }));
    const result = await runCliAsync(['users', 'me'], {
      env: {
        ...mock.env, SETTLEUP_CLI_CONFIG_DIR: configDir, SETTLEUP_ENV: 'staging',
        SETTLEUP_API_BASE_URL: `${mock.baseUrl}/db`, SETTLEUP_AUTH_BASE_URL: `${mock.baseUrl}/auth-service`, SETTLEUP_FIREBASE_API_KEY: '',
      },
    });
    assert.equal(result.status, 0, JSON.stringify(result.output));
    assert.equal(mock.requests().some((request) => request.url.endsWith('/auth/refresh')), refreshes);
  });
}
