# Changelog

## 0.3.0 (unreleased)

- Simplify browser sign-in to email/password through the private CLI link, with no code confirmation. Add an auth diagram and FAQ to the landing page, and use matching navigation and footers on both pages.
- Consolidate the existing hosted auth Worker source, deployment configuration, and tests into `server/auth-worker/` in the public CLI repository. Existing Worker identities and Cloudflare secrets are retained.

- Add `auth login --browser` and `auth login --complete [--wait]` so users can sign in privately on a hosted page while an agent runs the CLI on another computer.
- Reuse the existing hosted auth Worker for password verification and session refresh; the integration's Firebase API key stays in that Worker.
- Add a same-origin login page, Pages Functions, and a D1 migration for an encrypted, 10-minute, one-time session handoff. Neither passwords nor readable sessions are stored in the handoff database or returned to the browser.
- Cancel pending browser login on logout and update agent setup guidance. Private terminal login remains available.

## 0.2.0

### Changed

- Sessions are stored in the OS credential store by default (macOS Keychain, Windows Credential Manager, Linux Secret Service) through `@napi-rs/keyring`. Plaintext storage requires an explicit `SETTLEUP_AUTH_STORAGE=file`.
- An existing `<config>/<environment>/auth.json` from 0.1.x is imported into the selected store on first use, then removed once the new copy has been read back.
- Sessions are scoped by config directory, environment, database URL, and auth URL.
- `auth status` reports the selected `storage`.
- A stored session that cannot be parsed reads as signed out; `settleup auth login` replaces it.
- `settleup schema <command>` lists every field with its type, format, whether it is required, and a description.
- Errors include command-specific recovery guidance in `error.details.help`.
- `categories set` rejects category labels that are not strings, including `null`.
- Optional transaction fields (`category`, `fixedExchangeRate`, `exchangeRates`, `receiptUrl`, `templateId`) are validated before any request is sent.
- `groups create` validates `ownerColor` (string) and `inviteLinkActive` (boolean).
- New group IDs use the Firebase push-ID format that Settle Up's own apps produce, instead of a `codex-<timestamp>-<random>` string.

### Fixed

- A wrong email or password returned `API_REQUEST_FAILED` ("check connectivity") with direct Firebase sign-in, or `GROUP_ACCESS_DENIED` with hosted sign-in. A rejected sign-in is now `AUTH_INVALID` with sign-in guidance; service outages keep `API_REQUEST_FAILED`.
- `transactions list` and `changes list` silently returned wrong results for invalid filters: `--limit abc` or `0` returned nothing, `--limit -1` dropped the last item, a bare `--limit` returned one item, an unknown `--order` sorted ascending, a misspelled `--type` or an impossible date such as `2026-02-30` returned nothing. These now return `INVALID_INPUT` before any request.
- Creating a member (`members add`, or the first member in `groups create`) without `active` or `defaultWeight`, or a transaction without `fixedExchangeRate`, failed with `GROUP_ACCESS_DENIED` because the backend requires those fields. The CLI now fills the defaults `true`, `"1"`, and `false` when they are omitted.

### Added

- `AUTH_STORAGE_FAILED` error code for a locked, unavailable, or inaccessible credential store. The CLI never silently falls back to plaintext.
- CI on macOS, Windows, and Linux covering the offline suite, generated-doc freshness, and native credential stores.
