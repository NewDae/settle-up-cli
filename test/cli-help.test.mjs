import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repoRoot, 'bin', 'settleup.mjs');

function runCli(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('top-level help returns command groups as JSON', () => {
  const output = runCli(['--help']);

  assert.equal(output.ok, true);
  assert.equal(output.data.help.synopsis, 'settleup <group> <command> [flags]');
  assert.equal(output.data.help.commandGroups.transfers, 'Create transfer transactions, including settlements.');
});

test('group help lists subcommands and required flags', () => {
  const output = runCli(['transactions', '--help']);

  assert.equal(output.ok, true);
  assert.equal(output.data.help.group, 'transactions');
  assert.deepEqual(output.data.help.subcommands.get.requiredFlags, [
    '--group-id <groupId>',
    '--transaction-id <transactionId>',
  ]);
});

test('command help includes schema and patch semantics for transaction update', () => {
  const output = runCli(['transactions', 'update', '--help']);

  assert.equal(output.ok, true);
  assert.equal(output.data.help.inputType, 'TransactionPatchInput');
  assert.equal(output.data.help.schemaHelp, 'settleup schema transactions.update');
  assert.match(output.data.help.patchSemantics, /Omitted keys remain unchanged/);
  assert.match(output.data.help.patchSemantics, /arrays replace the full stored array/);
});

test('transfer help documents settlement behavior', () => {
  const output = runCli(['transfers', 'create', '--help']);

  assert.equal(output.ok, true);
  assert.equal(output.data.help.inputType, 'TransferInput');
  assert.match(output.data.help.purpose, /debts are settled/);
});
