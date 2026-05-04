import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ERROR_CODES,
  authLoginData,
  authStatusData,
  changeRecordSample,
  createGroupInput,
  debtsSample,
  errorEnvelope,
  expenseInput,
  groupRecordSample,
  memberInput,
  memberPatchInput,
  permissionRecordSample,
  setCategoriesInput,
  serverTaskRequestSample,
  successEnvelope,
  transactionItem,
  transactionPatchInput,
  transferInput,
  userGroupRecordSample,
  userRecordSample,
  weightedMemberRef,
} from './helpers/spec-fixtures.mjs';
import {
  applyPatchSemantics,
  assertChangeRecordShape,
  assertCreateGroupInput,
  assertDebtsShape,
  assertErrorEnvelopeShape,
  assertExpenseInput,
  assertGroupRecordShape,
  assertMemberInput,
  assertPermissionRecordShape,
  assertSetCategoriesInput,
  assertServerTaskRequestShape,
  assertSuccessEnvelopeShape,
  assertTransactionItem,
  assertTransactionPatchInput,
  assertTransferInput,
  assertUserGroupRecordShape,
  assertUserRecordShape,
  assertWeightedMemberRef,
  isCurrencyCode,
  isDecimalString,
  isEpochMillis,
  isTimezoneOffset,
} from './helpers/spec-validators.mjs';

test('success envelope matches the spec', () => {
  assertSuccessEnvelopeShape(assert, successEnvelope);
});

test('error envelope matches the spec and uses a stable error code', () => {
  assertErrorEnvelopeShape(assert, errorEnvelope, ERROR_CODES);
});

test('error code set is fixed and complete per the spec', () => {
  assert.deepEqual(ERROR_CODES, [
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
});

test('auth login/status payloads use uid and epoch millis, not memberId', () => {
  assert.equal(typeof authLoginData.uid, 'string');
  assert.equal(typeof authStatusData.uid, 'string');
  assert.ok(isEpochMillis(authLoginData.expiresAt));
  assert.ok(isEpochMillis(authStatusData.expiresAt));
  assert.equal(authStatusData.authenticated, true);
  assert.ok(!Object.hasOwn(authLoginData, 'memberId'));
  assert.ok(!Object.hasOwn(authStatusData, 'memberId'));
});

test('amount and weight validation uses decimal strings, never floats', () => {
  assert.equal(isDecimalString('1'), true);
  assert.equal(isDecimalString('1.5'), true);
  assert.equal(isDecimalString('2400'), true);
  assert.equal(isDecimalString(1.5), false);
  assert.equal(isDecimalString('01'), false);
  assert.equal(isDecimalString('-1'), false);
  assert.equal(isDecimalString('abc'), false);
});

test('shared primitive formats match the spec rules', () => {
  assert.equal(isCurrencyCode('INR'), true);
  assert.equal(isCurrencyCode('usd'), false);
  assert.equal(isCurrencyCode('USDT'), false);
  assert.equal(isEpochMillis(1777824000000), true);
  assert.equal(isEpochMillis(Date.now()), true);
  assert.equal(isEpochMillis('1777824000000'), false);
  assert.equal(isTimezoneOffset('+05:30'), true);
  assert.equal(isTimezoneOffset('-07:00'), true);
  assert.equal(isTimezoneOffset('Asia/Kolkata'), false);
});

test('weighted member refs use memberId and decimal weight', () => {
  assertWeightedMemberRef(assert, weightedMemberRef);
  assert.ok(!Object.hasOwn(weightedMemberRef, 'uid'));
});

test('transaction items use decimal-string amounts and weighted member refs', () => {
  assertTransactionItem(assert, transactionItem);
});

test('group creation input matches the documented schema', () => {
  assertCreateGroupInput(assert, createGroupInput);
});

test('member input and patch input match the documented schema', () => {
  assertMemberInput(assert, memberInput);
  assertMemberInput(assert, memberPatchInput, { partial: true });
});

test('categories input is a string to string mapping', () => {
  assertSetCategoriesInput(assert, setCategoriesInput);
});

test('group records match the official data-entities sample shape', () => {
  assertGroupRecordShape(assert, groupRecordSample);
});

test('permission records use user uid access levels 10, 20, 30', () => {
  assertPermissionRecordShape(assert, permissionRecordSample);
});

test('user records match the official data-entities sample shape', () => {
  assertUserRecordShape(assert, userRecordSample);
});

test('userGroup records expose order, color, and optional member mapping', () => {
  assertUserGroupRecordShape(assert, userGroupRecordSample);
});

test('expense input matches the documented schema and formats', () => {
  assertExpenseInput(assert, expenseInput);
});

test('transfer input matches the documented schema and preserves transfer type', () => {
  assertTransferInput(assert, transferInput);
});

test('transaction patch input matches the documented patch schema', () => {
  assertTransactionPatchInput(assert, transactionPatchInput);
});

test('member patch semantics preserve omitted fields and allow null clearing', () => {
  const original = {
    name: 'Sid',
    active: true,
    defaultWeight: '1',
    photoUrl: 'https://example.com/avatar.png',
    bankAccount: 'bank-1',
    lightningAddress: 'sid@ln',
  };
  const patch = {
    name: 'Siddharth',
    photoUrl: null,
  };

  const merged = applyPatchSemantics(original, patch);

  assert.deepEqual(merged, {
    name: 'Siddharth',
    active: true,
    defaultWeight: '1',
    photoUrl: null,
    bankAccount: 'bank-1',
    lightningAddress: 'sid@ln',
  });
});

test('transaction patch semantics replace provided arrays and preserve omitted fields', () => {
  const original = {
    type: 'expense',
    purpose: 'Dinner',
    category: '🍽️',
    currencyCode: 'INR',
    whoPaid: [
      { memberId: 'm_sid', weight: '1' },
      { memberId: 'm_neha', weight: '1' },
    ],
    items: [
      {
        amount: '2400',
        forWhom: [
          { memberId: 'm_sid', weight: '1' },
          { memberId: 'm_neha', weight: '1' },
        ],
      },
    ],
    exchangeRates: {
      USD: '0.012',
    },
  };
  const patch = {
    purpose: 'Dinner at Thalassa',
    items: [
      {
        amount: '2500',
        forWhom: [
          { memberId: 'm_sid', weight: '1' },
          { memberId: 'm_neha', weight: '1' },
          { memberId: 'm_rohan', weight: '1' },
        ],
      },
    ],
  };

  const merged = applyPatchSemantics(original, patch);

  assert.deepEqual(merged, {
    type: 'expense',
    purpose: 'Dinner at Thalassa',
    category: '🍽️',
    currencyCode: 'INR',
    whoPaid: [
      { memberId: 'm_sid', weight: '1' },
      { memberId: 'm_neha', weight: '1' },
    ],
    items: [
      {
        amount: '2500',
        forWhom: [
          { memberId: 'm_sid', weight: '1' },
          { memberId: 'm_neha', weight: '1' },
          { memberId: 'm_rohan', weight: '1' },
        ],
      },
    ],
    exchangeRates: {
      USD: '0.012',
    },
  });
});

test('update payload must not try to patch transaction type', () => {
  assert.equal(Object.hasOwn(transactionPatchInput, 'type'), false);
});

test('change records match the official data-entities sample shape', () => {
  assertChangeRecordShape(assert, changeRecordSample);
});

test('debts are arrays of member-to-member balances with decimal-string amounts', () => {
  assertDebtsShape(assert, debtsSample);
});

test('server task payloads wrap parameters inside request', () => {
  assertServerTaskRequestShape(assert, serverTaskRequestSample);
});
