# Settle Up CLI

A JSON-first command-line client for [Settle Up](https://settleup.app/), built so that people and AI agents can manage groups, shared expenses, payments and balances through one small, predictable interface. The installed command is `settleup`.

[Website](https://settleupcli.pages.dev/) · [npm package](https://www.npmjs.com/package/settle-up-cli) · [Agent guide](../AGENT_GUIDE.md) · [Changelog](../CHANGELOG.md)

> Installing and using the CLI? The [npm README](../README.md) is the user guide. This page covers the project's design and how to develop on it.

An independent community integration, not an official Settle Up client.

## What this CLI does

- Signs in through the hosted auth wrapper (or direct Firebase auth) and keeps the session in the OS credential store.
- Creates groups through Settle Up's permission-stub flow, not `POST /groups`.
- Manages members, categories, expenses, transfers and transactions, and reads debts and change history.
- Lists and filters transactions by member, payer, category, type, date, limit and order.
- Triggers backend debt recalculation.
- Returns a JSON success or error envelope for every command.

## Design principles

The CLI is a thin, deterministic layer for transport and validation. Judgement stays with the person or agent driving it.

- **JSON in, JSON out.** Stdout is always a `{ ok, data | error, meta }` envelope, and failures exit with a nonzero status. Interactive prompts go to stderr.
- **Exact IDs, no guessing.** Writes take exact IDs and JSON input. The CLI never resolves fuzzy group or member names; looking up names is the agent's job.
- **`uid` is not `memberId`.** An account identity (`uid`) and a group ledger participant (`memberId`) are kept separate everywhere.
- **Money is a string.** Amounts and weights are decimal strings, never floating-point numbers.
- **Explicit patches.** Updates change only the fields supplied. A supplied array or object replaces the whole field.
- **Validate before writing.** Input is checked before any request is sent, and every error carries `details.help` with the next step to take.
- **Discoverable contracts.** `settleup --help` and `settleup schema <operation>` describe every command, field, type and example, so agents don't need the source.
- **Secrets stay in the OS.** Sessions go to Keychain, Windows Credential Manager or Linux Secret Service. Plaintext storage needs an explicit opt-in, and the CLI never falls back to it silently. Passwords are never saved.
- **Test the real thing.** Tests run the actual executable against a strictly scripted HTTP boundary, not a reimplementation of it.

The full requirements, identity model, patch semantics and open questions are in [CLI_SPEC.md](../CLI_SPEC.md#requirements-and-design-principles).

## Architecture

```text
 person / AI agent
        │  argv + JSON input (--input file or -)
        ▼
 bin/settleup.mjs ── parse → validate → request → JSON envelope
        │                         │
        │                         └─ bin/lib/session-store.mjs ── OS credential store
        │                                                          (or explicit file)
        ├──► auth service     login / refresh  (hosted wrapper or Firebase)
        ├──► login website    browser login: start / poll / cancel  (Pages Functions + D1)
        └──► Settle Up database   REST paths, ?auth=<accessToken>

 user's browser ──► login website /login ──► auth Worker (service binding) ──► Firebase
                         └─ session encrypted to the CLI's key, held once in D1 for the CLI to poll
```

- **One executable.** `bin/settleup.mjs` holds the command table (`HELP`), input schemas (`SCHEMAS`), validators, request helpers and error recovery. It has no runtime dependencies apart from the keyring module.
- **The session store** (`bin/lib/session-store.mjs`) handles session read, write, migration and deletion. Each session is scoped by config directory, environment, database URL and auth URL.
- **Environments.** `production` uses packaged defaults. `staging` and local setups need explicit URLs. See [LOGIN.md](../LOGIN.md#configuration-reference).
- **The hosted auth Worker** lives in [`server/auth-worker/`](../server/auth-worker/README.md). The server, browser-login page, and CLI are all open source in this repository and run on Cloudflare; runtime secrets remain in Cloudflare. Anyone can self-host them (see [LOGIN.md](../LOGIN.md#self-hosting)).
- **The backend mapping** from each command to its endpoint is in [API_REFERENCE.md](../API_REFERENCE.md).

## Developing

Requires Node.js 22 or newer.

```bash
git clone https://github.com/NewDae/settle-up-cli.git
cd settle-up-cli
npm ci
npm test                  # offline suite: real CLI, scripted HTTP, stubbed keyring
node bin/settleup.mjs --help
```

[DEVELOPMENT.md](../DEVELOPMENT.md) covers environment files, staging configuration and the live and end-to-end runs.

### Adding or changing a command

1. **Help entry.** Add or update the command under `HELP.commands` with its synopsis, flags, input type and example.
2. **Schema.** For JSON input, add the schema to `SCHEMAS` and its field descriptions to `schemaFields()`.
3. **Validator.** Write or extend the validator so that bad input fails with `INVALID_INPUT` before any request is sent.
4. **Handler.** Add the handler in `main()`. Return results with `printJson(ok(...))` and throw errors that carry a `cliCode`.
5. **Tests.** Add tests in `test/cli-*.test.mjs` using `runAuthenticatedCli()` from `test/helpers/cli-harness.mjs`. Script the exact HTTP requests you expect, and include at least one invalid-input case that sends no request.
6. **Docs.** Update [CLI_SPEC.md](../CLI_SPEC.md) and, if agents use the command, [AGENT_GUIDE.md](../AGENT_GUIDE.md). Then run `npm run docs:sync`.
7. **Live check.** For behaviour that depends on the backend (persistence, server calculations), verify it against staging. A passing stub test doesn't prove those.

### Checks

| Command | What it checks |
|---|---|
| `npm test` | Offline contract, validation, help and credential-storage tests |
| `npm run docs:check` | Generated `docs/agent.md` and `docs/llms.txt` match `AGENT_GUIDE.md` |
| `npm run test:credentials` | Native OS credential store lifecycle, using dummy tokens |
| `npm run test:live` | Raw backend suite (opt-in; writes to the selected backend) |
| `npm run integration:e2e:staging` | Full CLI workflow against staging, writing a dated report |

CI (`.github/workflows/ci.yml`) runs the offline suite, `docs:check` and the native credential tests on macOS, Windows and Linux for every pull request. [Tests.md](../Tests.md) describes each layer and its limits.

## Documentation map

| Document | Covers |
|---|---|
| [README.md](../README.md) | User install and everyday commands (shown on npm) |
| [AGENT_GUIDE.md](../AGENT_GUIDE.md) | How an AI agent installs and operates the CLI (canonical source for `docs/agent.md`) |
| [CLI_SPEC.md](../CLI_SPEC.md) | Requirements, principles, output contract, command and input reference, design evolution |
| [API_REFERENCE.md](../API_REFERENCE.md) | Auth endpoints, backend paths and command-to-endpoint mapping |
| [LOGIN.md](../LOGIN.md) | Authentication, configuration and credential storage |
| [DEVELOPMENT.md](../DEVELOPMENT.md) | Running from source, environment setup and repository map |
| [Tests.md](../Tests.md) | Test layers, commands, coverage and limitations |
| [CHANGELOG.md](../CHANGELOG.md) | Release notes |

## Contributing

Issues and pull requests are welcome. Keep changes consistent with the design principles above, include tests that run the real CLI, and update the owning document rather than adding a new one. Don't commit real credentials or `.env.*` files.

## License

[MIT](../LICENSE)
