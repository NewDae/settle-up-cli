import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGroupInput,
  expenseInput,
  memberInput,
  memberPatchInput,
  serverTaskRequestSample,
  setCategoriesInput,
  transactionPatchInput,
  transferInput,
  weightedMemberRef,
} from './helpers/spec-fixtures.mjs';
import {
  assertCreateGroupInput,
  assertExpenseInput,
  assertMemberInput,
  assertServerTaskRequestShape,
  assertSetCategoriesInput,
  assertTransactionPatchInput,
  assertTransferInput,
  assertWeightedMemberRef,
} from './helpers/spec-validators.mjs';

function expectInvalid(name, fn) {
  test(name, () => {
    assert.throws(fn, /.+/);
  });
}

expectInvalid('rejects weighted member refs with uid instead of memberId', () => {
  assertWeightedMemberRef(assert, {
    uid: 'u_sid',
    weight: '1',
  });
});

expectInvalid('rejects weighted member refs with numeric weight', () => {
  assertWeightedMemberRef(assert, {
    memberId: 'm_sid',
    weight: 1,
  });
});

expectInvalid('rejects member input with numeric name', () => {
  assertMemberInput(assert, {
    ...memberInput,
    name: 42,
  });
});

expectInvalid('rejects member input with active as string', () => {
  assertMemberInput(assert, {
    ...memberInput,
    active: 'true',
  });
});

expectInvalid('rejects member input with invalid nullable field type', () => {
  assertMemberInput(assert, {
    ...memberInput,
    photoUrl: 123,
  });
});

expectInvalid('rejects member patch with invalid defaultWeight type', () => {
  assertMemberInput(assert, {
    ...memberPatchInput,
    defaultWeight: false,
  }, { partial: true });
});

expectInvalid('rejects create-group input with lowercase currency code', () => {
  assertCreateGroupInput(assert, {
    ...createGroupInput,
    convertedToCurrency: 'usd',
  });
});

expectInvalid('rejects create-group input with invalid permission level', () => {
  assertCreateGroupInput(assert, {
    ...createGroupInput,
    defaultPermission: 15,
  });
});

expectInvalid('rejects create-group input with malformed firstMember object', () => {
  assertCreateGroupInput(assert, {
    ...createGroupInput,
    firstMember: {
      active: true,
    },
  });
});

expectInvalid('rejects category mappings with non-string labels', () => {
  assertSetCategoriesInput(assert, {
    ...setCategoriesInput,
    categories: {
      ...setCategoriesInput.categories,
      '🍺': 9,
    },
  });
});

expectInvalid('rejects expense input with uid inside whoPaid', () => {
  assertExpenseInput(assert, {
    ...expenseInput,
    whoPaid: [
      {
        uid: 'u_sid',
        weight: '1',
      },
    ],
  });
});

expectInvalid('rejects expense input with dateTime as ISO string', () => {
  assertExpenseInput(assert, {
    ...expenseInput,
    dateTime: '2026-05-04T00:00:00Z',
  });
});

expectInvalid('rejects expense input with timezone name instead of offset', () => {
  assertExpenseInput(assert, {
    ...expenseInput,
    timezone: 'Asia/Kolkata',
  });
});

expectInvalid('rejects expense input with malformed exchange-rate values', () => {
  assertExpenseInput(assert, {
    ...expenseInput,
    exchangeRates: {
      USD: 83.1,
    },
  });
});

expectInvalid('rejects expense input with empty whoPaid array', () => {
  assertExpenseInput(assert, {
    ...expenseInput,
    whoPaid: [],
  });
});

expectInvalid('rejects expense input with malformed items array', () => {
  assertExpenseInput(assert, {
    ...expenseInput,
    items: [
      {
        amount: 2400,
        forWhom: 'm_sid',
      },
    ],
  });
});

expectInvalid('rejects transfer input with wrong literal type', () => {
  assertTransferInput(assert, {
    ...transferInput,
    type: 'expense',
  });
});

expectInvalid('rejects transaction patch input that tries to patch type', () => {
  assertTransactionPatchInput(assert, {
    ...transactionPatchInput,
    type: 'transfer',
  });
});

expectInvalid('rejects transaction patch input with invalid nested member refs', () => {
  assertTransactionPatchInput(assert, {
    ...transactionPatchInput,
    items: [
      {
        amount: '2500',
        forWhom: [
          {
            uid: 'u_sid',
            weight: '1',
          },
        ],
      },
    ],
  });
});

expectInvalid('rejects transaction patch input with non-array whoPaid', () => {
  assertTransactionPatchInput(assert, {
    ...transactionPatchInput,
    whoPaid: {
      memberId: 'm_sid',
      weight: '1',
    },
  });
});

expectInvalid('rejects transaction patch input with empty whoPaid array', () => {
  assertTransactionPatchInput(assert, {
    ...transactionPatchInput,
    whoPaid: [],
  });
});

expectInvalid('rejects transaction patch input with empty items array', () => {
  assertTransactionPatchInput(assert, {
    ...transactionPatchInput,
    items: [],
  });
});

expectInvalid('rejects server task payloads without request wrapper', () => {
  assertServerTaskRequestShape(assert, {
    groupId: serverTaskRequestSample.request.groupId,
  });
});

expectInvalid('rejects server task payloads without groupId', () => {
  assertServerTaskRequestShape(assert, {
    request: {},
  });
});
