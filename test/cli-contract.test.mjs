import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repoRoot, 'bin', 'settleup.mjs');

function runCli(args, { input } = {}) {
  const configDir = mkdtempSync(path.join(tmpdir(), 'settleup-cli-test-'));
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      SETTLEUP_CLI_CONFIG_DIR: configDir,
    },
  });

  return {
    status: result.status,
    stderr: result.stderr,
    output: JSON.parse(result.stdout),
  };
}

test('auth status is deterministic without a saved session', () => {
  const { status, output } = runCli(['auth', 'status']);

  assert.equal(status, 0);
  assert.deepEqual(output, {
    ok: true,
    data: {
      authenticated: false,
      uid: null,
      email: null,
      expiresAt: null,
    },
    meta: {
      sandbox: true,
    },
  });
});

test('authenticated commands fail locally with AUTH_REQUIRED before network access', () => {
  const { status, output } = runCli(['groups', 'list']);

  assert.equal(status, 1);
  assert.equal(output.ok, false);
  assert.equal(output.error.code, 'AUTH_REQUIRED');
  assert.match(output.error.message, /auth login/);
  assert.deepEqual(output.meta, { sandbox: true });
});

test('unknown commands return the stable invalid-input envelope', () => {
  const { status, output } = runCli(['wat']);

  assert.equal(status, 1);
  assert.equal(output.ok, false);
  assert.equal(output.error.code, 'INVALID_INPUT');
  assert.equal(output.error.message, 'Unknown command: wat');
  assert.deepEqual(output.meta, { sandbox: true });
});

test('schema command returns write-input examples as JSON', () => {
  const { status, output } = runCli(['schema', 'expenses.create']);

  assert.equal(status, 0);
  assert.equal(output.ok, true);
  assert.equal(output.data.command, 'expenses.create');
  assert.deepEqual(output.data.required, ['type', 'purpose', 'currencyCode', 'dateTime', 'whoPaid', 'items']);
  assert.equal(output.data.example.type, 'expense');
  assert.equal(output.data.example.whoPaid[0].memberId, 'member_id_1');
});
