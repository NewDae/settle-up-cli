# Changelog

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

### Added

- `AUTH_STORAGE_FAILED` error code for a locked, unavailable, or inaccessible credential store. The CLI never silently falls back to plaintext.
- CI on macOS, Windows, and Linux covering the offline suite, generated-doc freshness, and native credential stores.
