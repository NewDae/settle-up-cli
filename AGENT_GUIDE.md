# Settle Up CLI for agents

Install `settle-up-cli` from npm. The executable is `settleup` and requires Node.js 22+.

```bash
npm install -g settle-up-cli
settleup --help
settleup --version
```

## Authentication

Ask the user to run `settleup auth login` in their own terminal. The CLI supports email/password only. Users who sign in with Google, Apple, or another method should first follow https://settleup.app/migrate-account to migrate to email/password.

Do not ask users to paste passwords or session tokens into an agent conversation. Do not read the local auth file or include credentials in prompts, logs, or command arguments. The CLI manages token refresh automatically. `settleup auth status` reports local session presence; a successful read confirms live access.

The standard installation has production endpoints built in. Users do not need an API key, `.env`, or their own auth backend.

## Discover, read, then write

```bash
settleup auth status
settleup groups list
settleup members list --group-id <groupId>
settleup transactions list --group-id <groupId>
settleup debts list --group-id <groupId>
settleup expenses create --help
settleup schema expenses.create
```

- Parse stdout as JSON. Success is `{ "ok": true, "data": ..., "meta": ... }`; failure is `{ "ok": false, "error": { "code": ..., "message": ..., "details": ... }, "meta": ... }` with a nonzero exit code. Interactive login prompts go to stderr.
- Resolve names using read commands. Writes require exact IDs: never guess a group, member, or transaction ID.
- A global account `uid` is different from a group-specific `memberId`. Splits and payments use `memberId`.
- Amounts and weights are decimal strings, not floating-point numbers. Dates in write payloads are epoch milliseconds.
- Inspect `settleup schema <operation>` before building a payload. Send JSON with `--input <file.json>` or `--input -` via stdin.
- Only make changes the user has authorized. Confirm ambiguous amounts, participants, or targets before writing.
- Patches preserve omitted fields, but supplied arrays and objects replace those fields in full.
- After a write, read back the affected data. Do not blindly retry a create operation after an uncertain network response; it may already have succeeded.
- Server-calculated debts can lag a write. `settleup debts recalculate --group-id <groupId>` requests recalculation; re-read debts afterwards.

Example payload delivery after selecting the correct group and reviewing the expense schema:

```bash
settleup expenses create --group-id <groupId> --input expense.json
```

This CLI is a shell tool, not an MCP server. Use a shell-capable agent with the user's authenticated local CLI. For source and developer documentation, visit [GitHub](https://github.com/NewDae/settle-up-cli).

## Errors and sessions

- `AUTH_REQUIRED`: ask the user to sign in in their terminal.
- `AUTH_INVALID`: check email/password login and the account migration instructions.
- `AUTH_REFRESH_FAILED`: ask the user to sign in again.
- `AUTH_STORAGE_FAILED`: ask the user to unlock or enable the OS credential store; never switch to plaintext storage without their explicit choice.
- `API_RATE_LIMITED`: back off instead of retrying immediately.
- `GROUP_ACCESS_DENIED`: stop and ask the user to confirm the group and their access.

`settleup auth logout` removes the local session. Sessions use the OS credential store by default. Plaintext file storage requires the explicit setting `SETTLEUP_AUTH_STORAGE=file`; see [LOGIN.md](LOGIN.md#credential-storage).
