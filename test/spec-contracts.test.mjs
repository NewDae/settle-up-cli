import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGroupInput, expenseInput, transferInput, memberInput,
  transactionPatchInput, groupRecordSample, userGroupRecordSample,
  permissionRecordSample, userRecordSample, changeRecordSample, debtsSample,
} from './helpers/spec-fixtures.mjs';
import {
  runAuthenticatedCli, groupFlags, memberFlags, transactionFlags, membersResponse,
} from './helpers/cli-harness.mjs';

function assertSuccess(result) {
  assert.equal(result.status, 0, JSON.stringify(result.output));
  assert.equal(result.output.ok, true);
  assert.deepEqual(result.output.meta, { environment: 'test' });
}

function schemaExample(command) {
  const result = runAuthenticatedCli(['schema', command]);
  assertSuccess(result);
  return result.output.data.example;
}

// The backend rejects new members without active/defaultWeight and new
// transactions without fixedExchangeRate, so creates fill those defaults.
for (const [command, fixture] of [['expenses', expenseInput], ['transfers', transferInput]]) {
  test(`${command} create validates members, posts the exact transaction, and fills only omitted defaults`, () => {
    const create = (input, members = membersResponse) => runAuthenticatedCli([command, 'create', ...groupFlags, '--input', '-'], {
      input, responses: [members, { method: 'POST', path: '/transactions/g_test.json', body: { name: 'tx_created' } }],
    });

    const input = { ...fixture, exchangeRates: { USD: '0.012' }, fixedExchangeRate: true };
    const exact = create(input);
    assertSuccess(exact);
    assert.equal(exact.requests[0].method, 'GET');
    assert.deepEqual(exact.requests[1].body, input);
    assert.deepEqual(exact.requests[1].headers, { 'content-type': 'application/json' });
    assert.deepEqual(exact.output.data, { transactionId: 'tx_created', transaction: input });

    const { fixedExchangeRate, ...withoutRate } = fixture;
    const defaulted = create(withoutRate);
    assert.deepEqual(defaulted.requests[1].body, { ...withoutRate, fixedExchangeRate: false });

    // The advertised schema example must pass validation unchanged.
    const example = schemaExample(`${command}.create`);
    const advertised = create(example, { ...membersResponse, body: { member_id_1: { name: 'Example payer' }, member_id_2: { name: 'Example recipient' } } });
    assertSuccess(advertised);
    assert.deepEqual(advertised.requests[1].body, example);
  });
}

const groupCreateResponses = [
  { method: 'PUT', pathPattern: '^/permissions/[-0-9A-Za-z_]{20}/u_test\\.json$', body: { level: 30 } },
  { method: 'GET', pathPattern: '^/groups/[-0-9A-Za-z_]{20}\\.json$', body: null },
  { method: 'PATCH', pathPattern: '^/groups/[-0-9A-Za-z_]{20}\\.json$', body: {} },
  { method: 'POST', pathPattern: '^/members/[-0-9A-Za-z_]{20}\\.json$', body: { name: 'm_created' } },
  { method: 'PUT', pathPattern: '^/userGroups/u_test/[-0-9A-Za-z_]{20}\\.json$', body: {} },
  { method: 'PUT', path: '/users/u_test/currentTabId.json', body: null },
];

test('groups create sends permissions before group metadata and maps the returned first member ID', () => {
  const input = schemaExample('groups.create');
  const result = runAuthenticatedCli(['groups', 'create', '--input', '-'], { input, responses: groupCreateResponses });
  assertSuccess(result);
  const { groupId } = result.output.data;
  // Firebase push ID: time-ordered prefix, so a later ID never sorts before an earlier one.
  assert.match(groupId, /^[-0-9A-Za-z_]{20}$/);
  const pushChars = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  const createdAt = [...groupId.slice(0, 8)].reduce((time, char) => time * 64 + pushChars.indexOf(char), 0);
  assert.ok(Math.abs(Date.now() - createdAt) < 60_000, `push ID time prefix decodes to ${createdAt}`);
  assert.deepEqual(result.requests.map(({ path }) => path), [
    `/permissions/${groupId}/u_test.json`, `/groups/${groupId}.json`, `/groups/${groupId}.json`,
    `/members/${groupId}.json`, `/userGroups/u_test/${groupId}.json`, '/users/u_test/currentTabId.json',
  ]);
  assert.deepEqual(result.requests[0].body, { level: 30 });
  assert.deepEqual(result.requests[2].body, {
    name: createGroupInput.name, convertedToCurrency: 'INR', defaultPermission: 10,
    minimizeDebts: true, remindOldDebts: true, ownerColor: '#ec1561', inviteLinkActive: true,
  });
  assert.deepEqual(result.requests[3].body, createGroupInput.firstMember);
  assert.deepEqual(result.requests[4].body, { order: 1, color: '#ec1561', member: 'm_created' });
  assert.equal(result.requests[5].body, groupId);
  assert.equal(result.output.data.firstMemberId, 'm_created');

  const minimal = runAuthenticatedCli(['groups', 'create', '--input', '-'], {
    input: { name: 'Trip', convertedToCurrency: 'INR', firstMember: { name: 'Anshul' } }, responses: groupCreateResponses,
  });
  assertSuccess(minimal);
  assert.deepEqual(minimal.requests[3].body, { name: 'Anshul', active: true, defaultWeight: '1' });
});

test('members add sends supplied fields, fills only omitted defaults, and returns the backend member ID', () => {
  const add = (input) => runAuthenticatedCli(['members', 'add', ...groupFlags, '--input', '-'], {
    input, responses: [{ method: 'POST', path: '/members/g_test.json', body: { name: 'm_created' } }],
  });
  const example = add(schemaExample('members.add'));
  assertSuccess(example);
  assert.deepEqual(example.requests[0].body, memberInput);
  assert.deepEqual(example.output.data, { memberId: 'm_created', member: memberInput });
  assert.deepEqual(add({ name: 'Sid' }).requests[0].body, { name: 'Sid', active: true, defaultWeight: '1' });
  assert.deepEqual(add({ name: 'Sid', active: false, defaultWeight: '2' }).requests[0].body, { name: 'Sid', active: false, defaultWeight: '2' });
});

test('members update sends only provided fields and explicit null clearing', () => {
  const input = { ...schemaExample('members.update'), photoUrl: null };
  const result = runAuthenticatedCli(['members', 'update', ...memberFlags, '--input', '-'], {
    input, responses: [{ method: 'PATCH', path: '/members/g_test/m_sid.json', body: input }],
  });
  assertSuccess(result);
  assert.deepEqual(result.requests[0].body, input);
  assert.deepEqual(result.output.data, { memberId: 'm_sid', patch: input });
});

for (const [name, input, responses] of [
  ['supplied arrays', { ...transactionPatchInput, whoPaid: [{ memberId: 'm_neha', weight: '1' }] }, [membersResponse]],
  ['supplied object and null clearing', { exchangeRates: { USD: '0.012' }, receiptUrl: null, templateId: null }, []],
  ['purpose', { purpose: 'Updated dinner' }, []],
  ['the advertised schema example', schemaExample('transactions.update'), [{ ...membersResponse, body: { member_id_1: { name: 'Example member' } } }]],
]) {
  test(`transactions update sends only ${name} in the PATCH body`, () => {
    const result = runAuthenticatedCli(['transactions', 'update', ...transactionFlags, '--input', '-'], {
      input, responses: [...responses, { method: 'PATCH', path: '/transactions/g_test/tx_test.json', body: input }],
    });
    assertSuccess(result);
    assert.deepEqual(result.requests.at(-1).body, input);
    assert.deepEqual(result.output.data, { transactionId: 'tx_test', patch: input });
  });
}

test('categories set unwraps the categories mapping into its PATCH request', () => {
  const input = schemaExample('categories.set');
  const result = runAuthenticatedCli(['categories', 'set', ...groupFlags, '--input', '-'], {
    input,
    responses: [{ method: 'PATCH', path: '/groupCategories/g_test.json', body: input.categories }],
  });
  assertSuccess(result);
  assert.deepEqual(result.requests[0].body, input.categories);
  assert.deepEqual(result.output.data, { groupId: 'g_test', categories: input.categories });
});

test('debts recalculate builds the request wrapper itself', () => {
  const result = runAuthenticatedCli(['debts', 'recalculate', ...groupFlags], {
    responses: [{ method: 'POST', path: '/serverTasks/calculateDebts.json', body: { name: 'task_created' } }],
  });
  assertSuccess(result);
  assert.deepEqual(result.requests[0].body, { request: { groupId: 'g_test' } });
  assert.deepEqual(result.output.data, { groupId: 'g_test', taskId: 'task_created' });
});

test('groups get preserves backend group, permission and userGroup records', () => {
  const permissions = { u_test: permissionRecordSample };
  const result = runAuthenticatedCli(['groups', 'get', ...groupFlags], {
    responses: [
      { method: 'GET', path: '/groups/g_test.json', body: groupRecordSample },
      { method: 'GET', path: '/permissions/g_test.json', body: permissions },
      { method: 'GET', path: '/userGroups/u_test/g_test.json', body: userGroupRecordSample },
    ],
  });
  assertSuccess(result);
  assert.deepEqual(result.output.data, { id: 'g_test', group: groupRecordSample, permissions, userGroup: userGroupRecordSample });
});

test('users me keeps the auth UID separate from backend profile fields', () => {
  const result = runAuthenticatedCli(['users', 'me'], {
    responses: [{ method: 'GET', path: '/users/u_test.json', body: userRecordSample }],
  });
  assertSuccess(result);
  assert.deepEqual(result.output.data, { uid: 'u_test', user: userRecordSample });
});

test('changes list adds IDs to backend change records', () => {
  const result = runAuthenticatedCli(['changes', 'list', ...groupFlags], {
    responses: [{ method: 'GET', path: '/changes/g_test.json', body: { change_1: changeRecordSample } }],
  });
  assertSuccess(result);
  assert.deepEqual(result.output.data, { groupId: 'g_test', count: 1, changes: [{ id: 'change_1', ...changeRecordSample }] });
});

for (const [name, body, debts] of [
  ['array', debtsSample, debtsSample],
  ['nested map', { m_sid: { m_neha: '100.50', m_rohan: 25 } }, [
    { from: 'm_sid', to: 'm_neha', amount: '100.50' }, { from: 'm_sid', to: 'm_rohan', amount: '25' },
  ]],
  ['empty response', null, []],
]) {
  test(`debts list normalizes a backend ${name}`, () => {
    const result = runAuthenticatedCli(['debts', 'list', ...groupFlags], {
      responses: [{ method: 'GET', path: '/debts/g_test.json', body }],
    });
    assertSuccess(result);
    assert.deepEqual(result.output.data, { groupId: 'g_test', debts });
  });
}
