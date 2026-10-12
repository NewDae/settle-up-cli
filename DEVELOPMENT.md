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

The existing Cloudflare Pages project serves `docs/`. Pages Functions under `functions/api/login/` provide browser pairing, using the `LOGIN_DB` D1 binding and the `AUTH_SERVICE` service binding to the existing `settleup-production` auth Worker. No Firebase API key belongs in Pages configuration or browser assets. The auth Worker needs no change for browser login.

Before the first production deployment:

1. Create a D1 database with `npx wrangler d1 create settleup-browser-login` and put its returned ID in `wrangler.jsonc`.
2. Apply the migration with `npx wrangler d1 migrations apply LOGIN_DB --remote`.
3. Confirm the `AUTH_SERVICE` binding targets the production Worker in the same Cloudflare account. `env.preview` in `wrangler.jsonc` binds preview deployments to `settleup-staging` and a separate D1 database. Create it with `npx wrangler d1 create settleup-browser-login-staging`, put its ID in `env.preview`, and apply the migration with `--env preview`. Never point a public preview at production credentials.
4. Run `npm run docs:sync`, `npm test`, and `npm run docs:check`.
5. Deploy from the repository root with `npx wrangler pages deploy docs --project-name settleupcli`. Deploying only static files without Functions will not enable login. Publish a CLI release with the browser flags after checking the live site.

Local development: apply the migration with `npx wrangler d1 migrations apply LOGIN_DB --local`, run the auth Worker locally with `npm run auth:dev`, then run `npx wrangler pages dev docs --service AUTH_SERVICE=settleup-staging`. Use `SETTLEUP_LOGIN_BASE_URL=http://localhost:8788` with matching local/staging API/auth configuration. The public website uses no third-party scripts on the login page; CSP allows only same-origin requests. Keep request-body logging disabled in both hosted services and any proxy.

`npm run docs:sync` also updates the embedded machine guide. Login endpoint tests use real SQLite SQL, a local HTTP server, the real CLI executable, and a stub of the existing auth Worker. They do not verify production bindings or actual Firebase credentials.

## Auth Worker source

The complete hosted auth implementation lives in [server/auth-worker/](server/auth-worker/README.md), alongside the CLI and website. Its deployment configuration was imported unchanged; the only source change since import removes upstream Firebase error codes from responses. `npm test` includes its login, refresh, validation, rate-limit, and credential-logging checks.

Use `npm run auth:dev` for local staging development, or the explicit `auth:deploy:staging` / `auth:deploy:production` scripts for authorized deployments. These target the existing Workers and preserve their secret bindings; no live secrets were moved into this repository. Keep Worker local development secrets in ignored files under `server/auth-worker/`, separate from root CLI environment files. See the Worker README for configuration and the limits of public-source verification.

## Repository map

| Path | Responsibility |
|---|---|
| `bin/settleup.mjs` | CLI executable, validation, help, and schema examples. |
| `server/auth-worker/` | Hosted auth Worker source, deployment configuration, and operating instructions. |
| `server/browser-login.mjs` | Website pairing and encrypted session handoff. |
| `functions/api/login/` | Pages Functions route that serves `server/browser-login.mjs`. |
| `migrations/` | D1 schema for pending browser logins and rate limits. |
| `bin/lib/browser-login.mjs` | CLI side of browser login: start, poll, cancel, pending key file. |
| `bin/lib/browser-crypto.mjs` | ECDH + HKDF + AES-GCM handoff encryption shared by the CLI and website. |
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
