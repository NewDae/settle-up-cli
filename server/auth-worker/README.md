# Settle Up auth Worker

The auth server, CLI, and browser-login website are maintained together in this repository under its [MIT license](../../LICENSE). The Worker stays a separate Cloudflare deployment; moving its source does not change its endpoints or expose its runtime secrets.

`src/index.mjs` and `wrangler.toml` were imported without behavior or deployment-identity changes from the former auth repository at commit `3811c502cde8d5b032e996da5895c7915a80d1c5`. Make future auth-server changes here.

## What runs here

- `POST /auth/login` verifies email/password with Firebase and returns a session.
- `POST /auth/refresh` exchanges a refresh token for a refreshed session.
- Validation, an 8 KB request limit, stable errors, `Cache-Control: no-store`, and a shared per-IP auth rate limit.
- No database proxy, signup, password persistence, or credential logging. Browser access remains closed by default; the website calls this Worker through its internal `AUTH_SERVICE` binding.

Existing deployment identities are retained:

| Environment | Worker | Rate-limit namespace |
| --- | --- | --- |
| Staging | `settleup-staging` | `12001` |
| Production | `settleup-production` | `12002` |

The rate limit is 10 requests per 60 seconds, shared across login and refresh for each caller IP and environment. See [LOGIN.md](../../LOGIN.md) for the session flow and [API_REFERENCE.md](../../API_REFERENCE.md) for endpoint mapping.

## Configuration and commands

Keep `SETTLEUP_FIREBASE_API_KEY` and `SETTLEUP_API_BASE_URL` as secrets on the corresponding existing Cloudflare Worker. A source relocation does not require copying or re-uploading them. The code reads these bindings at runtime; no real values are included in this directory.

From the repository root:

```sh
npm run test:auth-worker
npm run auth:dev
# Deploy only when intended; these update the existing Worker deployments:
npm run auth:deploy:staging
npm run auth:deploy:production
```

For local development only, create ignored `server/auth-worker/.dev.vars.staging`:

```dotenv
SETTLEUP_API_BASE_URL=https://settle-up-sandbox.firebaseio.com
SETTLEUP_FIREBASE_API_KEY=<sandbox Firebase Web API key>
```

Use sandbox configuration locally. Worker dev starts from this directory, so it does not load the CLI's root environment files. Run the website separately with `npx wrangler pages dev docs --service AUTH_SERVICE=settleup-staging`; see [DEVELOPMENT.md](../../DEVELOPMENT.md#browser-login-website).

## Publication and trust

Worker source/configuration are public for inspection and self-hosting. Real `.env` and `.dev.vars` files stay ignored. The npm package includes only its existing client allowlist, and the website serves only `docs/`; Worker source is not shipped as a browser asset or installed CLI module.

Public source makes the credential-handling implementation reviewable. Users still trust whoever operates the hosted deployment: code with Worker deployment permission can access runtime secrets, and source publication cannot prove that a particular live deployment matches the repository. Protect deployment access, review changes, and keep credentials out of logs.
