import test from 'node:test';
import assert from 'node:assert/strict';
import { runAuthenticatedCli, groupFlags } from './helpers/cli-harness.mjs';
import { transferInput } from './helpers/spec-fixtures.mjs';

const schemas = ['groups.create', 'members.add', 'members.update', 'categories.set',
  'expenses.create', 'transfers.create', 'transactions.update'];

for (const operation of schemas) {
  test(`${operation} schema exposes required/optional field descriptions and usage`, () => {
    const result = runAuthenticatedCli(['schema', operation]);
    assert.equal(result.status, 0);
    const data = result.output.data;
    assert.match(data.invocation, /^settleup /);
    assert.equal(typeof data.inputType, 'string');
    for (const [name, field] of Object.entries(data.fields)) {
      assert.equal(field.required, data.required.includes(name));
      assert.equal(typeof field.type, 'string');
      assert.ok(field.description.length > 0);
    }
    for (const name of Object.keys(data.example)) assert.ok(data.fields[name], name);
    for (const name of data.required) assert.equal(data.fields[name].required, true);
  });
}

test('expense schema explains nested amounts, member identity, and relative shares', () => {
  const { fields } = runAuthenticatedCli(['schema', 'expenses.create']).output.data;
  assert.deepEqual(fields.type.enum, ['expense']);
  const item = fields.items.items.fields;
  assert.equal(item.amount.required, true);
  assert.equal(item.amount.type, 'string');
  assert.equal(item.amount.format, 'decimal-string');
  const participant = item.forWhom.items.fields;
  assert.equal(participant.memberId.required, true);
  assert.match(participant.memberId.description, /not the account uid/);
  assert.equal(participant.weight.required, true);
  assert.match(participant.weight.description, /not a monetary amount/);
  assert.equal(fields.exchangeRates.values.format, 'decimal-string');
});

test('transfer schema identifies sender and receiver while patches keep all fields optional', () => {
  const transfer = runAuthenticatedCli(['schema', 'transfers.create']).output.data;
  assert.deepEqual(transfer.fields.type.enum, ['transfer']);
  assert.match(transfer.fields.whoPaid.description, /debtor/);
  assert.match(transfer.fields.items.description, /creditor/);
  const patch = runAuthenticatedCli(['schema', 'transactions.update']).output.data;
  assert.equal(Object.hasOwn(patch.fields, 'type'), false);
  assert.ok(Object.values(patch.fields).every((field) => !field.required));
  assert.equal(patch.fields.receiptUrl.nullable, true);
  assert.match(patch.fields.exchangeRates.description, /replaces the entire map/);
  const group = runAuthenticatedCli(['schema', 'groups.create']).output.data;
  assert.equal(group.fields.firstMember.fields.name.required, true);
  assert.equal(group.fields.firstMember.fields.photoUrl.required, false);
});

for (const [label, args, options] of [
  ['missing input', ['transfers', 'create', ...groupFlags], {}],
  ['input flag without a value', ['transfers', 'create', ...groupFlags, '--input'], {}],
  ['invalid JSON', ['transfers', 'create', ...groupFlags, '--input', '-'], { inputText: '{' }],
  ['missing input file', ['transfers', 'create', ...groupFlags, '--input', '/nonexistent-settleup-test/input.json'], {}],
  ['invalid currency', ['transfers', 'create', ...groupFlags, '--input', '-'], { input: { ...transferInput, currencyCode: 'usd' } }],
]) {
  test(`${label} gives transfer-specific recovery guidance without backend access`, () => {
    const result = runAuthenticatedCli(args, options);
    assert.equal(result.status, 1);
    assert.equal(result.output.error.code, 'INVALID_INPUT');
    assert.match(result.output.error.details.help, /settleup schema transfers\.create/);
    assert.doesNotMatch(result.output.error.details.help, /expenses\.create/);
    assert.deepEqual(result.requests, []);
  });
}

test('flag-only write errors point to command help instead of an unavailable schema', () => {
  const result = runAuthenticatedCli(['transactions', 'delete']);
  assert.equal(result.status, 1);
  assert.match(result.output.error.details.help, /settleup transactions delete --help/);
  assert.doesNotMatch(result.output.error.details.help, /schema/);
});

test('unknown schema errors list supported operations', () => {
  const result = runAuthenticatedCli(['schema', 'unknown.create']);
  assert.equal(result.status, 1);
  assert.equal(result.output.error.code, 'INVALID_INPUT');
  assert.deepEqual(result.output.error.details.availableSchemas.sort(), [...schemas].sort());
});

for (const [status, code, guidance] of [
  [403, 'GROUP_ACCESS_DENIED', /groups list/],
  [429, 'API_RATE_LIMITED', /Wait before retrying/],
  [500, 'API_REQUEST_FAILED', /backend availability/],
]) {
  test(`backend ${status} preserves status details and gives ${code} recovery guidance`, () => {
    const result = runAuthenticatedCli(['users', 'me'], {
      responses: [{ method: 'GET', path: '/users/u_test.json', status, body: { error: 'Backend failure' } }],
    });
    assert.equal(result.status, 1);
    assert.equal(result.output.error.code, code);
    assert.equal(result.output.error.details.status, status);
    assert.deepEqual(result.output.error.details.body, { error: 'Backend failure' });
    assert.match(result.output.error.details.help, guidance);
  });
}

test('an uncertain failed create recommends read-back before retrying', () => {
  const result = runAuthenticatedCli(['members', 'add', ...groupFlags, '--input', '-'], {
    input: { name: 'Maya' },
    responses: [{ method: 'POST', path: '/members/g_test.json', status: 500, body: { error: 'Temporary failure' } }],
  });
  assert.equal(result.status, 1);
  assert.equal(result.output.error.code, 'API_REQUEST_FAILED');
  assert.match(result.output.error.details.help, /Read back.*before retrying/);
});
