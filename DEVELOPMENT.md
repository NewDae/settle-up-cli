# Developing Settle Up CLI

For installation and everyday usage, see [README.md](README.md). Requirements and design principles live in [CLI_SPEC.md](CLI_SPEC.md); endpoint mapping lives in [API_REFERENCE.md](API_REFERENCE.md).

## Run from source

Requires Node.js 22 or newer.

```bash
git clone https://github.com/NewDae/settle-up-cli.git
cd settle-up-cli
node bin/settleup.mjs --help
npm link
```

Discover commands with `settleup --help` and input examples with `settleup schema <operation>`. The [CLI command reference](CLI_SPEC.md#command-reference) is the maintained catalog.

## Environment setup

For day-to-day local development:

```bash
cp .env.example .env
```

For E2E runs, keep staging and production config separate:

```bash
cp .env.staging.example .env.staging
cp .env.production.example .env.production
```

Example staging configuration:

```bash
SETTLEUP_ENV=staging
SETTLEUP_API_BASE_URL=https://<staging-settle-up-api>
SETTLEUP_FIREBASE_API_KEY=<staging-firebase-api-key>
```

The CLI reads `.env` from its working directory. The E2E runner reads `.env` by default, or the file named by `SETTLEUP_ENV_FILE`. Existing shell variables take precedence over env-file values. The raw live backend suite reads exported shell variables only; it does not load `.env` automatically.

Published-package users need no configuration. [LOGIN.md](LOGIN.md#configuration-reference) owns configuration precedence, hosted/direct auth, session storage, and login limitations. Keep real keys and session credentials in ignored local files or environment/service configuration.

## Verification

Run `npm test` for local CLI checks. [Tests.md](Tests.md) owns the full coverage and limitation descriptions, live-test instructions, E2E environment commands, and report format. Live suites create backend records and require a deliberately selected environment.

When changing behavior, update the CLI spec and the corresponding public CLI tests. Backend behavior must be checked against the live backend; a passing request-stub test alone does not verify persistence or server calculations.

## Agent documentation

Edit [AGENT_GUIDE.md](AGENT_GUIDE.md), then run:

```bash
npm run docs:sync
npm run docs:check
```

`docs/agent.md` and `docs/llms.txt` are generated copies for the website. The npm package includes the canonical guide. Do not maintain three separate versions.

## Repository map

| Path | Responsibility |
|---|---|
| `bin/settleup.mjs` | CLI executable, validation, help, and schema examples. |
| `test/` | Public CLI tests and opt-in live backend tests. |
| `scripts/run-cli-integration.mjs` | Live CLI workflow and dated reports. |
| `scripts/sync-agent-docs.mjs` | Generate/check site copies of the agent guide. |
| `README.md` | User installation, everyday usage, and documentation entry point. |
| `CLI_SPEC.md` | Maintained requirements, principles, input contracts, and design evolution. |
| `API_REFERENCE.md` | Backend paths and command-to-endpoint mapping. |
| `LOGIN.md` | Authentication, configuration, and session storage. |
| `Tests.md` | Test commands, coverage, and limitations. |
| `AGENT_GUIDE.md` | Canonical agent installation and operating workflow. |
| `docs/` | Website and generated agent guide copies. |
| `design/CLI_SPEC.before-cleanup.md` | Frozen historical spec; not maintained as a current contract. |

## Open source

An independent community integration, not an official Settle Up client. Released under the [MIT license](LICENSE). If it helps you, [star the repository](https://github.com/NewDae/settle-up-cli).
