#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stderr as promptOutput } from 'node:process';

loadDotEnv();

const ENVIRONMENT = process.env.SETTLEUP_ENV || 'production';
const API_BASE_URL = (process.env.SETTLEUP_API_BASE_URL || '').replace(/\/$/, '');
const FIREBASE_API_KEY = process.env.SETTLEUP_FIREBASE_API_KEY || '';
const CONFIG_DIR = process.env.SETTLEUP_CLI_CONFIG_DIR
  || path.join(os.homedir(), '.config', 'settleup-cli');
const AUTH_PATH = path.join(CONFIG_DIR, ENVIRONMENT, 'auth.json');
const META = { environment: ENVIRONMENT };
const ERROR_CODES = new Set([
  'AUTH_REQUIRED',
  'AUTH_INVALID',
  'AUTH_REFRESH_FAILED',
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

function apiUrl(apiPath) {
  const base = requireApiBaseUrl();
  const clean = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
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

function ensureConfigDir() {
  fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true, mode: 0o700 });
}

function readAuthFile() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeAuthFile(auth) {
  ensureConfigDir();
  fs.writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

function deleteAuthFile() {
  try {
    fs.unlinkSync(AUTH_PATH);
  } catch {}
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
    : await fetchApiData('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    });
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
  writeAuthFile(next);
  return next;
}

async function requireAuth() {
  const auth = readAuthFile();
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
  if (!inputFlag) {
    throw Object.assign(new Error('Missing required flag: --input'), {
      cliCode: 'INVALID_INPUT',
      details: {},
    });
  }
  const text = inputFlag === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(inputFlag, 'utf8');
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

function assertCurrency(value) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
    throw Object.assign(new Error('Invalid currencyCode; run `settleup schema expenses.create` for the expected JSON input'), {
      cliCode: 'INVALID_INPUT',
      details: { help: 'Run `settleup schema expenses.create` for the expected JSON input' },
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

function assertGroupInput(input) {
  if (!isObject(input)) throw Object.assign(new Error('Input must be an object'), { cliCode: 'INVALID_INPUT', details: {} });
  assertNonEmptyString(input.name, 'name');
  assertCurrency(input.convertedToCurrency);
  if (Object.hasOwn(input, 'defaultPermission') && ![10, 20, 30].includes(input.defaultPermission)) {
    throw Object.assign(new Error('Invalid field: defaultPermission'), { cliCode: 'INVALID_INPUT', details: {} });
  }
  if (Object.hasOwn(input, 'minimizeDebts') && typeof input.minimizeDebts !== 'boolean') {
    throw Object.assign(new Error('Invalid field: minimizeDebts'), { cliCode: 'INVALID_INPUT', details: {} });
  }
  if (Object.hasOwn(input, 'remindOldDebts') && typeof input.remindOldDebts !== 'boolean') {
    throw Object.assign(new Error('Invalid field: remindOldDebts'), { cliCode: 'INVALID_INPUT', details: {} });
  }
  assertMemberInput(input.firstMember);
}

function assertTransactionInput(input, type) {
  if (!isObject(input)) throw Object.assign(new Error('Input must be an object'), { cliCode: 'INVALID_INPUT', details: {} });
  if (input.type !== type) {
    throw Object.assign(new Error(`Expected transaction type ${type}`), {
      cliCode: 'INVALID_INPUT',
      details: { help: `Run \`settleup schema ${type === 'expense' ? 'expenses.create' : 'transfers.create'}\` for the expected JSON input` },
    });
  }
  assertNonEmptyString(input.purpose, 'purpose');
  assertCurrency(input.currencyCode);
  assertEpochMillis(input.dateTime, 'dateTime');
  assertTimezone(input.timezone);
  if (!Array.isArray(input.whoPaid) || input.whoPaid.length === 0) {
    throw Object.assign(new Error('Missing required field: whoPaid'), {
      cliCode: 'INVALID_INPUT',
      details: { help: `Run \`settleup schema ${type === 'expense' ? 'expenses.create' : 'transfers.create'}\` for the expected JSON input` },
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
      details: { help: 'Run `settleup schema transactions.update` for the expected JSON input' },
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

function parseDateBound(value, endOfDay = false) {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw Object.assign(new Error(`Invalid date filter: ${value}`), { cliCode: 'INVALID_INPUT', details: {} });
  }
  const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
  return new Date(`${value}${suffix}`).getTime();
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
        synopsis: 'settleup auth login',
        purpose: 'Authenticate user and store local session.',
        operation: 'authenticates',
        requiredFlags: [],
        optionalFlags: [],
        identifiers: ['uid in output'],
        example: 'settleup auth login',
      },
      status: {
        synopsis: 'settleup auth status',
        purpose: 'Show whether a local session is available.',
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
        example: 'settleup groups get --group-id codex-123',
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
        example: 'settleup members list --group-id codex-123 --active-only',
      },
      get: {
        synopsis: 'settleup members get --group-id <groupId> --member-id <memberId>',
        purpose: 'Fetch one member.',
        operation: 'reads raw data',
        requiredFlags: ['--group-id <groupId>', '--member-id <memberId>'],
        optionalFlags: [],
        identifiers: ['groupId', 'memberId'],
        example: 'settleup members get --group-id codex-123 --member-id member_1',
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
        example: 'settleup members add --group-id codex-123 --input member.json',
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
        example: 'settleup members update --group-id codex-123 --member-id member_1 --input patch.json',
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
        example: 'settleup categories list --group-id codex-123',
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
        example: 'settleup categories set --group-id codex-123 --input categories.json',
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
        example: 'settleup transactions list --group-id codex-123 --member-id member_1 --category food',
      },
      get: {
        synopsis: 'settleup transactions get --group-id <groupId> --transaction-id <transactionId>',
        purpose: 'Fetch one transaction.',
        operation: 'reads raw data',
        requiredFlags: ['--group-id <groupId>', '--transaction-id <transactionId>'],
        optionalFlags: [],
        identifiers: ['groupId', 'transactionId'],
        example: 'settleup transactions get --group-id codex-123 --transaction-id tx_1',
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
        example: 'settleup transactions update --group-id codex-123 --transaction-id tx_1 --input patch.json',
      },
      delete: {
        synopsis: 'settleup transactions delete --group-id <groupId> --transaction-id <transactionId>',
        purpose: 'Delete one transaction.',
        operation: 'deletes a record',
        requiredFlags: ['--group-id <groupId>', '--transaction-id <transactionId>'],
        optionalFlags: [],
        identifiers: ['groupId', 'transactionId'],
        example: 'settleup transactions delete --group-id codex-123 --transaction-id tx_1',
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
        example: 'settleup expenses create --group-id codex-123 --input expense.json',
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
        example: 'settleup transfers create --group-id codex-123 --input transfer.json',
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
        example: 'settleup debts list --group-id codex-123',
      },
      recalculate: {
        synopsis: 'settleup debts recalculate --group-id <groupId>',
        purpose: 'Trigger backend recalculation of derived debts from current transactions.',
        operation: 'creates a server task',
        requiredFlags: ['--group-id <groupId>'],
        optionalFlags: [],
        identifiers: ['groupId'],
        example: 'settleup debts recalculate --group-id codex-123',
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
        example: 'settleup changes list --group-id codex-123 --limit 10 --order desc',
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
  if (flags.help || group === '--help' || !group) return printJson(ok({ help: helpText(group, command) }));

  if (group === 'schema') {
    const schema = SCHEMAS[command];
    if (!schema) throw Object.assign(new Error(`Unknown schema command: ${command}`), { cliCode: 'INVALID_INPUT', details: {} });
    return printJson(ok({ command, ...schema }));
  }

  if (group === 'auth' && command === 'login') {
    let email;
    let password;
    if (input.isTTY) {
      const rl = readline.createInterface({ input, output: promptOutput });
      email = await rl.question('Email: ');
      password = await rl.question('Password: ');
      rl.close();
    } else {
      const [emailLine, passwordLine] = fs.readFileSync(0, 'utf8').split(/\r?\n/);
      email = emailLine;
      password = passwordLine;
    }
    assertNonEmptyString(email, 'email');
    assertNonEmptyString(password, 'password');
    const json = FIREBASE_API_KEY
      ? await signInWithFirebase(email, password)
      : await fetchApiData('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
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
    writeAuthFile(auth);
    await ensureUserRecord(auth);
    return printJson(ok({ uid: auth.uid, email: auth.email, expiresAt: auth.expiresAt }));
  }

  if (group === 'auth' && command === 'status') {
    const auth = readAuthFile();
    return printJson(ok({
      authenticated: Boolean((auth?.accessToken || auth?.idToken) && auth?.refreshToken),
      uid: auth?.uid || null,
      email: auth?.email || null,
      expiresAt: auth?.expiresAt || null,
    }));
  }

  if (group === 'auth' && command === 'logout') {
    deleteAuthFile();
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
    const groupId = `codex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    const memberWrite = await dbPost(`/members/${groupId}`, auth, inputData.firstMember);
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
    const write = await dbPost(`/members/${groupId}`, auth, inputData);
    return printJson(ok({ memberId: write.name, member: inputData }));
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
    if (!isObject(inputData?.categories)) throw Object.assign(new Error('Missing required field: categories'), { cliCode: 'INVALID_INPUT', details: { help: 'Run `settleup schema categories.set` for the expected JSON input' } });
    const patch = await dbPatch(`/groupCategories/${groupId}`, auth, inputData.categories);
    return printJson(ok({ groupId, categories: patch }));
  }

  if (group === 'expenses' && command === 'create') {
    const groupId = requireFlag(flags, 'group-id');
    const inputData = readInput(flags.input);
    assertTransactionInput(inputData, 'expense');
    await assertMembersExist(groupId, auth, collectTransactionMembers(inputData));
    const write = await dbPost(`/transactions/${groupId}`, auth, inputData);
    return printJson(ok({ transactionId: write.name, transaction: inputData }));
  }

  if (group === 'transfers' && command === 'create') {
    const groupId = requireFlag(flags, 'group-id');
    const inputData = readInput(flags.input);
    assertTransactionInput(inputData, 'transfer');
    await assertMembersExist(groupId, auth, collectTransactionMembers(inputData));
    const write = await dbPost(`/transactions/${groupId}`, auth, inputData);
    return printJson(ok({ transactionId: write.name, transaction: inputData }));
  }

  if (group === 'transactions' && command === 'list') {
    const groupId = requireFlag(flags, 'group-id');
    let transactions = withIdMap(await dbGet(`/transactions/${groupId}`, auth));
    const from = parseDateBound(flags.from, false);
    const to = parseDateBound(flags.to, true);
    if (flags.type) transactions = transactions.filter((tx) => tx.type === flags.type);
    if (from !== null) transactions = transactions.filter((tx) => tx.dateTime >= from);
    if (to !== null) transactions = transactions.filter((tx) => tx.dateTime <= to);
    if (flags['member-id']) transactions = transactions.filter((tx) => transactionIncludesMember(tx, flags['member-id']));
    if (flags['paid-by-member-id']) transactions = transactions.filter((tx) => tx.whoPaid?.some((ref) => ref.memberId === flags['paid-by-member-id']));
    if (flags.category) transactions = transactions.filter((tx) => tx.category === flags.category);
    transactions.sort((a, b) => flags.order === 'desc' ? b.dateTime - a.dateTime : a.dateTime - b.dateTime);
    if (flags.limit) transactions = transactions.slice(0, Number(flags.limit));
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
    let changes = withIdMap(await dbGet(`/changes/${groupId}`, auth));
    changes.sort((a, b) => flags.order === 'desc' ? b.serverTimestamp - a.serverTimestamp : a.serverTimestamp - b.serverTimestamp);
    if (flags.limit) changes = changes.slice(0, Number(flags.limit));
    return printJson(ok({ groupId, count: changes.length, changes }));
  }

  throw Object.assign(new Error(`Unknown command: ${[group, command].filter(Boolean).join(' ')}`), {
    cliCode: 'INVALID_INPUT',
    details: {},
  });
}

main().catch((error) => {
  printJson(fail(error.cliCode || 'API_REQUEST_FAILED', error.message, error.details || {}), 1);
});
