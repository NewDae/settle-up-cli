# API Reference

This file documents the Firebase Auth and Settle Up sandbox database endpoints used by the `settleup` CLI. The CLI behavior and JSON contracts are defined in [CLI_SPEC.md](CLI_SPEC.md); this file explains the backend paths behind those commands.

## Sandbox Config

Defaults used by the CLI and live tests:

```text
SETTLEUP_SANDBOX_API_KEY = public sandbox Firebase Web API key
SETTLEUP_SANDBOX_DB_URL  = https://settle-up-sandbox.firebaseio.com
```

Both can be overridden with environment variables.

## Auth Endpoints

| Purpose | Method | Endpoint |
|---|---|---|
| Create temporary live-test user | `POST` | `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<API_KEY>` |
| Login | `POST` | `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<API_KEY>` |
| Refresh token | `POST` | `https://securetoken.googleapis.com/v1/token?key=<API_KEY>` |

The CLI stores `idToken`, `refreshToken`, `uid`, `email`, and `expiresAt` locally after login. Authenticated Realtime Database calls pass the current `idToken` as `?auth=<idToken>`.

## Database Paths

All database paths are under:

```text
https://settle-up-sandbox.firebaseio.com/<path>.json?auth=<idToken>
```

| Path | Used for |
|---|---|
| `/users/<uid>` | App-level user profile. |
| `/users/<uid>/currentTabId` | Current active group id for the user. |
| `/userGroups/<uid>` | Groups visible to a user. |
| `/userGroups/<uid>/<groupId>` | Link from authenticated user to group and member. |
| `/groups/<groupId>` | Group metadata. |
| `/permissions/<groupId>` | Group permission map. |
| `/permissions/<groupId>/<uid>` | Permission entry for one user. |
| `/members/<groupId>` | Group member collection. |
| `/members/<groupId>/<memberId>` | One group member. |
| `/groupCategories/<groupId>` | Custom category label map. |
| `/transactions/<groupId>` | Group transactions. |
| `/transactions/<groupId>/<transactionId>` | One transaction. |
| `/debts/<groupId>` | Server-calculated derived debts. |
| `/changes/<groupId>` | Group change log. |
| `/serverTasks/calculateDebts` | Backend task trigger for debt recalculation. |

## Command To Endpoint Mapping

| CLI command | Backend calls |
|---|---|
| `auth login` | `POST accounts:signInWithPassword`; then ensures `/users/<uid>` exists. |
| `auth status` | Local auth file only. |
| `auth logout` | Local auth file only. |
| `users me` | `GET /users/<uid>`. |
| `groups list` | `GET /userGroups/<uid>`, then `GET /groups/<groupId>` for each group. |
| `groups get` | `GET /groups/<groupId>`, `GET /permissions/<groupId>`, `GET /userGroups/<uid>/<groupId>`. |
| `groups create` | `PUT /permissions/<groupId>/<uid>`, `GET /groups/<groupId>`, `PATCH /groups/<groupId>`, `POST /members/<groupId>`, `PUT /userGroups/<uid>/<groupId>`, `PUT /users/<uid>/currentTabId`. |
| `members list` | `GET /members/<groupId>`. |
| `members get` | `GET /members/<groupId>/<memberId>`. |
| `members add` | `POST /members/<groupId>`. |
| `members update` | `PATCH /members/<groupId>/<memberId>`. |
| `categories list` | `GET /groupCategories/<groupId>`. |
| `categories set` | `PATCH /groupCategories/<groupId>`. |
| `expenses create` | `GET /members/<groupId>` for member validation, then `POST /transactions/<groupId>`. |
| `transfers create` | `GET /members/<groupId>` for member validation, then `POST /transactions/<groupId>`. |
| `transactions list` | `GET /transactions/<groupId>`, then client-side filtering. |
| `transactions get` | `GET /transactions/<groupId>/<transactionId>`. |
| `transactions update` | Optional `GET /members/<groupId>` for member validation, then `PATCH /transactions/<groupId>/<transactionId>`. |
| `transactions delete` | `DELETE /transactions/<groupId>/<transactionId>`. |
| `debts list` | `GET /debts/<groupId>`. |
| `debts recalculate` | `POST /serverTasks/calculateDebts` with `{ "request": { "groupId": "<groupId>" } }`. |
| `changes list` | `GET /changes/<groupId>`, then client-side limit/order. |

## Group Creation Notes

In the public sandbox, `POST /groups` has been verified to return `401 Permission denied` for fresh REST-created users, because permissions cannot be pre-created for the generated group id.

The CLI therefore uses a client-generated `groupId` and this order:

1. `PUT /permissions/<groupId>/<uid>`
2. `GET /groups/<groupId>` to observe the generated group stub
3. `PATCH /groups/<groupId>`
4. `POST /members/<groupId>`
5. `PUT /userGroups/<uid>/<groupId>`
6. `PUT /users/<uid>/currentTabId`

This is the same flow covered by the live sandbox tests.

## Debt And Settlement Notes

Transactions are the source of truth. `/debts/<groupId>` is derived state.

To refresh derived debts, the CLI posts:

```json
{
  "request": {
    "groupId": "<groupId>"
  }
}
```

to `/serverTasks/calculateDebts`.

Debt settlement is represented as a `transfer` transaction:

- debtor/sender is in `whoPaid`
- creditor/receiver is in `items[].forWhom`
- the transfer amount is the settlement amount

The CLI does not mutate `/debts/<groupId>` directly.

## Sandbox Quirks

- Firebase Auth signup does not create `/users/<uid>` automatically; the CLI and live tests create the app-level user profile explicitly.
- Group-owned writes require a permission entry before most group paths are writable.
- In the public sandbox, `POST /groups` has been verified to return `401 Permission denied` for fresh REST-created users.
- Debt recalculation is a server task, so the live integration also performs a local deterministic debt check from transactions for immediate verification.
