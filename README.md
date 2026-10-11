# Settle Up CLI

Manage your Settle Up groups, shared expenses, payments, and balances from a terminal or an AI agent. The installed command is `settleup`.

[Website](https://settleupcli.pages.dev/) · [Agent setup guide](https://settleupcli.pages.dev/agent.md) · [GitHub](https://github.com/NewDae/settle-up-cli)

## Install and connect

Requires **Node.js 22 or newer** and internet access.

```sh
npm install -g settle-up-cli
settleup auth login
settleup groups list
```

Sign in with your Settle Up email and password. The password is hidden while you type, and the CLI refreshes your session automatically. No API key, environment file, or backend setup is needed.

**Google, Apple, or another sign-in method?** First [migrate your account to email/password](https://settleup.app/migrate-account). Email/password is the only supported login method.

## Use with your AI agent

Visit the [landing page](https://settleupcli.pages.dev/), choose your agent, and copy its setup prompt into your conversation. The agent reads the [installation and everyday usage guide](https://settleupcli.pages.dev/agent.md), checks its tools, and helps you connect.

Your agent needs terminal access. Sign in privately on the same computer where the CLI runs; never paste passwords or session tokens into chat.

Try asking:

- “Show me who owes what in our weekend group.”
- “Maya paid $60 for dinner. Split it equally between the three of us.”
- “Record my $20 payment to Maya.”

## Everyday commands

Use IDs returned by the CLI in place of the placeholders below.

| Task | Command |
| --- | --- |
| List groups | `settleup groups list` |
| List group members | `settleup members list --group-id <groupId>` |
| View expenses and payments | `settleup transactions list --group-id <groupId>` |
| See who owes what | `settleup debts list --group-id <groupId>` |
| Add an expense | `settleup expenses create --group-id <groupId> --input expense.json` |
| Record a payment | `settleup transfers create --group-id <groupId> --input payment.json` |
| Create a group | `settleup groups create --input group.json` |
| Edit a transaction | `settleup transactions update --group-id <groupId> --transaction-id <transactionId> --input changes.json` |
| Delete a transaction | `settleup transactions delete --group-id <groupId> --transaction-id <transactionId>` |

Before creating or editing, get the required JSON fields and an example:

```sh
settleup schema expenses.create
settleup schema transfers.create
settleup schema groups.create
settleup schema transactions.update
```

Pass JSON using `--input file.json`, or pipe it with `--input -`. Payments and splits use group member IDs. Amounts and weights are decimal strings; dates are epoch milliseconds. Read back changes before retrying an operation.

If balances need refreshing:

```sh
settleup debts recalculate --group-id <groupId>
settleup debts list --group-id <groupId>
```

## Help, updates, and sign-out

```sh
settleup --help
settleup expenses create --help
settleup --version
settleup auth status
npm install -g settle-up-cli@latest
settleup auth logout
```

Commands return JSON. `ok: true` means success; `ok: false` includes an error code and message, and exits with a nonzero status. If authentication expires, sign in again. If a request is rate limited, wait before retrying.

For source code, contribution information, and developer documentation, visit [the GitHub repository](https://github.com/NewDae/settle-up-cli) and its [developer guide](https://github.com/NewDae/settle-up-cli/blob/main/DEVELOPMENT.md). If the CLI helps you, [give it a star](https://github.com/NewDae/settle-up-cli).
