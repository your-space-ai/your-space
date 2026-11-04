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

- **Decision:** use Better Auth's built-in features for everything except creating the owner. Configuration:
  - `emailAndPassword`: enabled, `disableSignUp: true`, `minPasswordLength: 12`,
    `maxPasswordLength: 128`, `autoSignIn: false`, `revokeSessionsOnPasswordReset: true`,
    `resetPasswordTokenExpiresIn: 1800`. See [R4](#r4-owner-first-then-invite-only) for sign-up and
    `sendResetPassword`.
  - Rate limiting: Better Auth's built-in defaults, unchanged ([R7](#r7-failed-attempt-limits-fr-011)).
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
  - Argon2id, or scrypt at OWASP's recommended cost (N=2^17, r=8, p=1), through Better Auth's
    `password.hash/verify` option. Rejected for now to keep the library default.
  - **What that choice risks:** hash strength matters only if someone steals the database or a
    backup and guesses passwords offline. The library default costs about a quarter of OWASP's
    minimum, so such guessing runs roughly 4 times faster. A strong password (12 or more random
    characters, or a long passphrase) stays out of reach either way. A common or leaked password
    falls quickly either way. Only passwords in between are affected. Revisit if backups (spec 006)
    or members (spec 004) change that picture.

## R4. Owner First, Then Invite Only

- **Decision:**
  - Regular sign-up is always off: the Better Auth instance that serves `/api/auth` has
    `disableSignUp: true`.
  - The `create-owner` and `reset-link` commands use their own Better Auth instance, inside the
    command's process. It has the same configuration except that sign-up is on and
    `sendResetPassword` prints the link. It is never mounted on HTTP, so the network can't reach it.
  - After the owner exists, new people join only when the owner invites them (spec 004). Open
    sign-up can be a later feature.
- **Rationale:**
  - Better Auth's `disableSignUp` is a fixed configuration value, not a switch that flips at
    runtime. It also blocks server-side `auth.api.signUpEmail` calls (`api/routes/sign-up.ts`). A
    command-only instance with sign-up on lets `create-owner` make the owner while public sign-up stays off,
    using only documented options. There are no hooks and nothing in front of Better Auth.
  - **No one else can join in 001:**
    - Sign-up is off.
    - The organization plugin's add-member function is server-only.
    - Accepting an invitation needs an existing account, and only the owner has one.
    - `allowUserToCreateOrganization: false` stops a second workspace.
    - The `installation.workspace_id` foreign key is `on delete restrict`, so the workspace can't be
      deleted out from under a claimed installation.
  - **"Email me a reset link":** the public instance has no `sendResetPassword`, so Better Auth
    refuses `/request-password-reset` itself (`RESET_PASSWORD_DISABLED`, `api/routes/password.ts`).
    Completing a reset with a token still works.
- **Alternatives:**
  - Our own allowlist in front of Better Auth, or `before` hooks: rejected in review as custom
    machinery.
  - The admin plugin's `createUser`: adds admin routes and user columns that this feature doesn't
    need.

## R5. Creating the Owner With a Server Command

- **Decision:**
  - The operator runs `create-owner --email --name`. It creates the account, workspace, and owner
    membership, marks the installation as having an owner, and prints a set-password link.
  - There is no setup code, no claim endpoint, and no setup page. Before an owner exists, the web
    client only explains how to run the command.
- **Rationale:**
  - **The proven risk:** bots watch public Certificate Transparency logs and complete the setup
    pages of newly certified sites within minutes. This was demonstrated against WordPress and other
    installers at DEF CON 25 (Hanno Böck, 2017). Caddy requests a certificate as soon as the stack
    starts, so a new install is announced right away. With no setup page, the network has nothing
    to claim.
  - **Fewest parts:** a server command closes that hole with less code than a setup code plus a
    browser form, which would need the code itself, the claim endpoint, and the form.
  - **Fits the wrappers:** spec 003's CLI asks for the email during install. Spec 008's desktop app
    asks for name, email, and password on one screen, runs the command, and sets the password with
    the returned token. Both use the same command.
  - **Reruns:** each step reuses what an earlier, interrupted run created, so rerunning finishes the
    job. The installation is marked as having an owner only in the last step, in the same
    transaction as the actor and event, and a check constraint requires the workspace (FR-004).
    There are no locks: concurrent runs by the operator aren't a scenario this feature needs to
    handle, and the unique email prevents duplicate accounts.
- **Alternatives:**
  - First visitor becomes owner: no code, but exactly the risk above.
  - A setup code and browser form: same protection, more parts. It was the earlier design in this
    PR.
  - A temporary password that must be changed at first sign-in: Better Auth has no such feature
    (none in the 1.7.16 source), so it would need a custom flag and enforcement.

## R6. First Password Through Better Auth's Reset Flow

- **Decision:** the owner sets their first password with the same single-use link used for recovery
  ([R8](#r8-owner-recovery-link)). `create-owner` gives the account a random password that is never
  shown, then issues the link.
- **Rationale:**
  - Better Auth's reset flow handles token creation, expiry, single use, and signing out other
    sessions, so first-password setup needs no code of its own.
  - The random initial password means the account is never usable until the owner sets a password.
    `auth.api.signUpEmail` requires a password, so this is the documented way to create the account.
    Better Auth's reset also creates the password credential if one is missing
    (`resetCredentialPassword` in `utils/password.mjs`).

## R7. Failed-Attempt Limits (FR-011)

- **Decision:** 001 adds no rate limiting of its own. Better Auth's built-in limiter stays on its own
  routes with its defaults; no configuration or code is involved.
- **Defaults** (on in production, per IP; `api/rate-limiter/index.ts` in 1.7.16):
  - sign-in: 3 attempts per 10 seconds;
  - all other auth routes: 100 per 10 seconds.
- **Rationale:**
  - Better Auth's set-password and reset tokens (24 random characters) are too long to
    guess, so they need no limit.
  - Sign-in is the only guessable secret, and Better Auth already protects it for its intended
    purpose: its own routes.
  - Per-account limits and a rate limiter for the whole app wait until a spec needs them, for
    example the gateway in spec 005. Under constitution principle VII, that would be a dedicated
    library, not Better Auth's limiter.
- **IP address behind Caddy:** Caddy replaces any `X-Forwarded-For` from an untrusted client with
  the single client address, which is the form Better Auth reads by default. No configuration is
  needed.
- **Limitation (documented):** limits are per IP address, so they slow guessing but do not lock the
  account.

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
  - the web client shows a storage error screen, never the "no owner yet" page;
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
  - Routes: `/sign-in`, `/` (home), and `/reset-password`, which also sets the first password.
    "No owner yet" and storage, connection, and session failures are shown as states, not separate
    routes.
- **Rationale:**
  - **Redirects:** the root route's `beforeLoad` reads `/api/status` and the session through
    TanStack Query. With no owner it shows the "no owner yet" state, which explains `create-owner`
    and has no form. Signed out goes to sign-in, and storage unavailable shows the error state.
  - **Queries:** Better Auth's client returns `{ data, error }`, and query functions unwrap it.
    Better Auth's docs show `getSession()` used with TanStack Query
    ([basic usage](https://www.better-auth.com/docs/basic-usage)). One cache and one error model
    serve FR-016's error states.
  - **Code-based routes:** with three routes, they avoid the router's Vite plugin.
- **Alternatives:**
  - React Router: replaced at review in favor of TanStack.
  - TanStack Form: not needed for four small forms.
  - A component library or Pico CSS: rejected under principle VII for a plain UI.

## R13. Server

- **Decision:**
  - Express 5 mounts Better Auth with `toNodeHandler` at `/api/auth/*splat`, before
    `express.json()`.
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
    database mocks, because owner creation and storage failure need a real database.
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
