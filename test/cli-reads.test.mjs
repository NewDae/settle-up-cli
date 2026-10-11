import test from 'node:test';
import assert from 'node:assert/strict';
import { userGroupRecordSample, groupRecordSample, changeRecordSample } from './helpers/spec-fixtures.mjs';
import { runAuthenticatedCli, groupFlags, memberFlags, transactionFlags } from './helpers/cli-harness.mjs';

function assertSuccess(result) {
  assert.equal(result.status, 0, JSON.stringify(result.output));
  assert.equal(result.output.ok, true);
}

function assertNotFound(result, code) {
  assert.equal(result.status, 1);
  assert.equal(result.output.error.code, code);
  assert.match(result.output.error.details.help, /list/);
}

// Local midnight bounds, matching how the CLI interprets date-only filters.
const day = (date, h = 12) => new Date(`${date}T${String(h).padStart(2, '0')}:00:00`).getTime();
const transactions = {
  t_dinner: { type: 'expense', category: 'food', dateTime: day('2026-01-01'),
    whoPaid: [{ memberId: 'm_sid', weight: '1' }], items: [{ amount: '30', forWhom: [{ memberId: 'm_neha', weight: '1' }] }] },
  t_settle: { type: 'transfer', category: 'transfer', dateTime: day('2026-01-03'),
    whoPaid: [{ memberId: 'm_neha', weight: '1' }], items: [{ amount: '30', forWhom: [{ memberId: 'm_sid', weight: '1' }] }] },
  t_taxi: { type: 'expense', category: 'taxi', dateTime: day('2026-01-02', 23),
    whoPaid: [{ memberId: 'm_rohan', weight: '1' }], items: [{ amount: '9', forWhom: [{ memberId: 'm_rohan', weight: '1' }] }] },
};
const transactionsResponse = { method: 'GET', path: '/transactions/g_test.json', body: transactions };

function listIds(...filters) {
  const result = runAuthenticatedCli(['transactions', 'list', ...groupFlags, ...filters], { responses: [transactionsResponse] });
  assertSuccess(result);
  assert.equal(result.output.data.count, result.output.data.transactions.length);
  return result.output.data.transactions.map(({ id }) => id);
}

test('groups list returns each linked group with its user link and metadata', () => {
  const result = runAuthenticatedCli(['groups', 'list'], {
    responses: [
      { method: 'GET', path: '/userGroups/u_test.json', body: { g_one: userGroupRecordSample } },
      { method: 'GET', path: '/groups/g_one.json', body: groupRecordSample },
    ],
  });
  assertSuccess(result);
  assert.deepEqual(result.output.data, { groups: [{ id: 'g_one', userGroup: userGroupRecordSample, group: groupRecordSample }] });
});

test('members list adds IDs and --active-only keeps only active members', () => {
  const members = { m_sid: { name: 'Sid', active: true }, m_old: { name: 'Old', active: false } };
  const response = { method: 'GET', path: '/members/g_test.json', body: members };
  const all = runAuthenticatedCli(['members', 'list', ...groupFlags], { responses: [response] });
  assertSuccess(all);
  assert.deepEqual(all.output.data.members, [{ id: 'm_sid', ...members.m_sid }, { id: 'm_old', ...members.m_old }]);
  const active = runAuthenticatedCli(['members', 'list', ...groupFlags, '--active-only'], { responses: [response] });
  assert.deepEqual(active.output.data.members.map(({ id }) => id), ['m_sid']);
});

test('members get returns the member, and a missing member is MEMBER_NOT_FOUND', () => {
  const found = runAuthenticatedCli(['members', 'get', ...memberFlags], {
    responses: [{ method: 'GET', path: '/members/g_test/m_sid.json', body: { name: 'Sid' } }],
  });
  assertSuccess(found);
  assert.deepEqual(found.output.data, { id: 'm_sid', name: 'Sid' });
  assertNotFound(runAuthenticatedCli(['members', 'get', ...memberFlags], {
    responses: [{ method: 'GET', path: '/members/g_test/m_sid.json', body: null }],
  }), 'MEMBER_NOT_FOUND');
});

test('categories list returns the mapping, or an empty one when none is stored', () => {
  for (const [body, categories] of [[{ food: 'Food' }, { food: 'Food' }], [null, {}]]) {
    const result = runAuthenticatedCli(['categories', 'list', ...groupFlags], {
      responses: [{ method: 'GET', path: '/groupCategories/g_test.json', body }],
    });
    assertSuccess(result);
    assert.deepEqual(result.output.data, { groupId: 'g_test', categories });
  }
});

test('transactions get returns the record, and a missing one is TRANSACTION_NOT_FOUND', () => {
  const found = runAuthenticatedCli(['transactions', 'get', ...transactionFlags], {
    responses: [{ method: 'GET', path: '/transactions/g_test/tx_test.json', body: transactions.t_dinner }],
  });
  assertSuccess(found);
  assert.deepEqual(found.output.data, { id: 'tx_test', ...transactions.t_dinner });
  assertNotFound(runAuthenticatedCli(['transactions', 'get', ...transactionFlags], {
    responses: [{ method: 'GET', path: '/transactions/g_test/tx_test.json', body: null }],
  }), 'TRANSACTION_NOT_FOUND');
});

test('transactions delete sends DELETE for exactly that transaction', () => {
  const result = runAuthenticatedCli(['transactions', 'delete', ...transactionFlags], {
    responses: [{ method: 'DELETE', path: '/transactions/g_test/tx_test.json', body: null }],
  });
  assertSuccess(result);
  assert.deepEqual(result.output.data, { transactionId: 'tx_test', deleted: true });
});

test('transactions list orders by date and applies each filter', () => {
  assert.deepEqual(listIds(), ['t_dinner', 't_taxi', 't_settle']);
  assert.deepEqual(listIds('--order', 'desc'), ['t_settle', 't_taxi', 't_dinner']);
  assert.deepEqual(listIds('--order', 'desc', '--limit', '2'), ['t_settle', 't_taxi']);
  assert.deepEqual(listIds('--type', 'transfer'), ['t_settle']);
  assert.deepEqual(listIds('--category', 'taxi'), ['t_taxi']);
  assert.deepEqual(listIds('--paid-by-member-id', 'm_neha'), ['t_settle']);
  // A member who was only split with still participates.
  assert.deepEqual(listIds('--member-id', 'm_neha'), ['t_dinner', 't_settle']);
  // Date-only bounds are inclusive local days: --to includes 23:00 that day.
  assert.deepEqual(listIds('--from', '2026-01-02', '--to', '2026-01-02'), ['t_taxi']);
  assert.deepEqual(listIds('--from', String(day('2026-01-03'))), ['t_settle']);
});

for (const [label, flags] of [
  ['non-numeric limit', ['--limit', 'abc']],
  ['zero limit', ['--limit', '0']],
  ['negative limit', ['--limit', '-1']],
  ['fractional limit', ['--limit', '1.5']],
  ['limit without a value', ['--limit']],
  ['unknown order', ['--order', 'sideways']],
  ['misspelled type', ['--type', 'expens']],
  ['impossible date', ['--from', '2026-02-30']],
  ['relative date', ['--to', 'yesterday']],
  ['category without a value', ['--category']],
]) {
  test(`transactions list rejects ${label} before fetching`, () => {
    const result = runAuthenticatedCli(['transactions', 'list', ...groupFlags, ...flags]);
    assert.equal(result.status, 1);
    assert.equal(result.output.error.code, 'INVALID_INPUT');
    assert.match(result.output.error.message, new RegExp(`--${flags[0].slice(2)}`));
    assert.deepEqual(result.requests, []);
  });
}

test('changes list applies order and limit, and rejects invalid values before fetching', () => {
  const body = { c1: { ...changeRecordSample, serverTimestamp: 1 }, c2: { ...changeRecordSample, serverTimestamp: 2 } };
  const result = runAuthenticatedCli(['changes', 'list', ...groupFlags, '--order', 'desc', '--limit', '1'], {
    responses: [{ method: 'GET', path: '/changes/g_test.json', body }],
  });
  assertSuccess(result);
  assert.deepEqual(result.output.data.changes.map(({ id }) => id), ['c2']);
  for (const flags of [['--limit', '-1'], ['--order', 'newest']]) {
    const invalid = runAuthenticatedCli(['changes', 'list', ...groupFlags, ...flags]);
    assert.equal(invalid.output.error.code, 'INVALID_INPUT');
    assert.deepEqual(invalid.requests, []);
  }
});

test('a backend 401 is reported as GROUP_ACCESS_DENIED with access guidance', () => {
  const result = runAuthenticatedCli(['groups', 'get', ...groupFlags], {
    responses: [{ method: 'GET', path: '/groups/g_test.json', status: 401, body: { error: 'Permission denied' } }],
  });
  assert.equal(result.output.error.code, 'GROUP_ACCESS_DENIED');
  assert.equal(result.output.error.details.status, 401);
  assert.match(result.output.error.details.help, /groups list/);
});
