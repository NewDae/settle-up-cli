# API Reference

This file documents the auth wrapper and Settle Up backend paths used by the `settleup` CLI. The CLI behavior and JSON contracts are defined in [CLI_SPEC.md](CLI_SPEC.md); this file explains the backend paths behind those commands.

## Configuration

[LOGIN.md](LOGIN.md#configuration-reference) owns runtime configuration, precedence, token storage, and hosted/direct-auth selection. Database calls use the configured URL or packaged production default. Non-production requires explicit configuration.

## Auth Endpoints

| Purpose | Method | Endpoint |
|---|---|---|
| Login | `POST` | packaged hosted auth endpoint, or `<SETTLEUP_AUTH_BASE_URL>/auth/login` when overridden |
| Refresh token | `POST` | packaged hosted auth endpoint, or `<SETTLEUP_AUTH_BASE_URL>/auth/refresh` when overridden |

The auth wrapper handles Firebase auth. Authenticated backend calls pass the current access token as `?auth=<accessToken>`; [LOGIN.md](LOGIN.md) describes the returned session fields and refresh flow.

When `SETTLEUP_FIREBASE_API_KEY` is present, the CLI bypasses hosted auth:

| Purpose | Method | Direct Firebase endpoint |
|---|---|---|
| Password sign-in | `POST` | `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<API_KEY>` |
| Token refresh | `POST` | `https://securetoken.googleapis.com/v1/token?key=<API_KEY>` |

Database paths still use the database URL, independently of the auth URL.

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
| `auth status` | Local credential store (or explicit file storage); see LOGIN.md. |
| `auth logout` | Local credential store (or explicit file storage); see LOGIN.md. |
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

The CLI generates the group ID before the permission write, in the same 20-character Firebase push-ID format that `POST /groups` would produce: 8 time-ordered characters followed by 12 random ones. That write creates a minimal group stub containing invite metadata; the CLI reads it and patches group fields rather than replacing the stub. The mapping table above records the complete write order, including member creation, user-group linkage, and current-tab update. This flow is exercised by request tests and the live integration workflow.

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

The CLI does not mutate `/debts/<groupId>` directly. Settlement uses the transfer input described in [CLI_SPEC.md](CLI_SPEC.md#transferinput).

## Backend Notes

- Auth login does not necessarily create `/users/<uid>` automatically; the CLI ensures the app-level user profile exists.
- Group-owned writes require a permission entry before most group paths are writable.
- Debt recalculation is a server task, so the live integration also performs a local deterministic debt check from transactions for immediate verification.
