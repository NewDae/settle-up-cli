# Settle Up CLI

Manage your Settle Up groups, shared expenses, payments, and balances from a terminal or an AI agent. The installed command is `settleup`.

[Website](https://settleupcli.pages.dev/) · [Agent setup guide](https://settleupcli.pages.dev/agent.md) · [GitHub](https://github.com/NewDae/settle-up-cli)

## Install and connect

Requires **Node.js 22 or newer** and internet access.

```sh
npm install -g settle-up-cli
settleup auth login --browser
# Open loginUrl privately and enter your Firebase API key, email, and password.
settleup auth login --complete
settleup groups list
```

Browser login requires CLI 0.4.0+ and a Firebase Web API key for the project that authenticates your Settle Up account. Your browser sends the key, email, and password directly to Firebase. The CLI receives an encrypted session and saves the key for direct refresh. A key from an unrelated Firebase project won’t work. For private terminal login, configure `SETTLEUP_FIREBASE_API_KEY` locally; terminal login without a key retains the legacy hosted-auth flow.

Your session is kept in your operating system's credential store: macOS Keychain, Windows Credential Manager, or Linux Secret Service (GNOME Keyring or KWallet). Your password is never saved. On a server or container without a credential store, set `SETTLEUP_AUTH_STORAGE=file` to opt into a plaintext session file instead; see the [login reference](https://github.com/NewDae/settle-up-cli/blob/main/LOGIN.md#credential-storage).

**Google, Apple, or another sign-in method?** First [migrate your account to email/password](https://settleup.app/migrate-account). Email/password is the only supported login method.

## Use with your AI agent

Visit the [landing page](https://settleupcli.pages.dev/), choose your agent, and copy its setup prompt into your conversation. The agent reads the [installation and everyday usage guide](https://settleupcli.pages.dev/agent.md), checks its tools, and helps you connect.

The [encrypted session relay](https://github.com/NewDae/settle-up-cli/blob/main/server/browser-login.mjs) and [direct Firebase browser login](https://github.com/NewDae/settle-up-cli/blob/main/bin/lib/firebase-browser-login.mjs) are open source alongside the CLI.

Your agent needs terminal access. It runs `settleup auth login --browser` and gives you a private login link. Enter your Settle Up Firebase Web API key, email, and password on the hosted page (CLI 0.4.0+), then the agent runs `settleup auth login --complete`. Your browser can be on a different computer from the CLI. The browser verifies directly with Firebase and encrypts the session before our backend receives it. The CLI saves the key with its session for direct Firebase refresh; your password is never saved. Use a key for the Firebase project that authenticates your Settle Up account. Never paste keys, passwords, or session tokens into chat. Only sign in through a link you just asked for, and check that the agent reports your email afterwards. See [how auth works](https://settleupcli.pages.dev/#auth) and the [security model](LOGIN.md#browser-login-security-model).

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

Commands return JSON. `ok: true` means success; `ok: false` includes an error code and message, and exits with a nonzero status. If authentication expires, sign in again. `AUTH_STORAGE_FAILED` means the credential store is locked or unavailable: unlock it and retry, or choose file storage as described above. If a request is rate limited, wait before retrying.

## Documentation

- [Agent guide](https://github.com/NewDae/settle-up-cli/blob/main/AGENT_GUIDE.md): installation and operating workflow for shell-capable agents.
- [CLI specification](https://github.com/NewDae/settle-up-cli/blob/main/CLI_SPEC.md): requirements, design principles, commands, and input fields.
- [Login reference](https://github.com/NewDae/settle-up-cli/blob/main/LOGIN.md): sign-in, configuration, and session storage.
- [Developer guide](https://github.com/NewDae/settle-up-cli/blob/main/DEVELOPMENT.md): source setup and repository layout.
- [Test strategy](https://github.com/NewDae/settle-up-cli/blob/main/Tests.md): test commands, coverage, and limits.
- [API reference](https://github.com/NewDae/settle-up-cli/blob/main/API_REFERENCE.md): backend endpoint mapping.
- [Changelog](https://github.com/NewDae/settle-up-cli/blob/main/CHANGELOG.md): what changed in each release.

For source code, contribution information, and developer documentation, visit [the GitHub repository](https://github.com/NewDae/settle-up-cli) and its [developer guide](https://github.com/NewDae/settle-up-cli/blob/main/DEVELOPMENT.md). If the CLI helps you, [give it a star](https://github.com/NewDae/settle-up-cli).
