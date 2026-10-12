#!/usr/bin/env node
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createSessionStore } from './lib/session-store.mjs';
import { createBrowserLogin } from './lib/browser-login.mjs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin as input, stderr as promptOutput } from 'node:process';

loadDotEnv();

const ENVIRONMENT = process.env.SETTLEUP_ENV || 'production';
const DEFAULT_API_BASE_URL = ENVIRONMENT === 'production' ? 'https://settle-up-live.firebaseio.com' : '';
const DEFAULT_AUTH_BASE_URL = ENVIRONMENT === 'production' ? 'https://settleup-production.newdae.workers.dev' : '';
const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const API_BASE_URL = (process.env.SETTLEUP_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '');
const AUTH_BASE_URL = (process.env.SETTLEUP_AUTH_BASE_URL || DEFAULT_AUTH_BASE_URL || API_BASE_URL).replace(/\/$/, '');
const FIREBASE_API_KEY = process.env.SETTLEUP_FIREBASE_API_KEY || '';
const CONFIG_DIR = process.env.SETTLEUP_CLI_CONFIG_DIR
  || path.join(os.homedir(), '.config', 'settleup-cli');
const sessionStore = createSessionStore({
  configDir: CONFIG_DIR, environment: ENVIRONMENT, apiBaseUrl: API_BASE_URL,
  authBaseUrl: AUTH_BASE_URL, storage: process.env.SETTLEUP_AUTH_STORAGE || 'keyring',
});
const browserLogin = createBrowserLogin({
  configDir: CONFIG_DIR, environment: ENVIRONMENT, apiBaseUrl: API_BASE_URL, authBaseUrl: AUTH_BASE_URL,
  loginBaseUrl: process.env.SETTLEUP_LOGIN_BASE_URL ||
    (ENVIRONMENT === 'production' && !process.env.SETTLEUP_API_BASE_URL && !process.env.SETTLEUP_AUTH_BASE_URL && !FIREBASE_API_KEY
      ? 'https://settleupcli.pages.dev' : ''),
});
const META = { environment: ENVIRONMENT };
const ERROR_CODES = new Set([
  'AUTH_REQUIRED',
  'AUTH_INVALID',
  'AUTH_REFRESH_FAILED',
  'AUTH_STORAGE_FAILED',
  'INVALID_INPUT',
  'GROUP_NOT_FOUND',
  'GROUP_ACCESS_DENIED',
  'MEMBER_NOT_FOUND',
  'TRANSACTION_NOT_FOUND',
  'API_REQUEST_FAILED',
  'API_RATE_LIMITED',
  'SERVER_TASK_FAILED',
]);

function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env');
  let text;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || Object.hasOwn(process.env, key)) continue;
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function printJson(value, exitCode = 0) {
  console.log(JSON.stringify(value, null, 2));
  process.exit(exitCode);
}

function ok(data = {}) {
  return { ok: true, data, meta: META };
}

function fail(code, message, details = {}) {
  const stableCode = ERROR_CODES.has(code) ? code : 'API_REQUEST_FAILED';
  return { ok: false, error: { code: stableCode, message, details }, meta: META };
}

function requireApiBaseUrl() {
  if (!API_BASE_URL) {
    throw Object.assign(new Error('Missing SETTLEUP_API_BASE_URL; set it in the environment or local .env'), {
      cliCode: 'INVALID_INPUT',
      details: { variable: 'SETTLEUP_API_BASE_URL', environment: ENVIRONMENT },
    });
  }
  return API_BASE_URL;
}

function requireAuthBaseUrl() {
  if (!AUTH_BASE_URL) {
    throw Object.assign(new Error('Missing SETTLEUP_AUTH_BASE_URL or SETTLEUP_API_BASE_URL; set one in the environment or local .env'), {
      cliCode: 'INVALID_INPUT',
      details: { variable: 'SETTLEUP_AUTH_BASE_URL', environment: ENVIRONMENT },
    });
  }
  return AUTH_BASE_URL;
}

function apiUrl(apiPath) {
  const base = requireApiBaseUrl();
  const clean = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${base}${clean}`;
}

function authUrl(authPath) {
  const base = requireAuthBaseUrl();
  const clean = authPath.startsWith('/') ? authPath : `/${authPath}`;
  return `${base}${clean}`;
}

function unwrapApiEnvelope(json) {
  if (json?.ok === true && json.data && typeof json.data === 'object') return json.data;
  if (json?.ok === false && json.error) {
    throw Object.assign(new Error(json.error.message || 'API request failed'), {
      cliCode: json.error.code || 'API_REQUEST_FAILED',
      details: json.error.details || {},
    });
  }
  return json;
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw Object.assign(new Error(`Missing required flag: --${name}`), {
      cliCode: 'INVALID_INPUT',
      details: {},
    });
  }
  return value;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return { positional, flags };
}

async function promptCredentials() {
  let hideOutput = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!hideOutput) promptOutput.write(chunk, encoding);
      callback();
    },
  });
  const rl = readline.createInterface({ input, output, terminal: true });
  const controller = new AbortController();
  rl.once('SIGINT', () => controller.abort());
  rl.once('close', () => controller.abort());
  try {
    const email = await rl.question('Email: ', { signal: controller.signal });
    promptOutput.write('Password: ');
    hideOutput = true;
    const password = await rl.question('', { signal: controller.signal });
    return { email, password };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw Object.assign(new Error('Login cancelled'), { cliCode: 'INVALID_INPUT' });
    }
    throw error;
  } finally {
    hideOutput = false;
    promptOutput.write('\n');
    rl.close();
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (response.status === 429) {
    throw Object.assign(new Error('API rate limit reached'), {
      cliCode: 'API_RATE_LIMITED',
      details: { status: response.status, body: json },
    });
  }
  if (!response.ok) {
    throw Object.assign(new Error(json?.error?.message || json?.error || `API request failed with ${response.status}`), {
      cliCode: response.status === 401 || response.status === 403 ? 'GROUP_ACCESS_DENIED' : 'API_REQUEST_FAILED',
      details: { status: response.status, body: json },
    });
  }
  return json;
}

async function fetchApiData(apiPath, options = {}) {
  return unwrapApiEnvelope(await fetchJson(apiUrl(apiPath), options));
}

async function signInWithFirebase(email, password) {
  const json = await fetchJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  return {
    accessToken: json.idToken,
    refreshToken: json.refreshToken,
    uid: json.localId,
    email: json.email || email,
    expiresAt: Date.now() + (Number(json.expiresIn) * 1000),
  };
}

async function refreshWithFirebase(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const json = await fetchJson(
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }
  );
  return {
    accessToken: json.id_token,
    refreshToken: json.refresh_token,
    uid: json.user_id,
    expiresAt: Date.now() + (Number(json.expires_in) * 1000),
  };
}

async function refreshAuth(auth) {
  const json = FIREBASE_API_KEY
    ? await refreshWithFirebase(auth.refreshToken)
    : unwrapApiEnvelope(await fetchJson(authUrl('/auth/refresh'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    }));
  const accessToken = json.accessToken || json.idToken;
  const next = {
    ...auth,
    accessToken,
    idToken: accessToken,
    refreshToken: json.refreshToken || auth.refreshToken,
    uid: json.uid || auth.uid,
    email: json.email || auth.email,
    expiresAt: json.expiresAt || Date.now() + (Number(json.expiresIn || json.expires_in) * 1000),
  };
  if (!next.accessToken || !next.refreshToken || !next.uid || !Number.isFinite(next.expiresAt)) {
    throw Object.assign(new Error('Auth refresh response did not include a complete session'), {
      cliCode: 'AUTH_REFRESH_FAILED',
      details: { required: ['accessToken', 'refreshToken', 'uid', 'expiresAt'] },
    });
  }
  await sessionStore.write(next);
  return next;
}

async function requireAuth() {
  const auth = await sessionStore.read();
  if (!(auth?.accessToken || auth?.idToken) || !auth?.refreshToken || !auth?.uid) {
    throw Object.assign(new Error('Run `settleup auth login` first'), {
      cliCode: 'AUTH_REQUIRED',
      details: {},
    });
  }
  if (!auth.expiresAt || auth.expiresAt - Date.now() < 60_000) {
    try {
      return await refreshAuth(auth);
    } catch (error) {
      if (error.cliCode === 'AUTH_STORAGE_FAILED') throw error;
      throw Object.assign(new Error('Stored session could not be refreshed'), {
        cliCode: 'AUTH_REFRESH_FAILED',
        details: { cause: error.message },
      });
    }
  }
  return auth;
}

function dbUrl(dbPath, idToken) {
  const clean = dbPath.startsWith('/') ? dbPath : `/${dbPath}`;
  return `${requireApiBaseUrl()}${clean}.json?auth=${encodeURIComponent(idToken)}`;
}

async function dbGet(dbPath, auth) {
  return fetchJson(dbUrl(dbPath, auth.accessToken || auth.idToken));
}

async function dbPut(dbPath, auth, body) {
  try {
    return await fetchJson(dbUrl(dbPath, auth.accessToken || auth.idToken), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    error.details = { ...(error.details || {}), path: dbPath, method: 'PUT' };
    throw error;
  }
}

async function dbPatch(dbPath, auth, body) {
  try {
    return await fetchJson(dbUrl(dbPath, auth.accessToken || auth.idToken), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    error.details = { ...(error.details || {}), path: dbPath, method: 'PATCH' };
    throw error;
  }
}

async function dbPost(dbPath, auth, body) {
  return fetchJson(dbUrl(dbPath, auth.accessToken || auth.idToken), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function dbDelete(dbPath, auth) {
  return fetchJson(dbUrl(dbPath, auth.accessToken || auth.idToken), { method: 'DELETE' });
}

function readInput(inputFlag) {
  if (typeof inputFlag !== 'string' || inputFlag.length === 0) {
    throw Object.assign(new Error('Missing required flag: --input'), {
      cliCode: 'INVALID_INPUT',
      details: {},
    });
  }
  let text;
  try {
    text = inputFlag === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(inputFlag, 'utf8');
  } catch {
    throw Object.assign(new Error('Could not read JSON input; check the input path and file permissions'), {
      cliCode: 'INVALID_INPUT', details: { inputPath: inputFlag },
    });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw Object.assign(new Error(`Invalid JSON input: ${error.message}`), {
      cliCode: 'INVALID_INPUT',
      details: {},
    });
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw Object.assign(new Error(`Missing or invalid field: ${name}`), { cliCode: 'INVALID_INPUT', details: {} });
  }
}

function assertDecimalString(value, name) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    throw Object.assign(new Error(`Invalid decimal string field: ${name}`), { cliCode: 'INVALID_INPUT', details: {} });
  }
}

function assertCurrency(value, name = 'currencyCode') {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
    throw Object.assign(new Error(`Invalid ${name}; expected three uppercase letters`), {
      cliCode: 'INVALID_INPUT', details: {},
    });
  }
}

function assertEpochMillis(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw Object.assign(new Error(`Invalid epoch millis field: ${name}`), { cliCode: 'INVALID_INPUT', details: {} });
  }
}

function assertTimezone(value) {
  if (value !== undefined && (typeof value !== 'string' || !/^[+-](0\d|1\d|2[0-3]):[0-5]\d$/.test(value))) {
    throw Object.assign(new Error('Invalid timezone offset'), { cliCode: 'INVALID_INPUT', details: {} });
  }
}

function assertWeightedRef(ref, name) {
  if (!isObject(ref)) throw Object.assign(new Error(`Invalid ${name}`), { cliCode: 'INVALID_INPUT', details: {} });
  assertNonEmptyString(ref.memberId, `${name}.memberId`);
  assertDecimalString(ref.weight, `${name}.weight`);
}

function assertMemberInput(input, { partial = false } = {}) {
  if (!isObject(input)) throw Object.assign(new Error('Input must be an object'), { cliCode: 'INVALID_INPUT', details: {} });
  if (!partial || Object.hasOwn(input, 'name')) assertNonEmptyString(input.name, 'name');
  if (Object.hasOwn(input, 'active') && typeof input.active !== 'boolean') {
    throw Object.assign(new Error('Invalid field: active'), { cliCode: 'INVALID_INPUT', details: {} });
  }
  if (Object.hasOwn(input, 'defaultWeight')) assertDecimalString(input.defaultWeight, 'defaultWeight');
  for (const nullable of ['photoUrl', 'bankAccount', 'lightningAddress']) {
    if (Object.hasOwn(input, nullable) && input[nullable] !== null && typeof input[nullable] !== 'string') {
      throw Object.assign(new Error(`Invalid field: ${nullable}`), { cliCode: 'INVALID_INPUT', details: {} });
    }
  }
}

// Settle Up's own clients create groups with POST /groups, so group IDs are
// Firebase push IDs. The CLI must write permissions before the group exists,
// so it generates the same format locally: 8 time characters, 12 random.
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

function generatePushId(now = Date.now()) {
  let time = '';
  for (let i = 0; i < 8; i += 1) {
    time = PUSH_CHARS[now % 64] + time;
    now = Math.floor(now / 64);
  }
  const random = Array.from(randomBytes(12), (byte) => PUSH_CHARS[byte % 64]).join('');
  return time + random;
}

// The backend rejects new members and transactions that omit these fields
// (401 "Permission denied"), so creates fill them with the app's defaults.
function withMemberDefaults(member) {
  return { active: true, defaultWeight: '1', ...member };
}

function withTransactionDefaults(transaction) {
  return { fixedExchangeRate: false, ...transaction };
}

function assertGroupInput(input) {
  if (!isObject(input)) throw Object.assign(new Error('Input must be an object'), { cliCode: 'INVALID_INPUT', details: {} });
  assertNonEmptyString(input.name, 'name');
  assertCurrency(input.convertedToCurrency, 'convertedToCurrency');
  if (Object.hasOwn(input, 'defaultPermission') && ![10, 20, 30].includes(input.defaultPermission)) {
    throw Object.assign(new Error('Invalid field: defaultPermission'), { cliCode: 'INVALID_INPUT', details: {} });
  }
  if (Object.hasOwn(input, 'minimizeDebts') && typeof input.minimizeDebts !== 'boolean') {
    throw Object.assign(new Error('Invalid field: minimizeDebts'), { cliCode: 'INVALID_INPUT', details: {} });
  }
  if (Object.hasOwn(input, 'remindOldDebts') && typeof input.remindOldDebts !== 'boolean') {
    throw Object.assign(new Error('Invalid field: remindOldDebts'), { cliCode: 'INVALID_INPUT', details: {} });
  }
  if (Object.hasOwn(input, 'ownerColor') && typeof input.ownerColor !== 'string') {
    throw Object.assign(new Error('Invalid field: ownerColor'), { cliCode: 'INVALID_INPUT', details: {} });
  }
  if (Object.hasOwn(input, 'inviteLinkActive') && typeof input.inviteLinkActive !== 'boolean') {
    throw Object.assign(new Error('Invalid field: inviteLinkActive'), { cliCode: 'INVALID_INPUT', details: {} });
  }
  assertMemberInput(input.firstMember);
}

function assertTransactionInput(input, type) {
  if (!isObject(input)) throw Object.assign(new Error('Input must be an object'), { cliCode: 'INVALID_INPUT', details: {} });
  if (input.type !== type) {
    throw Object.assign(new Error(`Expected transaction type ${type}`), {
      cliCode: 'INVALID_INPUT',
      details: {},
    });
  }
  assertNonEmptyString(input.purpose, 'purpose');
  assertCurrency(input.currencyCode);
  assertEpochMillis(input.dateTime, 'dateTime');
  assertTimezone(input.timezone);
  if (Object.hasOwn(input, 'category') && typeof input.category !== 'string') {
    throw Object.assign(new Error('Invalid field: category'), { cliCode: 'INVALID_INPUT', details: {} });
  }
  if (Object.hasOwn(input, 'fixedExchangeRate') && typeof input.fixedExchangeRate !== 'boolean') {
    throw Object.assign(new Error('Invalid field: fixedExchangeRate'), { cliCode: 'INVALID_INPUT', details: {} });
  }
  if (Object.hasOwn(input, 'exchangeRates')) {
    if (!isObject(input.exchangeRates)) {
      throw Object.assign(new Error('Invalid field: exchangeRates'), { cliCode: 'INVALID_INPUT', details: {} });
    }
    for (const [code, rate] of Object.entries(input.exchangeRates)) {
      assertCurrency(code, `exchangeRates.${code} currencyCode`);
      assertDecimalString(rate, `exchangeRates.${code}`);
    }
  }
  for (const nullable of ['receiptUrl', 'templateId']) {
    if (Object.hasOwn(input, nullable) && input[nullable] !== null && typeof input[nullable] !== 'string') {
      throw Object.assign(new Error(`Invalid field: ${nullable}`), { cliCode: 'INVALID_INPUT', details: {} });
    }
  }
  if (!Array.isArray(input.whoPaid) || input.whoPaid.length === 0) {
    throw Object.assign(new Error('Missing required field: whoPaid'), {
      cliCode: 'INVALID_INPUT',
      details: {},
    });
  }
  input.whoPaid.forEach((ref, index) => assertWeightedRef(ref, `whoPaid[${index}]`));
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw Object.assign(new Error('Missing required field: items'), { cliCode: 'INVALID_INPUT', details: {} });
  }
  input.items.forEach((item, index) => {
    if (!isObject(item)) throw Object.assign(new Error(`Invalid items[${index}]`), { cliCode: 'INVALID_INPUT', details: {} });
    assertDecimalString(item.amount, `items[${index}].amount`);
    if (!Array.isArray(item.forWhom) || item.forWhom.length === 0) {
      throw Object.assign(new Error(`Missing items[${index}].forWhom`), { cliCode: 'INVALID_INPUT', details: {} });
    }
    item.forWhom.forEach((ref, refIndex) => assertWeightedRef(ref, `items[${index}].forWhom[${refIndex}]`));
  });
}

function assertTransactionPatch(input) {
  if (!isObject(input)) throw Object.assign(new Error('Input must be an object'), { cliCode: 'INVALID_INPUT', details: {} });
  if (Object.hasOwn(input, 'type')) {
    throw Object.assign(new Error('Transaction type is not patchable'), {
      cliCode: 'INVALID_INPUT',
      details: {},
    });
  }
  const merged = {
    type: 'expense',
    purpose: input.purpose || 'x',
    currencyCode: input.currencyCode || 'USD',
    dateTime: input.dateTime || 1,
    whoPaid: input.whoPaid || [{ memberId: 'm', weight: '1' }],
    items: input.items || [{ amount: '1', forWhom: [{ memberId: 'm', weight: '1' }] }],
    ...input,
  };
  assertTransactionInput(merged, 'expense');
}

async function assertMembersExist(groupId, auth, ids) {
  const members = await dbGet(`/members/${groupId}`, auth);
  const missing = [...new Set(ids)].filter((id) => !members || !members[id]);
  if (missing.length > 0) {
    throw Object.assign(new Error(`Member not found: ${missing.join(', ')}`), {
      cliCode: 'MEMBER_NOT_FOUND',
      details: { memberIds: missing },
    });
  }
}

function collectTransactionMembers(input) {
  return [
    ...input.whoPaid.map((ref) => ref.memberId),
    ...input.items.flatMap((item) => item.forWhom.map((ref) => ref.memberId)),
  ];
}

function withIdMap(map) {
  return Object.entries(map || {}).map(([id, value]) => ({ id, ...value }));
}

function normalizeDebts(raw) {
  if (raw === null) return [];
  if (Array.isArray(raw)) return raw;
  if (!isObject(raw)) return raw;
  const debts = [];
  for (const [from, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      debts.push(...value);
    } else if (isObject(value)) {
      for (const [to, amount] of Object.entries(value)) {
        if (typeof amount === 'string' || typeof amount === 'number') {
          debts.push({ from, to, amount: String(amount) });
        } else if (isObject(amount)) {
          debts.push({ from, to, ...amount });
        }
      }
    }
  }
  return debts;
}

function invalidFlag(name, expected) {
  return Object.assign(new Error(`Invalid --${name}; expected ${expected}`), { cliCode: 'INVALID_INPUT', details: {} });
}

// Optional flags must carry a value; a bare `--category` would otherwise
// filter on `true` and silently return nothing.
function optionalFlag(flags, name, expected = 'a value') {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) throw invalidFlag(name, expected);
  return value;
}

function parseLimit(flags) {
  const value = optionalFlag(flags, 'limit', 'a positive integer');
  if (value === undefined) return null;
  if (!/^[1-9]\d*$/.test(value)) throw invalidFlag('limit', 'a positive integer');
  return Number(value);
}

function parseOrder(flags) {
  const value = optionalFlag(flags, 'order', 'asc or desc') ?? 'asc';
  if (!['asc', 'desc'].includes(value)) throw invalidFlag('order', 'asc or desc');
  return value;
}

function parseDateBound(flags, name, endOfDay = false) {
  const value = optionalFlag(flags, name, 'YYYY-MM-DD or epoch milliseconds');
  if (value === undefined) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = match && new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // Reject impossible dates such as 2026-02-30, which Date would roll over.
  if (!date || date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
    throw invalidFlag(name, 'YYYY-MM-DD or epoch milliseconds');
  }
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function transactionIncludesMember(tx, memberId) {
  return tx.whoPaid?.some((ref) => ref.memberId === memberId)
    || tx.items?.some((item) => item.forWhom?.some((ref) => ref.memberId === memberId));
}

const HELP = {
  groups: {
    auth: 'Authenticate and manage the local session.',
    users: 'Read the authenticated Settle Up user profile.',
    groups: 'List, fetch, and create groups.',
    members: 'List, fetch, create, and patch group members.',
    categories: 'List and patch group category labels.',
    transactions: 'List, fetch, patch, and delete raw transactions.',
    expenses: 'Create expense transactions.',
    transfers: 'Create transfer transactions, including settlements.',
    debts: 'Read server-calculated debts and trigger recalculation.',
    changes: 'Read the group change log.',
    schema: 'Show JSON input contracts for write commands.',
  },
  commands: {
    auth: {
      login: {
        synopsis: 'settleup auth login [--browser | --complete [--wait]]',
        purpose: 'Authenticate user and store the session in the OS credential store (or explicit file storage). Agents: use --browser, show the user loginUrl, then --complete after they sign in.',
        operation: 'authenticates',
        requiredFlags: [],
        optionalFlags: ['--browser (create a private browser login link)', '--complete (retrieve the encrypted session)', '--wait (with --complete, poll until signed in or expired)'],
        identifiers: ['uid in output'],
        example: 'settleup auth login --browser',
      },
      status: {
        synopsis: 'settleup auth status',
        purpose: 'Show selected credential storage and whether a local session is available.',
        operation: 'reads local session',
        requiredFlags: [],
        optionalFlags: [],
        identifiers: ['uid in output'],
        example: 'settleup auth status',
      },
      logout: {
        synopsis: 'settleup auth logout',
        purpose: 'Delete the local session.',
        operation: 'deletes local session',
        requiredFlags: [],
        optionalFlags: [],
        identifiers: [],
        example: 'settleup auth logout',
      },
    },
    users: {
      me: {
        synopsis: 'settleup users me',
        purpose: 'Fetch /users/<uid> for the authenticated user.',
        operation: 'reads raw data',
        requiredFlags: [],
        optionalFlags: [],
        identifiers: ['uid from auth session'],
        example: 'settleup users me',
      },
    },
    groups: {
      list: {
        synopsis: 'settleup groups list',
        purpose: 'List groups accessible to the current user.',
        operation: 'reads raw data',
        requiredFlags: [],
        optionalFlags: [],
        identifiers: ['uid from auth session', 'groupId in output'],
        example: 'settleup groups list',
      },
      get: {
        synopsis: 'settleup groups get --group-id <groupId>',
        purpose: 'Fetch one group, permissions, and caller membership.',
        operation: 'reads raw data',
        requiredFlags: ['--group-id <groupId>'],
        optionalFlags: [],
        identifiers: ['groupId', 'uid from auth session', 'memberId in userGroup.member'],
        example: 'settleup groups get --group-id group_1',
      },
      create: {
        synopsis: 'settleup groups create --input -|<path>',
        purpose: 'Create a group and first member using the permission-stub flow.',
        operation: 'creates records',
        inputType: 'CreateGroupInput',
        schemaHelp: 'settleup schema groups.create',
        requiredFlags: ['--input -|<path>'],
        optionalFlags: [],
        identifiers: ['uid from auth session', 'groupId generated by CLI', 'memberId generated for firstMember'],
        example: 'settleup groups create --input group.json',
      },
    },
    members: {
      list: {
        synopsis: 'settleup members list --group-id <groupId> [--active-only]',
        purpose: 'List members in a group.',
        operation: 'reads raw data',
        requiredFlags: ['--group-id <groupId>'],
        optionalFlags: ['--active-only'],
        identifiers: ['groupId', 'memberId in output'],
        example: 'settleup members list --group-id group_1 --active-only',
      },
      get: {
        synopsis: 'settleup members get --group-id <groupId> --member-id <memberId>',
        purpose: 'Fetch one member.',
        operation: 'reads raw data',
        requiredFlags: ['--group-id <groupId>', '--member-id <memberId>'],
        optionalFlags: [],
        identifiers: ['groupId', 'memberId'],
        example: 'settleup members get --group-id group_1 --member-id member_1',
      },
      add: {
        synopsis: 'settleup members add --group-id <groupId> --input -|<path>',
        purpose: 'Create a member in a group.',
        operation: 'creates a record',
        inputType: 'MemberInput',
        schemaHelp: 'settleup schema members.add',
        requiredFlags: ['--group-id <groupId>', '--input -|<path>'],
        optionalFlags: [],
        identifiers: ['groupId', 'memberId generated by API'],
        example: 'settleup members add --group-id group_1 --input member.json',
      },
      update: {
        synopsis: 'settleup members update --group-id <groupId> --member-id <memberId> --input -|<path>',
        purpose: 'Patch selected member fields.',
        operation: 'patches selected fields',
        inputType: 'MemberPatchInput',
        schemaHelp: 'settleup schema members.update',
        patchSemantics: 'Omitted keys remain unchanged; nullable fields can be cleared with null.',
        requiredFlags: ['--group-id <groupId>', '--member-id <memberId>', '--input -|<path>'],
        optionalFlags: [],
        identifiers: ['groupId', 'memberId'],
        example: 'settleup members update --group-id group_1 --member-id member_1 --input patch.json',
      },
    },
    categories: {
      list: {
        synopsis: 'settleup categories list --group-id <groupId>',
        purpose: 'List custom category mappings.',
        operation: 'reads raw data',
        requiredFlags: ['--group-id <groupId>'],
        optionalFlags: [],
        identifiers: ['groupId'],
        example: 'settleup categories list --group-id group_1',
      },
      set: {
        synopsis: 'settleup categories set --group-id <groupId> --input -|<path>',
        purpose: 'Patch category mappings.',
        operation: 'patches selected mappings',
        inputType: 'SetCategoriesInput',
        schemaHelp: 'settleup schema categories.set',
        requiredFlags: ['--group-id <groupId>', '--input -|<path>'],
        optionalFlags: [],
        identifiers: ['groupId'],
        example: 'settleup categories set --group-id group_1 --input categories.json',
      },
    },
    transactions: {
      list: {
        synopsis: 'settleup transactions list --group-id <groupId> [filters...]',
        purpose: 'List raw transactions with client-side filtering.',
        operation: 'reads raw data',
        requiredFlags: ['--group-id <groupId>'],
        optionalFlags: ['--type expense|transfer', '--from <YYYY-MM-DD|epochMillis>', '--to <YYYY-MM-DD|epochMillis>', '--member-id <memberId>', '--paid-by-member-id <memberId>', '--category <categoryKey>', '--limit <n>', '--order asc|desc'],
        identifiers: ['groupId', 'memberId in filters', 'transactionId in output'],
        example: 'settleup transactions list --group-id group_1 --member-id member_1 --category food',
      },
      get: {
        synopsis: 'settleup transactions get --group-id <groupId> --transaction-id <transactionId>',
        purpose: 'Fetch one transaction.',
        operation: 'reads raw data',
        requiredFlags: ['--group-id <groupId>', '--transaction-id <transactionId>'],
        optionalFlags: [],
        identifiers: ['groupId', 'transactionId'],
        example: 'settleup transactions get --group-id group_1 --transaction-id tx_1',
      },
      update: {
        synopsis: 'settleup transactions update --group-id <groupId> --transaction-id <transactionId> --input -|<path>',
        purpose: 'Patch selected transaction fields.',
        operation: 'patches selected fields',
        inputType: 'TransactionPatchInput',
        schemaHelp: 'settleup schema transactions.update',
        patchSemantics: 'Omitted keys remain unchanged; provided arrays replace the full stored array; provided objects replace the full stored object; type is not patchable.',
        requiredFlags: ['--group-id <groupId>', '--transaction-id <transactionId>', '--input -|<path>'],
        optionalFlags: [],
        identifiers: ['groupId', 'transactionId', 'memberId in whoPaid/items'],
        example: 'settleup transactions update --group-id group_1 --transaction-id tx_1 --input patch.json',
      },
      delete: {
        synopsis: 'settleup transactions delete --group-id <groupId> --transaction-id <transactionId>',
        purpose: 'Delete one transaction.',
        operation: 'deletes a record',
        requiredFlags: ['--group-id <groupId>', '--transaction-id <transactionId>'],
        optionalFlags: [],
        identifiers: ['groupId', 'transactionId'],
        example: 'settleup transactions delete --group-id group_1 --transaction-id tx_1',
      },
    },
    expenses: {
      create: {
        synopsis: 'settleup expenses create --group-id <groupId> --input -|<path>',
        purpose: 'Create an expense transaction.',
        operation: 'creates a record',
        inputType: 'ExpenseInput',
        schemaHelp: 'settleup schema expenses.create',
        requiredFlags: ['--group-id <groupId>', '--input -|<path>'],
        optionalFlags: [],
        identifiers: ['groupId', 'memberId in whoPaid/items', 'transactionId generated by API'],
        example: 'settleup expenses create --group-id group_1 --input expense.json',
      },
    },
    transfers: {
      create: {
        synopsis: 'settleup transfers create --group-id <groupId> --input -|<path>',
        purpose: 'Create a transfer transaction; this is how debts are settled.',
        operation: 'creates a record',
        inputType: 'TransferInput',
        schemaHelp: 'settleup schema transfers.create',
        requiredFlags: ['--group-id <groupId>', '--input -|<path>'],
        optionalFlags: [],
        identifiers: ['groupId', 'memberId in whoPaid/items', 'transactionId generated by API'],
        example: 'settleup transfers create --group-id group_1 --input transfer.json',
      },
    },
    debts: {
      list: {
        synopsis: 'settleup debts list --group-id <groupId>',
        purpose: 'Fetch server-calculated debts.',
        operation: 'reads derived data',
        requiredFlags: ['--group-id <groupId>'],
        optionalFlags: [],
        identifiers: ['groupId', 'memberId in from/to debt rows'],
        example: 'settleup debts list --group-id group_1',
      },
      recalculate: {
        synopsis: 'settleup debts recalculate --group-id <groupId>',
        purpose: 'Trigger backend recalculation of derived debts from current transactions.',
        operation: 'creates a server task',
        requiredFlags: ['--group-id <groupId>'],
        optionalFlags: [],
        identifiers: ['groupId'],
        example: 'settleup debts recalculate --group-id group_1',
      },
    },
    changes: {
      list: {
        synopsis: 'settleup changes list --group-id <groupId> [--limit <n>] [--order asc|desc]',
        purpose: 'Fetch the group change log.',
        operation: 'reads raw data',
        requiredFlags: ['--group-id <groupId>'],
        optionalFlags: ['--limit <n>', '--order asc|desc'],
        identifiers: ['groupId'],
        example: 'settleup changes list --group-id group_1 --limit 10 --order desc',
      },
    },
    schema: {
      '<command>': {
        synopsis: 'settleup schema <command>',
        purpose: 'Print the JSON input contract for a write command.',
        operation: 'prints schema',
        requiredFlags: [],
        optionalFlags: [],
        identifiers: [],
        example: 'settleup schema expenses.create',
      },
    },
  },
};

function helpText(group, command) {
  if (!group) {
    return {
      synopsis: 'settleup <group> <command> [flags]',
      commandGroups: HELP.groups,
      examples: ['settleup auth login', 'settleup groups create --input group.json', 'settleup schema expenses.create'],
    };
  }
  if (!HELP.commands[group]) {
    return {
      error: `Unknown command group: ${group}`,
      commandGroups: HELP.groups,
    };
  }
  if (!command) {
    return {
      group,
      purpose: HELP.groups[group],
      subcommands: Object.fromEntries(
        Object.entries(HELP.commands[group]).map(([name, details]) => [
          name,
          {
            synopsis: details.synopsis,
            purpose: details.purpose,
            requiredFlags: details.requiredFlags,
          },
        ])
      ),
    };
  }
  return HELP.commands[group][command] || {
    error: `Unknown command: ${group} ${command}`,
    availableSubcommands: Object.keys(HELP.commands[group]),
  };
}

const SCHEMAS = {
  'groups.create': {
    required: ['name', 'convertedToCurrency', 'firstMember'],
    example: {
      name: 'Goa Trip',
      convertedToCurrency: 'INR',
      defaultPermission: 10,
      minimizeDebts: true,
      remindOldDebts: true,
      firstMember: { name: 'Anshul', active: true, defaultWeight: '1', photoUrl: null, bankAccount: null, lightningAddress: null },
    },
  },
  'members.add': {
    required: ['name'],
    example: { name: 'Sid', active: true, defaultWeight: '1', photoUrl: null, bankAccount: null, lightningAddress: null },
  },
  'members.update': {
    required: [],
    patch: 'Omitted keys remain unchanged; nullable fields can be cleared with null.',
    example: { name: 'Siddharth', defaultWeight: '1.5' },
  },
  'expenses.create': {
    required: ['type', 'purpose', 'currencyCode', 'dateTime', 'whoPaid', 'items'],
    example: {
      type: 'expense',
      purpose: 'Dinner',
      category: 'food',
      currencyCode: 'USD',
      dateTime: 1777824000000,
      timezone: '+05:30',
      fixedExchangeRate: false,
      exchangeRates: {},
      receiptUrl: null,
      templateId: null,
      whoPaid: [{ memberId: 'member_id_1', weight: '1' }],
      items: [{ amount: '42.50', forWhom: [{ memberId: 'member_id_1', weight: '1' }] }],
    },
  },
  'transfers.create': {
    required: ['type', 'purpose', 'currencyCode', 'dateTime', 'whoPaid', 'items'],
    example: {
      type: 'transfer',
      purpose: 'Settlement',
      category: 'transfer',
      currencyCode: 'USD',
      dateTime: 1777827600000,
      timezone: '+05:30',
      fixedExchangeRate: false,
      exchangeRates: {},
      receiptUrl: null,
      templateId: null,
      whoPaid: [{ memberId: 'member_id_2', weight: '1' }],
      items: [{ amount: '21.25', forWhom: [{ memberId: 'member_id_1', weight: '1' }] }],
    },
  },
  'transactions.update': {
    required: [],
    patch: 'Omitted keys remain unchanged; whoPaid/items/exchangeRates replace full stored arrays or object.',
    example: { purpose: 'Dinner updated', items: [{ amount: '45', forWhom: [{ memberId: 'member_id_1', weight: '1' }] }] },
  },
  'categories.set': {
    required: ['categories'],
    example: { categories: { food: 'Food', taxi: 'Transport' } },
  },
};

// Field descriptions are shared across schema output; runtime validation remains
// in the existing validators. This is discovery metadata, not a validation engine.
function describeFields(fields, required = []) {
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => [
    name, { ...field, required: required.includes(name) },
  ]));
}

const MEMBER_FIELDS = {
  name: { type: 'string', description: 'Nonempty member display name.' },
  active: { type: 'boolean', description: 'Whether this member is included by default in future transactions; defaults to true when a member is created.' },
  defaultWeight: { type: 'string', format: 'decimal-string', description: 'Default relative split share; "1" is a normal equal share, not a monetary amount. Defaults to "1" when a member is created.' },
  photoUrl: { type: 'string', nullable: true, description: 'Avatar URL; null clears it.' },
  bankAccount: { type: 'string', nullable: true, description: 'Bank account or payout reference for settlement; null clears it.' },
  lightningAddress: { type: 'string', nullable: true, description: 'Lightning payment address; null clears it.' },
};
const WEIGHTED_MEMBER_FIELDS = describeFields({
  memberId: { type: 'string', description: 'Exact participant ID in this group, not the account uid.' },
  weight: { type: 'string', format: 'decimal-string', description: 'Relative contribution or split share; "1" gives one equal share, not a monetary amount.' },
}, ['memberId', 'weight']);
const WEIGHTED_MEMBERS = {
  type: 'array', minItems: 1,
  items: { type: 'object', fields: WEIGHTED_MEMBER_FIELDS },
};
const TRANSACTION_FIELDS = {
  purpose: { type: 'string', description: 'Nonempty label describing the expense or payment.' },
  category: { type: 'string', description: 'Category key or emoji.' },
  currencyCode: { type: 'string', format: 'currency-code', description: 'Three uppercase letters for the transaction currency, e.g. USD or INR.' },
  dateTime: { type: 'integer', format: 'epoch-milliseconds', description: 'Nonnegative timestamp when the transaction occurred; not an ISO date string.' },
  timezone: { type: 'string', format: 'timezone-offset', description: 'Offset in ±HH:MM format, e.g. +05:30; not a timezone name.' },
  fixedExchangeRate: { type: 'boolean', description: 'Whether exchange rates were fixed manually; defaults to false when a transaction is created.' },
  exchangeRates: {
    type: 'object', description: 'Conversion rates from currencyCode to target currencies; a patch replaces the entire map.',
    keys: { type: 'string', format: 'currency-code', description: 'Target currency, e.g. USD.' },
    values: { type: 'string', format: 'decimal-string', description: 'Rate as a nonnegative decimal string.' },
  },
  receiptUrl: { type: 'string', nullable: true, description: 'Receipt image/document URL; null clears it.' },
  templateId: { type: 'string', nullable: true, description: 'Recurring/future transaction template reference; null clears it.' },
  whoPaid: { ...WEIGHTED_MEMBERS, description: 'Members who paid, weighted by their relative contributions; a patch replaces the complete payer array.' },
  items: {
    type: 'array', minItems: 1, description: 'Line amounts and participant allocations; a patch replaces the complete item array.',
    items: {
      type: 'object', fields: describeFields({
        amount: { type: 'string', format: 'decimal-string', description: 'Line amount in the transaction currency, e.g. "42.50"; not a number.' },
        forWhom: { ...WEIGHTED_MEMBERS, description: 'Members allocated this line amount, weighted by relative shares.' },
      }, ['amount', 'forWhom']),
    },
  },
};

function schemaFields(command) {
  let fields;
  switch (command) {
    case 'groups.create':
      fields = {
        name: { type: 'string', description: 'Nonempty group display name.' },
        convertedToCurrency: { type: 'string', format: 'currency-code', description: 'Three uppercase letters for the currency used for balances and debts.' },
        defaultPermission: { type: 'integer', enum: [10, 20, 30], description: 'Default permission level assigned to new users.' },
        minimizeDebts: { type: 'boolean', description: 'Whether to minimize the number of settlement transfers.' },
        remindOldDebts: { type: 'boolean', description: 'Whether reminders for older debts are enabled.' },
        ownerColor: { type: 'string', description: 'Owner color; defaults to #ec1561 when omitted.' },
        inviteLinkActive: { type: 'boolean', description: 'Whether the group invite link is active; defaults to true.' },
        firstMember: { type: 'object', description: 'Creator as a participant in this group ledger.', fields: describeFields(MEMBER_FIELDS, ['name']) },
      };
      break;
    case 'members.add':
    case 'members.update':
      fields = MEMBER_FIELDS;
      break;
    case 'expenses.create':
    case 'transfers.create': {
      const type = command === 'expenses.create' ? 'expense' : 'transfer';
      fields = {
        type: { type: 'string', enum: [type], description: `Must be "${type}" for this command; transaction type cannot be patched.` },
        ...TRANSACTION_FIELDS,
      };
      if (type === 'transfer') {
        fields.whoPaid = { ...fields.whoPaid, description: 'Members sending the payment; for settlement, the debtor is the sender.' };
        fields.items = { ...fields.items, description: 'Payment amounts allocated to receivers in items[].forWhom; for settlement, the creditor receives.' };
      }
      break;
    }
    case 'transactions.update':
      fields = TRANSACTION_FIELDS;
      break;
    case 'categories.set':
      fields = {
        categories: {
          type: 'object', description: 'Merge supplied category labels into the group mapping.',
          keys: { type: 'string', description: 'Category key or emoji.' },
          values: { type: 'string', description: 'Custom display label.' },
        },
      };
      break;
  }
  return describeFields(fields, SCHEMAS[command].required);
}

function schemaOutput(command) {
  const [group, action] = command.split('.');
  return {
    command, ...SCHEMAS[command],
    inputType: HELP.commands[group][action].inputType,
    fields: schemaFields(command),
    invocation: HELP.commands[group][action].example,
  };
}

async function ensureUserRecord(auth) {
  const current = await dbGet(`/users/${auth.uid}`, auth);
  if (current && typeof current === 'object') return;
  await dbPut(`/users/${auth.uid}`, auth, {
    email: auth.email,
    name: auth.email.split('@')[0],
  });
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [group, command] = positional;
  if (flags.version) return printJson(ok({ version: VERSION }));
  if (flags.help || group === '--help' || !group) return printJson(ok({ help: helpText(group, command) }));

  if (group === 'schema') {
    if (!Object.hasOwn(SCHEMAS, command)) throw Object.assign(new Error(`Unknown schema command: ${command}`), { cliCode: 'INVALID_INPUT', details: {} });
    return printJson(ok(schemaOutput(command)));
  }

  if (group === 'auth' && command === 'login') {
    if ((flags.browser && flags.complete) || (flags.wait && !flags.complete)) {
      throw Object.assign(new Error('Use --browser to start, or --complete [--wait] to finish browser login'), { cliCode: 'INVALID_INPUT' });
    }
    if (flags.browser || flags.complete) {
      await sessionStore.check();
      if (flags.browser) return printJson(ok(await browserLogin.start()));
      const result = await browserLogin.complete({ wait: Boolean(flags.wait) });
      if (result.status === 'pending') return printJson(ok(result));
      const auth = result.session;
      if (typeof auth?.accessToken !== 'string' || !auth.accessToken
          || typeof auth.refreshToken !== 'string' || !auth.refreshToken
          || typeof auth.uid !== 'string' || !auth.uid
          || typeof auth.email !== 'string' || !auth.email
          || !Number.isFinite(auth.expiresAt) || auth.expiresAt <= Date.now()) {
        browserLogin.finish();
        throw Object.assign(new Error('Browser login did not return a complete session; start again'), { cliCode: 'AUTH_INVALID' });
      }
      try { await sessionStore.write(auth); } finally { browserLogin.finish(); }
      await ensureUserRecord(auth);
      return printJson(ok({ uid: auth.uid, email: auth.email, expiresAt: auth.expiresAt }));
    }
    let email;
    let password;
    if (input.isTTY) {
      ({ email, password } = await promptCredentials());
    } else {
      const [emailLine, passwordLine] = fs.readFileSync(0, 'utf8').split(/\r?\n/);
      email = emailLine;
      password = passwordLine;
    }
    assertNonEmptyString(email, 'email');
    assertNonEmptyString(password, 'password');
    await sessionStore.check();
    let json;
    try {
      json = FIREBASE_API_KEY
        ? await signInWithFirebase(email, password)
        : unwrapApiEnvelope(await fetchJson(authUrl('/auth/login'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        }));
    } catch (error) {
      // A rejected sign-in is a credentials problem, not a group-access or
      // connectivity one; Firebase answers 400 and hosted auth 401/403.
      if ([400, 401, 403].includes(error.details?.status) && !error.cliCode?.startsWith('AUTH_')) {
        throw Object.assign(new Error('Sign-in was rejected; check the email and password'), {
          cliCode: 'AUTH_INVALID', details: error.details,
        });
      }
      throw error;
    }
    const accessToken = json.accessToken || json.idToken;
    const auth = {
      accessToken,
      idToken: accessToken,
      refreshToken: json.refreshToken,
      uid: json.uid || json.localId,
      email: json.email || email,
      expiresAt: json.expiresAt || Date.now() + (Number(json.expiresIn) * 1000),
    };
    if (!auth.accessToken || !auth.refreshToken || !auth.uid || !Number.isFinite(auth.expiresAt)) {
      throw Object.assign(new Error('Auth response did not include a complete session'), {
        cliCode: 'AUTH_INVALID',
        details: { required: ['accessToken', 'refreshToken', 'uid', 'expiresAt'] },
      });
    }
    await sessionStore.write(auth);
    await ensureUserRecord(auth);
    return printJson(ok({ uid: auth.uid, email: auth.email, expiresAt: auth.expiresAt }));
  }

  if (group === 'auth' && command === 'status') {
    const auth = await sessionStore.read();
    return printJson(ok({
      authenticated: Boolean((auth?.accessToken || auth?.idToken) && auth?.refreshToken),
      storage: sessionStore.storage,
      uid: auth?.uid || null,
      email: auth?.email || null,
      expiresAt: auth?.expiresAt || null,
    }));
  }

  if (group === 'auth' && command === 'logout') {
    await browserLogin.cancel();
    await sessionStore.delete();
    return printJson(ok({ authenticated: false }));
  }

  if (!HELP.commands[group]?.[command]) {
    throw Object.assign(new Error(`Unknown command: ${[group, command].filter(Boolean).join(' ')}`), {
      cliCode: 'INVALID_INPUT',
      details: {},
    });
  }

  const auth = await requireAuth();

  if (group === 'users' && command === 'me') {
    return printJson(ok({ uid: auth.uid, user: await dbGet(`/users/${auth.uid}`, auth) }));
  }

  if (group === 'groups' && command === 'list') {
    const userGroups = await dbGet(`/userGroups/${auth.uid}`, auth);
    const groups = [];
    for (const [groupId, userGroup] of Object.entries(userGroups || {})) {
      groups.push({ id: groupId, userGroup, group: await dbGet(`/groups/${groupId}`, auth) });
    }
    return printJson(ok({ groups }));
  }

  if (group === 'groups' && command === 'get') {
    const groupId = requireFlag(flags, 'group-id');
    const groupRecord = await dbGet(`/groups/${groupId}`, auth);
    if (!groupRecord) throw Object.assign(new Error(`Group ${groupId} was not found`), { cliCode: 'GROUP_NOT_FOUND', details: { groupId } });
    return printJson(ok({
      id: groupId,
      group: groupRecord,
      permissions: await dbGet(`/permissions/${groupId}`, auth),
      userGroup: await dbGet(`/userGroups/${auth.uid}/${groupId}`, auth),
    }));
  }

  if (group === 'groups' && command === 'create') {
    const inputData = readInput(flags.input);
    assertGroupInput(inputData);
    const groupId = generatePushId();
    await dbPut(`/permissions/${groupId}/${auth.uid}`, auth, { level: 30 });
    await dbGet(`/groups/${groupId}`, auth);
    const groupPatch = {
      name: inputData.name,
      convertedToCurrency: inputData.convertedToCurrency,
      defaultPermission: inputData.defaultPermission ?? 10,
      minimizeDebts: inputData.minimizeDebts ?? true,
      remindOldDebts: inputData.remindOldDebts ?? true,
      ownerColor: inputData.ownerColor || '#ec1561',
      inviteLinkActive: inputData.inviteLinkActive ?? true,
    };
    await dbPatch(`/groups/${groupId}`, auth, groupPatch);
    const memberWrite = await dbPost(`/members/${groupId}`, auth, withMemberDefaults(inputData.firstMember));
    const memberId = memberWrite.name;
    const userGroup = { order: 1, color: '#ec1561', member: memberId };
    await dbPut(`/userGroups/${auth.uid}/${groupId}`, auth, userGroup);
    await dbPut(`/users/${auth.uid}/currentTabId`, auth, groupId);
    return printJson(ok({ groupId, firstMemberId: memberId, group: groupPatch, userGroup }));
  }

  if (group === 'members' && command === 'list') {
    const groupId = requireFlag(flags, 'group-id');
    let members = withIdMap(await dbGet(`/members/${groupId}`, auth));
    if (flags['active-only']) members = members.filter((member) => member.active);
    return printJson(ok({ groupId, members }));
  }

  if (group === 'members' && command === 'get') {
    const groupId = requireFlag(flags, 'group-id');
    const memberId = requireFlag(flags, 'member-id');
    const member = await dbGet(`/members/${groupId}/${memberId}`, auth);
    if (!member) throw Object.assign(new Error(`Member ${memberId} was not found`), { cliCode: 'MEMBER_NOT_FOUND', details: { groupId, memberId } });
    return printJson(ok({ id: memberId, ...member }));
  }

  if (group === 'members' && command === 'add') {
    const groupId = requireFlag(flags, 'group-id');
    const inputData = readInput(flags.input);
    assertMemberInput(inputData);
    const member = withMemberDefaults(inputData);
    const write = await dbPost(`/members/${groupId}`, auth, member);
    return printJson(ok({ memberId: write.name, member }));
  }

  if (group === 'members' && command === 'update') {
    const groupId = requireFlag(flags, 'group-id');
    const memberId = requireFlag(flags, 'member-id');
    const inputData = readInput(flags.input);
    assertMemberInput(inputData, { partial: true });
    const patch = await dbPatch(`/members/${groupId}/${memberId}`, auth, inputData);
    return printJson(ok({ memberId, patch }));
  }

  if (group === 'categories' && command === 'list') {
    const groupId = requireFlag(flags, 'group-id');
    return printJson(ok({ groupId, categories: await dbGet(`/groupCategories/${groupId}`, auth) || {} }));
  }

  if (group === 'categories' && command === 'set') {
    const groupId = requireFlag(flags, 'group-id');
    const inputData = readInput(flags.input);
    if (!isObject(inputData?.categories)) throw Object.assign(new Error('Missing required field: categories'), { cliCode: 'INVALID_INPUT', details: {} });
    for (const [key, label] of Object.entries(inputData.categories)) {
      if (typeof label !== 'string') {
        throw Object.assign(new Error(`Invalid category label: categories.${key}`), { cliCode: 'INVALID_INPUT', details: {} });
      }
    }
    const patch = await dbPatch(`/groupCategories/${groupId}`, auth, inputData.categories);
    return printJson(ok({ groupId, categories: patch }));
  }

  if (group === 'expenses' && command === 'create') {
    const groupId = requireFlag(flags, 'group-id');
    const inputData = readInput(flags.input);
    assertTransactionInput(inputData, 'expense');
    await assertMembersExist(groupId, auth, collectTransactionMembers(inputData));
    const transaction = withTransactionDefaults(inputData);
    const write = await dbPost(`/transactions/${groupId}`, auth, transaction);
    return printJson(ok({ transactionId: write.name, transaction }));
  }

  if (group === 'transfers' && command === 'create') {
    const groupId = requireFlag(flags, 'group-id');
    const inputData = readInput(flags.input);
    assertTransactionInput(inputData, 'transfer');
    await assertMembersExist(groupId, auth, collectTransactionMembers(inputData));
    const transaction = withTransactionDefaults(inputData);
    const write = await dbPost(`/transactions/${groupId}`, auth, transaction);
    return printJson(ok({ transactionId: write.name, transaction }));
  }

  if (group === 'transactions' && command === 'list') {
    const groupId = requireFlag(flags, 'group-id');
    // Validate every filter before fetching so a typo fails instead of
    // silently returning a wrong or empty list.
    const type = optionalFlag(flags, 'type', 'expense or transfer');
    if (type !== undefined && !['expense', 'transfer'].includes(type)) throw invalidFlag('type', 'expense or transfer');
    const from = parseDateBound(flags, 'from', false);
    const to = parseDateBound(flags, 'to', true);
    const memberId = optionalFlag(flags, 'member-id', 'a member ID');
    const paidBy = optionalFlag(flags, 'paid-by-member-id', 'a member ID');
    const category = optionalFlag(flags, 'category', 'a category key');
    const order = parseOrder(flags);
    const limit = parseLimit(flags);
    let transactions = withIdMap(await dbGet(`/transactions/${groupId}`, auth));
    if (type) transactions = transactions.filter((tx) => tx.type === type);
    if (from !== null) transactions = transactions.filter((tx) => tx.dateTime >= from);
    if (to !== null) transactions = transactions.filter((tx) => tx.dateTime <= to);
    if (memberId) transactions = transactions.filter((tx) => transactionIncludesMember(tx, memberId));
    if (paidBy) transactions = transactions.filter((tx) => tx.whoPaid?.some((ref) => ref.memberId === paidBy));
    if (category) transactions = transactions.filter((tx) => tx.category === category);
    transactions.sort((a, b) => order === 'desc' ? b.dateTime - a.dateTime : a.dateTime - b.dateTime);
    if (limit !== null) transactions = transactions.slice(0, limit);
    return printJson(ok({ groupId, count: transactions.length, transactions }));
  }

  if (group === 'transactions' && command === 'get') {
    const groupId = requireFlag(flags, 'group-id');
    const transactionId = requireFlag(flags, 'transaction-id');
    const transaction = await dbGet(`/transactions/${groupId}/${transactionId}`, auth);
    if (!transaction) throw Object.assign(new Error(`Transaction ${transactionId} was not found`), { cliCode: 'TRANSACTION_NOT_FOUND', details: { groupId, transactionId } });
    return printJson(ok({ id: transactionId, ...transaction }));
  }

  if (group === 'transactions' && command === 'update') {
    const groupId = requireFlag(flags, 'group-id');
    const transactionId = requireFlag(flags, 'transaction-id');
    const inputData = readInput(flags.input);
    assertTransactionPatch(inputData);
    const memberIds = [];
    if (inputData.whoPaid) memberIds.push(...inputData.whoPaid.map((ref) => ref.memberId));
    if (inputData.items) memberIds.push(...inputData.items.flatMap((item) => item.forWhom.map((ref) => ref.memberId)));
    if (memberIds.length > 0) await assertMembersExist(groupId, auth, memberIds);
    const patch = await dbPatch(`/transactions/${groupId}/${transactionId}`, auth, inputData);
    return printJson(ok({ transactionId, patch }));
  }

  if (group === 'transactions' && command === 'delete') {
    const groupId = requireFlag(flags, 'group-id');
    const transactionId = requireFlag(flags, 'transaction-id');
    await dbDelete(`/transactions/${groupId}/${transactionId}`, auth);
    return printJson(ok({ transactionId, deleted: true }));
  }

  if (group === 'debts' && command === 'list') {
    const groupId = requireFlag(flags, 'group-id');
    return printJson(ok({ groupId, debts: normalizeDebts(await dbGet(`/debts/${groupId}`, auth)) }));
  }

  if (group === 'debts' && command === 'recalculate') {
    const groupId = requireFlag(flags, 'group-id');
    const task = await dbPost('/serverTasks/calculateDebts', auth, { request: { groupId } });
    return printJson(ok({ groupId, taskId: task.name }));
  }

  if (group === 'changes' && command === 'list') {
    const groupId = requireFlag(flags, 'group-id');
    const order = parseOrder(flags);
    const limit = parseLimit(flags);
    let changes = withIdMap(await dbGet(`/changes/${groupId}`, auth));
    changes.sort((a, b) => order === 'desc' ? b.serverTimestamp - a.serverTimestamp : a.serverTimestamp - b.serverTimestamp);
    if (limit !== null) changes = changes.slice(0, limit);
    return printJson(ok({ groupId, count: changes.length, changes }));
  }

  throw Object.assign(new Error(`Unknown command: ${[group, command].filter(Boolean).join(' ')}`), {
    cliCode: 'INVALID_INPUT',
    details: {},
  });
}

function recoveryDetails(error) {
  const details = { ...(error.details || {}) };
  const { positional } = parseArgs(process.argv.slice(2));
  const [group, command] = positional;
  const definition = HELP.commands[group]?.[command];
  const operation = `${group}.${command}`;
  const code = ERROR_CODES.has(error.cliCode) ? error.cliCode : 'API_REQUEST_FAILED';

  if (code === 'INVALID_INPUT') {
    if (details.variable) {
      details.help = 'Configure the indicated environment variable for the selected environment; see https://github.com/NewDae/settle-up-cli/blob/main/LOGIN.md.';
    } else if (definition) {
      details.commandHelp = `settleup ${group} ${command} --help`;
      details.help = Object.hasOwn(SCHEMAS, operation)
        ? `Run \`settleup schema ${operation}\` for field types and an example; run \`${details.commandHelp}\` for flags.`
        : `Run \`${details.commandHelp}\` for required flags and usage.`;
    } else if (group === 'schema') {
      details.help = 'Use a supported operation such as `settleup schema expenses.create`.';
      details.availableSchemas = Object.keys(SCHEMAS);
    } else {
      details.help = 'Run `settleup --help` to discover supported commands.';
    }
    return details;
  }

  const help = {
    AUTH_REQUIRED: 'Run `settleup auth login --browser`, sign in privately in the browser, then run `settleup auth login --complete`. Private terminal login is also available.',
    AUTH_INVALID: 'Check email/password sign-in. For Google or Apple accounts, follow https://settleup.app/migrate-account, then run `settleup auth login` privately.',
    AUTH_REFRESH_FAILED: 'Run `settleup auth login --browser` and `settleup auth login --complete` to renew the session, or sign in privately in your terminal.',
    GROUP_NOT_FOUND: 'Run `settleup groups list` and use an exact returned group ID.',
    GROUP_ACCESS_DENIED: 'Confirm the group ID and the signed-in account\'s access using `settleup groups list`.',
    MEMBER_NOT_FOUND: 'Run `settleup members list --group-id <groupId>` and use returned member IDs, not account uids.',
    TRANSACTION_NOT_FOUND: 'Run `settleup transactions list --group-id <groupId>` and use an exact returned transaction ID.',
    API_RATE_LIMITED: 'Wait before retrying; use increasing delays if rate limiting continues.',
    API_REQUEST_FAILED: definition?.inputType || definition?.operation === 'deletes a record'
      ? 'Check connectivity and backend availability. Read back the affected data before retrying a write; a create may already have succeeded.'
      : 'Check connectivity and backend availability before retrying.',
    SERVER_TASK_FAILED: 'Check the group ID and access, then re-read debts; recalculation may not have completed.',
  };
  details.help ??= help[code];
  return details;
}

main().catch((error) => {
  printJson(fail(error.cliCode || 'API_REQUEST_FAILED', error.message, recoveryDetails(error)), 1);
});
