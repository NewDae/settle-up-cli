const DECIMAL_STRING_RE = /^(0|[1-9]\d*)(\.\d+)?$/;
const TIMEZONE_OFFSET_RE = /^[+-](0\d|1\d|2[0-3]):[0-5]\d$/;
const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value) {
  return value === null || typeof value === 'string';
}

export function isDecimalString(value) {
  return typeof value === 'string' && DECIMAL_STRING_RE.test(value);
}

export function isCurrencyCode(value) {
  return typeof value === 'string' && CURRENCY_CODE_RE.test(value);
}

export function isEpochMillis(value) {
  return Number.isInteger(value) && value >= 0;
}

export function isTimezoneOffset(value) {
  return typeof value === 'string' && TIMEZONE_OFFSET_RE.test(value);
}

export function assertSuccessEnvelopeShape(assert, envelope) {
  assert.equal(envelope.ok, true);
  assert.ok(isObject(envelope.data));
  assert.ok(isObject(envelope.meta));
  assert.equal(typeof envelope.meta.environment, 'string');
}

export function assertErrorEnvelopeShape(assert, envelope, allowedCodes) {
  assert.equal(envelope.ok, false);
  assert.ok(isObject(envelope.error));
  assert.ok(allowedCodes.includes(envelope.error.code));
  assert.equal(typeof envelope.error.message, 'string');
  assert.ok(isObject(envelope.error.details));
  assert.ok(isObject(envelope.meta));
  assert.equal(typeof envelope.meta.environment, 'string');
}

export function assertWeightedMemberRef(assert, ref) {
  assert.ok(isObject(ref));
  assert.equal(typeof ref.memberId, 'string');
  assert.ok(ref.memberId.length > 0);
  assert.ok(isDecimalString(ref.weight));
}

export function assertTransactionItem(assert, item) {
  assert.ok(isObject(item));
  assert.ok(isDecimalString(item.amount));
  assert.ok(Array.isArray(item.forWhom));
  assert.ok(item.forWhom.length > 0);
  for (const ref of item.forWhom) {
    assertWeightedMemberRef(assert, ref);
  }
}

export function assertMemberInput(assert, input, { partial = false } = {}) {
  assert.ok(isObject(input));
  if (!partial || Object.hasOwn(input, 'name')) {
    assert.equal(typeof input.name, 'string');
    assert.ok(input.name.length > 0);
  }
  if (Object.hasOwn(input, 'active')) {
    assert.equal(typeof input.active, 'boolean');
  }
  if (Object.hasOwn(input, 'defaultWeight')) {
    assert.ok(isDecimalString(input.defaultWeight));
  }
  if (Object.hasOwn(input, 'photoUrl')) {
    assert.ok(isNullableString(input.photoUrl));
  }
  if (Object.hasOwn(input, 'bankAccount')) {
    assert.ok(isNullableString(input.bankAccount));
  }
  if (Object.hasOwn(input, 'lightningAddress')) {
    assert.ok(isNullableString(input.lightningAddress));
  }
}

export function assertCreateGroupInput(assert, input) {
  assert.ok(isObject(input));
  assert.equal(typeof input.name, 'string');
  assert.ok(input.name.length > 0);
  assert.ok(isCurrencyCode(input.convertedToCurrency));
  if (Object.hasOwn(input, 'defaultPermission')) {
    assert.ok([10, 20, 30].includes(input.defaultPermission));
  }
  if (Object.hasOwn(input, 'minimizeDebts')) {
    assert.equal(typeof input.minimizeDebts, 'boolean');
  }
  if (Object.hasOwn(input, 'remindOldDebts')) {
    assert.equal(typeof input.remindOldDebts, 'boolean');
  }
  assertMemberInput(assert, input.firstMember);
}

export function assertSetCategoriesInput(assert, input) {
  assert.ok(isObject(input));
  assert.ok(isObject(input.categories));
  for (const [key, value] of Object.entries(input.categories)) {
    assert.equal(typeof key, 'string');
    assert.ok(key.length > 0);
    assert.equal(typeof value, 'string');
    assert.ok(value.length > 0);
  }
}

export function assertExpenseInput(assert, input) {
  assert.ok(isObject(input));
  assert.equal(input.type, 'expense');
  assert.equal(typeof input.purpose, 'string');
  assert.ok(input.purpose.length > 0);
  assert.ok(isCurrencyCode(input.currencyCode));
  assert.ok(isEpochMillis(input.dateTime));
  if (Object.hasOwn(input, 'category')) {
    assert.equal(typeof input.category, 'string');
  }
  if (Object.hasOwn(input, 'timezone')) {
    assert.ok(isTimezoneOffset(input.timezone));
  }
  if (Object.hasOwn(input, 'fixedExchangeRate')) {
    assert.equal(typeof input.fixedExchangeRate, 'boolean');
  }
  if (Object.hasOwn(input, 'exchangeRates')) {
    assert.ok(isObject(input.exchangeRates));
    for (const [code, rate] of Object.entries(input.exchangeRates)) {
      assert.ok(isCurrencyCode(code));
      assert.ok(isDecimalString(rate));
    }
  }
  if (Object.hasOwn(input, 'receiptUrl')) {
    assert.ok(isNullableString(input.receiptUrl));
  }
  if (Object.hasOwn(input, 'templateId')) {
    assert.ok(isNullableString(input.templateId));
  }
  assert.ok(Array.isArray(input.whoPaid));
  assert.ok(input.whoPaid.length > 0);
  for (const payer of input.whoPaid) {
    assertWeightedMemberRef(assert, payer);
  }
  assert.ok(Array.isArray(input.items));
  assert.ok(input.items.length > 0);
  for (const item of input.items) {
    assertTransactionItem(assert, item);
  }
}

export function assertTransferInput(assert, input) {
  assertExpenseInput(assert, { ...input, type: 'expense' });
  assert.equal(input.type, 'transfer');
}

export function assertTransactionPatchInput(assert, input) {
  assert.ok(isObject(input));
  assert.ok(!Object.hasOwn(input, 'type'));
  if (Object.hasOwn(input, 'purpose')) {
    assert.equal(typeof input.purpose, 'string');
    assert.ok(input.purpose.length > 0);
  }
  if (Object.hasOwn(input, 'category')) {
    assert.equal(typeof input.category, 'string');
  }
  if (Object.hasOwn(input, 'currencyCode')) {
    assert.ok(isCurrencyCode(input.currencyCode));
  }
  if (Object.hasOwn(input, 'dateTime')) {
    assert.ok(isEpochMillis(input.dateTime));
  }
  if (Object.hasOwn(input, 'timezone')) {
    assert.ok(isTimezoneOffset(input.timezone));
  }
  if (Object.hasOwn(input, 'fixedExchangeRate')) {
    assert.equal(typeof input.fixedExchangeRate, 'boolean');
  }
  if (Object.hasOwn(input, 'exchangeRates')) {
    assert.ok(isObject(input.exchangeRates));
    for (const [code, rate] of Object.entries(input.exchangeRates)) {
      assert.ok(isCurrencyCode(code));
      assert.ok(isDecimalString(rate));
    }
  }
  if (Object.hasOwn(input, 'receiptUrl')) {
    assert.ok(isNullableString(input.receiptUrl));
  }
  if (Object.hasOwn(input, 'templateId')) {
    assert.ok(isNullableString(input.templateId));
  }
  if (Object.hasOwn(input, 'whoPaid')) {
    assert.ok(Array.isArray(input.whoPaid));
    assert.ok(input.whoPaid.length > 0);
    for (const payer of input.whoPaid) {
      assertWeightedMemberRef(assert, payer);
    }
  }
  if (Object.hasOwn(input, 'items')) {
    assert.ok(Array.isArray(input.items));
    assert.ok(input.items.length > 0);
    for (const item of input.items) {
      assertTransactionItem(assert, item);
    }
  }
}

export function applyPatchSemantics(original, patch) {
  return {
    ...original,
    ...patch,
  };
}

export function assertGroupRecordShape(assert, record) {
  assert.ok(isObject(record));
  assert.equal(typeof record.ownerColor, 'string');
  assert.ok(isCurrencyCode(record.convertedToCurrency));
  assert.equal(typeof record.inviteLink, 'string');
  assert.equal(typeof record.inviteLinkHash, 'string');
  assert.equal(typeof record.inviteLinkActive, 'boolean');
  assert.equal(typeof record.minimizeDebts, 'boolean');
  assert.equal(typeof record.remindOldDebts, 'boolean');
  assert.equal(typeof record.name, 'string');
  if (Object.hasOwn(record, 'premiumPurchasedBy')) {
    assert.equal(typeof record.premiumPurchasedBy, 'string');
  }
  if (Object.hasOwn(record, 'premiumPurchasedUntil')) {
    assert.ok(isEpochMillis(record.premiumPurchasedUntil));
  }
  assert.ok(isEpochMillis(record.lastChanged));
  assert.ok([10, 20, 30].includes(record.defaultPermission));
}

export function assertPermissionRecordShape(assert, record) {
  assert.ok(isObject(record));
  assert.ok([10, 20, 30].includes(record.level));
}

export function assertUserRecordShape(assert, record) {
  assert.ok(isObject(record));
  assert.equal(typeof record.currentTabId, 'string');
  assert.equal(typeof record.authProvider, 'string');
  assert.equal(typeof record.email, 'string');
  assert.equal(typeof record.inviteLinkHash, 'string');
  assert.equal(typeof record.name, 'string');
  if (Object.hasOwn(record, 'photoUrl')) {
    assert.equal(typeof record.photoUrl, 'string');
  }
  if (Object.hasOwn(record, 'superuser')) {
    assert.equal(typeof record.superuser, 'boolean');
  }
  if (Object.hasOwn(record, 'locale')) {
    assert.equal(typeof record.locale, 'string');
  }
}

export function assertUserGroupRecordShape(assert, record) {
  assert.ok(isObject(record));
  assert.equal(typeof record.order, 'number');
  assert.equal(typeof record.color, 'string');
  if (Object.hasOwn(record, 'member')) {
    assert.equal(typeof record.member, 'string');
    assert.ok(record.member.length > 0);
  }
}

export function assertChangeRecordShape(assert, record) {
  assert.ok(isObject(record));
  assert.equal(typeof record.action, 'string');
  assert.equal(typeof record.entity, 'string');
  assert.equal(typeof record.entityId, 'string');
  assert.equal(typeof record.entityName, 'string');
  assert.equal(typeof record.serverTimestamp, 'number');
  if (Object.hasOwn(record, 'by')) {
    assert.equal(typeof record.by, 'string');
  }
}

export function assertDebtsShape(assert, debts) {
  assert.ok(Array.isArray(debts));
  for (const debt of debts) {
    assert.ok(isObject(debt));
    assert.equal(typeof debt.from, 'string');
    assert.equal(typeof debt.to, 'string');
    assert.ok(isDecimalString(debt.amount));
  }
}

export function assertServerTaskRequestShape(assert, input) {
  assert.ok(isObject(input));
  assert.ok(isObject(input.request));
  assert.equal(typeof input.request.groupId, 'string');
  assert.ok(input.request.groupId.length > 0);
}

export function shouldRunLiveSandboxTests(env = process.env) {
  return env.SETTLEUP_RUN_LIVE === '1';
}
