# API Reference

This file documents the auth wrapper and Settle Up backend paths used by the `settleup` CLI. The CLI behavior and JSON contracts are defined in [CLI_SPEC.md](CLI_SPEC.md); this file explains the backend paths behind those commands.

## Config

Runtime config:

```text
SETTLEUP_ENV              = production | staging | test
SETTLEUP_API_BASE_URL     = Settle Up API base URL
SETTLEUP_FIREBASE_API_KEY = optional local/staging development Firebase Web API key
```

The open-source CLI does not ship a Firebase API key. Local development can provide one through `.env` when the configured auth wrapper requires it.

## Auth Endpoints

| Purpose | Method | Endpoint |
|---|---|---|
| Login | `POST` | `<SETTLEUP_API_BASE_URL>/auth/login` |
| Refresh token | `POST` | `<SETTLEUP_API_BASE_URL>/auth/refresh` |

The auth wrapper handles Firebase auth. The CLI stores `accessToken`, `refreshToken`, `uid`, `email`, and `expiresAt` locally after login. Authenticated backend calls pass the current access token as `?auth=<accessToken>`.

## Backend Paths

Backend paths are under:

```text
<SETTLEUP_API_BASE_URL>/<path>.json?auth=<accessToken>
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
| `auth login` | `POST /auth/login`; then ensures `/users/<uid>` exists. |
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

`POST /groups` is not used because permissions must exist before group metadata is writable.

The CLI therefore uses a client-generated `groupId` and this order:

1. `PUT /permissions/<groupId>/<uid>`
2. `GET /groups/<groupId>` to observe the generated group stub
3. `PATCH /groups/<groupId>`
4. `POST /members/<groupId>`
5. `PUT /userGroups/<uid>/<groupId>`
6. `PUT /users/<uid>/currentTabId`

This is the same flow covered by the integration tests.

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

## Backend Notes

- Auth login does not necessarily create `/users/<uid>` automatically; the CLI ensures the app-level user profile exists.
- Group-owned writes require a permission entry before most group paths are writable.
- Debt recalculation is a server task, so the live integration also performs a local deterministic debt check from transactions for immediate verification.
