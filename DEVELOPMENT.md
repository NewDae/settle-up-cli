# Developing Settle Up CLI

For installation and everyday usage, see [README.md](README.md). Requirements and design principles live in [CLI_SPEC.md](CLI_SPEC.md); endpoint mapping lives in [API_REFERENCE.md](API_REFERENCE.md).

## Run from source

Requires Node.js 22 or newer. `npm ci` installs the OS credential-store module that sign-in needs.

```bash
git clone https://github.com/NewDae/settle-up-cli.git
cd settle-up-cli
npm ci
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

## Browser login website

The Pages project serves `docs/`. Functions under `functions/api/login/` provide only an encrypted handoff through the `LOGIN_DB` D1 binding. The browser calls Firebase Auth directly using the user-entered API key. Pages needs no `AUTH_SERVICE` binding, Firebase key, or auth Worker. Production and previews use separate handoff databases.

For deployment:

1. Create/configure the production D1 database in `wrangler.jsonc` (existing IDs are already configured), then apply `npx wrangler d1 migrations apply LOGIN_DB --remote`.
2. Configure a separate preview database under `env.preview` and apply migrations with `--env preview`.
3. Run `npm run docs:sync`, `npm test`, and `npm run docs:check`.
4. Deploy from the root with `npx wrangler pages deploy docs --project-name settleupcli`, including Functions and `_headers`. Remove any old `AUTH_SERVICE` binding from Pages configuration. The login CSP allows same-origin requests and only `https://identitytoolkit.googleapis.com` for Firebase password verification.
5. Publish CLI **0.4.0+** alongside the website update. Protocol version 2 rejects older browser-login clients and servers; users with a pending old link should cancel with `auth logout`, update the CLI, and start again. Test the coordinated release before promoting it. Old CLI 0.3.0 sessions and terminal login can continue using the separately deployed legacy auth Worker.

Local development: apply migrations with `npx wrangler d1 migrations apply LOGIN_DB --local`, then run `npx wrangler pages dev docs`. No local auth Worker is needed. Set `SETTLEUP_LOGIN_BASE_URL=http://localhost:8788` and use explicit sandbox database/auth settings with a sandbox API key. Do not use production credentials in an unreviewed preview. Keep request-body logging disabled.

`npm run docs:sync` copies the shared browser cryptography and direct-Firebase helper into `docs/` and updates the embedded machine guide. Tests use real SQLite SQL, a localhost relay, the real CLI, and mocked Firebase responses. The page-controller test checks the actual form script’s request destinations and ensures its backend sees only ciphertext. Live Firebase/browser checks remain separate from deterministic tests.

## Auth Worker source

The legacy terminal/0.3.0 hosted auth implementation lives in [server/auth-worker/](server/auth-worker/README.md), alongside the CLI and website. Its deployment configuration was imported unchanged; the only source change since import removes upstream Firebase error codes from responses. `npm test` includes its login, refresh, validation, rate-limit, and credential-logging checks.

Use `npm run auth:dev` for local staging development, or the explicit `auth:deploy:staging` / `auth:deploy:production` scripts for authorized deployments. These legacy-only commands target the existing Workers and preserve their secret bindings; no live secrets were moved into this repository. Keep Worker local development secrets in ignored files under `server/auth-worker/`, separate from root CLI environment files. See the Worker README for configuration and the limits of public-source verification.

## Repository map

| Path | Responsibility |
|---|---|
| `bin/settleup.mjs` | CLI executable, validation, help, and schema examples. |
| `server/auth-worker/` | Legacy terminal/older-client auth Worker source and deployment instructions. |
| `server/browser-login.mjs` | Website pairing and encrypted session handoff. |
| `functions/api/login/` | Pages Functions route that serves `server/browser-login.mjs`. |
| `migrations/` | D1 schema for pending browser logins and rate limits. |
| `bin/lib/browser-login.mjs` | CLI side of protocol-v2 browser login: start, poll, cancel, pending key file. |
| `bin/lib/browser-crypto.mjs` | ECDH + HKDF + AES-GCM handoff encryption shared by the CLI and browser. |
| `bin/lib/firebase-browser-login.mjs` | Browser-only Firebase verification and encrypted session creation. |
| `docs/` | Website: landing page, login page, and generated agent guide copies. |
| `wrangler.jsonc` | Pages project bindings (production and preview). |
| `bin/lib/session-store.mjs` | Session storage in the OS credential store or explicit file. |
| `test/` | Public CLI tests and opt-in live backend tests. |
| `scripts/run-cli-integration.mjs` | Live CLI workflow and dated reports. |
| `scripts/sync-agent-docs.mjs` | Generate/check site copies of the agent guide. |
| `scripts/test-credential-store.mjs` | Native credential-store lifecycle check. |
| `.github/workflows/ci.yml` | CI on macOS, Windows, and Linux. |
| `README.md` | User installation, everyday usage, and documentation entry point (shown on npm). |
| `.github/README.md` | Project overview, design principles, architecture, and contributor guide (shown on GitHub). |
| `CHANGELOG.md` | Release notes. |
| `CLI_SPEC.md` | Maintained requirements, principles, input contracts, and design evolution. |
| `API_REFERENCE.md` | Backend paths and command-to-endpoint mapping. |
| `LOGIN.md` | Authentication, configuration, and session storage. |
| `Tests.md` | Test commands, coverage, and limitations. |
| `AGENT_GUIDE.md` | Canonical agent installation and operating workflow. |
| `docs/` | Website and generated agent guide copies. |

## Open source

An independent community integration, not an official Settle Up client. Released under the [MIT license](LICENSE). If it helps you, [star the repository](https://github.com/NewDae/settle-up-cli).
