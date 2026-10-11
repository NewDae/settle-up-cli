# Settle Up CLI specification

This is the maintained requirements and design reference for the CLI. It preserves the original goal: a small, explicit, deterministic transport and validation layer over Settle Up for agents. Implementation differences and unmet requirements are recorded under [design evolution](#design-evolution-and-open-requirements).

Related references: [backend mapping](API_REFERENCE.md), [authentication](LOGIN.md), [developer setup](DEVELOPMENT.md), [test coverage](Tests.md), and [agent workflow](AGENT_GUIDE.md). The [pre-cleanup spec](https://github.com/NewDae/settle-up-cli/blob/78d1e91/CLI_SPEC.md) and the [initial spec](https://github.com/NewDae/settle-up-cli/blob/9aa02bf/CLI_SPEC.md) remain in Git history.

## Requirements and design principles

- JSON on stdout, with stable success/error envelopes and nonzero exit status for failures. Interactive login prompts go to stderr.
- Reads use explicit flags. Writes use exact IDs and JSON input; the CLI never resolves fuzzy group or member names.
- The agent handles name lookup, caching, aggregation, memory, and policy decisions. The CLI handles transport and structural validation.
- No natural-language inputs, human-first pretty output, derived reporting commands, or direct debt mutation.
- Updates affect supplied fields only. Omitted fields remain unchanged; supplied nested arrays and objects are complete field replacements.
- Monetary amounts and weights are decimal strings, not floating-point JSON numbers.
- Account identity and group membership stay distinct.
- No bundled user passwords, session tokens, or production Firebase API keys. Production database and hosted-auth URLs are packaged defaults; staging/local overrides remain supported.
- Validate inputs before writes where practical. Backend reads for exact-ID member validation are permitted; fuzzy resolution is not.
- Keep server behavior observable and verify writes in staging. Structural validity cannot establish that the agent chose the correct people, amount, or group.

### Identity model

| Identifier | Scope | Meaning and uses |
|---|---|---|
| `uid` | Global account | Authenticated Firebase / Settle Up identity; user profile, group access, permissions. |
| `groupId` | Group | Exact group targeted by reads and writes. |
| `memberId` | One group | Ledger participant used in splits, transactions, debts, and settlements. |
| `transactionId` | One group | Exact expense or transfer record to read, patch, or delete. |

A `uid` is not interchangeable with a `memberId`. The same person may have different member IDs in different groups. Authentication/access control uses `uid`; transaction participants use `memberId`.

### Patch semantics

`members update` and `transactions update` use partial patches:

- Omitted keys remain unchanged; supplied scalar values overwrite their fields.
- Supplied arrays and objects replace the complete field. For example, `items` replaces the item list, not one item inside it; `exchangeRates` replaces the map.
- `null` clears documented nullable fields.
- Transaction `type` cannot be patched.

Read the current record before editing a nested field, then supply the complete intended replacement. `categories set` instead merges supplied category entries into the existing mapping. Request-shape tests verify what the CLI sends; backend persistence semantics require live checks.

## Output contract

Success:

```json
{ "ok": true, "data": {}, "meta": { "environment": "staging" } }
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "GROUP_NOT_FOUND",
    "message": "Group g123 was not found",
    "details": {}
  },
  "meta": { "environment": "staging" }
}
```

Stable error codes:

- `AUTH_REQUIRED`
- `AUTH_INVALID`
- `AUTH_REFRESH_FAILED`
- `AUTH_STORAGE_FAILED`
- `INVALID_INPUT`
- `GROUP_NOT_FOUND`
- `GROUP_ACCESS_DENIED`
- `MEMBER_NOT_FOUND`
- `TRANSACTION_NOT_FOUND`
- `API_REQUEST_FAILED`
- `API_RATE_LIMITED`
- `SERVER_TASK_FAILED`

## Command reference

The executable is `settleup`. Write JSON is supplied with `--input <path>` or `--input -` for stdin. Use `settleup <group> <command> --help` for flags and `settleup schema <operation>` for an input example. Backend calls are owned by [API_REFERENCE.md](API_REFERENCE.md).

| Command | Required flags / input | Behavior |
|---|---|---|
| `auth login` | None | Email/password sign-in; store a local session. Private interactive input is the user/agent workflow; non-TTY automation accepts email and password on separate stdin lines. |
| `auth status` | None | Report local session presence, selected `storage`, `uid`, email, expiry; does not confirm live access. |
| `auth logout` | None | Delete the local session. |
| `users me` | None | Fetch the authenticated user's profile. |
| `groups list` | None | List groups accessible to the current user. |
| `groups get` | `--group-id` | Fetch group metadata, permissions, and the caller's group link. |
| `groups create` | `--input` → `CreateGroupInput` | Create a client-generated group ID, permission record, group metadata, first member, user-group link, and current-tab setting. |
| `members list` | `--group-id` | List members; optional `--active-only`. |
| `members get` | `--group-id`, `--member-id` | Fetch one member. |
| `members add` | `--group-id`, `--input` → `MemberInput` | Create a member. |
| `members update` | `--group-id`, `--member-id`, `--input` → `MemberPatchInput` | Patch supplied member fields. |
| `categories list` | `--group-id` | List custom category mappings. |
| `categories set` | `--group-id`, `--input` → `SetCategoriesInput` | Merge supplied category entries. |
| `transactions list` | `--group-id` | Fetch raw transactions, filter and order client-side; see filter reference below. |
| `transactions get` | `--group-id`, `--transaction-id` | Fetch one transaction. |
| `transactions update` | `--group-id`, `--transaction-id`, `--input` → `TransactionPatchInput` | Patch supplied transaction fields; validate referenced members when present. |
| `transactions delete` | `--group-id`, `--transaction-id` | Delete one transaction. |
| `expenses create` | `--group-id`, `--input` → `ExpenseInput` | Validate members and create an expense. |
| `transfers create` | `--group-id`, `--input` → `TransferInput` | Validate members and record a payment/settlement. Sender is in `whoPaid`, receiver in `items[].forWhom`. |
| `debts list` | `--group-id` | Read server-calculated debts. |
| `debts recalculate` | `--group-id` | Request server-side debt recalculation. |
| `changes list` | `--group-id` | Read the change log; optional `--limit <n>` and `--order asc\|desc`. |
| `schema <operation>` | Operation, e.g. `expenses.create` | Return field types/descriptions, required/optional status, nested fields, an input example, and invocation. |

Auth/login and status examples:

```json
{ "ok": true, "data": { "uid": "u1", "email": "me@example.com", "expiresAt": 1777872000000 }, "meta": { "environment": "staging" } }
```

```json
{ "ok": true, "data": { "authenticated": true, "storage": "keyring", "uid": "u1", "email": "me@example.com", "expiresAt": 1777872000000 }, "meta": { "environment": "staging" } }
```

With no session, status reports `authenticated: false` and null identity/expiry fields. Tokens and login configuration are described in [LOGIN.md](LOGIN.md).

## Input types


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
| `firstMember` | object | yes | Initial group member representing the creator inside the group ledger; uses MemberInput fields. |

---

### `MemberInput`

Used by:

- `members add`

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

Accepts the same fields and types as [MemberInput](#memberinput), with every field optional. See [patch semantics](#patch-semantics); `null` clears `photoUrl`, `bankAccount`, or `lightningAddress`.

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

#### Transaction fields

These fields are shared by expenses and transfers; only `type` and the payer/recipient interpretation differ.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"expense"` or `"transfer"` | yes | Transaction kind: `"expense"` or `"transfer"`, matching the create command. |
| `purpose` | string | yes | Human-readable label describing the expense or payment. |
| `category` | string | no | Category key or emoji used to classify the transaction. |
| `currencyCode` | string | yes | ISO currency code of the transaction amounts. |
| `dateTime` | epoch millis | yes | Timestamp when the transaction occurred. |
| `timezone` | string | no | Timezone offset of the user creating the transaction, for example `"+05:30"`. |
| `fixedExchangeRate` | boolean | no | Whether exchange rates were manually fixed instead of auto-derived. |
| `exchangeRates` | object<string,string> | no | Optional conversion map from target currency to rate relative to `currencyCode`. |
| `receiptUrl` | string or `null` | no | Optional URL pointing to a receipt image or document. |
| `templateId` | string or `null` | no | Optional reference to a recurring or future transaction template. |
| `whoPaid` | `WeightedMemberRef[]` | yes | Members who actually paid the money, with weights if multiple people contributed. |
| `items` | `TransactionItem[]` | yes | Line items that together make up the full transaction amount and split; for transfers, these allocate to receivers. |

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

Uses the [transaction fields](#transaction-fields), with `type: "transfer"`. `whoPaid` identifies senders; `items[].forWhom` allocates the amount to receivers. For debt settlement, the debtor sends and the creditor receives.

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

Accepts the [transaction fields](#transaction-fields) except `type`, with every field optional. Transaction kind is immutable. See [patch semantics](#patch-semantics); `whoPaid`, `items`, and `exchangeRates` are supplied as complete replacement fields, and `null` clears `receiptUrl` or `templateId`.

## Transaction filter reference

`transactions list` fetches the group's transactions before applying filters locally.

| Flag | Type | Meaning |
|---|---|---|
| `--type` | `expense` or `transfer` | Transaction kind. |
| `--from` | `YYYY-MM-DD` or epoch millis | Inclusive lower `dateTime` bound. |
| `--to` | `YYYY-MM-DD` or epoch millis | Inclusive upper `dateTime` bound. |
| `--member-id` | Member ID | Member appears in payers or any item recipient list. |
| `--paid-by-member-id` | Member ID | Member appears in `whoPaid`. |
| `--category` | String | Exact category match. |
| `--limit` | Integer | Maximum results. |
| `--order` | `asc` or `desc` | Order by `dateTime`; default ascending. |

Date-only bounds use the CLI process's local timezone: start of day for `--from`, end of day for `--to`. Epoch milliseconds pass through unchanged. Prefer epoch bounds for deterministic agent workflows.

## Help and validation requirements

| Discovery command | Required information |
|---|---|
| `settleup --help` | Command groups and one-line purposes. |
| `settleup <group> --help` | Subcommands and required flags. |
| `settleup <group> <command> --help` | Synopsis, description, required/optional flags, expected identifier types, read/create/patch/delete behavior, input type, and a small example. |
| `settleup schema <operation>` | JSON input shape, required fields, field meanings, and an example invocation. |

Every input-taking write command links to schema help in command help and input-validation errors. Validation failures expose the matching command in `error.details.commandHelp` and recovery guidance in `error.details.help`. Flag-only writes point to command help. Auth, access, rate-limit, and request failures instead receive guidance suited to their error code; backend error details are retained. Update help states the [patch semantics](#patch-semantics).

Schema output retains `command`, `required`, `example`, and existing `patch` notes. It adds `inputType`, `fields`, and `invocation`. Each field has `type`, `description`, and `required`; nullable fields use `nullable: true`. Nested objects use `fields`, arrays use `items`, and mappings describe `keys`/`values`. Formats such as `decimal-string` and `epoch-milliseconds` clarify representation. This is discovery metadata, not a formal JSON Schema validation document.

Expected validation:

- Required fields present and IDs nonempty strings.
- Amounts/weights nonnegative decimal strings, e.g. `"0"`, `"1"`, `"1.5"`; numbers, signs, exponent notation, and leading-zero forms such as `"01"` are rejected.
- Currency codes match three uppercase letters; this checks format, not membership in a currency registry.
- Dates are nonnegative integer epoch milliseconds; timezone offsets use `±HH:MM`.
- Documented boolean, mapping, string, nullable, and nonempty payer/item/recipient-array types are enforced.
- Referenced transaction members exist in the target group. The CLI fetches members for this check before writing.
- Transaction patches cannot change `type`.

Authentication can refresh before payload validation. The guarantee is validation before the write; zero-request tests use a fresh session. Local tests and their limits are described in [Tests.md](Tests.md).

## Risks and operating guidance

| Risk | Guidance |
|---|---|
| Public project configuration increases endpoint exposure | Keep Firebase keys and user credentials out of the package. Production URLs are public defaults; backend access rules and hosted auth remain essential. |
| Nested edits can unintentionally remove entries | Read first and supply complete replacement arrays/maps. Partial patches protect omitted fields, not entries inside supplied fields. |
| Client-side filtering costs bandwidth/time on large groups | Make the full-group fetch explicit; add optimization only when needed. |
| Date-only ranges vary by timezone | Document local-day bounds; use epoch milliseconds when exact bounds matter. |
| Account and ledger identity can be confused | Use group `memberId` for participants and account `uid` for auth/access. |
| Backend write semantics may differ from assumptions | Verify staging write flows and read back results; keep the wrapper thin and observable before adding abstractions. |
| Derived debts can lag transactions | Settlement is a transfer from debtor to creditor, never a direct debt edit. Request recalculation and re-read debts. |
| A valid payload can still express the wrong user intent | Agent must resolve IDs, clarify ambiguous amounts/participants, act only on authorized changes, and read back results. Validation cannot prove semantic correctness. |
| A create may succeed despite an uncertain response | Inspect records before retrying; blind retries can duplicate writes. |

The canonical discover → read → schema → write → read-back workflow is in [AGENT_GUIDE.md](AGENT_GUIDE.md). Keep reasoning and reporting with the agent rather than adding a policy engine to the CLI.

## Design evolution and open requirements

The original design principles remain the basis of the CLI. This table preserves earlier intentions while distinguishing current implementation. Unimplemented preferences remain explicit; completed discovery improvements are recorded below.

| Earlier statement / requirement | Current status |
|---|---|
| No hidden lookup before writes | Exact-ID member validation performs a backend read before transaction writes; group creation reads its permission-created stub. No fuzzy name lookup is added. |
| Interactive login only | Private interactive sign-in remains the recommended user/agent workflow. Non-TTY stdin login supports automated integration runs; there are no credential command flags. |
| Do not bundle project configuration; require runtime config | Published package bundles production database/hosted-auth URLs for zero-config use, but no Firebase key or user/session secrets. Environment overrides remain available. |
| Prefer OS keychain, with restricted-file fallback | Implemented: OS credential store by default; plaintext requires explicit `SETTLEUP_AUTH_STORAGE=file`. Sessions are isolated by config directory, environment, and endpoints, with verified legacy migration and storage-specific recovery; details in [LOGIN.md](LOGIN.md#credential-storage). |
| Exact schema with field meanings and example invocation | Implemented: schema output includes field types/descriptions, required/optional status, nested fields, examples, and invocation. Shared field descriptions keep expense/transfer and add/patch metadata aligned. |
| Every write command and validation error directs callers to schema help | Implemented for input-taking write validation. Flag-only deletion/recalculation points to command help; auth, configuration, permissions, and service errors give relevant recovery guidance. |

The [pre-cleanup spec](https://github.com/NewDae/settle-up-cli/blob/78d1e91/CLI_SPEC.md) in Git history retains all earlier wording. Its content is consolidated here as requirements/identity/output/commands/input types/filter/help/validation/risks, in [LOGIN.md](LOGIN.md) as auth/storage, and in [API_REFERENCE.md](API_REFERENCE.md) as endpoint mapping. Implementation correctness should be assessed with [Tests.md](Tests.md), not inferred from the design document alone.
