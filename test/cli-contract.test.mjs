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
    body: !bodyText ? null : options.body instanceof URLSearchParams ? Object.fromEntries(options.body) : JSON.parse(bodyText),
  };
  fs.appendFileSync(process.env.SETTLEUP_MOCK_LOG, JSON.stringify(entry) + '\\n');

  const mode = process.env.SETTLEUP_MOCK_MODE;
  if (entry.url.startsWith('https://identitytoolkit.googleapis.com/') && mode === 'bad-key') {
    return json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }, 400);
  }
  if (entry.url.startsWith('https://identitytoolkit.googleapis.com/') && mode === 'login-unavailable') {
    return json({ error: { code: 503, message: 'UNAVAILABLE' } }, 503);
  }
  if (entry.url.startsWith('https://identitytoolkit.googleapis.com/') && entry.body.email.startsWith('wrong')) {
    return json({ error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } }, 400);
  }
  if (mode === 'new-user' && entry.url.includes('/users/u-env.json')) {
    return json(entry.method === 'PUT' ? entry.body : null);
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

const KEY = `AIza${'K'.repeat(35)}`;

function directLogin({ input = 'env@example.com\nsecret\n', env = {} } = {}) {
  const configDir = mkdtempSync(path.join(tmpdir(), 'settleup-cli-login-'));
  const mock = createFetchMock();
  return runCliAsync(['auth', 'login'], {
    input,
    env: {
      ...mock.env, SETTLEUP_CLI_CONFIG_DIR: configDir, SETTLEUP_ENV: 'staging',
      SETTLEUP_API_BASE_URL: mock.baseUrl, SETTLEUP_AUTH_BASE_URL: '', SETTLEUP_FIREBASE_API_KEY: KEY, ...env,
    },
  }).then((result) => ({ ...result, requests: mock.requests(), configDir, mock }));
}

test('terminal login goes directly to Firebase, saves the key, and isolates environments', async () => {
  const result = await directLogin();
  assert.equal(result.status, 0, JSON.stringify(result.output));
  assert.equal(result.output.data.uid, 'u-env');
  assert.equal(JSON.stringify(result.output).includes(KEY), false);
  assert.equal(result.requests[0].url, `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`);
  assert.deepEqual(result.requests[0].body, { email: 'env@example.com', password: 'secret', returnSecureToken: true });
  assert.equal(result.requests[1].url, `${result.mock.baseUrl}/users/u-env.json?auth=env-token`);
  assert.equal(result.requests.some((request) => /workers\.dev|\/auth\//.test(request.url)), false);

  const authPath = path.join(result.configDir, 'staging', readdirSync(path.join(result.configDir, 'staging')).find(name => name.startsWith('auth-')));
  const auth = JSON.parse(readFileSync(authPath, 'utf8'));
  assert.equal(auth.accessToken, 'env-token');
  assert.equal(auth.firebaseApiKey, KEY);
  assert.equal('password' in auth, false);

  const productionStatus = await runCliAsync(['auth', 'status'], {
    env: { SETTLEUP_CLI_CONFIG_DIR: result.configDir, SETTLEUP_ENV: 'production' },
  });
  assert.equal(productionStatus.output.data.authenticated, false);
});

test('non-interactive terminal login without a key fails before any request', async () => {
  const result = await directLogin({ env: { SETTLEUP_FIREBASE_API_KEY: '' } });
  assert.equal(result.status, 1);
  assert.equal(result.output.error.code, 'INVALID_INPUT');
  assert.match(result.output.error.message, /SETTLEUP_FIREBASE_API_KEY.*--browser/);
  assert.deepEqual(result.requests, []);
});

test('a malformed key is rejected locally without echoing it', async () => {
  const result = await directLogin({ env: { SETTLEUP_FIREBASE_API_KEY: 'not-a-real-key-123456789' } });
  assert.equal(result.output.error.code, 'INVALID_INPUT');
  assert.match(result.output.error.message, /AIza/);
  assert.equal(JSON.stringify(result.output).includes('not-a-real-key'), false);
  assert.deepEqual(result.requests, []);
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
      SETTLEUP_FIREBASE_API_KEY: KEY,
    },
  });
  assert.equal(result.status, 1);
  assert.equal(result.output.error.code, 'INVALID_INPUT');
  assert.deepEqual(mock.requests(), []);
});

function writeSession(configDir, extra = {}) {
  mkdirSync(path.join(configDir, 'staging'), { recursive: true });
  writeFileSync(path.join(configDir, 'staging', 'auth.json'), JSON.stringify({
    accessToken: 'old-token', refreshToken: 'refresh-1', uid: 'u1', email: 'me@example.com', expiresAt: Date.now() - 1000, ...extra,
  }));
}

test('expired sessions refresh directly with Firebase using the saved key', async () => {
  const configDir = mkdtempSync(path.join(tmpdir(), 'settleup-cli-refresh-'));
  const mock = createFetchMock();
  writeSession(configDir, { firebaseApiKey: KEY });
  const result = await runCliAsync(['users', 'me'], {
    env: {
      ...mock.env, SETTLEUP_CLI_CONFIG_DIR: configDir, SETTLEUP_ENV: 'staging',
      SETTLEUP_API_BASE_URL: `${mock.baseUrl}/db`, SETTLEUP_FIREBASE_API_KEY: '',
    },
  });
  assert.equal(result.status, 0, JSON.stringify(result.output));
  const requests = mock.requests();
  assert.equal(requests[0].url, `https://securetoken.googleapis.com/v1/token?key=${KEY}`);
  assert.equal(requests[1].url, `${mock.baseUrl}/db/users/u1.json?auth=new-token`);
});

test('a pre-0.4 session without a key asks for a new sign-in and contacts no auth service', async () => {
  const configDir = mkdtempSync(path.join(tmpdir(), 'settleup-cli-legacy-refresh-'));
  const mock = createFetchMock();
  writeSession(configDir);
  const result = await runCliAsync(['users', 'me'], {
    env: {
      ...mock.env, SETTLEUP_CLI_CONFIG_DIR: configDir, SETTLEUP_ENV: 'staging',
      SETTLEUP_API_BASE_URL: `${mock.baseUrl}/db`, SETTLEUP_AUTH_BASE_URL: `${mock.baseUrl}/auth-service`, SETTLEUP_FIREBASE_API_KEY: '',
    },
  });
  assert.equal(result.status, 1);
  assert.equal(result.output.error.code, 'AUTH_REFRESH_FAILED');
  assert.match(result.output.error.message, /older CLI version.*sign in again/);
  assert.match(result.output.error.details.help, /auth login --browser/);
  assert.deepEqual(mock.requests(), []);
});

test('.env local development is read and shell env wins', async () => {
  const configDir = mkdtempSync(path.join(tmpdir(), 'settleup-cli-dotenv-config-'));
  const cwd = mkdtempSync(path.join(tmpdir(), 'settleup-cli-dotenv-cwd-'));
  const mock = createFetchMock();
  const dotenvKey = `AIza${'E'.repeat(35)}`;

  writeFileSync(path.join(cwd, '.env'), [
    'SETTLEUP_ENV=staging',
    `SETTLEUP_API_BASE_URL=${mock.baseUrl}`,
    `SETTLEUP_FIREBASE_API_KEY=${dotenvKey}`,
    '',
  ].join('\n'));

  const result = await runCliAsync(['auth', 'login'], {
    cwd,
    input: 'env@example.com\nsecret\n',
    env: { ...mock.env, SETTLEUP_CLI_CONFIG_DIR: configDir, SETTLEUP_FIREBASE_API_KEY: KEY },
  });

  assert.equal(result.status, 0, JSON.stringify(result.output));
  assert.equal(result.output.meta.environment, 'staging');
  const requests = mock.requests();
  assert.match(requests[0].url, new RegExp(`key=${KEY}$`));
});

test('direct Firebase sign-in rejection is AUTH_INVALID, not a connectivity error', async () => {
  const result = await directLogin({ input: 'wrong@example.com\nsecret\n' });
  assert.equal(result.output.error.code, 'AUTH_INVALID');
  assert.equal(result.output.error.details.status, 400);
  assert.match(result.output.error.message, /email, password/);
  assert.match(result.output.error.details.help, /API key/);
  assert.equal(JSON.stringify(result.output).includes('secret'), false);
  assert.equal(result.requests.length, 1);
});

test('a key Firebase rejects is reported as a key problem', async () => {
  const result = await directLogin({ env: { SETTLEUP_MOCK_MODE: 'bad-key' } });
  assert.equal(result.output.error.code, 'AUTH_INVALID');
  assert.match(result.output.error.message, /API key was not accepted/);
});

test('a Firebase outage stays API_REQUEST_FAILED rather than blaming credentials', async () => {
  const result = await directLogin({ env: { SETTLEUP_MOCK_MODE: 'login-unavailable' } });
  assert.equal(result.output.error.code, 'API_REQUEST_FAILED');
  assert.equal(result.output.error.details.status, 503);
});

test('first sign-in creates the missing app-level user profile', async () => {
  const result = await directLogin({ env: { SETTLEUP_MOCK_MODE: 'new-user' } });
  assert.equal(result.status, 0, JSON.stringify(result.output));
  const [, read, write] = result.requests;
  assert.equal(read.method, 'GET');
  assert.equal(write.method, 'PUT');
  assert.match(write.url, /\/users\/u-env\.json\?auth=env-token$/);
  assert.equal(write.body.email, 'env@example.com');
});

for (const [label, expiresIn, refreshes] of [['within the final minute', 30_000, true], ['with time remaining', 600_000, false]]) {
  test(`a session ${label} ${refreshes ? 'refreshes' : 'is used without refreshing'}`, async () => {
    const configDir = mkdtempSync(path.join(tmpdir(), 'settleup-cli-refresh-window-'));
    const mock = createFetchMock();
    mkdirSync(path.join(configDir, 'staging'), { recursive: true });
    writeFileSync(path.join(configDir, 'staging', 'auth.json'), JSON.stringify({
      accessToken: 'token-1', refreshToken: 'refresh-1', uid: 'u1', email: 'me@example.com', expiresAt: Date.now() + expiresIn, firebaseApiKey: KEY,
    }));
    const result = await runCliAsync(['users', 'me'], {
      env: {
        ...mock.env, SETTLEUP_CLI_CONFIG_DIR: configDir, SETTLEUP_ENV: 'staging',
        SETTLEUP_API_BASE_URL: `${mock.baseUrl}/db`, SETTLEUP_AUTH_BASE_URL: `${mock.baseUrl}/auth-service`, SETTLEUP_FIREBASE_API_KEY: '',
      },
    });
    assert.equal(result.status, 0, JSON.stringify(result.output));
    assert.equal(mock.requests().some((request) => request.url.startsWith('https://securetoken.googleapis.com/')), refreshes);
  });
}
