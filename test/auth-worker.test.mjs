import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/auth-worker/src/index.mjs';

const env = {
  SETTLEUP_ENV: 'staging',
  SETTLEUP_API_BASE_URL: 'https://settle-up-sandbox.firebaseio.com',
  SETTLEUP_FIREBASE_API_KEY: 'test-key',
};

function request(path, body, options = {}) {
  const init = {
    method: options.method || 'POST',
    headers: options.headers || { 'content-type': 'application/json' },
  };
  if (body !== undefined && init.method !== 'GET' && init.method !== 'HEAD') {
    init.body = JSON.stringify(body);
  }
  return new Request(`https://settleup-staging.example.workers.dev${path}`, init);
}

async function readJson(response) {
  return JSON.parse(await response.text());
}

test('login returns CLI-compatible session without logging credentials', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  console.log = () => { throw new Error('console.log must not be called'); };
  console.error = () => { throw new Error('console.error must not be called'); };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: JSON.parse(String(options.body)) });
    return new Response(JSON.stringify({
      idToken: 'token-1',
      refreshToken: 'refresh-1',
      localId: 'u1',
      email: 'me@example.com',
      expiresIn: '3600',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const response = await worker.fetch(request('/auth/login', {
      email: 'me@example.com',
      password: 'secret',
    }), env);
    const json = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.data.accessToken, 'token-1');
    assert.equal(json.data.refreshToken, 'refresh-1');
    assert.equal(json.data.uid, 'u1');
    assert.equal(calls[0].url, 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test-key');
    assert.deepEqual(calls[0].body, {
      email: 'me@example.com',
      password: 'secret',
      returnSecureToken: true,
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }
});

test('refresh returns CLI-compatible refreshed session', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), 'https://securetoken.googleapis.com/v1/token?key=test-key');
    assert.equal(String(options.body), 'grant_type=refresh_token&refresh_token=refresh-1');
    return new Response(JSON.stringify({
      id_token: 'new-token',
      refresh_token: 'refresh-2',
      user_id: 'u1',
      expires_in: '3600',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const response = await worker.fetch(request('/auth/refresh', {
      refreshToken: 'refresh-1',
    }), env);
    const json = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.data.accessToken, 'new-token');
    assert.equal(json.data.refreshToken, 'refresh-2');
    assert.equal(json.data.uid, 'u1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects non-auth paths and browser-style requests', async () => {
  const notFound = await worker.fetch(request('/users/u1', {}, { method: 'GET', headers: {} }), env);
  assert.equal(notFound.status, 404);

  const wrongMethod = await worker.fetch(request('/auth/login', undefined, { method: 'GET', headers: {} }), env);
  assert.equal(wrongMethod.status, 405);

  const wrongType = await worker.fetch(request('/auth/login', { email: 'me@example.com', password: 'secret' }, {
    headers: { 'content-type': 'text/plain' },
  }), env);
  assert.equal(wrongType.status, 400);
  assert.equal(wrongType.headers.get('access-control-allow-origin'), null);
});

test('rate limits auth routes when binding is available', async () => {
  const keys = [];
  const limitedEnv = {
    ...env,
    AUTH_RATE_LIMITER: {
      async limit({ key }) {
        keys.push(key);
        return { success: false };
      },
    },
  };

  const response = await worker.fetch(request('/auth/login', {
    email: 'me@example.com',
    password: 'secret',
  }, {
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.10',
    },
  }), limitedEnv);
  const json = await readJson(response);

  assert.equal(response.status, 429);
  assert.equal(json.error.code, 'API_RATE_LIMITED');
  assert.equal(JSON.stringify(json).includes('secret'), false);

  const refreshResponse = await worker.fetch(request('/auth/refresh', {
    refreshToken: 'refresh-secret',
  }, {
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.10',
    },
  }), limitedEnv);
  assert.equal(refreshResponse.status, 429);
  assert.deepEqual(keys, [
    `${env.SETTLEUP_ENV}:203.0.113.10`,
    `${env.SETTLEUP_ENV}:203.0.113.10`,
  ]);
});

test('maps upstream auth failures to stable envelopes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { message: 'INVALID_PASSWORD' },
  }), { status: 400, headers: { 'content-type': 'application/json' } });

  try {
    const response = await worker.fetch(request('/auth/login', {
      email: 'me@example.com',
      password: 'bad-secret',
    }), env);
    const json = await readJson(response);

    assert.equal(response.status, 401);
    assert.equal(json.ok, false);
    assert.equal(json.error.code, 'AUTH_INVALID');
    assert.equal(json.error.message, 'Invalid email or password');
    assert.equal(JSON.stringify(json).includes('bad-secret'), false);
    assert.deepEqual(json.error.details, {}, 'upstream codes would allow account enumeration');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
