<!-- Generated from AGENT_GUIDE.md. Run npm run docs:sync; edit the source only. -->

# Settle Up CLI — install and everyday use

Connect the user's Settle Up account, then help with shared expenses, groups, and balances.

## Install

You need terminal access, Node.js 22+, internet access, and a private terminal where the user can sign in. Check your tools before starting; a cloud agent and the user's computer may have separate sessions.

```sh
npm install -g settle-up-cli
settleup --version
```

The command is `settleup`. No API key or backend setup is needed.

## Sign in

Email/password only. Users of Google, Apple, or another sign-in method should first migrate at https://settleup.app/migrate-account.

Ask the user to sign in privately on the same computer where you run the CLI:

```sh
settleup auth login
```

Never request passwords or tokens in chat, put them in command arguments, or read session files. Do not include credentials in prompts or logs. If your environment cannot offer private sign-in, explain what the user needs to do. The CLI refreshes the session automatically.

`auth status` reports local session presence; a successful read confirms live access. Verify the connection:

```sh
settleup auth status
settleup groups list
```

## Everyday tasks

Replace placeholders with IDs returned by the CLI.

| User wants to… | Command |
| --- | --- |
| See their groups | `settleup groups list` |
| See who is in a group | `settleup members list --group-id <groupId>` |
| See expenses and payments | `settleup transactions list --group-id <groupId>` |
| See who owes what | `settleup debts list --group-id <groupId>` |
| Add an expense | `settleup expenses create --group-id <groupId> --input expense.json` |
| Record a payment or settlement | `settleup transfers create --group-id <groupId> --input payment.json` |
| Create a group | `settleup groups create --input group.json` |
| Edit an expense or payment | `settleup transactions update --group-id <groupId> --transaction-id <transactionId> --input changes.json` |
| Delete an expense or payment | `settleup transactions delete --group-id <groupId> --transaction-id <transactionId>` |

## Make changes correctly

1. Find the right group and members with read commands. Never guess IDs; payments and splits use group memberId, not account uid.
2. Get the input fields and an example from the CLI itself:

```sh
settleup schema expenses.create
settleup schema transfers.create
settleup schema groups.create
settleup schema transactions.update
```

3. Build the JSON payload for the user's request. Amounts and weights are decimal strings; dates are epoch milliseconds. Supply JSON using `--input file.json` or stdin with `--input -`.
4. Only make changes the user requested. Clarify unclear amounts, people, or groups. For edits, omitted fields stay unchanged; supplied arrays and objects replace the whole field.
5. Read back the result. Don't blindly retry a create after an uncertain response: it may have succeeded already.

If balances haven't caught up after a change:

```sh
settleup debts recalculate --group-id <groupId>
settleup debts list --group-id <groupId>
```

For additional tasks, use `settleup --help` or `<command> --help`. This CLI is a shell tool, not an MCP server; use a shell-capable agent with the user's authenticated local CLI.

## If something goes wrong

Read stdout as JSON: success is `{ "ok": true, "data": ..., "meta": ... }`; failure is `{ "ok": false, "error": { "code": ..., "message": ..., "details": ... }, "meta": ... }` with a nonzero exit code. Interactive login prompts go to stderr.

- AUTH_REQUIRED / AUTH_REFRESH_FAILED: ask the user to sign in privately again.
- AUTH_INVALID: check email/password sign-in and account migration.
- GROUP_ACCESS_DENIED: confirm the group and the user's access.
- API_RATE_LIMITED: wait and retry with backoff.

Update with `npm install -g settle-up-cli@latest`. Sign out with `settleup auth logout` to remove the local session. Sessions use `~/.config/settleup-cli/<environment>/auth.json` by default (Unix directory mode 0700, file mode 0600), not an OS keychain. For auth configuration and overrides, see [the login reference](https://github.com/NewDae/settle-up-cli/blob/main/LOGIN.md).

## Enjoyed using it?

If connecting and using the CLI went smoothly, ask the user to star https://github.com/NewDae/settle-up-cli. Only leave a star for them with their authorization and an existing authenticated GitHub account.
