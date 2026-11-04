# Research: Workspace Setup and Owner Access

**Feature**: [001 Workspace Setup and Owner Access](spec.md) · **Plan**: [plan.md](plan.md)

Each entry records a decision, why it was made, and what else was considered. Library behavior
was checked against the current releases on 2026-11-03: `better-auth` 1.7.16 (source tag `v1.7.16`
and its docs), Node.js 26, PostgreSQL 18, and Caddy 2.11. Citations point to the source or docs
that settled each question.

## R1. Runtime and Language Versions

- **Decision:** Node.js 26 LTS, TypeScript 7, PostgreSQL 18, Caddy 2.11.
- **Rationale:**
  - Node 26 entered long-term support on 2026-10-28, with support until 2029-04-30
    ([endoflife.date/nodejs](https://endoflife.date/nodejs)). Its built-in TypeScript type
    stripping is stable ([Node 26 TypeScript docs](https://nodejs.org/docs/latest-v26.x/api/typescript.html)),
    so the server runs `.ts` files directly with no build step and no `tsx`/`ts-node` dependency.
    `tsc --noEmit` checks types in CI.
  - PostgreSQL 18 is the newest major version, supported until 2030-11-14.
  - Caddy 2.11 is the current release.
- **Alternatives:**
  - Node 24 is supported until 2028-04, which is shorter.
  - Compiling the server with `tsc` or a bundler would add a build step that type stripping makes
    unnecessary. The server code must then use only erasable TypeScript syntax (`erasableSyntaxOnly`),
    so no enums or parameter properties.
- **Note:** the official PostgreSQL 18 image moved its volume from `/var/lib/postgresql/data` to
  `/var/lib/postgresql` ([image Dockerfile](https://github.com/docker-library/postgres/blob/master/18/bookworm/Dockerfile)).
  The Compose file mounts the named volume at the new path.

## R2. Repository Layout and Packaging

- **Decision:**
  - One repository with npm workspaces: `server/`, `web/`, and `e2e/`, plus `deploy/` for the
    Compose file and Caddyfile.
  - The project publishes two images: `your-space-server` (Node and the API) and `your-space-web`
    (Caddy with the built web client and the Caddyfile baked in).
- **Rationale:**
  - npm workspaces are built into npm, so no extra tool is needed.
  - Baking the web client into the Caddy image keeps it to one container and one origin, and the
    operator's Compose file only references published images.
- **Alternatives:**
  - pnpm or Turborepo add tools without solving a problem here.
  - A shared volume for web files is fragile across updates.
  - Serving the web client from Express was rejected earlier in review.

## R3. Authentication With Better Auth

- **Decision:** use Better Auth's built-in features for everything except the claim. Configuration:
  - `emailAndPassword`: enabled, `minPasswordLength: 12`, `maxPasswordLength: 128`,
    `autoSignIn: false`, `revokeSessionsOnPasswordReset: true`, `resetPasswordTokenExpiresIn: 1800`,
    and `sendResetPassword` set to the operator command's print callback.
  - `rateLimit.enabled: false`; the app's own limiter covers auth routes ([R7](#r7-failed-attempt-limits-fr-011)).
  - Session: database-backed, 7-day expiry, refreshed daily (the library defaults), `cookieCache`
    off.
  - `baseURL` set to `YS_PUBLIC_URL`; `advanced.database.generateId: "uuid"`.
  - Plugins: `organization({ allowUserToCreateOrganization: false })` only.
  - `telemetry: { enabled: false }`, set explicitly.
- **Rationale:**
  - **Password hashing (cross-cutting scenario 1, FR-010):** scrypt with N=16384, r=16, p=1, a
    64-byte key, and a 16-byte random salt per password. This is the library default
    (`@better-auth/utils` 0.5.1, `password.node.mjs`).
  - **Sessions (FR-009):** sessions are rows in the database, so they survive restarts. Sign-out
    deletes the row (`api/routes/sign-out.ts`). The cookie cache stays off, because with it on a
    revoked session can keep working on other devices for up to 5 minutes
    ([session management docs](https://www.better-auth.com/docs/concepts/session-management)).
  - **Revocation on reset (FR-019):** `revokeSessionsOnPasswordReset` defaults to `false`, so it is
    turned on explicitly.
  - **Single-use reset tokens (FR-018):** Better Auth consumes the token inside the reset
    transaction, so only the first of two concurrent uses succeeds (`api/routes/password.ts`).
  - **Host-only cookies (FR-021):** cookies get a `Domain` attribute only when
    `crossSubDomainCookies` is on, so they are host-only by default. With an `https` `baseURL` they
    are `Secure` and use the `__Secure-` prefix, and they default to `SameSite=Lax` and `HttpOnly`
    (`cookies/index.ts`). This meets FR-015's rule that session cookies never go over plain HTTP to
    a remote host.
  - **Password length:** 12 characters rather than the default 8, because the owner account
    controls the whole installation.
- **Alternatives:**
  - Argon2 through a custom `password.hash`: Better Auth supports it, but it needs a native
    dependency and the scrypt default is adequate.
  - Raising scrypt's cost to OWASP's recommended N=2^17 would need a custom hash function. The
    default costs about 32 MiB per hash, and the sign-in limits make guessing slow. This is
    worth revisiting before publication.

## R4. Blocking Account and Workspace Creation After Setup

- **Decision:** mount Better Auth behind an **Express allowlist** of the exact routes the web
  client uses ([HTTP API contract](contracts/http-api.md)). Two Better Auth hooks back it up:
  - a `before` hook refuses sign-in while unclaimed;
  - `databaseHooks.user.create.before` refuses any user creation after the claim.
- **Rationale:**
  - The organization plugin adds 35 `/organization/*` routes in 1.7.16, including invitations and
    member management. FR-005 says no membership path may exist in this feature.
  - Better Auth's `disabledPaths` matches exact paths only and is checked only by the HTTP router
    (`api/index.ts`). A blocklist would need every route listed, and a library upgrade could add new
    ones silently. An allowlist fails safe instead.
  - Server-side `auth.api.*` calls bypass the HTTP router, so the claim can still call
    `signUpEmail` and `createOrganization` directly.
- **Alternatives:**
  - `disableSignUp: true`: it also blocks the server-side `auth.api.signUpEmail`
    (`api/routes/sign-up.ts`), which the claim needs.
  - The admin plugin's `createUser`: it adds admin routes and user columns that this feature
    doesn't otherwise need.
  - Calling `internalAdapter` directly: not a documented public API.

## R5. The Claim: Atomic Enough Without Custom Transactions Across Libraries

- **Decision:** a resumable claim, run under a PostgreSQL advisory lock, that ends in one small
  commit transaction. The steps are in [data-model.md](data-model.md#claim-sequence).
- **Rationale:**
  - Better Auth's `signUpEmail` and `createOrganization` each commit on their own, so the account
    and workspace cannot be created in a single transaction without going around the library.
  - Instead, everything before the commit point can be thrown away. Before the claim, any user row
    can only be a leftover from an interrupted attempt, so a retry deletes leftovers and starts
    again.
  - The `installation` row flips to `claimed` in the same transaction that creates the actor and
    event and marks the code used. A claimed installation therefore always has its owner and
    workspace, enforced by a check constraint (FR-004).
  - The advisory lock makes double-clicks and concurrent claims run one after another; the second
    one sees `claimed`.
- **Alternatives:**
  - Wrapping everything in one transaction through Better Auth's internal adapter: undocumented API.
  - A `claiming` state with step-by-step resumption: more states for no benefit, since restarting
    the claim from scratch is safe.

## R6. Setup Code

- **Decision:**
  - 24 characters from Crockford's base32 alphabet (about 120 bits), generated with
    `crypto.randomBytes`, shown in groups of four.
  - Stored as a SHA-256 hash, valid for 60 minutes, locked after 10 failed attempts. A new code
    replaces the old one.
- **Rationale:**
  - At 120 bits, guessing is infeasible, so a fast hash is enough; slow password hashing is for
    low-entropy secrets.
  - The per-code attempt limit meets FR-011 without a rate-limit library. The claim is an Express
    route, outside Better Auth's rate limiter.
  - Crockford's alphabet avoids look-alike characters (I, L, O, U), which helps when the code is
    typed by hand.
- **Alternatives:**
  - `express-rate-limit`: a dependency for one route, when a counter on the code row is stronger.
  - A shorter code: shorter codes need slow hashing and stricter lockout.

## R7. Failed-Attempt Limits (FR-011)

- **Decision:** one rate-limiting system for the whole app, using **rate-limiter-flexible** with its
  Drizzle store. Better Auth's built-in limiter is turned off (`rateLimit.enabled: false`).

  | Limit | Key | Rule |
  | --- | --- | --- |
  | Every `/api` request | IP | 300 per minute |
  | Sign-in failures | account + IP | 5 in a row blocks that pair for 15 minutes; a success clears it |
  | Sign-in failures | account, from any IP | 50 per hour blocks the account's sign-in for 1 hour |
  | Sign-in failures | IP | 100 per day blocks that IP for 1 day |
  | Claim attempts | IP | 10 per 15 minutes, plus the per-code lock in [R6](#r6-setup-code) |
  | Password reset submissions | IP | 5 per minute |

- **Rationale:**
  - **Library used for its purpose:** Better Auth's limiter exists to protect Better Auth's own
    routes. It cannot count per account, and it cannot cover Your Space's routes, such as the claim
    now and the gateway later. Stretching it into the app's limiter would use it for something it
    wasn't built for. The decision record and constitution principle VII now say this explicitly.
  - **Purpose-built library:** rate-limiter-flexible counts any key, so it can count per account,
    per IP, or per account and IP. Its docs include a login-protection recipe for exactly this table
    ([login endpoint protection](https://github.com/animir/node-rate-limiter-flexible/wiki/Overall-example#login-endpoint-protection)).
  - **Fits the stack:** it ships a Drizzle store (`RateLimiterDrizzle`) that uses a table we define in
    our Drizzle schema, so its table goes through our migrations (FR-024) and counters survive
    restarts. Version 11.2.4, ISC license, no runtime dependencies, about 4.6 million weekly
    downloads.
- **How it is wired:**
  - The general and claim limits are Express middleware.
  - Sign-in and reset limits use Better Auth's documented `hooks`:
    - a `before` hook checks whether the account or IP is blocked and returns 429;
    - an `after` hook records failures and clears the account and IP pair on success.
  - Better Auth runs `after` hooks for failed requests too, with the error in
    `ctx.context.returned` (`api/dispatch.mjs` in 1.7.16).
- **Locking out the owner:**
  - A stranger who knows the owner's email could trigger the per-account limit and block the owner's
    sign-in for up to an hour. The account and IP pair is limited first, so a single attacker hits
    their own limit long before that.
  - Running `reset-link` clears the account's sign-in limits, so the operator always has a way back
    in.
- **IP address behind Caddy:**
  - Caddy sets `X-Forwarded-For` to `{client_ip}`, a single address.
  - Express's `trust proxy` is set to one hop, so `req.ip` and the hooks see the real client.
  - Caddy's `trusted_proxies` is set through the environment when the operator runs their own proxy
    or Tailscale in front of Caddy.
- **Alternatives:**
  - `express-rate-limit`: very widely used, but it counts requests per route. Counting failures per
    account would need custom code, and its Postgres store is a separate community package.
  - Better Auth's limiter: rejected for the reasons above.

## R8. Owner Recovery Link

- **Decision:**
  - The `reset-link` command calls `auth.api.requestPasswordReset` for the owner's email.
  - The `sendResetPassword` callback receives the token and prints
    `${YS_PUBLIC_URL}/reset-password#token=<token>`.
  - The reset page posts the token and new password to `/api/auth/reset-password` in the request
    body.
- **Rationale:**
  - Better Auth generates, stores, expires, and consumes the token, and revokes sessions.
  - Better Auth's own link puts the token in the URL path, then redirects to the client with
    `?token=` in the query string (`api/routes/password.ts`). A URL fragment is never sent to any
    server, so the token stays out of proxy logs, server logs, and `Referer` headers (FR-010).
- **Alternatives:** Better Auth's own link works too, but it puts the token in two logged
  positions.

## R9. HTTPS and the Caddy Configuration

- **Decision:** one Caddyfile, configured by `YS_SITE_ADDRESS`:

  | Mode | `YS_SITE_ADDRESS` | Result |
  | --- | --- | --- |
  | Own domain | `space.example.com` | Automatic certificate, HTTP redirected to HTTPS, HTTP/3 |
  | Same machine | `http://localhost` | Plain HTTP on localhost only |
  | Own proxy or Tailscale | `http://:8080` bound to `127.0.0.1` | Caddy serves plain HTTP to the local proxy, which terminates HTTPS |

  The site block serves the web files with `try_files {path} /index.html`, compresses responses,
  and sends `/api/*` to `server:3000`. Caddy's access log stays off.

- **Rationale:**
  - Caddy's automatic HTTPS needs no custom code (FR-028).
  - `YS_PUBLIC_URL` (`https://…`) makes Better Auth issue `Secure` cookies even when Caddy serves
    plain HTTP to a local proxy, so the browser never sends them over plain HTTP.
  - With the access log off, nothing records request URLs.
- **Certificate failures:** Caddy logs the ACME error (for example, DNS doesn't point at the host)
  and keeps retrying. It does not fall back to serving the domain over plain HTTP. The guide points
  to `docker compose logs caddy`.
- **Tailscale:** `tailscale serve --https=443 http://127.0.0.1:8080` gives a `*.ts.net` HTTPS address
  with no public ports; the guide documents it.
- **Outbound requests (FR-026):**
  - Caddy has no telemetry. It contacts the ACME certificate authority only when a domain is
    configured.
  - Better Auth ships an anonymous telemetry package. In 1.7.16 it is off unless
    `telemetry.enabled` or `BETTER_AUTH_TELEMETRY` turns it on (`@better-auth/telemetry`,
    `dist/index.mjs`). The configuration sets `enabled: false` explicitly so a future default
    change cannot turn it on.
  - Node, Postgres, and the web client make no outbound requests.
  - Cross-cutting scenario 5 verifies this by capturing traffic.

## R10. Storage-Unavailable Handling (FR-013)

- **Decision:** the first migration inserts the `installation` row with `state = 'unclaimed'`.
  Status queries read that row:
  - if the query fails or the row is missing, the API answers `storage_unavailable` (503);
  - the web client shows a storage error screen, never setup;
  - the operator commands exit 3.
- **Rationale:** unclaimed is a fact stored in the database, so it cannot be confused with "the
  database didn't answer".
- **Startup:** the server applies migrations and starts listening only after it reaches the
  database. Compose starts it after Postgres reports healthy (`pg_isready`). If the database is
  lost later, requests return 503 and the health check fails, and service resumes when Postgres
  returns.

## R11. Migrations and Schema Version (FR-024)

- **Decision:**
  - Better Auth's CLI (`npx auth@latest generate`) writes its Drizzle schema file.
  - Drizzle Kit (`drizzle-kit generate`) turns both schema files into versioned SQL migrations,
    which are committed.
  - At startup, the server applies pending migrations with `drizzle-orm`'s `migrate()` under a
    PostgreSQL advisory lock. Drizzle records them in `drizzle.__drizzle_migrations`.
- **Rationale:**
  - This is the flow Better Auth documents for Drizzle
    ([Drizzle adapter docs](https://www.better-auth.com/docs/adapters/drizzle)).
  - The production image needs only `drizzle-orm`; Drizzle Kit and the Better Auth CLI are
    development tools.
- **Policy:** migrations only add or change in place; they never drop data that holds identities.
  Before migrating, the server logs the old and new schema versions. Snapshots before updates are
  spec 006.

## R12. Web Client

- **Decision:**
  - React 19, Vite 8, TanStack Router with code-based routes, TanStack Query, and Better Auth's React
    client (`createAuthClient` with `organizationClient`).
  - Styling is one plain CSS file, and forms use native HTML validation.
  - Routes: `/setup`, `/sign-in`, `/` (home), and `/reset-password`. Storage, connection, and
    session failures are shown as states, not separate routes.
- **Rationale:**
  - **Redirects:** the root route's `beforeLoad` reads setup status and the session through
    TanStack Query, then redirects: unclaimed to setup, signed out to sign-in, storage unavailable
    to the error state.
  - **Queries:** Better Auth's client returns `{ data, error }`, and query functions unwrap it.
    Better Auth's docs show `getSession()` used with TanStack Query
    ([basic usage](https://www.better-auth.com/docs/basic-usage)). One cache and one error model
    serve FR-016's error states.
  - **Code-based routes:** with four routes, they avoid the router's Vite plugin.
- **Alternatives:**
  - React Router: replaced at review in favor of TanStack.
  - TanStack Form: not needed for four small forms.
  - A component library or Pico CSS: rejected under principle VII for a plain UI.

## R13. Server

- **Decision:**
  - Express 5 mounts Better Auth with `toNodeHandler` at `/api/auth/*splat`, behind the allowlist
    and before `express.json()`.
  - The database driver is `pg` (node-postgres) with Drizzle.
  - Logs are one JSON line per event through a small wrapper over `console`. Logs never include
    request bodies, cookies, or `Authorization` headers.
- **Rationale:**
  - Better Auth's Express docs require mounting it before body parsing
    ([Express integration](https://www.better-auth.com/docs/integrations/express)).
  - `pg` is the most widely used Postgres driver for Node, and both Drizzle and Better Auth support
    it.
  - A logging library would add little for the few log lines this feature writes.
- **Alternatives:**
  - `postgres` (postgres.js): also fine, but `pg` is more widely used.
  - `pino`: worth adding when log volume grows.

## R14. Testing and Images

- **Decision:**
  - Vitest for server tests, run against a real PostgreSQL service container in CI. There are no
    database mocks, because claim concurrency and storage failure need a real database.
  - Playwright for browser journeys, run against the full Compose stack, including restart and
    `down`/`up` recreation.
  - Docker Buildx with QEMU publishes `linux/amd64` and `linux/arm64` images to GitHub Container
    Registry.
- **Rationale:**
  - Vitest pairs with Vite.
  - Playwright is the standard for multi-browser end-to-end tests; it covers Chromium, Firefox, and
    WebKit for Safari behavior.
  - Buildx and QEMU are GitHub's standard multi-architecture path. The ARM check of the guide
    (SC-011) runs on a real Apple Silicon Mac.
- **Alternatives:**
  - Testcontainers: another dependency, when CI service containers and Compose already provide
    Postgres.

## R15. Supported Hosts and Browsers

- **Decision:**
  - **Hosts:** macOS 15 and 26 with Docker Desktop; Ubuntu 24.04 LTS and Debian 13 with Docker
    Engine 28 or newer and the Compose v2 plugin. Each must be verified on ARM and Intel/AMD where
    available.
  - **Browsers:** the current and previous major versions of Chrome, Edge, Firefox, and Safari,
    including iOS Safari.
- **Rationale:** these are current, widely used releases that can be tested directly. The support
  claims in the guide list only what was verified (SC-010).
