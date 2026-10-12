# Changelog

## 0.4.0 (unreleased)

### Changed

- **Sign-in no longer uses the hosted auth Worker.** You now enter the Settle Up API key (the public Firebase key Settle Up's apps use, starting with `AIza`) along with your email and password. `LOGIN.md` explains how to find it.
- Browser login sends your email, password, and key straight to Firebase. The browser encrypts the session and key for your CLI before anything reaches the login site, whose backend is now only an encrypted relay with no auth binding or secrets.
- Terminal login (`settleup auth login`) prompts for the key, or reads `SETTLEUP_FIREBASE_API_KEY`, and signs in directly with Firebase. Non-interactive terminal login requires that variable.
- The CLI saves the key with your session and renews it directly with Firebase.
- Login protocol version 2 pins the encryption key to the original link. Login links and the login site require CLI 0.4.0+.
- The login page reports a mistyped or rejected key separately from a wrong email or password.

### Upgrading

- Sessions saved by 0.3 can't be renewed and will ask you to sign in again within an hour of upgrading.
- `SETTLEUP_AUTH_BASE_URL` is deprecated and no longer contacted.

## 0.3.0 (2026-10-12)

### Added

- `auth login --browser` and `auth login --complete [--wait]`. The CLI returns a private login link; the user signs in on the hosted page, from any device, while an agent runs the CLI elsewhere. `auth logout` also cancels a pending link.
- A same-origin login page, Pages Functions, and a D1 migration for the handoff. The session is encrypted to the CLI's key (ECDH P-256, HKDF-SHA-256, AES-256-GCM), collected once, and expires after 10 minutes. Neither passwords nor readable sessions are stored or returned to the browser.
- The hosted auth Worker source, deployment configuration, and tests in `server/auth-worker/`. Existing Worker deployments and Cloudflare secrets are unchanged.
- Self-hosting instructions, a browser login security model, and a sequence diagram in `LOGIN.md`. API_REFERENCE.md lists the browser login endpoints.
- Agent guide: a step-by-step "How login works" with links to the source, output shapes, the one-pending-login rule, `--wait` and tool timeouts, and browser login errors with next steps.

### Changed

- The landing page leads with "Get started" (to the agent prompts) and "Star on GitHub". A "How auth works" section explains the flow, guarantees, where it runs, and FAQs. The agent prompt uses browser login, tells the agent not to open the link itself, and asks it to report the connected email.
- Agents start login only at the user's request and confirm the connected email with them.
- The auth Worker no longer returns upstream Firebase error codes, which could reveal whether an email has an account.
- Pages preview deployments bind the staging auth Worker and a separate D1 database.
- `auth login --help` shows the browser flow.

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
