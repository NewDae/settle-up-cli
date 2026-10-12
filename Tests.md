# Test Strategy

This project tests the CLI in three layers:

| Layer | Command | Purpose |
|---|---|---|
| Local deterministic suite | `npm test` | Runs the real CLI; scripted responses verify requests without external network access. Browser-login tests use a localhost HTTP server and real SQLite SQL. |
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
- [test/cli-credential-storage.test.mjs](test/cli-credential-storage.test.mjs) (see [credential storage](#credential-storage))
- [test/cli-help.test.mjs](test/cli-help.test.mjs)
- [test/cli-reads.test.mjs](test/cli-reads.test.mjs)
- [test/cli-guidance.test.mjs](test/cli-guidance.test.mjs)
- [test/negative-inputs.test.mjs](test/negative-inputs.test.mjs)
- [test/spec-contracts.test.mjs](test/spec-contracts.test.mjs)

What it covers:

| Area | Coverage |
|---|---|
| CLI executable behavior | Help, schema output, auth status without a session, auth-required errors, and unknown-command errors. |
| JSON envelopes | Success and error responses keep the documented `ok`, `data` or `error`, and `meta.environment` shape. |
| Error codes and recovery | Actual CLI failures use stable codes. Validation links to the command's schema/help; backend failure guidance preserves status/body details and avoids blind write retries. |
| Identity model | Auth UID and group member IDs remain separate; the CLI rejects `uid` in payer and recipient references. |
| Primitive formats | Actual CLI input checks reject numeric amounts/weights, malformed decimal strings, lowercase currency codes, ISO date strings, and timezone names. |
| Write inputs and discovery | Valid group, member, category, expense, transfer, and patch inputs produce expected HTTP requests; creates fill backend-required defaults only when omitted. Schema output explains required/optional and nested field types, formats, meanings, and invocation; advertised examples exercise CLI validators. |
| Patch requests | The CLI sends only supplied fields, including complete supplied arrays/objects and explicit null clearing; it does not fill in omitted fields. |
| Negative cases | Malformed write inputs return `INVALID_INPUT` before any backend request with a fresh session. Unknown transaction members are rejected after the member lookup and before any write. |
| Response mapping | The CLI preserves backend group, permission, user, and userGroup records, adds change IDs, and normalizes debt responses. |
| Read commands | `groups list`, `members list` (including `--active-only`), `members get`, `categories list`, `transactions get`, and `transactions delete` send the expected request and shape; missing records return `MEMBER_NOT_FOUND` or `TRANSACTION_NOT_FOUND`. |
| List filters | Every `transactions list` filter, including recipient-only member matches and inclusive local-day `--to` bounds; ordering and limits for transactions and changes; invalid filter values fail with `INVALID_INPUT` before any request. |
| Sign-in and sessions | Rejected hosted and direct Firebase sign-in return `AUTH_INVALID` while outages stay `API_REQUEST_FAILED`; first sign-in creates the user profile; sessions refresh within the final minute but not earlier; backend 401 maps to `GROUP_ACCESS_DENIED`. |
| Auth Worker | Login/refresh Firebase mapping, closed browser access, validation, rate-limit binding, stable failures without upstream Firebase codes, no credential logging, and no-store responses. |
| Browser login | Pairing and pending state, private-key file permissions, encrypted handoff, wrong-key/tampering rejection, one-time collection, expiry, cancellation, same-origin checks, bounded inputs, rate limiting, sanitized hosted-auth failures, and hosted Worker refresh. Firebase API keys and readable tokens are never returned to the page. |
| Server task | Debt recalculation constructs `{ request: { groupId } }`; a missing group ID is rejected locally. |

Reusable inputs and backend response samples live in [test/helpers/spec-fixtures.mjs](test/helpers/spec-fixtures.mjs). [test/helpers/cli-harness.mjs](test/helpers/cli-harness.mjs) launches the executable with isolated configuration and a fresh test session, captures outgoing requests, and supplies scripted responses. Unexpected requests fail; temporary files are removed after each run. Validation lives in the CLI, with no parallel test-only implementation.

These local tests verify what the wrapper sends and returns. They do not prove backend persistence, permissions, debt calculation, or how the backend applies a PATCH. Those behaviors require live backend checks; see the live-suite coverage and end-to-end limitations below.

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

This uses the configured API/environment (see environment selection below), creates a temporary account using a locally supplied Firebase key, and drives every CLI command through a full user journey:

- login, status, profile, token refresh after an expired session, logout, and signed-out status
- group create (checking the push-ID format), list, and get
- member add (including a name-only input that relies on create defaults), get, patch with read-back, and active-only listing
- category set, a second set that must merge, and list
- expenses (including a minimal input that relies on `fixedExchangeRate` defaulting), patch with read-back, get, delete, and every `transactions list` filter
- debts, recalculation, settlement transfers, and the change log with limit/order
- expected failures, which must return the right error code with `details.help` and write nothing: `MEMBER_NOT_FOUND`, `TRANSACTION_NOT_FOUND`, `INVALID_INPUT`, and an unknown group

Each run writes a dated report to:

```text
integration-reports/cli-integration-<date>.md
```

The report includes each command, its JSON output, and a one-line pass check.

The workflow checks that the server debt endpoint returns an array. Settlement amounts and the final zero-balance assertion use the runner's own calculation from transactions; they do not independently verify the server's debt amounts.

## Environment selection

Use [developer environment setup](DEVELOPMENT.md#environment-setup) for config files and precedence, and [LOGIN.md](LOGIN.md#configuration-reference) for auth selection. The raw live suite needs exported staging API and Firebase key variables; the E2E runner loads `.env` by default.

For explicit E2E config files:

```bash
npm run integration:e2e:staging  # loads .env.staging
npm run integration:e2e:prod     # loads .env.production
```

These are real write workflows. The production command creates records in the configured production backend; use staging for routine validation. No environment is inferred from a URL alone.

Group-owned writes depend on permission-first creation; the exact mapping and stub rationale live in [API_REFERENCE.md](API_REFERENCE.md#group-creation-notes).

## Reference Docs

- [CLI spec](CLI_SPEC.md)
- [Settle Up API index](https://api.settleup.io/)
- [Data entities](https://api.settleup.io/entities/)
- [Operations](https://api.settleup.io/operations/)

## Credential storage

`test/cli-credential-storage.test.mjs` runs the real CLI across processes with mocked native storage and strictly offline HTTP responses. It covers login, refresh, logout, store failures and error redaction, verified legacy migration, corrupt sessions reading as signed out, explicit file storage and Unix permissions (including leaving an existing config directory unchanged), the Windows Credential Manager size limit, and session isolation by environment, directory, and backend.

`npm run test:credentials` exercises the real native OS store using uniquely scoped dummy sessions and mocked HTTP. It never reads the user's normal session or contacts a backend. The dummy credential is deleted after testing. This verifies the CLI integration, not every desktop permission prompt or a security audit of the dependency.

GitHub Actions (`.github/workflows/ci.yml`) runs the offline suite, `docs:check`, and native tests on macOS, Windows, and Linux. Linux starts GNOME Keyring within a D-Bus session, and also tests an unavailable service. To reproduce Linux locally:

```bash
docker build -f test/docker/Dockerfile -t settleup-credential-test .
docker run --rm settleup-credential-test
```

The integration runner deliberately uses explicit file storage with its temporary config directory so sandbox runs do not leave OS credentials behind.
