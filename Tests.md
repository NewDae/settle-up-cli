# Test Strategy

This project tests the CLI in three layers:

| Layer | Command | Purpose |
|---|---|---|
| Local deterministic suite | `npm test` | Fast, no-network checks for CLI output, JSON contracts, and invalid inputs. |
| Live backend suite | `npm run test:live` | Verifies configured staging backend behavior against real APIs. |
| CLI end-to-end workflow | `npm run integration:e2e` | Exercises the actual CLI through a full staging user journey and writes a report. |

The default test command is intentionally quiet. It excludes helper modules and live backend tests so ordinary local runs do not show skipped network tests or fail because an external service is unavailable.

## Principles

- Test the public CLI contract: JSON envelopes, stable error codes, required identifiers, and schema examples.
- Keep `uid` and `memberId` separate everywhere. Auth uses `uid`; group ledger operations use `memberId`.
- Reject common bad agent inputs early, before writes reach the backend.
- Keep live tests explicit because they depend on network access and staging availability.
- Avoid assertions on incidental backend behavior unless the CLI depends on it.

## Local Deterministic Suite

Run:

```bash
npm test
```

This runs:

- [test/cli-contract.test.mjs](test/cli-contract.test.mjs)
- [test/cli-help.test.mjs](test/cli-help.test.mjs)
- [test/negative-inputs.test.mjs](test/negative-inputs.test.mjs)
- [test/spec-contracts.test.mjs](test/spec-contracts.test.mjs)

What it covers:

| Area | Coverage |
|---|---|
| CLI executable behavior | Help, schema output, auth status without a session, auth-required errors, and unknown-command errors. |
| JSON envelopes | Success and error responses keep the documented `ok`, `data` or `error`, and `meta.environment` shape. |
| Error codes | The allowed error code list remains stable. |
| Identity model | Fixtures and nested transaction references do not mix `uid` and `memberId`. |
| Primitive formats | Amounts and weights are decimal strings; currency codes are `A-Z{3}`; dates are epoch millis; timezones are offsets. |
| Write inputs | Group, member, category, expense, transfer, transaction patch, and server task payloads match the CLI spec. |
| Patch behavior | Omitted fields remain unchanged; provided arrays and objects replace the stored value. |
| Negative cases | Malformed inputs such as numeric weights, lowercase currency codes, ISO date strings, empty split arrays, and missing wrappers are rejected. |
| Entity samples | Group, permission, user, userGroup, change, and debts examples match the published API shapes. |

Most contract logic lives in [test/helpers/spec-validators.mjs](test/helpers/spec-validators.mjs), with reusable fixtures in [test/helpers/spec-fixtures.mjs](test/helpers/spec-fixtures.mjs). These helpers are not run as standalone tests in the default command.

## Live Backend Suite

Run:

```bash
npm run test:live
```

This sets `SETTLEUP_RUN_LIVE=1` and runs [test/sandbox-live.test.mjs](test/sandbox-live.test.mjs). These legacy live tests still target Firebase-style backend paths and should be run only with explicit staging config.

What it covers:

| Area | Coverage |
|---|---|
| Auth | Temporary user signup, signin, and token refresh where supported by staging. |
| User provisioning | The test creates `/users/<uid>` because Firebase signup does not create the database profile automatically. |
| Authenticated reads | `/users/<uid>` and `/userGroups/<uid>` are reachable with the returned `idToken`. |
| Permission-first writes | Group-owned writes work after creating `/permissions/<groupId>/<uid>`. |
| Group creation flow | Permission write, group metadata patch, first member create, `/userGroups/<uid>/<groupId>` link, and current tab update. |
| Members and categories | List, fetch, patch, and read operations against group-owned paths. |
| Transactions | Create, list, patch, fetch, and delete expense and transfer transactions. |
| Debts and changes | Read derived debts and group changes after seeding a transaction. |
| Server tasks | Post `{ request: { groupId } }` to `/serverTasks/calculateDebts`. |
| Auto-ID group create | Documents why the CLI avoids `POST /groups`: permissions cannot be pre-created for a generated id. |

Required staging overrides:

```bash
export SETTLEUP_ENV=staging
export SETTLEUP_API_BASE_URL="https://<staging-settle-up-api>"
export SETTLEUP_FIREBASE_API_KEY="..."
```

## Full File Run

Run:

```bash
npm run test:all
```

This runs every `test/*.test.mjs` file. Without `SETTLEUP_RUN_LIVE=1`, the live backend cases appear as skipped tests. Use this when you want to confirm all test files load, not as the normal local feedback loop.

## End-to-End CLI Workflow

Run:

```bash
npm run integration:e2e
```

This uses the configured staging API, logs in through the CLI, creates a group and members, exercises expenses, transaction patching, listing, deletion, filtering, debts, settlement transfers, changes, and logout.

Each run writes a dated report to:

```text
integration-reports/cli-integration-<date>.md
```

The report includes each command, its JSON output, and a one-line pass check.

## Staging Assumptions

- The suite uses `SETTLEUP_API_BASE_URL` and local `.env`/shell config.
- The CLI does not commit Firebase API keys.
- Auth login goes through `<SETTLEUP_API_BASE_URL>/auth/login`.
- Group-owned writes need a permission record first. The stable create flow is permission write, `PATCH /groups/<groupId>`, member create, and `/userGroups/<uid>/<groupId>` link.
- The CLI uses a client-generated group id so permissions can be created before group metadata is patched.

## Reference Docs

- [CLI spec](CLI_SPEC.md)
- [Settle Up API index](https://api.settleup.io/)
- [Data entities](https://api.settleup.io/entities/)
- [Operations](https://api.settleup.io/operations/)
