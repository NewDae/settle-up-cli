# settleup CLI

Deterministic JSON-only CLI for exercising the Settle Up sandbox API. The installed command is `settleup`.

## What This CLI Does

- Authenticates a sandbox Firebase user and stores a local session.
- Creates groups using the sandbox-safe permission-stub flow.
- Manages members, categories, expenses, transfers, transactions, debts, and changes.
- Lists and filters transactions by member, payer, category, type, date, limit, and order.
- Triggers backend debt recalculation tasks.
- Emits JSON success/error envelopes for every command.

## Design Principles

- Output is always JSON.
- Writes use exact IDs and JSON input.
- `uid` and `memberId` are kept separate.
- Amounts and weights are strings, not floats.
- Patch commands preserve omitted fields; provided arrays/objects replace the stored field.
- The CLI does not do fuzzy name matching before writes.

## Main Commands

```bash
settleup auth login
settleup auth status
settleup users me
settleup groups create --input -
settleup members add --group-id <groupId> --input -
settleup expenses create --group-id <groupId> --input -
settleup transactions list --group-id <groupId>
settleup transactions update --group-id <groupId> --transaction-id <transactionId> --input -
settleup transactions delete --group-id <groupId> --transaction-id <transactionId>
settleup debts recalculate --group-id <groupId>
settleup debts list --group-id <groupId>
```

Use schema help for write payloads:

```bash
settleup schema groups.create
settleup schema expenses.create
settleup schema transactions.update
```

## Group Creation Flow

`settleup groups create` is one command, but it performs the full sandbox-safe flow:

1. Generates a client-side `groupId`.
2. Writes `/permissions/<groupId>/<uid>`.
3. Reads the generated group stub.
4. Patches `/groups/<groupId>` with metadata.
5. Creates the first member from `firstMember`.
6. Links `/userGroups/<uid>/<groupId>` to that member.
7. Sets `/users/<uid>/currentTabId`.

This means the logged-in user is automatically added to the group as the first member.

## Spec Alignment

Implemented from [CLI_SPEC.md](CLI_SPEC.md):

- Command groups: `auth`, `users`, `groups`, `members`, `categories`, `transactions`, `expenses`, `transfers`, `debts`, `changes`, `schema`.
- JSON success/error envelopes.
- Explicit IDs for writes.
- Client-side transaction filtering.
- Group creation via permission stub, not `POST /groups`.
- Transaction and member patch semantics.
- Server task wrapper for debt recalculation.

Backend endpoint details are documented in [API_REFERENCE.md](API_REFERENCE.md).

Known implementation notes:

- `auth login` supports piped stdin in non-TTY runs so the integration test can automate login. Interactive login still works normally.
- Tokens are stored in the config-directory fallback path, not OS keychain.
- Debt settlement is represented by creating `transfer` transactions, aligned with the CLI spec.

## Tests

[Tests.md](Tests.md) has the fuller test overview, including what each test layer checks and the exact commands to run them.

Offline contract tests:

```bash
npm test
```

Live sandbox smoke tests:

```bash
SETTLEUP_RUN_LIVE=1 node --test test/sandbox-live.test.mjs
```

Reusable CLI end-to-end integration:

```bash
npm run integration:e2e
```

The integration run creates a fresh sandbox user and group, then covers login, member creation, categories, expenses, transaction patching, listing, deletion, filtering, debts, settlement transfers, final debt checks, changes, and logout.

Each run writes a dated markdown report:

```text
integration-reports/cli-integration-<date>.md
```

The report includes the input command, JSON output, and a one-line pass check for every step.

## Repo Structure

```text
bin/settleup.mjs                  CLI executable
scripts/run-cli-integration.mjs   Reusable live E2E runner
test/                             Contract and sandbox tests
CLI_SPEC.md                       CLI contract and API mapping
API_REFERENCE.md                  Backend endpoints and sandbox path mapping
Tests.md                          Test coverage notes and commands
```
