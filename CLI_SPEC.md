# Settle Up Sandbox CLI Spec

## Goal

Provide a deterministic, JSON-only CLI for agent use against the configured Settle Up API.

Design constraints:

- No fuzzy resolution in the CLI
- No hidden lookup before writes
- No derived reporting commands
- All write commands are explicit and deterministic
- Agent is responsible for lookup, caching, aggregation, and memory

---

## Non-Goals

- No human-first pretty output by default
- No natural-language command inputs
- No internal "smart" matching of group names or member names
- No bundled credentials or session tokens
- No reporting layer like `reports spend` or `reports share`

---

## Core Design

### Principles

- Output is always JSON
- Read commands use flags
- Write commands use exact IDs plus JSON input
- Mutating commands never accept fuzzy names
- Mutating commands only affect provided fields; omitted fields remain unchanged
- Errors are structured and stable
- Amounts and weights are strings, not floats

### Identity Model

There are two different identities:

- `user`
  - authenticated Firebase / Settle Up account
  - represented by `uid`
- `member`
  - participant inside a specific group
  - represented by `memberId`
  - used in transactions and debts

The CLI must keep these distinct.

### `uid` vs `memberId`

| Identifier | Scope | Meaning | Where used |
|---|---|---|---|
| `uid` | global user account | Authenticated Settle Up / Firebase user identity. | Auth, `/users/<uid>`, `/userGroups/<uid>`, `/permissions/<groupId>/<uid>` |
| `memberId` | single group | Ledger participant inside one specific group. | `/members/<groupId>/<memberId>`, transactions, debts, splits, transfers |

Rules:

- a `uid` is not interchangeable with a `memberId`
- the same person may have different `memberId` values in different groups
- transaction and settlement commands use `memberId`, not `uid`
- auth and access control are based on `uid`

---

## Auth Model

### What the CLI ships with

- code
- command schemas and validation
- production/staging API URL configuration through environment or `.env`

### What the CLI must not ship with

- Firebase API keys for production
- any `idToken`
- any `refreshToken`
- any user password

### Token flow

Hosted user flow:

1. user runs `auth login`
2. CLI calls `<SETTLEUP_API_BASE_URL>/auth/login`
3. auth wrapper handles Firebase auth
4. CLI stores `accessToken`, `refreshToken`, `uid`, `expiresAt` locally
5. CLI refreshes token through `<SETTLEUP_API_BASE_URL>/auth/refresh` before authenticated commands

Local/staging development flow:

1. contributor sets `SETTLEUP_FIREBASE_API_KEY` in `.env` or shell env
2. user runs `auth login`
3. CLI signs in directly with Firebase Auth using the local development key
4. CLI stores `accessToken`, `refreshToken`, `uid`, `expiresAt` locally
5. CLI refreshes directly with Firebase Auth before authenticated commands
6. backend commands still use `<SETTLEUP_API_BASE_URL>` with the stored access token

### Security boundary

- Firebase API keys are not committed to the open-source CLI
- local/staging development can provide `SETTLEUP_FIREBASE_API_KEY` through `.env`
- real session secrets are `refreshToken` and `accessToken`
- hosted auth wrapping is handled by the configured Settle Up API

### Local storage

Preferred:

- OS keychain for tokens

Fallback:

- config directory with strict file permissions

Suggested paths:

- `~/.config/settleup-cli/<environment>/auth.json`

---

## Output Contract

### Success envelope

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "environment": "staging"
  }
}
```

### Error envelope

```json
{
  "ok": false,
  "error": {
    "code": "GROUP_NOT_FOUND",
    "message": "Group g123 was not found",
    "details": {}
  },
  "meta": {
    "environment": "staging"
  }
}
```

### Error code set

- `AUTH_REQUIRED`
- `AUTH_INVALID`
- `AUTH_REFRESH_FAILED`
- `INVALID_INPUT`
- `GROUP_NOT_FOUND`
- `GROUP_ACCESS_DENIED`
- `MEMBER_NOT_FOUND`
- `TRANSACTION_NOT_FOUND`
- `API_REQUEST_FAILED`
- `API_RATE_LIMITED`
- `SERVER_TASK_FAILED`

---

## Command Surface

### Top-level groups

- `auth`
- `users`
- `groups`
- `members`
- `categories`
- `transactions`
- `expenses`
- `transfers`
- `debts`
- `changes`
- `schema`

---

## Commands

### `auth`

#### `settleup auth login`

Purpose:

- authenticate user and store local session

Behavior:

- prompt for email interactively
- prompt for password interactively with hidden input
- no non-interactive mode

Output:

```json
{
  "ok": true,
  "data": {
    "uid": "u1",
    "email": "me@example.com",
    "expiresAt": 1777872000000
  }
}
```

#### `settleup auth status`

Output:

```json
{
  "ok": true,
  "data": {
    "authenticated": true,
    "uid": "u1",
    "email": "me@example.com",
    "expiresAt": 1777872000000
  }
}
```

#### `settleup auth logout`

Purpose:

- delete local session

---

### `users`

#### `settleup users me`

Purpose:

- fetch `/users/<uid>`

---

### `groups`

#### `settleup groups list`

Purpose:

- list groups accessible to current user

Reads:

- `/userGroups/<uid>`
- `/groups/<groupId>`

#### `settleup groups get --group-id <groupId>`

Purpose:

- fetch one group, permissions, and caller membership

Reads:

- `/groups/<groupId>`
- `/permissions/<groupId>`
- `/userGroups/<uid>/<groupId>`

#### `settleup groups create --input -|<path>`

Purpose:

- create group and first member

Input type:

- `CreateGroupInput`

Writes:

1. Generate a client-side `groupId`
2. `PUT /permissions/<groupId>/<uid>`
3. `PATCH /groups/<groupId>`
4. `POST /members/<groupId>`
5. `PUT /userGroups/<uid>/<groupId>`
6. `PUT /users/<uid>/currentTabId`

Sandbox note:

- `POST /groups` is not used because permissions must exist before group metadata is writable.
- Creating `/permissions/<groupId>/<uid>` creates a minimal group stub with invite metadata.
- The CLI should patch that stub with `CreateGroupInput` group fields, then create the creator's member and user-group link.

---

### `members`

#### `settleup members list --group-id <groupId> [--active-only]`

Purpose:

- list members in a group

#### `settleup members get --group-id <groupId> --member-id <memberId>`

Purpose:

- fetch one member

#### `settleup members add --group-id <groupId> --input -|<path>`

Purpose:

- create member in group

Input type:

- `MemberInput`

#### `settleup members update --group-id <groupId> --member-id <memberId> --input -|<path>`

Purpose:

- patch member object

Input type:

- `MemberPatchInput`

Important:

- only provided keys are updated
- omitted keys remain unchanged

---

### `categories`

#### `settleup categories list --group-id <groupId>`

Purpose:

- list custom category mappings

#### `settleup categories set --group-id <groupId> --input -|<path>`

Purpose:

- patch category mappings

Input type:

- `SetCategoriesInput`

---

### `transactions`

#### `settleup transactions list --group-id <groupId> [filters...]`

Purpose:

- list raw transactions with client-side filtering

Supported filters:

- `--type expense|transfer`
- `--from <YYYY-MM-DD|epochMillis>`
- `--to <YYYY-MM-DD|epochMillis>`
- `--member-id <memberId>`
- `--paid-by-member-id <memberId>`
- `--category <categoryKey>`
- `--limit <n>`
- `--order asc|desc`

Filter semantics:

- `member-id`: member appears anywhere in transaction
- `paid-by-member-id`: member appears in `whoPaid`
- `from` and `to`: inclusive bounds on `dateTime`
- `category`: exact transaction category match

#### `settleup transactions get --group-id <groupId> --transaction-id <transactionId>`

Purpose:

- fetch one transaction

#### `settleup transactions update --group-id <groupId> --transaction-id <transactionId> --input -|<path>`

Purpose:

- patch transaction object

Input type:

- `TransactionPatchInput`

Important:

- only provided top-level keys are updated
- omitted keys remain unchanged
- if an array field is provided, the whole array replaces the stored array
- if an object field is provided, the whole object replaces the stored object

#### `settleup transactions delete --group-id <groupId> --transaction-id <transactionId>`

Purpose:

- delete transaction

---

### `expenses`

#### `settleup expenses create --group-id <groupId> --input -|<path>`

Purpose:

- create expense transaction

Input type:

- `ExpenseInput`

---

### `transfers`

#### `settleup transfers create --group-id <groupId> --input -|<path>`

Purpose:

- create transfer transaction
- this is the mechanism for marking settlement
- settlement is not a separate debt mutation; a settlement is recorded as a `transfer` transaction from the debtor to the creditor

Input type:

- `TransferInput`

---

### `debts`

#### `settleup debts list --group-id <groupId>`

Purpose:

- fetch server-calculated debts

#### `settleup debts recalculate --group-id <groupId>`

Purpose:

- trigger debt recalculation server task

---

### `changes`

#### `settleup changes list --group-id <groupId> [--limit <n>] [--order asc|desc]`

Purpose:

- fetch group change log

---

### `schema`

#### `settleup schema <command>`

Examples:

- `settleup schema groups.create`
- `settleup schema members.update`
- `settleup schema expenses.create`

Purpose:

- print exact JSON input contract, required fields, and example payload

---

## Input Types

### `CreateGroupInput`

Used by:

- `groups create`

```json
{
  "name": "Goa Trip",
  "convertedToCurrency": "INR",
  "defaultPermission": 10,
  "minimizeDebts": true,
  "remindOldDebts": true,
  "firstMember": {
    "name": "Anshul",
    "active": true,
    "defaultWeight": "1",
    "photoUrl": null,
    "bankAccount": null,
    "lightningAddress": null
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Group display name. |
| `convertedToCurrency` | string | yes | Group currency used for balances and debts. |
| `defaultPermission` | integer (`10`/`20`/`30`) | no | Default permission level assigned to new users added to the group. |
| `minimizeDebts` | boolean | no | Whether Settle Up should minimize the number of settlement transfers. |
| `remindOldDebts` | boolean | no | Whether the group should enable reminders for older outstanding debts. |
| `firstMember` | object | yes | Initial group member representing the creator inside the group ledger. |

---

### `MemberInput`

Used by:

- `members add`
- `members update`

```json
{
  "name": "Sid",
  "active": true,
  "defaultWeight": "1",
  "photoUrl": null,
  "bankAccount": null,
  "lightningAddress": null
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Member display name shown in the group. |
| `active` | boolean | no | Whether the member should be included by default in future transactions. |
| `defaultWeight` | decimal string | no | Default split weight for this member in new transactions; `"1"` is a normal equal share. |
| `photoUrl` | string or `null` | no | Optional avatar URL for the member. |
| `bankAccount` | string or `null` | no | Optional bank account or payout reference shown for settlement. |
| `lightningAddress` | string or `null` | no | Optional Lightning payment address for settlement. |

Update behavior:

- partial patch
- only provided keys are changed
- omitted keys are preserved

---

### `MemberPatchInput`

Used by:

- `members update`

Example:

```json
{
  "name": "Siddharth",
  "defaultWeight": "1.5"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | no | Updated member display name shown in the group. |
| `active` | boolean | no | Updated flag controlling whether the member is included by default in future transactions. |
| `defaultWeight` | decimal string | no | Updated default split weight for this member in new transactions. |
| `photoUrl` | string or `null` | no | Updated avatar URL for the member. |
| `bankAccount` | string or `null` | no | Updated bank account or payout reference shown for settlement. |
| `lightningAddress` | string or `null` | no | Updated Lightning payment address for settlement. |

Patch semantics:

- only keys present in the input are changed
- omitted keys are preserved
- `null` clears nullable fields such as `photoUrl`, `bankAccount`, and `lightningAddress`

---

### `SetCategoriesInput`

Used by:

- `categories set`

```json
{
  "categories": {
    "🍽️": "Food",
    "🚕": "Transport",
    "☕": "Coffee"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `categories` | object<string,string> | yes | Mapping from Settle Up category key or emoji to a custom display label. |

Behavior:

- patch merge

---

### Shared nested types

#### `WeightedMemberRef`

```json
{
  "memberId": "m_sid",
  "weight": "1"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `memberId` | string | yes | Exact group member identifier. |
| `weight` | decimal string | yes | Relative contribution or split weight for this member inside the given array. |

#### `TransactionItem`

```json
{
  "amount": "2400",
  "forWhom": [
    { "memberId": "m_sid", "weight": "1" },
    { "memberId": "m_neha", "weight": "1" }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `amount` | decimal string | yes | Monetary amount for this line item in the transaction currency. |
| `forWhom` | `WeightedMemberRef[]` | yes | Members who should bear this item, with relative weights for splitting. |

---

### `ExpenseInput`

Used by:

- `expenses create`

```json
{
  "type": "expense",
  "purpose": "Dinner",
  "category": "🍽️",
  "currencyCode": "INR",
  "dateTime": 1777824000000,
  "timezone": "+05:30",
  "fixedExchangeRate": false,
  "exchangeRates": {},
  "receiptUrl": null,
  "templateId": null,
  "whoPaid": [
    { "memberId": "m_sid", "weight": "1" }
  ],
  "items": [
    {
      "amount": "2400",
      "forWhom": [
        { "memberId": "m_sid", "weight": "1" },
        { "memberId": "m_neha", "weight": "1" },
        { "memberId": "m_rohan", "weight": "1" }
      ]
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | literal `"expense"` | yes | Transaction kind; fixed to expense for this command. |
| `purpose` | string | yes | Human-readable label describing what the expense was for. |
| `category` | string | no | Category key or emoji used to classify the transaction. |
| `currencyCode` | string | yes | ISO currency code of the transaction amounts. |
| `dateTime` | epoch millis | yes | Timestamp when the expense occurred. |
| `timezone` | string | no | Timezone offset of the user creating the transaction, for example `"+05:30"`. |
| `fixedExchangeRate` | boolean | no | Whether exchange rates were manually fixed instead of auto-derived. |
| `exchangeRates` | object<string,string> | no | Optional conversion map from target currency to rate relative to `currencyCode`. |
| `receiptUrl` | string or `null` | no | Optional URL pointing to a receipt image or document. |
| `templateId` | string or `null` | no | Optional reference to a recurring or future transaction template. |
| `whoPaid` | `WeightedMemberRef[]` | yes | Members who actually paid the money, with weights if multiple people contributed. |
| `items` | `TransactionItem[]` | yes | Expense line items that together make up the full transaction amount and split. |

---

### `TransferInput`

Used by:

- `transfers create`

```json
{
  "type": "transfer",
  "purpose": "Neha settled dinner share",
  "category": "💸",
  "currencyCode": "INR",
  "dateTime": 1777827600000,
  "timezone": "+05:30",
  "fixedExchangeRate": false,
  "exchangeRates": {},
  "receiptUrl": null,
  "templateId": null,
  "whoPaid": [
    { "memberId": "m_neha", "weight": "1" }
  ],
  "items": [
    {
      "amount": "800",
      "forWhom": [
        { "memberId": "m_sid", "weight": "1" }
      ]
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | literal `"transfer"` | yes | Transaction kind; fixed to transfer for this command. |
| `purpose` | string | yes | Human-readable label describing what the transfer was for. |
| `category` | string | no | Category key or emoji used to classify the transaction. |
| `currencyCode` | string | yes | ISO currency code of the transaction amounts. |
| `dateTime` | epoch millis | yes | Timestamp when the transfer occurred. |
| `timezone` | string | no | Timezone offset of the user creating the transaction, for example `"+05:30"`. |
| `fixedExchangeRate` | boolean | no | Whether exchange rates were manually fixed instead of auto-derived. |
| `exchangeRates` | object<string,string> | no | Optional conversion map from target currency to rate relative to `currencyCode`. |
| `receiptUrl` | string or `null` | no | Optional URL pointing to a receipt image or document. |
| `templateId` | string or `null` | no | Optional reference to a recurring or future transaction template. |
| `whoPaid` | `WeightedMemberRef[]` | yes | Members who actually sent the money. |
| `items` | `TransactionItem[]` | yes | Receiving-side allocation for the transfer amount. |

Interpretation:

- sender is in `whoPaid`
- receiver side is in `items[].forWhom`
- debt settlement uses this same transfer shape: the settling member is in `whoPaid`, and the member receiving settlement is in `items[].forWhom`

---

### `TransactionPatchInput`

Used by:

- `transactions update`

Example:

```json
{
  "purpose": "Dinner at Thalassa",
  "category": "🍽️",
  "items": [
    {
      "amount": "2500",
      "forWhom": [
        { "memberId": "m_sid", "weight": "1" },
        { "memberId": "m_neha", "weight": "1" },
        { "memberId": "m_rohan", "weight": "1" }
      ]
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `purpose` | string | no | Updated human-readable label describing what the transaction was for. |
| `category` | string | no | Updated category key string used to classify the transaction. |
| `currencyCode` | string | no | Updated ISO currency code of the transaction amounts. |
| `dateTime` | epoch millis | no | Updated timestamp when the transaction occurred. |
| `timezone` | string | no | Updated timezone offset of the user creating the transaction. |
| `fixedExchangeRate` | boolean | no | Updated flag indicating whether exchange rates were manually fixed. |
| `exchangeRates` | object<string,string> | no | Replacement exchange rate map relative to `currencyCode`. |
| `receiptUrl` | string or `null` | no | Updated receipt URL; `null` clears it. |
| `templateId` | string or `null` | no | Updated template reference; `null` clears it. |
| `whoPaid` | `WeightedMemberRef[]` | no | Replacement payer array for the transaction. |
| `items` | `TransactionItem[]` | no | Replacement item array for the transaction. |

Patch semantics:

- only keys present in the input are changed
- omitted keys are preserved
- `whoPaid` replaces the full stored payer array if provided
- `items` replaces the full stored item array if provided
- `exchangeRates` replaces the full stored object if provided
- `type` is not patchable; transaction kind stays whatever the original record is

---

## Filter Reference

### `transactions list`

| Flag | Type | Meaning |
|---|---|---|
| `--type` | enum | `expense` or `transfer` |
| `--from` | date or epoch | inclusive lower bound |
| `--to` | date or epoch | inclusive upper bound |
| `--member-id` | string | member appears anywhere in transaction |
| `--paid-by-member-id` | string | member appears in `whoPaid` |
| `--category` | string | exact category match |
| `--limit` | integer | max results |
| `--order` | enum | `asc` or `desc` by `dateTime` |

Date handling:

- `YYYY-MM-DD` is interpreted as local-day range
- `epochMillis` passes through as-is

---

## Help UX

### Required help layers

#### `settleup --help`

Shows:

- command groups
- one-line purpose for each

#### `settleup <group> --help`

Shows:

- subcommands
- required flags

#### `settleup <group> <command> --help`

Shows:

- command synopsis
- one-line description of what the command does
- required flags
- optional flags
- which identifier types are expected, such as `uid`, `groupId`, or `memberId`
- whether the command reads raw data, creates a record, patches selected fields, or deletes a record
- input type name if command accepts `--input`
- one small example

#### `settleup schema <command>`

Shows:

- exact JSON shape
- required fields
- field meanings
- example invocation

### Help quality rule

Every write command must point to schema help in both:

- `--help`
- validation errors

Every update command help page must explicitly say:

- patch command, not full replace
- omitted keys remain unchanged
- provided arrays replace the full stored array
- provided objects replace the full stored object

Example error:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "Missing required field: whoPaid",
    "details": {
      "help": "Run `settleup schema expenses.create` for the expected JSON input"
    }
  }
}
```

---

## Validation Rules

The CLI should validate before calling the API when practical.

### General validation

- required fields present
- IDs are non-empty strings
- `amount` and `weight` are decimal strings
- all referenced `memberId`s exist in the target group
- `currencyCode` is non-empty and 3 letters
- `dateTime` is epoch millis

### Patch semantics

These commands are patch commands:

- `members update`
- `transactions update`

Rules:

- omitted keys remain unchanged
- provided scalar fields overwrite the stored scalar values
- provided object fields replace the stored object at that field
- provided array fields replace the stored array at that field
- nullable fields can be cleared by sending `null`

---

## API Mapping

Detailed endpoint behavior and command-to-path mapping are documented in [API_REFERENCE.md](API_REFERENCE.md). This section is the short summary.

### Firebase Auth

- sign in:
  - `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<API_KEY>`
- refresh token:
  - `POST https://securetoken.googleapis.com/v1/token?key=<API_KEY>`

### Settle Up backend paths

- `/users/<uid>`
- `/userGroups/<uid>`
- `/groups/<groupId>`
- `/permissions/<groupId>`
- `/members/<groupId>`
- `/transactions/<groupId>`
- `/debts/<groupId>`
- `/groupCategories/<groupId>`
- `/changes/<groupId>`
- `/serverTasks/<taskName>`

---

## Risks and Failure Points

### 1. Shipping project config expands attack surface

Risk:

- if `apiKey` and `databaseUrl` are bundled publicly, anyone can target the Firebase project endpoints

Impact:

- not enough to impersonate users by itself
- still expands unauthorized sign-in or account-creation attack surface depending on auth settings

Mitigation:

- require runtime config
- do not bundle project config in a public CLI

### 2. Update semantics for nested data can still be misunderstood

Risk:

- callers may assume arrays are patched element-by-element when they are actually replace-on-write at the field level

Mitigation:

- document patch semantics clearly
- document that arrays and objects replace the whole field when provided
- recommend read-modify-write flow before editing nested arrays

### 3. Transaction filtering may be expensive

Risk:

- `transactions list` may need to fetch all transactions in a group and filter client-side

Impact:

- slow for large groups
- more bandwidth

Mitigation:

- keep filtering behavior explicit
- consider future optimization only if needed

### 4. Date filtering can be ambiguous

Risk:

- `YYYY-MM-DD` depends on timezone interpretation

Mitigation:

- document inclusive local-day semantics
- prefer epoch millis for deterministic agent workflows

### 5. Member and user identity can be confused

Risk:

- agent may accidentally use `uid` where `memberId` is required

Mitigation:

- make command docs explicit about ID type
- return both structures distinctly where useful

### 6. Settle Up API docs are thin

Risk:

- some write semantics may not be fully documented
- server behavior may differ from assumptions around transfer structure or optional fields

Mitigation:

- test all write flows in staging first
- keep CLI behavior thin and observable
- avoid adding abstractions until staging behavior is verified

### 7. Debts are derived state

Risk:

- client may try to mutate debts directly

Mitigation:

- never support direct debt mutation
- settlement only through transfer transactions

### 8. Agent errors can still create bad writes

Risk:

- deterministic CLI does not protect against logically wrong but structurally valid agent payloads

Mitigation:

- add strong validation
- require explicit IDs
- keep outputs raw and inspectable
- use patch semantics for update commands so small edits are less likely to wipe unrelated fields
- make command help explicit about object type, identifier type, and patch behavior

Residual risk:

- patch semantics reduce accidental destructive overwrites
- they do not prevent logically incorrect updates, wrong IDs, or incorrect replacement of array fields

---

## Recommended Agent Workflow

1. `auth login`
2. `groups list`
3. `members list --group-id ...`
4. `transactions list --group-id ... --from ... --to ...`
5. `expenses create --group-id ... --input -`
6. `debts list --group-id ...`
7. `transfers create --group-id ... --input -`

---

## Final Recommendation

Keep this CLI small, explicit, and boring.

The main mistake to avoid is moving agent reasoning into the CLI. The CLI should be a deterministic transport and validation layer over Settle Up, not a policy engine.
