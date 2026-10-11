# Developing Settle Up CLI

Developer setup, implementation references, and testing. For installation and everyday usage, see [README.md](README.md).

## Run from source

```bash
git clone https://github.com/NewDae/settle-up-cli.git
cd settle-up-cli
node bin/settleup.mjs --help
npm link
```

## Local Dev And Testing Config

For local development, use `.env` for day-to-day CLI commands:

```bash
cp .env.example .env
```

For E2E runs, keep staging and production config separate:

```bash
cp .env.staging.example .env.staging
cp .env.production.example .env.production
```

Example staging config:

```bash
SETTLEUP_ENV=staging
SETTLEUP_API_BASE_URL=https://<staging-settle-up-api>
SETTLEUP_FIREBASE_API_KEY=<staging-firebase-api-key>
```

`SETTLEUP_FIREBASE_API_KEY` is only for local/staging development or trusted internal runs. Normal users of the published package do not need to configure URLs, Firebase keys, or a local backend. Published-package login options are documented in [LOGIN.md](LOGIN.md).

Run E2E against a specific environment:

```bash
npm run integration:e2e:staging
npm run integration:e2e:prod
```

Real shell environment variables override env-file values.

## Main Commands

| Command | What it does |
|---|---|
| `settleup auth login` | Signs in through hosted auth, or direct Firebase Auth when `SETTLEUP_FIREBASE_API_KEY` is set. |
| `settleup auth status` | Shows whether a local session exists. |
| `settleup users me` | Reads the current app-level user profile. |
| `settleup groups list` | Lists groups visible to the logged-in user. |
| `settleup groups get --group-id <groupId>` | Fetches one group, permissions, and the caller's group link. |
| `settleup groups create --input -` | Creates a group, first member, permission entry, and user-group link. |
| `settleup members list --group-id <groupId>` | Lists members in a group. |
| `settleup members add --group-id <groupId> --input -` | Adds a member to a group. |
| `settleup members update --group-id <groupId> --member-id <memberId> --input -` | Patches selected member fields. |
| `settleup categories set --group-id <groupId> --input -` | Patches custom category labels for a group. |
| `settleup expenses create --group-id <groupId> --input -` | Creates an expense transaction. |
| `settleup transfers create --group-id <groupId> --input -` | Creates a transfer transaction, including settlement transfers. |
| `settleup transactions list --group-id <groupId>` | Lists transactions, with optional filters for member, category, type, date, and order. |
| `settleup transactions update --group-id <groupId> --transaction-id <transactionId> --input -` | Patches selected transaction fields. |
| `settleup transactions delete --group-id <groupId> --transaction-id <transactionId>` | Deletes one transaction. |
| `settleup debts recalculate --group-id <groupId>` | Triggers backend recalculation of derived debts. |
| `settleup debts list --group-id <groupId>` | Reads server-calculated debts for a group. |
| `settleup changes list --group-id <groupId>` | Reads the group change log. |

Use schema help for write payloads:

```bash
settleup schema groups.create
settleup schema expenses.create
settleup schema transactions.update
```

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
- Tokens are stored per `SETTLEUP_ENV` in the config-directory fallback path, not OS keychain.
- Debt settlement is represented by creating `transfer` transactions, aligned with the CLI spec.

## Tests

[Tests.md](https://github.com/NewDae/settle-up-cli/blob/main/Tests.md) has the fuller test overview, including what each test layer checks and the exact commands to run them.

Offline contract tests:

```bash
npm test
```

Live staging smoke tests:

```bash
SETTLEUP_ENV=staging npm run integration:e2e
```

Reusable CLI end-to-end integration:

```bash
npm run integration:e2e
```

The integration run uses the configured staging API, then covers login, member creation, categories, expenses, transaction patching, listing, deletion, filtering, debts, settlement transfers, final debt checks, changes, and logout.

Each run writes a dated markdown report:

```text
integration-reports/cli-integration-<date>.md
```

The report includes the input command, JSON output, and a one-line pass check for every step.

## Repo Structure

```text
bin/settleup.mjs                  CLI executable
scripts/run-cli-integration.mjs   Reusable live E2E runner
test/                             Contract and staging tests
CLI_SPEC.md                       CLI contract and API mapping
API_REFERENCE.md                  Backend endpoints and path mapping
Tests.md                          Test coverage notes and commands
```

## Open source

An independent community integration, not an official Settle Up client. Released under the [MIT license](LICENSE). If it helps you, [star the repository](https://github.com/NewDae/settle-up-cli).
