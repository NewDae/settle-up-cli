const MAX_BODY_BYTES = 8 * 1024;
const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

const ERROR_CODES = new Set([
  'AUTH_INVALID',
  'AUTH_REFRESH_FAILED',
  'INVALID_INPUT',
  'API_REQUEST_FAILED',
  'API_RATE_LIMITED',
]);

async function rateLimitAuthRequest(request, env) {
  if (!env.AUTH_RATE_LIMITER) return null;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const environment = env.SETTLEUP_ENV || 'production';
  const { success } = await env.AUTH_RATE_LIMITER.limit({
    key: `${environment}:${ip}`,
  });
  if (!success) {
    return fail(env, 'API_RATE_LIMITED', 'Too many auth requests', 429);
  }
  return null;
}

function meta(env) {
  return { environment: env.SETTLEUP_ENV || 'production' };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}

function ok(env, data = {}) {
  return { ok: true, data, meta: meta(env) };
}

function fail(env, code, message, status = 400, details = {}) {
  const stableCode = ERROR_CODES.has(code) ? code : 'API_REQUEST_FAILED';
  return jsonResponse({ ok: false, error: { code: stableCode, message, details }, meta: meta(env) }, status);
}

function requireEnv(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw Object.assign(new Error(`Missing Worker environment variable: ${name}`), {
      status: 500,
      code: 'API_REQUEST_FAILED',
      publicMessage: 'Auth Worker is not configured',
    });
  }
  return value;
}

function assertPostJson(request, env) {
  if (request.method !== 'POST') {
    return fail(env, 'INVALID_INPUT', 'Method not allowed', 405);
  }
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return fail(env, 'INVALID_INPUT', 'Expected application/json request body', 400);
  }
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_BYTES) {
    return fail(env, 'INVALID_INPUT', 'Request body is too large', 413);
  }
  return null;
}

async function readJsonBody(request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw Object.assign(new Error('Request body is too large'), {
      status: 413,
      code: 'INVALID_INPUT',
      publicMessage: 'Request body is too large',
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Invalid JSON'), {
      status: 400,
      code: 'INVALID_INPUT',
      publicMessage: 'Invalid JSON request body',
    });
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (response.status === 429) {
    throw Object.assign(new Error('Auth provider rate limit reached'), {
      status: 429,
      code: 'API_RATE_LIMITED',
      publicMessage: 'Auth provider rate limit reached',
    });
  }
  if (!response.ok) {
    // Never echo Firebase error codes: EMAIL_NOT_FOUND vs INVALID_PASSWORD
    // would let anyone check which emails have Settle Up accounts.
    const authInvalid = response.status === 400 || response.status === 401 || response.status === 403;
    throw Object.assign(new Error(`Auth provider request failed: ${response.status}`), {
      status: authInvalid ? 401 : 502,
      code: authInvalid ? 'AUTH_INVALID' : 'API_REQUEST_FAILED',
      publicMessage: authInvalid ? 'Invalid email or password' : 'Auth provider request failed',
      details: {},
    });
  }
  return body;
}

async function signInWithPassword(env, email, password) {
  const apiKey = encodeURIComponent(requireEnv(env, 'SETTLEUP_FIREBASE_API_KEY'));
  const json = await fetchJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return {
    accessToken: json.idToken,
    idToken: json.idToken,
    refreshToken: json.refreshToken,
    uid: json.localId,
    email: json.email || email,
    expiresAt: Date.now() + (Number(json.expiresIn) * 1000),
  };
}

async function refreshToken(env, refreshToken) {
  const apiKey = encodeURIComponent(requireEnv(env, 'SETTLEUP_FIREBASE_API_KEY'));
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const json = await fetchJson(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  return {
    accessToken: json.id_token,
    idToken: json.id_token,
    refreshToken: json.refresh_token,
    uid: json.user_id,
    expiresAt: Date.now() + (Number(json.expires_in) * 1000),
  };
}

function assertCompleteSession(session, refresh = false) {
  const required = refresh
    ? ['accessToken', 'idToken', 'refreshToken', 'uid', 'expiresAt']
    : ['accessToken', 'idToken', 'refreshToken', 'uid', 'email', 'expiresAt'];
  const missing = required.filter((key) => !session[key]);
  if (missing.length > 0 || !Number.isFinite(session.expiresAt)) {
    throw Object.assign(new Error('Auth provider response did not include a complete session'), {
      status: 502,
      code: refresh ? 'AUTH_REFRESH_FAILED' : 'AUTH_INVALID',
      publicMessage: refresh ? 'Auth refresh response did not include a complete session' : 'Auth response did not include a complete session',
      details: { required },
    });
  }
}

async function handleLogin(request, env) {
  const methodError = assertPostJson(request, env);
  if (methodError) return methodError;

  const body = await readJsonBody(request);
  if (typeof body.email !== 'string' || body.email.length === 0 || typeof body.password !== 'string' || body.password.length === 0) {
    return fail(env, 'INVALID_INPUT', 'Missing email or password', 400);
  }

  requireEnv(env, 'SETTLEUP_API_BASE_URL');
  const session = await signInWithPassword(env, body.email, body.password);
  assertCompleteSession(session);
  return jsonResponse(ok(env, session));
}

async function handleRefresh(request, env) {
  const methodError = assertPostJson(request, env);
  if (methodError) return methodError;

  const body = await readJsonBody(request);
  if (typeof body.refreshToken !== 'string' || body.refreshToken.length === 0) {
    return fail(env, 'INVALID_INPUT', 'Missing refresh token', 400);
  }

  requireEnv(env, 'SETTLEUP_API_BASE_URL');
  const session = await refreshToken(env, body.refreshToken);
  assertCompleteSession(session, true);
  return jsonResponse(ok(env, session));
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/auth/login') {
        const rateLimitError = await rateLimitAuthRequest(request, env);
        if (rateLimitError) return rateLimitError;
        return await handleLogin(request, env);
      }
      if (url.pathname === '/auth/refresh') {
        const rateLimitError = await rateLimitAuthRequest(request, env);
        if (rateLimitError) return rateLimitError;
        return await handleRefresh(request, env);
      }
      return fail(env, 'INVALID_INPUT', 'Not found', 404);
    } catch (error) {
      return fail(
        env,
        error.code || 'API_REQUEST_FAILED',
        error.publicMessage || 'Auth request failed',
        error.status || 500,
        error.details || {}
      );
    }
  },
};
