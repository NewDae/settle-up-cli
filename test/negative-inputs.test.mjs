import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGroupInput, expenseInput, memberInput, memberPatchInput,
  setCategoriesInput, transactionPatchInput, transferInput,
} from './helpers/spec-fixtures.mjs';
import {
  runAuthenticatedCli, groupFlags, memberFlags, transactionFlags, membersResponse,
} from './helpers/cli-harness.mjs';

const expense = ['expenses', 'create', ...groupFlags];
const transfer = ['transfers', 'create', ...groupFlags];
const member = ['members', 'add', ...groupFlags];
const memberPatch = ['members', 'update', ...memberFlags];
const group = ['groups', 'create'];
const categories = ['categories', 'set', ...groupFlags];
const patch = ['transactions', 'update', ...transactionFlags];

const invalidInputs = [
  ['weighted refs use uid instead of memberId', expense, { ...expenseInput, whoPaid: [{ uid: 'u_sid', weight: '1' }] }, /memberId/],
  ['weighted refs have numeric weight', expense, { ...expenseInput, whoPaid: [{ memberId: 'm_sid', weight: 1 }] }, /weight/],
  ['member has numeric name', member, { ...memberInput, name: 42 }, /name/],
  ['member has string active', member, { ...memberInput, active: 'true' }, /active/],
  ['member has numeric photoUrl', member, { ...memberInput, photoUrl: 123 }, /photoUrl/],
  ['member patch has boolean defaultWeight', memberPatch, { ...memberPatchInput, defaultWeight: false }, /defaultWeight/],
  ['group has lowercase currency', group, { ...createGroupInput, convertedToCurrency: 'usd' }, /convertedToCurrency/],
  ['group has invalid permission', group, { ...createGroupInput, defaultPermission: 15 }, /defaultPermission/],
  ['group has numeric ownerColor', group, { ...createGroupInput, ownerColor: 1 }, /ownerColor/],
  ['group has string inviteLinkActive', group, { ...createGroupInput, inviteLinkActive: 'yes' }, /inviteLinkActive/],
  ['group has malformed firstMember', group, { ...createGroupInput, firstMember: { active: true } }, /name/],
  ['categories have numeric labels', categories, { ...setCategoriesInput, categories: { food: 9 } }, /categories/],
  ['categories are not a mapping', categories, { categories: [] }, /categories/],
  ['expense has ISO date string', expense, { ...expenseInput, dateTime: '2026-05-04T00:00:00Z' }, /dateTime/],
  ['expense has timezone name', expense, { ...expenseInput, timezone: 'Asia/Kolkata' }, /timezone/],
  ['expense has no payers', expense, { ...expenseInput, whoPaid: [] }, /whoPaid/],
  ['expense has numeric item amount', expense, { ...expenseInput, items: [{ amount: 2400, forWhom: [{ memberId: 'm_sid', weight: '1' }] }] }, /amount/],
  ['expense has malformed recipient list', expense, { ...expenseInput, items: [{ amount: '2400', forWhom: 'm_sid' }] }, /forWhom/],
  ['expense has no recipients', expense, { ...expenseInput, items: [{ amount: '2400', forWhom: [] }] }, /forWhom/],
  ['transfer has wrong type', transfer, { ...transferInput, type: 'expense' }, /type transfer/],
  ['patch changes transaction type', patch, { ...transactionPatchInput, type: 'transfer' }, /type is not patchable/],
  ['patch has uid in nested recipient', patch, { items: [{ amount: '2500', forWhom: [{ uid: 'u_sid', weight: '1' }] }] }, /memberId/],
  ['patch has non-array payers', patch, { whoPaid: { memberId: 'm_sid', weight: '1' } }, /whoPaid/],
  ['patch has no payers', patch, { whoPaid: [] }, /whoPaid/],
  ['patch has no items', patch, { items: [] }, /items/],
];

// Optional fields must obey the same contract on both creates and patches.
for (const [label, change, message] of [
  ['numeric exchange rate', { exchangeRates: { USD: 83.1 } }, /exchangeRates/],
  ['non-object exchange rates', { exchangeRates: [] }, /exchangeRates/],
  ['lowercase exchange currency', { exchangeRates: { usd: '0.012' } }, /currencyCode/],
  ['string fixedExchangeRate', { fixedExchangeRate: 'true' }, /fixedExchangeRate/],
  ['numeric category', { category: 5 }, /category/],
  ['numeric receiptUrl', { receiptUrl: 123 }, /receiptUrl/],
  ['boolean templateId', { templateId: false }, /templateId/],
]) {
  invalidInputs.push(
    [`expense has ${label}`, expense, { ...expenseInput, ...change }, message],
    [`transfer has ${label}`, transfer, { ...transferInput, ...change }, message],
    [`patch has ${label}`, patch, change, message],
  );
}

for (const [label, value] of [['number', 1.5], ['leading zero', '01'], ['negative', '-1'], ['text', 'abc']]) {
  invalidInputs.push([`expense amount is ${label}`, expense, {
    ...expenseInput, items: [{ ...expenseInput.items[0], amount: value }],
  }, /amount/]);
}

for (const [name, args, input, message] of invalidInputs) {
  test(`CLI rejects ${name} before any backend request`, () => {
    const result = runAuthenticatedCli([...args, '--input', '-'], { input });
    assert.equal(result.status, 1);
    assert.equal(result.output.ok, false);
    assert.equal(result.output.error.code, 'INVALID_INPUT');
    assert.match(result.output.error.message, message);
    assert.match(result.output.error.details.help, new RegExp(`settleup schema ${args[0]}\\.${args[1]}`));
    assert.equal(result.output.error.details.commandHelp, `settleup ${args[0]} ${args[1]} --help`);
    assert.deepEqual(result.requests, []);
  });
}

test('CLI rejects debt recalculation without group-id before posting a server task', () => {
  const result = runAuthenticatedCli(['debts', 'recalculate']);
  assert.equal(result.status, 1);
  assert.equal(result.output.error.code, 'INVALID_INPUT');
  assert.match(result.output.error.message, /--group-id/);
});

test('CLI rejects unknown transaction members after its read and before any write', () => {
  const input = { ...expenseInput, whoPaid: [{ memberId: 'm_unknown', weight: '1' }] };
  const result = runAuthenticatedCli([...expense, '--input', '-'], { input, responses: [membersResponse] });
  assert.equal(result.status, 1);
  assert.equal(result.output.error.code, 'MEMBER_NOT_FOUND');
  assert.deepEqual(result.output.error.details.memberIds, ['m_unknown']);
  assert.deepEqual(result.requests.map(({ method }) => method), ['GET']);
});
