import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createLoginKey, decryptLogin } from './browser-crypto.mjs';

const error = (message, cliCode = 'INVALID_INPUT') => Object.assign(new Error(message), { cliCode });
export function createBrowserLogin({ configDir, environment, apiBaseUrl, authBaseUrl, loginBaseUrl }) {
  const scope = createHash('sha256').update(JSON.stringify([apiBaseUrl, authBaseUrl])).digest('hex');
  const directory = path.join(configDir, environment);
  const filename = path.join(directory, `browser-login-${scope}.json`);
  function remove() { try { fs.unlinkSync(filename); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  function read() {
    let pending;
    try { pending = JSON.parse(fs.readFileSync(filename, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw error('Could not read pending browser login; start again', 'AUTH_INVALID'); }
    if (pending.expiresAt <= Date.now()) { remove(); return null; }
    if (pending.baseUrl !== loginBaseUrl) throw error('Browser login URL changed; cancel login with auth logout, then start again');
    return pending;
  }
  function baseUrl() {
    if (!loginBaseUrl) throw error('Custom environments require SETTLEUP_LOGIN_BASE_URL for browser login');
    let url;
    try { url = new URL(loginBaseUrl); } catch { throw error('SETTLEUP_LOGIN_BASE_URL must be an HTTPS origin'); }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw error('SETTLEUP_LOGIN_BASE_URL must be an HTTPS origin (HTTP loopback is allowed for local development)');
    }
    return url.origin;
  }
  async function request(base, action, body) {
    let response;
    try {
      response = await fetch(`${base}/api/login/${action}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15_000), redirect: 'error',
      });
    } catch { throw error('Could not reach the browser login service; retry', 'API_REQUEST_FAILED'); }
    let json;
    try { json = await response.json(); } catch { throw error('Browser login service returned an invalid response', 'API_REQUEST_FAILED'); }
    if (!response.ok || !json?.ok) {
      const code = response.status === 410 ? 'AUTH_INVALID' : response.status === 429 ? 'API_RATE_LIMITED' : 'API_REQUEST_FAILED';
      throw error(response.status === 410 ? 'Browser login expired or already completed; run auth login --browser again' : 'Browser login service could not complete the request', code);
    }
    return json.data;
  }
  return {
    async start() {
      const base = baseUrl();
      if (read()) throw error('A browser login is already pending; run auth login --complete, or auth logout to cancel');
      const keys = await createLoginKey();
      const result = await request(base, 'start', { publicKey: keys.publicKey, protocolVersion: 2 });
      if (result?.protocolVersion !== 2 || !/^[a-f0-9]{64}$/.test(result?.browserId) || !/^[a-f0-9]{64}$/.test(result?.deviceToken)
          || !Number.isFinite(result?.expiresAt) || result.expiresAt <= Date.now() || result.expiresAt > Date.now() + 11 * 60_000) throw error('Invalid browser login response', 'API_REQUEST_FAILED');
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
      // Exclusive creation prevents a second CLI from replacing the private key.
      try {
        fs.writeFileSync(filename, JSON.stringify({ ...result, privateKey: keys.privateKey, baseUrl: loginBaseUrl }), { mode: 0o600, flag: 'wx' });
      } catch {
        await request(base, 'cancel', { deviceToken: result.deviceToken }).catch(() => {});
        throw error('Could not save pending browser login; check the CLI config directory', 'AUTH_STORAGE_FAILED');
      }
      return {
        status: 'pending', loginUrl: `${base}/login#${result.browserId}.${encodeURIComponent(keys.publicKey)}`,
        expiresAt: result.expiresAt,
        next: 'Open loginUrl privately and enter your Settle Up email, password, and API key, then run settleup auth login --complete. Never send API keys, passwords, or tokens in chat.',
      };
    },
    async complete({ wait = false } = {}) {
      const base = baseUrl();
      const pending = read();
      if (!pending) throw error('No pending browser login; run auth login --browser first', 'AUTH_REQUIRED');
      for (;;) {
        if (Date.now() >= pending.expiresAt) { remove(); throw error('Browser login expired; start again', 'AUTH_INVALID'); }
        let result;
        try { result = await request(base, 'poll', { deviceToken: pending.deviceToken }); }
        catch (e) { if (e.cliCode === 'AUTH_INVALID') remove(); throw e; }
        if (result?.status === 'pending') {
          if (!wait) return { status: 'pending', expiresAt: pending.expiresAt, next: 'Finish sign-in in your browser, then run settleup auth login --complete.' };
          await delay(Math.min(3000, Math.max(1, pending.expiresAt - Date.now())));
          continue;
        }
        if (result?.status !== 'ready' || !result.envelope) throw error('Invalid browser login response', 'API_REQUEST_FAILED');
        try { return { status: 'ready', session: await decryptLogin(result.envelope, pending.privateKey, pending.browserId) }; }
        catch { remove(); throw error('Could not verify the encrypted session; start browser login again', 'AUTH_INVALID'); }
      }
    },
    finish: remove,
    async cancel() {
      // Always clear local key material, even if the network is unavailable.
      let pending;
      try { pending = JSON.parse(fs.readFileSync(filename, 'utf8')); } catch {}
      remove();
      if (pending) await request(pending.baseUrl, 'cancel', { deviceToken: pending.deviceToken }).catch(() => {});
    },
  };
}
