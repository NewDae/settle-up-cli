import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../../bin/settleup.mjs', import.meta.url));

// Run the real executable with a fresh session and a scripted HTTP boundary.
// Unlisted requests fail; the stub never calls the network or stores records.
export function runAuthenticatedCli(args, { input, inputText, responses = [] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'settleup-write-test-'));
  try {
    const authDir = path.join(dir, 'config', 'test');
    mkdirSync(authDir, { recursive: true });
    writeFileSync(path.join(authDir, 'auth.json'), JSON.stringify({
      uid: 'u_test', accessToken: 'test-token', refreshToken: 'test-refresh',
      email: 'test@example.com', expiresAt: Date.now() + 3_600_000,
    }));
    writeFileSync(path.join(dir, 'responses.json'), JSON.stringify(responses));
    const logPath = path.join(dir, 'requests.jsonl');
    writeFileSync(logPath, '');
    const mockPath = path.join(dir, 'fetch-stub.mjs');
    writeFileSync(mockPath, `
import fs from 'node:fs';
const responses = JSON.parse(fs.readFileSync(new URL('./responses.json', import.meta.url), 'utf8'));
let index = 0;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const request = {
    path: parsed.pathname, method: options.method || 'GET',
    body: options.body ? JSON.parse(options.body) : null,
    headers: options.headers || {},
  };
  fs.appendFileSync(new URL('./requests.jsonl', import.meta.url), JSON.stringify(request) + '\\n');
  const expected = responses[index++];
  if (parsed.origin !== 'https://cli-test.invalid' || parsed.search !== '?auth=test-token'
      || !expected || request.method !== expected.method
      || (expected.path ? request.path !== expected.path : !new RegExp(expected.pathPattern).test(request.path))) {
    throw new Error('Unexpected stub request: ' + JSON.stringify(request));
  }
  return new Response(JSON.stringify(expected.body ?? null), {
    status: expected.status || 200, headers: { 'content-type': 'application/json' },
  });
};
`);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !key.startsWith('SETTLEUP_') && key !== 'NODE_OPTIONS'));
    const result = spawnSync(process.execPath, ['--import', mockPath, cliPath, ...args], {
      cwd: dir, encoding: 'utf8', timeout: 10_000,
      input: inputText ?? (input === undefined ? undefined : JSON.stringify(input)),
      env: {
        ...env, SETTLEUP_ENV: 'test', SETTLEUP_CLI_CONFIG_DIR: path.join(dir, 'config'),
        SETTLEUP_API_BASE_URL: 'https://cli-test.invalid',
        SETTLEUP_AUTH_BASE_URL: 'https://cli-test.invalid', SETTLEUP_FIREBASE_API_KEY: '',
        SETTLEUP_AUTH_STORAGE: 'file',
      },
    });
    assert.ifError(result.error);
    const requests = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(requests.length, responses.length, `Unexpected request count: ${result.stdout}`);
    return { status: result.status, stderr: result.stderr, output: JSON.parse(result.stdout), requests };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const groupFlags = ['--group-id', 'g_test'];
export const transactionFlags = [...groupFlags, '--transaction-id', 'tx_test'];
export const memberFlags = [...groupFlags, '--member-id', 'm_sid'];
export const membersResponse = {
  method: 'GET', path: '/members/g_test.json',
  body: { m_sid: { name: 'Sid' }, m_neha: { name: 'Neha' }, m_rohan: { name: 'Rohan' } },
};
