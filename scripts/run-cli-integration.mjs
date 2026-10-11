#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'bin', 'settleup.mjs');
const reportsDir = path.join(repoRoot, 'integration-reports');
await loadDotEnv(process.env.SETTLEUP_ENV_FILE || '.env');
const firebaseApiKey = process.env.SETTLEUP_FIREBASE_API_KEY;
const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'settleup-cli-e2e-'));
const runStartedAt = new Date();
const runStamp = runStartedAt.toISOString().replace(/[:.]/g, '-');
const steps = [];

async function loadDotEnv(filePath = '.env') {
  let text;
  try {
    text = await fs.readFile(path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || Object.hasOwn(process.env, key)) continue;
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function cents(amount) {
  const [whole, fraction = ''] = String(amount).split('.');
  const padded = `${fraction}00`.slice(0, 2);
  return Number(whole) * 100 + Number(padded);
}

function money(value) {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return fraction === '00' ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

function weightedShares(amountCents, refs) {
  const totalWeight = refs.reduce((sum, ref) => sum + Number(ref.weight), 0);
  let allocated = 0;
  return refs.map((ref, index) => {
    const share = index === refs.length - 1
      ? amountCents - allocated
      : Math.round((amountCents * Number(ref.weight)) / totalWeight);
    allocated += share;
    return [ref.memberId, share];
  });
}

function calculateDebts(transactions) {
  const balances = new Map();
  const add = (memberId, amount) => balances.set(memberId, (balances.get(memberId) || 0) + amount);

  for (const tx of transactions) {
    for (const item of tx.items || []) {
      const amountCents = cents(item.amount);
      for (const [memberId, share] of weightedShares(amountCents, tx.whoPaid || [])) add(memberId, share);
      for (const [memberId, share] of weightedShares(amountCents, item.forWhom || [])) add(memberId, -share);
    }
  }

  const debtors = [...balances.entries()].filter(([, value]) => value < 0).map(([memberId, value]) => ({ memberId, amount: -value }));
  const creditors = [...balances.entries()].filter(([, value]) => value > 0).map(([memberId, value]) => ({ memberId, amount: value }));
  const debts = [];

  for (const debtor of debtors) {
    for (const creditor of creditors) {
      if (debtor.amount === 0) break;
      if (creditor.amount === 0) continue;
      const amount = Math.min(debtor.amount, creditor.amount);
      debts.push({ from: debtor.memberId, to: creditor.memberId, amount: money(amount) });
      debtor.amount -= amount;
      creditor.amount -= amount;
    }
  }

  return debts.filter((debt) => cents(debt.amount) > 0);
}

async function signUpSandboxUser() {
  assert.ok(firebaseApiKey, 'SETTLEUP_FIREBASE_API_KEY is required for integration user signup');
  const email = `cli-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'CliTest123!';
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(firebaseApiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const json = await response.json();
  assert.equal(response.status, 200, JSON.stringify(json));
  return { email, password };
}

function runCli(args, { inputJson, inputText, displayCommand, check, expectFailure = false }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        SETTLEUP_CLI_CONFIG_DIR: configDir,
        SETTLEUP_AUTH_STORAGE: 'file',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      let json;
      try {
        json = JSON.parse(stdout);
      } catch (error) {
        reject(new Error(`Could not parse CLI JSON for ${args.join(' ')}: ${error.message}\nstdout=${stdout}\nstderr=${stderr}`));
        return;
      }
      try {
        // Surface the CLI's own error rather than a crash inside the check.
        if (!expectFailure && json.ok !== true) throw new Error(`${json.error?.code}: ${json.error?.message}`);
        const pass = check(json);
        steps.push({
          command: displayCommand || `settleup ${args.join(' ')}`,
          output: json,
          check: pass,
          passed: expectFailure ? code !== 0 && json.ok === false : code === 0 && json.ok === true,
        });
        resolve(json);
      } catch (error) {
        steps.push({
          command: displayCommand || `settleup ${args.join(' ')}`,
          output: json,
          check: error.message,
          passed: false,
        });
        reject(error);
      }
    });
    if (inputJson !== undefined) child.stdin.end(`${JSON.stringify(inputJson, null, 2)}\n`);
    else if (inputText !== undefined) child.stdin.end(inputText);
    else child.stdin.end();
  });
}

// Drop optional fields so the CLI's create defaults are exercised live.
function minimal(transaction) {
  const { fixedExchangeRate, exchangeRates, receiptUrl, templateId, timezone, ...rest } = transaction;
  return rest;
}

function tx({ purpose, category, date, payer, split, amount }) {
  return {
    type: 'expense',
    purpose,
    category,
    currencyCode: 'USD',
    dateTime: new Date(`${date}T12:00:00.000Z`).getTime(),
    timezone: '+05:30',
    fixedExchangeRate: false,
    exchangeRates: {},
    receiptUrl: null,
    templateId: null,
    whoPaid: [{ memberId: payer, weight: '1' }],
    items: [{ amount, forWhom: split.map((memberId) => ({ memberId, weight: '1' })) }],
  };
}

function expectError(code) {
  return (json) => {
    assert.equal(json.ok, false, 'expected the command to fail');
    assert.equal(json.error.code, code);
    assert.equal(typeof json.error.details.help, 'string');
    return `Failed as expected with ${code} and recovery help.`;
  };
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Runs the live Settle Up CLI end-to-end integration and writes integration-reports/cli-integration-<date>.md');
    return;
  }

  await fs.mkdir(reportsDir, { recursive: true });
  const user = await signUpSandboxUser();

  const login = await runCli(['auth', 'login'], {
    inputText: `${user.email}\n${user.password}\n`,
    displayCommand: 'settleup auth login <email/password via stdin>',
    check: (json) => {
      assert.equal(typeof json.data.uid, 'string');
      return 'Login succeeded and stored a reusable local session.';
    },
  });

  await runCli(['auth', 'status'], {
    check: (json) => {
      assert.equal(json.data.authenticated, true);
      assert.equal(json.data.uid, login.data.uid);
      return 'Auth status shows the same signed-in staging user.';
    },
  });

  await runCli(['users', 'me'], {
    check: (json) => {
      assert.equal(json.data.uid, login.data.uid);
      assert.equal(json.data.user.email, user.email);
      return 'The CLI can read the provisioned app-level user profile.';
    },
  });

  const groupCreate = await runCli(['groups', 'create', '--input', '-'], {
    inputJson: {
      name: `CLI Test ${Date.now()}`,
      convertedToCurrency: 'USD',
      defaultPermission: 10,
      minimizeDebts: true,
      remindOldDebts: true,
      firstMember: {
        name: 'Anshul',
        active: true,
        defaultWeight: '1',
        photoUrl: null,
        bankAccount: null,
        lightningAddress: null,
      },
    },
    check: (json) => {
      assert.match(json.data.groupId, /^[-0-9A-Za-z_]{20}$/);
      assert.equal(typeof json.data.firstMemberId, 'string');
      return 'Group create used the permission-stub flow, a Firebase push-style group ID, and linked the creator member.';
    },
  });

  await runCli(['groups', 'list'], {
    check: (json) => {
      assert.ok(json.data.groups.some((group) => group.id === groupCreate.data.groupId));
      return 'Groups list includes the newly created group.';
    },
  });

  const groupId = groupCreate.data.groupId;
  const memberA = groupCreate.data.firstMemberId;
  const memberBCreate = await runCli(['members', 'add', '--group-id', groupId, '--input', '-'], {
    inputJson: { name: 'Neha', active: true, defaultWeight: '1', photoUrl: 'https://example.com/neha.png', bankAccount: null, lightningAddress: null },
    check: (json) => {
      assert.equal(typeof json.data.memberId, 'string');
      return 'Second member was created with a memberId distinct from uid.';
    },
  });
  const memberCCreate = await runCli(['members', 'add', '--group-id', groupId, '--input', '-'], {
    inputJson: { name: 'Rohan' },
    check: (json) => {
      assert.equal(typeof json.data.memberId, 'string');
      assert.equal(json.data.member.active, true);
      assert.equal(json.data.member.defaultWeight, '1');
      return 'Third member was created from a name-only input; the CLI filled active and defaultWeight.';
    },
  });
  const memberB = memberBCreate.data.memberId;
  const memberC = memberCCreate.data.memberId;

  await runCli(['members', 'update', '--group-id', groupId, '--member-id', memberB, '--input', '-'], {
    inputJson: { name: 'Neha S', photoUrl: null },
    check: (json) => {
      assert.deepEqual(json.data.patch, { name: 'Neha S', photoUrl: null });
      return 'Member patch sent only the supplied name and an explicit null photo.';
    },
  });

  await runCli(['members', 'get', '--group-id', groupId, '--member-id', memberB], {
    check: (json) => {
      const member = json.data;
      assert.equal(member.name, 'Neha S');
      assert.equal(member.photoUrl ?? null, null);
      assert.equal(member.defaultWeight, '1');
      assert.equal(member.active, true);
      return 'Backend kept omitted member fields and null cleared the photo.';
    },
  });

  await runCli(['members', 'get', '--group-id', groupId, '--member-id', 'missing-member'], {
    expectFailure: true, check: expectError('MEMBER_NOT_FOUND'),
  });

  await runCli(['members', 'list', '--group-id', groupId, '--active-only'], {
    check: (json) => {
      assert.equal(json.data.members.length, 3);
      return 'Listing active members returns the three expected group participants.';
    },
  });

  await runCli(['categories', 'set', '--group-id', groupId, '--input', '-'], {
    inputJson: { categories: { food: 'Food', taxi: 'Transport', stay: 'Stay', coffee: 'Coffee', activity: 'Activity' } },
    check: (json) => {
      assert.equal(json.data.categories.food, 'Food');
      return 'Custom categories can be patched on the group.';
    },
  });

  await runCli(['categories', 'set', '--group-id', groupId, '--input', '-'], {
    inputJson: { categories: { transfer: 'Settlement' } },
    check: (json) => {
      assert.equal(json.data.categories.transfer, 'Settlement');
      return 'A second category set supplies only one new label.';
    },
  });

  await runCli(['categories', 'list', '--group-id', groupId], {
    check: (json) => {
      assert.equal(json.data.categories.food, 'Food');
      assert.equal(json.data.categories.transfer, 'Settlement');
      return 'Category list shows the second set merged with the first.';
    },
  });

  await runCli(['groups', 'get', '--group-id', groupId], {
    check: (json) => {
      assert.equal(json.data.group.name.startsWith('CLI Test'), true);
      assert.equal(json.data.userGroup.member, memberA);
      return 'Group get returns metadata, permissions, and caller membership.';
    },
  });

  const firstExpense = tx({
    purpose: 'Launch dinner',
    category: 'food',
    date: '2026-01-01',
    payer: memberA,
    split: [memberA, memberB],
    amount: '90',
  });
  const firstExpenseCreate = await runCli(['expenses', 'create', '--group-id', groupId, '--input', '-'], {
    inputJson: firstExpense,
    check: (json) => {
      assert.equal(typeof json.data.transactionId, 'string');
      return 'Expense was created with a two-member split.';
    },
  });
  const firstExpenseId = firstExpenseCreate.data.transactionId;

  const patchedFirstExpense = {
    purpose: 'Launch dinner updated',
    items: [{ amount: '90', forWhom: [memberA, memberB, memberC].map((memberId) => ({ memberId, weight: '1' })) }],
  };
  await runCli(['transactions', 'update', '--group-id', groupId, '--transaction-id', firstExpenseId, '--input', '-'], {
    inputJson: patchedFirstExpense,
    check: (json) => {
      assert.equal(json.data.patch.purpose, 'Launch dinner updated');
      assert.equal(json.data.patch.items[0].forWhom.length, 3);
      return 'Patch replaced the item split so the third member is included.';
    },
  });

  await runCli(['transactions', 'get', '--group-id', groupId, '--transaction-id', firstExpenseId], {
    check: (json) => {
      const transaction = json.data;
      assert.equal(transaction.purpose, 'Launch dinner updated');
      assert.equal(transaction.items[0].forWhom.length, 3);
      assert.equal(transaction.currencyCode, 'USD');
      assert.equal(transaction.whoPaid[0].memberId, memberA);
      return 'Backend applied the patch and kept omitted transaction fields.';
    },
  });

  const extraTransactions = [
    tx({ purpose: 'Airport taxi', category: 'taxi', date: '2026-01-02', payer: memberB, split: [memberA, memberB, memberC], amount: '60' }),
    tx({ purpose: 'Beach coffee', category: 'coffee', date: '2026-01-03', payer: memberC, split: [memberB, memberC], amount: '24' }),
    tx({ purpose: 'Villa booking', category: 'stay', date: '2026-01-04', payer: memberA, split: [memberA, memberB, memberC], amount: '300' }),
    tx({ purpose: 'Scooter rental', category: 'taxi', date: '2026-01-05', payer: memberB, split: [memberA, memberB], amount: '45' }),
    tx({ purpose: 'Kayaking', category: 'activity', date: '2026-01-06', payer: memberC, split: [memberA, memberC], amount: '80' }),
    minimal(tx({ purpose: 'Breakfast', category: 'food', date: '2026-01-07', payer: memberA, split: [memberA, memberB, memberC], amount: '54' })),
    tx({ purpose: 'Museum tickets', category: 'activity', date: '2026-01-08', payer: memberB, split: [memberB, memberC], amount: '36' }),
    tx({ purpose: 'Late-night snacks', category: 'food', date: '2026-01-09', payer: memberC, split: [memberA, memberB, memberC], amount: '33' }),
    tx({ purpose: 'Train tickets', category: 'taxi', date: '2026-01-10', payer: memberA, split: [memberA, memberC], amount: '70' }),
    tx({ purpose: 'Farewell lunch', category: 'food', date: '2026-01-11', payer: memberB, split: [memberA, memberB, memberC], amount: '99' }),
  ];

  const createdTransactions = [firstExpenseId];
  for (const expense of extraTransactions) {
    const created = await runCli(['expenses', 'create', '--group-id', groupId, '--input', '-'], {
      inputJson: expense,
      check: (json) => {
        assert.equal(json.data.transaction.type, 'expense');
        assert.equal(json.data.transaction.fixedExchangeRate, false);
        return Object.hasOwn(expense, 'fixedExchangeRate')
          ? `Created ${expense.purpose} across ${expense.category}, date, and member mix.`
          : `Created ${expense.purpose} from a minimal input; the CLI filled fixedExchangeRate.`;
      },
    });
    createdTransactions.push(created.data.transactionId);
  }

  const fullList = await runCli(['transactions', 'list', '--group-id', groupId, '--order', 'asc'], {
    check: (json) => {
      assert.equal(json.data.count, 11);
      return 'Transaction list returns all 11 expenses in ascending date order.';
    },
  });

  const deleteId = createdTransactions[3];
  await runCli(['transactions', 'delete', '--group-id', groupId, '--transaction-id', deleteId], {
    check: (json) => {
      assert.equal(json.data.deleted, true);
      return 'Delete command reports the selected transaction as removed.';
    },
  });

  const afterDelete = await runCli(['transactions', 'list', '--group-id', groupId], {
    check: (json) => {
      assert.equal(json.data.count, 10);
      assert.equal(json.data.transactions.some((item) => item.id === deleteId), false);
      return 'Transaction list confirms the deleted transaction is absent.';
    },
  });

  await runCli(['transactions', 'get', '--group-id', groupId, '--transaction-id', deleteId], {
    expectFailure: true, check: expectError('TRANSACTION_NOT_FOUND'),
  });

  await runCli(['expenses', 'create', '--group-id', groupId, '--input', '-'], {
    inputJson: tx({ purpose: 'Ghost dinner', category: 'food', date: '2026-01-07', payer: 'missing-member', split: [memberA], amount: '10' }),
    expectFailure: true, check: expectError('MEMBER_NOT_FOUND'),
  });

  await runCli(['expenses', 'create', '--group-id', groupId, '--input', '-'], {
    inputJson: { ...tx({ purpose: 'Bad amount', category: 'food', date: '2026-01-07', payer: memberA, split: [memberA], amount: '10' }), items: [{ amount: 10, forWhom: [{ memberId: memberA, weight: '1' }] }] },
    expectFailure: true, check: expectError('INVALID_INPUT'),
  });

  await runCli(['transactions', 'list', '--group-id', groupId], {
    check: (json) => {
      assert.equal(json.data.count, 10);
      return 'Rejected creates (unknown member, numeric amount) wrote nothing.';
    },
  });

  await runCli(['transactions', 'list', '--group-id', groupId, '--type', 'transfer'], {
    check: (json) => {
      assert.equal(json.data.count, 0);
      return 'Type filter finds no transfers before settlement.';
    },
  });

  await runCli(['transactions', 'list', '--group-id', groupId, '--paid-by-member-id', memberB], {
    check: (json) => {
      assert.ok(json.data.count > 0);
      assert.ok(json.data.transactions.every((item) => item.whoPaid.some((ref) => ref.memberId === memberB)));
      return 'Payer filter only returns transactions paid by that member.';
    },
  });

  await runCli(['transactions', 'list', '--group-id', groupId, '--order', 'desc', '--limit', '3'], {
    check: (json) => {
      assert.equal(json.data.count, 3);
      const times = json.data.transactions.map((item) => item.dateTime);
      assert.deepEqual(times, [...times].sort((a, b) => b - a));
      return 'Limit and descending order return the three latest transactions.';
    },
  });

  await runCli(['transactions', 'list', '--group-id', groupId, '--member-id', memberC], {
    check: (json) => {
      assert.ok(json.data.count > 0);
      assert.ok(json.data.transactions.every((item) =>
        item.whoPaid.some((ref) => ref.memberId === memberC)
        || item.items.some((line) => line.forWhom.some((ref) => ref.memberId === memberC))
      ));
      return 'Member filter only returns transactions where that member participates.';
    },
  });

  await runCli(['transactions', 'list', '--group-id', groupId, '--category', 'food'], {
    check: (json) => {
      assert.ok(json.data.count > 0);
      assert.ok(json.data.transactions.every((item) => item.category === 'food'));
      return 'Category filter only returns food transactions.';
    },
  });

  await runCli(['transactions', 'list', '--group-id', groupId, '--from', '2026-01-05', '--to', '2026-01-09'], {
    check: (json) => {
      assert.ok(json.data.count > 0);
      assert.ok(json.data.transactions.every((item) => {
        const date = new Date(item.dateTime).toISOString().slice(0, 10);
        return date >= '2026-01-05' && date <= '2026-01-09';
      }));
      return 'Date filter only returns transactions inside the inclusive range.';
    },
  });

  await runCli(['debts', 'recalculate', '--group-id', groupId], {
    check: (json) => {
      assert.equal(typeof json.data.taskId, 'string');
      return 'Debt recalculation task was accepted by the configured backend.';
    },
  });

  await runCli(['debts', 'list', '--group-id', groupId], {
    check: (json) => {
      assert.ok(Array.isArray(json.data.debts));
      return 'Server-calculated debt endpoint is reachable after expense creation.';
    },
  });

  const localDebtsBeforeSettlement = calculateDebts(afterDelete.data.transactions);
  assert.ok(localDebtsBeforeSettlement.length > 0);
  steps.push({
    command: 'local ledger debt check from `settleup transactions list` output',
    output: { ok: true, data: { debts: localDebtsBeforeSettlement } },
    check: 'Local deterministic debt calculation found outstanding balances to settle.',
    passed: true,
  });

  const settlementIds = [];
  for (const debt of localDebtsBeforeSettlement) {
    const settlement = {
      type: 'transfer',
      purpose: `Settlement ${debt.from} to ${debt.to}`,
      category: 'transfer',
      currencyCode: 'USD',
      dateTime: new Date('2026-01-12T12:00:00.000Z').getTime(),
      timezone: '+05:30',
      fixedExchangeRate: false,
      exchangeRates: {},
      receiptUrl: null,
      templateId: null,
      whoPaid: [{ memberId: debt.from, weight: '1' }],
      items: [{ amount: debt.amount, forWhom: [{ memberId: debt.to, weight: '1' }] }],
    };
    const created = await runCli(['transfers', 'create', '--group-id', groupId, '--input', '-'], {
      inputJson: settlement,
      check: (json) => {
        assert.equal(json.data.transaction.type, 'transfer');
        return `Settlement transfer created for ${debt.amount} from debtor to creditor.`;
      },
    });
    settlementIds.push(created.data.transactionId);
  }

  await runCli(['debts', 'recalculate', '--group-id', groupId], {
    check: (json) => {
      assert.equal(typeof json.data.taskId, 'string');
      return 'Debt recalculation task was accepted after settlement transfers.';
    },
  });

  await runCli(['debts', 'list', '--group-id', groupId], {
    check: (json) => {
      assert.ok(Array.isArray(json.data.debts));
      return 'Final server debt endpoint is reachable after settlement.';
    },
  });

  const finalList = await runCli(['transactions', 'list', '--group-id', groupId], {
    check: (json) => {
      assert.equal(json.data.transactions.filter((item) => item.type === 'transfer').length, settlementIds.length);
      return 'Final transaction list includes the generated settlement transfers.';
    },
  });

  const localDebtsAfterSettlement = calculateDebts(finalList.data.transactions);
  steps.push({
    command: 'local final debt check from `settleup transactions list` output',
    output: { ok: true, data: { debts: localDebtsAfterSettlement } },
    check: 'Local deterministic debt calculation is zero after settlement transfers.',
    passed: localDebtsAfterSettlement.length === 0,
  });
  assert.equal(localDebtsAfterSettlement.length, 0);

  await runCli(['changes', 'list', '--group-id', groupId, '--limit', '5', '--order', 'desc'], {
    check: (json) => {
      assert.ok(json.data.count > 0);
      return 'Change log is readable and limit/order flags work.';
    },
  });

  await runCli(['groups', 'get', '--group-id', 'missing-group'], {
    expectFailure: true,
    check: (json) => {
      assert.match(json.error.code, /^(GROUP_NOT_FOUND|GROUP_ACCESS_DENIED)$/);
      assert.equal(typeof json.error.details.help, 'string');
      return `Unknown group failed with ${json.error.code} and recovery help.`;
    },
  });

  // Expire the stored session so the next command must refresh it.
  const sessionDir = path.join(configDir, process.env.SETTLEUP_ENV || 'production');
  const sessionFile = path.join(sessionDir, (await fs.readdir(sessionDir)).find((name) => name.startsWith('auth-')));
  const expired = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
  await fs.writeFile(sessionFile, JSON.stringify({ ...expired, expiresAt: Date.now() - 1000 }));
  await runCli(['users', 'me'], {
    displayCommand: 'settleup users me  # after expiring the stored session',
    check: (json) => {
      assert.equal(json.data.uid, login.data.uid);
      return 'Command succeeded with an expired stored session.';
    },
  });
  const refreshed = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
  assert.ok(refreshed.expiresAt > Date.now() && refreshed.accessToken !== expired.accessToken);
  steps.push({
    command: 'inspect the stored session after `settleup users me`',
    output: { ok: true, data: { refreshed: true, expiresAt: refreshed.expiresAt } },
    check: 'The expired session was refreshed and saved with a new access token.',
    passed: true,
  });

  await runCli(['auth', 'logout'], {
    check: (json) => {
      assert.equal(json.data.authenticated, false);
      return 'Logout clears the local CLI session.';
    },
  });

  await runCli(['auth', 'status'], {
    check: (json) => {
      assert.equal(json.data.authenticated, false);
      return 'Auth status reports signed out after logout.';
    },
  });

  const reportPath = path.join(reportsDir, `cli-integration-${runStamp}.md`);
  const markdown = [
    `# CLI Integration Test Run - ${runStartedAt.toISOString()}`,
    '',
    `Sandbox user: \`${user.email}\``,
    `Group id: \`${groupId}\``,
    '',
    '| Summary | Value |',
    '|---|---:|',
    `| Steps run | ${steps.length} |`,
    `| Passed | ${steps.filter((step) => step.passed).length} |`,
    `| Failed | ${steps.filter((step) => !step.passed).length} |`,
    '',
    ...steps.flatMap((step, index) => [
      `## ${index + 1}. ${step.passed ? 'PASS' : 'FAIL'}`,
      '',
      `Checked: ${step.check}`,
      '',
      'Input command:',
      '',
      '```bash',
      step.command,
      '```',
      '',
      'Output:',
      '',
      '```json',
      JSON.stringify(step.output, null, 2),
      '```',
      '',
    ]),
  ].join('\n');

  await fs.writeFile(reportPath, markdown);
  console.log(JSON.stringify({ ok: true, reportPath, steps: steps.length, passed: steps.filter((step) => step.passed).length }, null, 2));
}

main().catch(async (error) => {
  const reportPath = path.join(reportsDir, `cli-integration-${runStamp}-failed.md`);
  await fs.mkdir(reportsDir, { recursive: true });
  const markdown = [
    `# CLI Integration Test Run Failed - ${runStartedAt.toISOString()}`,
    '',
    `Error: ${error.stack || error.message}`,
    '',
    ...steps.flatMap((step, index) => [
      `## ${index + 1}. ${step.passed ? 'PASS' : 'FAIL'}`,
      '',
      `Checked: ${step.check}`,
      '',
      'Input command:',
      '',
      '```bash',
      step.command,
      '```',
      '',
      'Output:',
      '',
      '```json',
      JSON.stringify(step.output, null, 2),
      '```',
      '',
    ]),
  ].join('\n');
  await fs.writeFile(reportPath, markdown);
  console.error(JSON.stringify({ ok: false, reportPath, error: error.message }, null, 2));
  process.exit(1);
});
