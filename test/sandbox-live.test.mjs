import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldRunLiveSandboxTests } from './helpers/spec-validators.mjs';

const env = process.env;
const runLive = shouldRunLiveSandboxTests(env);
const firebaseApiKey = env.SETTLEUP_FIREBASE_API_KEY || '';
const backendBaseUrl = env.SETTLEUP_API_BASE_URL || '';

let tempUser;
let tempUserRecord;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { response, json };
}

async function signUpWithPassword() {
  const email = `codex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'CodexTest123!';
  const url =
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(firebaseApiKey)}`;
  const { response, json } = await fetchJson(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  });

  assert.equal(response.status, 200, JSON.stringify(json));
  assert.equal(typeof json.idToken, 'string');
  assert.equal(typeof json.refreshToken, 'string');
  assert.equal(typeof json.localId, 'string');
  assert.equal(typeof json.expiresIn, 'string');
  return { ...json, email, password };
}

async function signInWithPassword(email, password) {
  const url =
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(firebaseApiKey)}`;
  const { response, json } = await fetchJson(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  });

  assert.equal(response.status, 200, JSON.stringify(json));
  assert.equal(typeof json.idToken, 'string');
  assert.equal(typeof json.refreshToken, 'string');
  assert.equal(typeof json.localId, 'string');
  assert.equal(typeof json.expiresIn, 'string');
  return json;
}

async function refreshToken(refreshToken) {
  const url =
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebaseApiKey)}`;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const { response, json } = await fetchJson(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  assert.equal(response.status, 200, JSON.stringify(json));
  assert.equal(typeof json.id_token, 'string');
  assert.equal(typeof json.refresh_token, 'string');
  assert.equal(typeof json.user_id, 'string');
  return json;
}

async function readDbPath(path, idToken) {
  const base = backendBaseUrl.replace(/\/$/, '');
  const separator = path.startsWith('/') ? '' : '/';
  const url = `${base}${separator}${path}.json?auth=${encodeURIComponent(idToken)}`;
  return fetchJson(url);
}

async function putDbPath(path, idToken, body) {
  const base = backendBaseUrl.replace(/\/$/, '');
  const separator = path.startsWith('/') ? '' : '/';
  const url = `${base}${separator}${path}.json?auth=${encodeURIComponent(idToken)}`;
  return fetchJson(url, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function patchDbPath(path, idToken, body) {
  const base = backendBaseUrl.replace(/\/$/, '');
  const separator = path.startsWith('/') ? '' : '/';
  const url = `${base}${separator}${path}.json?auth=${encodeURIComponent(idToken)}`;
  return fetchJson(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function postDbPath(path, idToken, body) {
  const base = backendBaseUrl.replace(/\/$/, '');
  const separator = path.startsWith('/') ? '' : '/';
  const url = `${base}${separator}${path}.json?auth=${encodeURIComponent(idToken)}`;
  return fetchJson(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function deleteDbPath(path, idToken) {
  const base = backendBaseUrl.replace(/\/$/, '');
  const separator = path.startsWith('/') ? '' : '/';
  const url = `${base}${separator}${path}.json?auth=${encodeURIComponent(idToken)}`;
  return fetchJson(url, {
    method: 'DELETE',
  });
}

function maybeLiveTest(name, fn) {
  test(name, { skip: !runLive }, fn);
}

function buildSandboxUserRecord(user) {
  return {
    email: user.email,
    name: 'Codex Sandbox User',
  };
}

async function createSandboxGroupWithMembers(memberNames = ['Codex Creator', 'Codex Friend']) {
  const groupId = `codex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const permissionWrite = await putDbPath(`/permissions/${groupId}/${tempUser.localId}`, tempUser.idToken, {
    level: 30,
  });
  const groupPatch = {
    name: `Codex Test ${Date.now()}`,
    convertedToCurrency: 'USD',
    defaultPermission: 10,
    minimizeDebts: true,
    remindOldDebts: true,
    ownerColor: '#ec1561',
    inviteLinkActive: true,
  };
  const groupPatchWrite = await patchDbPath(`/groups/${groupId}`, tempUser.idToken, groupPatch);
  const memberIds = [];

  assert.equal(permissionWrite.response.status, 200, JSON.stringify(permissionWrite.json));
  assert.deepEqual(permissionWrite.json, { level: 30 });
  assert.equal(groupPatchWrite.response.status, 200, JSON.stringify(groupPatchWrite.json));
  assert.deepEqual(groupPatchWrite.json, groupPatch);

  for (const name of memberNames) {
    const memberWrite = await postDbPath(`/members/${groupId}`, tempUser.idToken, {
      name,
      active: true,
      defaultWeight: '1',
      photoUrl: null,
      bankAccount: null,
      lightningAddress: null,
    });

    assert.equal(memberWrite.response.status, 200, JSON.stringify(memberWrite.json));
    assert.equal(typeof memberWrite.json.name, 'string');
    memberIds.push(memberWrite.json.name);
  }

  const userGroup = {
    order: 1,
    color: '#ec1561',
    member: memberIds[0],
  };
  const userGroupWrite = await putDbPath(
    `/userGroups/${tempUser.localId}/${groupId}`,
    tempUser.idToken,
    userGroup
  );
  const currentTabWrite = await putDbPath(
    `/users/${tempUser.localId}/currentTabId`,
    tempUser.idToken,
    groupId
  );

  assert.equal(userGroupWrite.response.status, 200, JSON.stringify(userGroupWrite.json));
  assert.deepEqual(userGroupWrite.json, userGroup);
  assert.equal(currentTabWrite.response.status, 200, JSON.stringify(currentTabWrite.json));
  assert.equal(currentTabWrite.json, groupId);

  return { groupId, groupPatch, memberIds, userGroup };
}

test.before(async () => {
  if (!runLive) {
    return;
  }

  tempUser = await signUpWithPassword();
  tempUserRecord = buildSandboxUserRecord(tempUser);
  const userWrite = await putDbPath(`/users/${tempUser.localId}`, tempUser.idToken, tempUserRecord);

  assert.equal(userWrite.response.status, 200, JSON.stringify(userWrite.json));
  assert.deepEqual(userWrite.json, tempUserRecord);
});

test('live sandbox tests are env-gated', () => {
  if (!runLive) {
    assert.ok(true);
    return;
  }

  assert.ok(firebaseApiKey);
  assert.ok(backendBaseUrl);
});

maybeLiveTest('firebase auth sign-up returns the expected token fields', async () => {
  assert.ok(tempUser.idToken.length > 0);
  assert.ok(tempUser.refreshToken.length > 0);
  assert.ok(tempUser.localId.length > 0);
  assert.ok(tempUser.email.endsWith('@example.com'));
});

maybeLiveTest('firebase auth sign-in returns the expected token fields for the created user', async () => {
  const auth = await signInWithPassword(tempUser.email, tempUser.password);

  assert.equal(auth.localId, tempUser.localId);
  assert.ok(auth.idToken.length > 0);
  assert.ok(auth.refreshToken.length > 0);
});

maybeLiveTest('firebase token refresh returns the expected token fields', async () => {
  const refreshed = await refreshToken(tempUser.refreshToken);

  assert.equal(refreshed.user_id, tempUser.localId);
  assert.ok(refreshed.id_token.length > 0);
  assert.ok(refreshed.refresh_token.length > 0);
});

maybeLiveTest('sandbox /users/<uid> returns the DB profile created for the auth user', async () => {
  const { response, json } = await readDbPath(`/users/${tempUser.localId}`, tempUser.idToken);

  assert.equal(response.status, 200, JSON.stringify(json));
  assert.deepEqual(json, tempUserRecord);
});

maybeLiveTest('sandbox /userGroups/<uid> is reachable with auth and returns json', async () => {
  const { response, json } = await readDbPath(`/userGroups/${tempUser.localId}`, tempUser.idToken);

  assert.equal(response.status, 200, JSON.stringify(json));
  assert.notEqual(typeof json, 'string');
  assert.ok(json === null || typeof json === 'object');
});

maybeLiveTest('sandbox permission records can be written and read for a synthetic group id', async () => {
  const syntheticGroupId = `codex-${Date.now()}`;
  const permissionWrite = await putDbPath(`/permissions/${syntheticGroupId}/${tempUser.localId}`, tempUser.idToken, {
    level: 30,
  });
  const permissionRead = await readDbPath(
    `/permissions/${syntheticGroupId}/${tempUser.localId}`,
    tempUser.idToken
  );

  assert.equal(permissionWrite.response.status, 200, JSON.stringify(permissionWrite.json));
  assert.deepEqual(permissionWrite.json, { level: 30 });
  assert.equal(permissionRead.response.status, 200, JSON.stringify(permissionRead.json));
  assert.deepEqual(permissionRead.json, { level: 30 });
});

maybeLiveTest('sandbox group membership can be written after permissions exist', async () => {
  const syntheticGroupId = `codex-${Date.now()}`;
  const permissionWrite = await putDbPath(`/permissions/${syntheticGroupId}/${tempUser.localId}`, tempUser.idToken, {
    level: 30,
  });
  const memberWrite = await postDbPath(`/members/${syntheticGroupId}`, tempUser.idToken, {
    name: 'Codex',
    active: true,
    defaultWeight: '1',
    photoUrl: null,
    bankAccount: null,
    lightningAddress: null,
  });

  assert.equal(permissionWrite.response.status, 200, JSON.stringify(permissionWrite.json));
  assert.deepEqual(permissionWrite.json, { level: 30 });
  assert.equal(memberWrite.response.status, 200, JSON.stringify(memberWrite.json));
  assert.equal(typeof memberWrite.json.name, 'string');

  const userGroupWrite = await putDbPath(
    `/userGroups/${tempUser.localId}/${syntheticGroupId}`,
    tempUser.idToken,
    {
      order: 1,
      color: '#ec1561',
      member: memberWrite.json.name,
    }
  );
  const userGroupRead = await readDbPath(
    `/userGroups/${tempUser.localId}/${syntheticGroupId}`,
    tempUser.idToken
  );

  assert.equal(userGroupWrite.response.status, 200, JSON.stringify(userGroupWrite.json));
  assert.deepEqual(userGroupWrite.json, {
    order: 1,
    color: '#ec1561',
    member: memberWrite.json.name,
  });
  assert.equal(userGroupRead.response.status, 200, JSON.stringify(userGroupRead.json));
  assert.deepEqual(userGroupRead.json, userGroupWrite.json);
});

maybeLiveTest('sandbox group create flow works with permission, group patch, member, and userGroup link', async () => {
  const syntheticGroupId = `codex-${Date.now()}`;
  const permissionWrite = await putDbPath(`/permissions/${syntheticGroupId}/${tempUser.localId}`, tempUser.idToken, {
    level: 30,
  });
  const groupPatch = {
    name: `Codex Test ${Date.now()}`,
    convertedToCurrency: 'USD',
    defaultPermission: 10,
    minimizeDebts: true,
    remindOldDebts: true,
    ownerColor: '#ec1561',
    inviteLinkActive: true,
  };
  const groupPatchWrite = await patchDbPath(`/groups/${syntheticGroupId}`, tempUser.idToken, groupPatch);
  const groupRead = await readDbPath(`/groups/${syntheticGroupId}`, tempUser.idToken);
  const memberWrite = await postDbPath(`/members/${syntheticGroupId}`, tempUser.idToken, {
    name: 'Codex Creator',
    active: true,
    defaultWeight: '1',
    photoUrl: null,
    bankAccount: null,
    lightningAddress: null,
  });

  assert.equal(permissionWrite.response.status, 200, JSON.stringify(permissionWrite.json));
  assert.deepEqual(permissionWrite.json, { level: 30 });
  assert.equal(groupPatchWrite.response.status, 200, JSON.stringify(groupPatchWrite.json));
  assert.deepEqual(groupPatchWrite.json, groupPatch);
  assert.equal(groupRead.response.status, 200, JSON.stringify(groupRead.json));
  assert.deepEqual(
    {
      convertedToCurrency: groupRead.json.convertedToCurrency,
      defaultPermission: groupRead.json.defaultPermission,
      inviteLinkActive: groupRead.json.inviteLinkActive,
      minimizeDebts: groupRead.json.minimizeDebts,
      name: groupRead.json.name,
      ownerColor: groupRead.json.ownerColor,
      remindOldDebts: groupRead.json.remindOldDebts,
    },
    groupPatch
  );
  assert.equal(memberWrite.response.status, 200, JSON.stringify(memberWrite.json));
  assert.equal(typeof memberWrite.json.name, 'string');

  const userGroup = {
    order: 1,
    color: '#ec1561',
    member: memberWrite.json.name,
  };
  const userGroupWrite = await putDbPath(
    `/userGroups/${tempUser.localId}/${syntheticGroupId}`,
    tempUser.idToken,
    userGroup
  );
  const currentTabWrite = await putDbPath(
    `/users/${tempUser.localId}/currentTabId`,
    tempUser.idToken,
    syntheticGroupId
  );
  const userGroupsRead = await readDbPath(`/userGroups/${tempUser.localId}`, tempUser.idToken);

  assert.equal(userGroupWrite.response.status, 200, JSON.stringify(userGroupWrite.json));
  assert.deepEqual(userGroupWrite.json, userGroup);
  assert.equal(currentTabWrite.response.status, 200, JSON.stringify(currentTabWrite.json));
  assert.equal(currentTabWrite.json, syntheticGroupId);
  assert.equal(userGroupsRead.response.status, 200, JSON.stringify(userGroupsRead.json));
  assert.deepEqual(userGroupsRead.json[syntheticGroupId], userGroup);
});

maybeLiveTest('sandbox members can be listed, fetched, and patched', async () => {
  const { groupId, memberIds } = await createSandboxGroupWithMembers(['Codex Original', 'Codex Other']);
  const membersList = await readDbPath(`/members/${groupId}`, tempUser.idToken);
  const memberRead = await readDbPath(`/members/${groupId}/${memberIds[0]}`, tempUser.idToken);
  const memberPatch = await patchDbPath(`/members/${groupId}/${memberIds[0]}`, tempUser.idToken, {
    name: 'Codex Updated',
    defaultWeight: '1.5',
  });
  const memberReadAfterPatch = await readDbPath(`/members/${groupId}/${memberIds[0]}`, tempUser.idToken);

  assert.equal(membersList.response.status, 200, JSON.stringify(membersList.json));
  assert.equal(typeof membersList.json[memberIds[0]], 'object');
  assert.equal(typeof membersList.json[memberIds[1]], 'object');
  assert.equal(memberRead.response.status, 200, JSON.stringify(memberRead.json));
  assert.equal(memberRead.json.name, 'Codex Original');
  assert.equal(memberPatch.response.status, 200, JSON.stringify(memberPatch.json));
  assert.deepEqual(memberPatch.json, {
    name: 'Codex Updated',
    defaultWeight: '1.5',
  });
  assert.equal(memberReadAfterPatch.response.status, 200, JSON.stringify(memberReadAfterPatch.json));
  assert.equal(memberReadAfterPatch.json.name, 'Codex Updated');
  assert.equal(memberReadAfterPatch.json.defaultWeight, '1.5');
  assert.equal(memberReadAfterPatch.json.active, true);
});

maybeLiveTest('sandbox categories can be patched and read', async () => {
  const { groupId } = await createSandboxGroupWithMembers();
  const categories = {
    food: 'Food',
    taxi: 'Transport',
    coffee: 'Coffee',
  };
  const categoriesPatch = await patchDbPath(`/groupCategories/${groupId}`, tempUser.idToken, categories);
  const categoriesRead = await readDbPath(`/groupCategories/${groupId}`, tempUser.idToken);

  assert.equal(categoriesPatch.response.status, 200, JSON.stringify(categoriesPatch.json));
  assert.deepEqual(categoriesPatch.json, categories);
  assert.equal(categoriesRead.response.status, 200, JSON.stringify(categoriesRead.json));
  assert.deepEqual(categoriesRead.json, categories);
});

maybeLiveTest('sandbox expense and transfer transactions can be created, listed, patched, fetched, and deleted', async () => {
  const { groupId, memberIds } = await createSandboxGroupWithMembers(['Codex Payer', 'Codex Receiver']);
  const expense = {
    type: 'expense',
    purpose: 'Dinner',
    category: 'food',
    currencyCode: 'USD',
    dateTime: Date.now(),
    timezone: '+05:30',
    fixedExchangeRate: false,
    exchangeRates: {},
    receiptUrl: null,
    templateId: null,
    whoPaid: [
      { memberId: memberIds[0], weight: '1' },
    ],
    items: [
      {
        amount: '42.50',
        forWhom: [
          { memberId: memberIds[0], weight: '1' },
          { memberId: memberIds[1], weight: '1' },
        ],
      },
    ],
  };
  const transfer = {
    type: 'transfer',
    purpose: 'Settlement',
    category: 'transfer',
    currencyCode: 'USD',
    dateTime: Date.now(),
    timezone: '+05:30',
    fixedExchangeRate: false,
    exchangeRates: {},
    receiptUrl: null,
    templateId: null,
    whoPaid: [
      { memberId: memberIds[1], weight: '1' },
    ],
    items: [
      {
        amount: '21.25',
        forWhom: [
          { memberId: memberIds[0], weight: '1' },
        ],
      },
    ],
  };

  const expenseWrite = await postDbPath(`/transactions/${groupId}`, tempUser.idToken, expense);
  const expenseId = expenseWrite.json?.name;
  const expenseRead = await readDbPath(`/transactions/${groupId}/${expenseId}`, tempUser.idToken);
  const expensePatch = await patchDbPath(`/transactions/${groupId}/${expenseId}`, tempUser.idToken, {
    purpose: 'Dinner Updated',
  });
  const transferWrite = await postDbPath(`/transactions/${groupId}`, tempUser.idToken, transfer);
  const transferId = transferWrite.json?.name;
  const transactionsList = await readDbPath(`/transactions/${groupId}`, tempUser.idToken);
  const transferDelete = await deleteDbPath(`/transactions/${groupId}/${transferId}`, tempUser.idToken);
  const transferReadAfterDelete = await readDbPath(`/transactions/${groupId}/${transferId}`, tempUser.idToken);

  assert.equal(expenseWrite.response.status, 200, JSON.stringify(expenseWrite.json));
  assert.equal(typeof expenseId, 'string');
  assert.equal(expenseRead.response.status, 200, JSON.stringify(expenseRead.json));
  assert.equal(expenseRead.json.purpose, 'Dinner');
  assert.equal(expenseRead.json.type, 'expense');
  assert.deepEqual(expenseRead.json.whoPaid, expense.whoPaid);
  assert.deepEqual(expenseRead.json.items, expense.items);
  assert.equal(expensePatch.response.status, 200, JSON.stringify(expensePatch.json));
  assert.deepEqual(expensePatch.json, { purpose: 'Dinner Updated' });
  assert.equal(transferWrite.response.status, 200, JSON.stringify(transferWrite.json));
  assert.equal(typeof transferId, 'string');
  assert.equal(transactionsList.response.status, 200, JSON.stringify(transactionsList.json));
  assert.equal(transactionsList.json[expenseId].purpose, 'Dinner Updated');
  assert.equal(transactionsList.json[transferId].type, 'transfer');
  assert.equal(transferDelete.response.status, 200, JSON.stringify(transferDelete.json));
  assert.equal(transferDelete.json, null);
  assert.equal(transferReadAfterDelete.response.status, 200, JSON.stringify(transferReadAfterDelete.json));
  assert.equal(transferReadAfterDelete.json, null);
});

maybeLiveTest('sandbox debts, changes, and debt recalculation task are reachable for a created group', async () => {
  const { groupId, memberIds } = await createSandboxGroupWithMembers(['Codex Payer', 'Codex Receiver']);
  const expenseWrite = await postDbPath(`/transactions/${groupId}`, tempUser.idToken, {
    type: 'expense',
    purpose: 'Debt Seed',
    category: 'food',
    currencyCode: 'USD',
    dateTime: Date.now(),
    timezone: '+05:30',
    fixedExchangeRate: false,
    exchangeRates: {},
    receiptUrl: null,
    templateId: null,
    whoPaid: [
      { memberId: memberIds[0], weight: '1' },
    ],
    items: [
      {
        amount: '10',
        forWhom: [
          { memberId: memberIds[0], weight: '1' },
          { memberId: memberIds[1], weight: '1' },
        ],
      },
    ],
  });
  const taskWrite = await postDbPath('/serverTasks/calculateDebts', tempUser.idToken, {
    request: {
      groupId,
    },
  });
  const debtsRead = await readDbPath(`/debts/${groupId}`, tempUser.idToken);
  const changesRead = await readDbPath(`/changes/${groupId}`, tempUser.idToken);

  assert.equal(expenseWrite.response.status, 200, JSON.stringify(expenseWrite.json));
  assert.equal(typeof expenseWrite.json.name, 'string');
  assert.equal(taskWrite.response.status, 200, JSON.stringify(taskWrite.json));
  assert.equal(typeof taskWrite.json.name, 'string');
  assert.equal(debtsRead.response.status, 200, JSON.stringify(debtsRead.json));
  assert.ok(debtsRead.json === null || typeof debtsRead.json === 'object');
  assert.equal(changesRead.response.status, 200, JSON.stringify(changesRead.json));
  assert.equal(typeof changesRead.json, 'object');
  assert.ok(Object.keys(changesRead.json).length > 0);
});

maybeLiveTest('POST /groups still requires pre-existing create permissions', async () => {
  const { response, json } = await postDbPath('/groups', tempUser.idToken, {
    name: `Codex Test ${Date.now()}`,
    convertedToCurrency: 'USD',
    defaultPermission: 10,
    minimizeDebts: true,
    remindOldDebts: true,
  });

  assert.equal(response.status, 401, JSON.stringify(json));
  assert.deepEqual(json, {
    error: 'Permission denied',
  });
});
