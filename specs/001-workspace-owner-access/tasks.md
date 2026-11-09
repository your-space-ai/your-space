---
description: "Task list for 001 Workspace Setup and Owner Access"
---

# Tasks: Workspace Setup and Owner Access

**Input**: Design documents from `/specs/001-workspace-owner-access/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Included. The spec requires verified behavior for authentication, owner creation,
storage failure, and recovery (FR-011, SC-002 to SC-013), and constitution principle VI requires
evidence for authorization and data-integrity changes. Server tests run against a real PostgreSQL
database; browser tests run against the full Compose stack.

**Organization**: Tasks are grouped by user story, so each story can be built and tested on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: The user story the task belongs to (US1 to US4)

## Path Conventions

One repository with npm workspaces: `server/`, `web/`, `e2e/`, plus `deploy/` and `docs/install/`
([plan.md](plan.md#project-structure)).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the workspaces and tooling.

- [X] T001 Create root `package.json` with npm workspaces `server`, `web`, `e2e` and its `package-lock.json`, plus root `tsconfig.base.json` (TypeScript 7, `strict`, `erasableSyntaxOnly`, `rewriteRelativeImportExtensions`) and `.gitignore` (`node_modules`, `dist`, `.env`)
- [X] T002 Create `server/package.json` (Node 26, `"type": "module"`) with runtime dependencies `express`, `better-auth`, `drizzle-orm`, `pg`, and dev dependencies `drizzle-kit`, `vitest`, `@types/express`, `@types/pg`, plus `server/tsconfig.json` and `server/vitest.config.ts`
- [X] T003 [P] Create the Vite React app in `web/` (`web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`) with `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`, `better-auth`
- [X] T004 [P] Create `e2e/package.json` and `e2e/playwright.config.ts` with Chromium, Firefox, and WebKit projects and a base URL of `http://localhost` (`YS_PORT` moves it), plus `e2e/tsconfig.json`, `e2e/global-setup.ts` (builds the images), `e2e/stack.env` (the stack's settings, empty on purpose), and the `stack` and `evidence` helpers in `e2e/tests/helpers/`
- [X] T005 [P] Add `.github/workflows/ci.yml`: install, `tsc --noEmit` in every workspace, server tests with a PostgreSQL 18 service container, web build

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Configuration, database, Better Auth, the HTTP app, and the Compose stack. Every story
depends on these.

- [X] T058 [P] Implement `server/src/secrets.ts`: each platform secret from `.env` as given, otherwise the copy in `ys-secrets`, otherwise, for a new installation, generated; stop with recovery steps when the database exists but a secret is missing; replace a generated secret on request ([research R16](research.md#r16-platform-secrets)). Test it in `server/tests/secrets.test.ts`
- [X] T006 Implement `server/src/config.ts`: derive the setup and public address from the optional `YS_DOMAIN`, `YS_PROXY_URL`, and `YS_PORT` ([research R9](research.md#r9-https-and-the-caddy-configuration)), refuse unknown `YS_*` keys, read the auth secret and database password from `.env` or the `ys-secrets` volume ([research R16](research.md#r16-platform-secrets)), and validate them and `DATABASE_URL` at startup; exit with a clear message when one is missing or malformed
- [ ] T007 [P] Implement `server/src/log.ts`: one JSON line per event to stdout, never including request bodies, cookies, `Authorization` headers, passwords, or tokens
- [X] T059 [P] `server/tests/config.test.ts`: each setup line and the public address it gives, refused values and setting names with messages that say what to fix, Better Auth's own secret settings refused, and the secrets read from `.env` or the volume
- [X] T008 Implement `server/src/db/client.ts`: a `pg` pool and Drizzle instance from `DATABASE_URL`, with a pool `error` handler so losing the database never crashes the process
- [X] T009 Implement `server/src/auth.ts` with one shared options builder ([research R3, R4](research.md#r3-authentication-with-better-auth)):
  - `emailAndPassword` with `disableSignUp`, `minPasswordLength: 12`, `maxPasswordLength: 128`, `autoSignIn: false`, `revokeSessionsOnPasswordReset: true`, `resetPasswordTokenExpiresIn: 1800`
  - `baseURL` from the derived public address, `advanced.database.generateId: "uuid"`, `telemetry: { enabled: false }`
  - `organization({ allowUserToCreateOrganization: false })`, and the Drizzle adapter
  - export `auth`, the public instance with sign-up off and no `sendResetPassword`
  - export `createCommandAuth(onLink)`, the command-only instance with sign-up on and `sendResetPassword` calling `onLink`
- [X] T060 Store set-password and reset tokens in `server/src/auth.ts` only as SHA-256 hashes (`verification.storeIdentifier`), and have the commands' `sendResetPassword` delete any earlier unused link for the account, so only the newest link works ([research R8](research.md#r8-owner-recovery-link), [R16](research.md#r16-platform-secrets))
- [X] T010 Generate `server/src/db/auth-schema.ts` with `npx auth@1.7.18 generate` (`npm run auth:generate -w server`) from `server/src/db/auth-generate.ts`, which builds the instance in `server/src/auth.ts`
- [X] T011 Define `installation`, `actor`, and `event` in `server/src/db/schema.ts` per [data-model.md](data-model.md): single-row check on `installation`, a `claimed` row requires `workspace_id` and `claimed_at`, `workspace_id` references `organization.id` `on delete restrict`
- [X] T012 Add `server/drizzle.config.ts`, generate the first migration into `server/drizzle/`, and append inserts for the `installation` row (`state = 'unclaimed'`) and the `operator` actor
- [X] T063 [P] Mark the generated files `server/drizzle/meta/**` and `server/src/db/auth-schema.ts` as `linguist-generated` in `.gitattributes`
- [ ] T013 Implement `server/src/migrate.ts` (`drizzle-orm` `migrate()` under a PostgreSQL advisory lock, logging old and new schema versions) and `server/src/index.ts` (validate config, migrate, then listen on port 3000)
- [X] T014 Implement `server/src/app.ts`: Express 5 with `trust proxy` set to 1 hop, Better Auth via `toNodeHandler(auth)` at `/api/auth/*splat` mounted before `express.json()`, then JSON routes, and an error handler that returns `{ error, message }` without stack traces
- [X] T061 Refuse `/api` requests whose `Host` isn't the public address with 421 `wrong_host` in `server/src/app.ts`, with `/api/health` exempt for Docker's health check ([http-api](contracts/http-api.md#host-check)); test it in `server/tests/host.test.ts`
- [X] T062 Make sign-out from Your Space's own pages delete the session first in `server/src/app.ts`, and report a storage failure as 503 instead of success (FR-009, FR-016). `server/tests/outage.test.ts` covers storage failing mid-request (a reset, sign-out, a lost connection) and the organization routes closed over HTTP
- [X] T015 Implement `server/src/owner/installation.ts`: read the `installation` row and return `claimed` or `unclaimed`, or throw `StorageUnavailable` when the query fails or the row is missing ([research R10](research.md#r10-storage-unavailable-handling-fr-013))
- [X] T016 [P] Add `server/tests/helpers/db.ts`: create a fresh database per test file, run migrations, and expose helpers to stop and restore the connection; and the other helpers in `server/tests/helpers/`: `state.ts` (the identity and ownership records the tests compare), `commands.ts` (runs the operator commands as processes), and `env.ts` (shared settings)
- [ ] T017 [P] Add `server/Dockerfile` (`node:26-slim`, production dependencies, `bin/` on `PATH`, `CMD ["node", "src/index.ts"]`) and a `.dockerignore` that keeps `node_modules`, `.env`, docs, and specs out of the build context
- [X] T018 [P] Add `deploy/Caddyfile`:
  - site address `{$YS_SITE}` from the mode file, with `encode`, and `http://127.0.0.1` redirecting to the public address
  - `/api/*` to `server:3000`, with request bodies capped at 64 KB
  - the web files served with `try_files {path} /index.html`
  - no access log
- [X] T019 [P] Add `web/Dockerfile`: build with Vite, then `caddy:2.11` with `dist/` and `deploy/Caddyfile`
- [X] T020 Add `deploy/compose.yaml`, `deploy/stack.yaml`, `deploy/modes/mode.yaml`, and `deploy/.env.example` for this machine, and `deploy/compose.build.yaml`, which builds both images from this repository for development, CI, and the browser tests:
  - services `caddy` (web image), `server`, and `postgres:18`;
  - named volumes `ys-postgres` (mounted at `/var/lib/postgresql`), `ys-caddy-data`, and `ys-secrets`;
  - `compose.yaml` includes the mode file picked by which of `YS_DOMAIN` and `YS_PROXY_URL` is set; `modes/mode.yaml`, for neither, publishes `127.0.0.1` only, with literal port addresses ([research R9](research.md#r9-https-and-the-caddy-configuration));
  - a one-shot `secrets` service running `server/src/commands/secrets-step.ts` that settles the auth secret and database password into `ys-secrets` unless `.env` sets them, with no network ([research R16](research.md#r16-platform-secrets));
  - health checks: `pg_isready` and `/api/health`;
  - `postgres` and `server` start after the secrets step, `server` after Postgres is healthy, and `caddy` after the server is healthy.
- [X] T064 Implement `server/src/commands/show-secrets.ts`, with the output and exit codes the commands share in `server/src/commands/output.ts`, and the `server/bin/show-secrets` wrapper: print both platform secrets and where each comes from, as lines valid in `.env` ([operator commands](contracts/operator-commands.md#show-secrets)); test `describeSecrets` in `server/tests/secrets.test.ts`
- [X] T065 [P] `e2e/tests/setups.spec.ts`: this machine, with and without `YS_PORT`, publishes only its loopback port, the server and database publish nothing, and the secrets step has no network while each service mounts only what it reads, all read with `docker compose config`. A `setups` job in `.github/workflows/ci.yml` runs it on Compose 2.26.0 and on the runner's version
- [X] T066 `e2e/tests/secrets.spec.ts` against the Compose stack: an empty `.env` gets generated secrets that survive restarts; a lost `ys-secrets` volume stops start-up and the guide's steps recover the workspace; secrets set in `.env` are used as given, and a changed password is recovered with the guide's command. Write the Secrets, Lost Secrets, Give PostgreSQL the Database Password, and Replace a Secret sections of `docs/install/README.md`
- [ ] T021 Implement `web/src/auth-client.ts` (Better Auth `createAuthClient` with `organizationClient`), `web/src/queries.ts` (TanStack Query hooks for `/api/status`, the session, and the workspace that unwrap `{ data, error }`), and `web/src/main.tsx` (QueryClient and RouterProvider)
- [ ] T022 [P] Implement `web/src/components/ErrorState.tsx` with the failure kinds in `web/src/errors.ts` (storage unavailable, server unreachable, wrong address (421), session expired, each with a next step) and `web/src/styles.css` (plain CSS)

**Checkpoint**: `docker compose up` starts all three services healthy, and migrations apply, once
T029 adds `/api/health`, which the server's health check calls, and T030 and T032 add NoOwnerYet and
the router's root route, which the web image's `main.tsx` renders.

---

## Phase 3: User Story 1 - Install and Establish the Owner (Priority: P1) 🎯 MVP

**Goal**: The operator runs `create-owner`, opens the printed link, sets a password, and reaches
an empty workspace as owner. Network access alone can never create an account.

**Independent Test**: [quickstart.md section 1](quickstart.md#1-install-and-create-the-owner-story-1)
on a clean stack.

### Tests for User Story 1

- [X] T023 [P] [US1] `server/tests/create-owner.test.ts`:
  - success creates exactly one user, organization, `owner` member, human actor, `owner.created` event, and a `claimed` installation;
  - `--json` output matches [operator-commands](contracts/operator-commands.md);
  - a second run exits 2 `owner_exists`;
  - invalid name or email exits 1;
  - storage down exits 3 and changes nothing;
  - a rerun after a run stopped before the final transaction finishes with one owner.
- [X] T024 [P] [US1] `server/tests/signup-closed.test.ts`: `POST /api/auth/sign-up/email` is refused before and after the owner exists, and creating an organization over HTTP is refused
- [X] T025 [P] [US1] `server/tests/status.test.ts`: `GET /api/status` returns `{ owner: false }`, then `{ owner: true }`, and 503 `storage_unavailable` when the database is down or the row is missing; `GET /api/health` returns 200 or 503; with the helpers `server/tests/helpers/server.ts` (the Express app on a random port) and `owner.ts` (an owner with a known password), which T024, T061, T062 and the later stories' server tests reuse
- [ ] T026 [P] [US1] `e2e/tests/us1-create-owner.spec.ts`: a fresh stack shows "no owner yet" with no form; run `create-owner --json` through `docker compose exec`; open the link; set the password; sign in; the home screen shows the workspace, name, email, and sign out only, with the shared set-password and sign-in steps in `e2e/tests/helpers/ui.ts`

### Implementation for User Story 1

- [X] T027 [US1] Implement `server/src/owner/create-owner.ts` per [data-model.md](data-model.md#creating-the-owner):
  - validate the name and email with the rules in `server/src/owner/rules.ts`;
  - stop with `owner_exists` if claimed;
  - sign up with a random password, or reuse an existing account for that email;
  - create or reuse the organization "&lt;name&gt;'s space";
  - in one transaction, create the actor and event (`server/src/actors.ts`) and claim the installation;
  - request the reset link through `createCommandAuth`.
- [X] T028 [US1] Implement `server/src/commands/create-owner.ts` (`util.parseArgs` for `--email`, `--name`, `--json`; human and JSON output; exit codes 0 to 4) with the shared output in `server/src/commands/output.ts` (T064), and the `server/bin/create-owner` wrapper
- [X] T029 [P] [US1] Implement `server/src/owner/routes.ts`: `GET /api/status` and `GET /api/health` per [http-api](contracts/http-api.md); register them in `server/src/app.ts`
- [X] T030 [P] [US1] Implement `web/src/pages/NoOwnerYet.tsx`: explains running `create-owner` and has no form
- [ ] T031 [US1] Implement `web/src/pages/ResetPassword.tsx`:
  - read the token from `location.hash`, then clear the hash;
  - collect the new password with native validation (12 to 128 characters);
  - post it with Better Auth `resetPassword`;
  - on success go to sign-in; on an invalid or expired link, explain how to get a new one with `reset-link`.
- [ ] T032 [US1] Implement `web/src/router.tsx` with routes `/sign-in`, `/`, and `/reset-password`; the root `beforeLoad` shows NoOwnerYet when there is no owner and ErrorState when storage is unavailable
- [ ] T033 [US1] Write `docs/install/README.md` sections for prerequisites, configuring this machine (`YS_PORT` and refused settings), starting the stack, `create-owner`, and setting the password (FR-001)

**Checkpoint**: User Story 1 works end to end on localhost, once T036 and T037 (Phase 4) and T049
(Phase 6) exist.

---

## Phase 4: User Story 2 - Sign In and Access the Workspace (Priority: P1)

**Goal**: The owner signs in and out from any device over HTTPS, and protected data needs a valid
session.

**Independent Test**: [quickstart.md section 2](quickstart.md#2-https-with-a-domain-story-1-scenario-9)
and [section 3](quickstart.md#3-sign-in-remote-access-sign-out-story-2).

### Tests for User Story 2

- [ ] T034 [P] [US2] `server/tests/session.test.ts`:
  - correct sign-in creates a session and a wrong password does not;
  - `get-session` without a cookie returns no session;
  - after sign-out, replaying the cookie fails;
  - an expired session fails;
  - with an `https` public address the cookie is `__Secure-`, `Secure`, and `HttpOnly`, with no `Domain` attribute;
  - in production mode the 4th sign-in within 10 seconds returns 429.
- [ ] T035 [P] [US2] `e2e/tests/us2-sign-in.spec.ts`: wrong password is refused; sign in reaches home; sign out returns to sign-in; a replayed session cookie is refused; a stopped server shows the "server unreachable" state, not an empty workspace

### Implementation for User Story 2

- [ ] T036 [P] [US2] Implement `web/src/pages/SignIn.tsx`: email and password with native validation, Better Auth `signIn.email`, and clear errors for wrong credentials and rate limiting
- [ ] T037 [P] [US2] Implement `web/src/pages/Home.tsx`: workspace name from `organization.list`, the owner's name and email, and sign out; nothing else (FR-027)
- [ ] T038 [US2] Extend `web/src/router.tsx`: the root `beforeLoad` sends signed-out visitors to `/sign-in` and signed-in visitors away from it; an expired session mid-use returns to sign-in without reporting success (FR-016)
- [ ] T067 [US2] Add the other setups: `deploy/modes/mode.domain.yaml` (ports 80 and 443 on every IPv4 address), `deploy/modes/mode.proxy.yaml` (`127.0.0.1:8080` and the `your-space_edge` network), and `deploy/modes/mode.domain.proxy.yaml` (stops Compose when both keys are set); the `YS_DOMAIN` and `YS_PROXY_URL` lines in `deploy/.env.example`; and their checks in `e2e/tests/setups.spec.ts` ([research R9](research.md#r9-https-and-the-caddy-configuration))
- [ ] T068 [US2] Pass visitors' addresses to the sign-in limit in `deploy/Caddyfile`: `X-Forwarded-For` set to `{client_ip}` on `/api/*`, and `trusted_proxies` (strict, `private_ranges`) on the `:8080` proxy listener only ([research R9](research.md#r9-https-and-the-caddy-configuration))
- [ ] T039 [US2] Add the remote-access sections to `docs/install/README.md`: the configure and start rows for `YS_DOMAIN` and `YS_PROXY_URL`, and which line opens which ports; your own domain, with certificate troubleshooting through `docker compose logs caddy`; your own proxy; and Tailscale (`tailscale serve` with `YS_PROXY_URL`), including proxies in containers through the `your-space_edge` network and the `Host` check, and why plain `http://<LAN IP>` is not supported (FR-028)
- [ ] T069 [US2] Add a Sign-In and Sessions section to `docs/install/README.md`: session lifetime, sign-out, the sign-in limit, password rules and hashing (scrypt with Better Auth defaults), and how links are stored (FR-009 to FR-011)

**Checkpoint**: User Stories 1 and 2 both work; a second device signs in over HTTPS.

---

## Phase 5: User Story 3 - Preserve the Workspace Across Restarts (Priority: P1)

**Goal**: Restarts and container recreation keep everything. A database outage shows "storage
unavailable" and never "no owner yet".

**Independent Test**: [quickstart.md section 4](quickstart.md#4-restart-and-recreate-story-3).

### Tests for User Story 3

- [ ] T040 [US3] `e2e/tests/us3-restart.spec.ts`:
  - after `docker compose restart` and after `down` then `up`, user, workspace, and membership IDs match and an existing session still works;
  - with Postgres stopped, the web shows "storage unavailable", `/api/status` returns 503, and `create-owner` exits 3;
  - after Postgres restarts, everything returns unchanged.
- [ ] T041 [P] [US3] `server/tests/migrations.test.ts`: a database at the first migration upgrades to a later test migration in place, records the new version in `drizzle.__drizzle_migrations`, and keeps all identities and claim state (cross-cutting scenario 8)

### Implementation for User Story 3

- [ ] T042 [US3] Make `server/src/owner/routes.ts` and `server/src/index.ts` keep serving 503 while the database is down and recover when it returns, without a restart
- [ ] T043 [US3] Add a retry action to the storage-unavailable state in `web/src/components/ErrorState.tsx` that refetches `/api/status`
- [ ] T044 [US3] Add a restart and storage section to `docs/install/README.md`: the named volumes, safe `restart` and `down`/`up`, a clear warning that `down -v` deletes the workspace, and recovery after a database outage

**Checkpoint**: All data survives restarts and recreation; outages are reported honestly.

---

## Phase 6: User Story 4 - Recover Owner Access (Priority: P1)

**Goal**: `reset-link` gives the operator a one-time link that resets the owner's password and signs
out every session, without email.

**Independent Test**: [quickstart.md section 5](quickstart.md#5-recover-the-owner-story-4).

### Tests for User Story 4

- [X] T045 [P] [US4] `server/tests/reset-link.test.ts`:
  - with no owner it exits 2 `no_owner`, and storage down exits 3;
  - the link resets the password once, and a second use fails;
  - an expired link fails;
  - all prior sessions are revoked;
  - user, workspace, membership, and ownership IDs are unchanged and the email stays unverified;
  - issuing a link alone changes nothing;
  - `recovery.link_issued` and `recovery.password_reset` events reference actors;
  - `POST /api/auth/request-password-reset` over HTTP is refused.
- [ ] T046 [P] [US4] `e2e/tests/us4-recover.spec.ts`: sign in on two browser contexts, run `reset-link`, set a new password through the link, both old sessions are signed out, the new password works and the old one does not

### Implementation for User Story 4

- [X] T047 [US4] Implement `server/src/recovery/reset-link.ts`: find the owner through the `owner` membership, call `requestPasswordReset` through `createCommandAuth`, and record `recovery.link_issued` against the operator actor
- [ ] T048 [US4] Implement `server/src/commands/reset-link.ts` (`--json`, exit codes 0 to 4) and the `server/bin/reset-link` wrapper
- [X] T049 [US4] Record `recovery.password_reset` against the owner's actor using Better Auth's `emailAndPassword.onPasswordReset` option in `server/src/auth.ts`
- [ ] T050 [US4] Add a recovery section to `docs/install/README.md`: running `reset-link`, link lifetime, and that using it signs out every device

**Checkpoint**: All four stories work independently.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Shared rules from the spec map, release evidence, and multi-architecture images.

- [ ] T051 [P] `server/tests/logs.test.ts` and an e2e log check in `e2e/tests/logs.spec.ts`: after exercising create-owner, sign-in, failures, and recovery, server and Caddy logs contain no passwords, tokens, set-password links, or session values (cross-cutting scenario 2)
- [ ] T052 [P] Add `.github/workflows/images.yml`: Docker Buildx with QEMU builds and publishes `your-space-server` and `your-space-web` for `linux/amd64` and `linux/arm64` to GitHub Container Registry; point `deploy/stack.yaml` at the published tags (FR-022)
- [ ] T070 Add a `release-files` job to `.github/workflows/images.yml` that attaches `your-space.tar.gz` (`compose.yaml`, `stack.yaml`, `modes/`, and `env.example`, with `stack.yaml` pinned to the release's image version) to each release, and the Download section of `docs/install/README.md` that fetches and unpacks it
- [X] T053 [P] Add an e2e job to `.github/workflows/ci.yml` that builds both images locally with `deploy/compose.build.yaml` (T020), starts `deploy/compose.yaml`, and runs Playwright in all three browsers
- [ ] T054 Capture outbound traffic while running quickstart sections 1, 3, and 5, and confirm the only outbound connections are certificate requests for a configured domain (cross-cutting scenario 5, SC-013); record the method and result in `docs/install/VERIFICATION.md`
- [ ] T055 Run [quickstart.md](quickstart.md) on an Apple Silicon Mac and an Intel/AMD Linux host with the published images, including HTTPS with a real domain and Tailscale, and record versions, environments, results, and limitations in `docs/install/VERIFICATION.md` (SC-010, SC-011)
- [ ] T056 Finish `docs/install/README.md`: list the supported hosts and browsers verified in T055 (FR-001)
- [ ] T057 Self-review and an independent review of the full diff against the constitution, spec, and plan; then confirm each delivered 001 roadmap item in `docs/roadmap.md` is checked with its date and the link to the pull request that verified it. The overview tree is never checked.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup. Blocks every user story.
- **User Story 1 (Phase 3)**: depends on Foundational. It is the MVP: without an owner, nothing
  else can be tested in a real browser.
- **User Stories 2 to 4 (Phases 4 to 6)**: depend on Foundational. Their browser tests need an owner
  from US1, created through `create-owner`. Their server tests can create an owner with the US1
  helper and otherwise run in parallel.
- **T061, T062 and T066**: the tests of T061 and T062 (`host.test.ts`, `outage.test.ts`) use the
  server and owner helpers from T025, which need `create-owner` (T027), and `outage.test.ts` also
  runs `reset-link` (T048); `secrets.spec.ts` (T066) runs `create-owner` through
  `docker compose exec` (T027, T028). Both server tests also call `/api/status` (T029). So the
  three tests pass once these files exist: T025's helpers, `create-owner.ts` (T027) and
  `owner/routes.ts` (T029), plus `recovery/reset-link.ts` and `commands/reset-link.ts` (T047,
  T048) for `outage.test.ts` and the `create-owner` command and wrapper (T028) for
  `secrets.spec.ts`, which also needs the running stack (see the Phase 2 checkpoint).
- **T032 and T026**: `router.tsx` imports `SignIn.tsx` (T036) and `Home.tsx` (T037), and the US1
  browser test signs in and reads the home screen. So T036 and T037 are built with US1, and Phase 4
  checks their US2 behavior (wrong password, rate limit, sign-out). The US1 browser test also
  expects the `recovery.password_reset` event recorded when the owner sets the password, which T049
  adds to `auth.ts`, so T049 is built with US1 too.
- **T040**: `us3-restart.spec.ts` also runs `reset-link` with Postgres stopped and expects exit 3,
  so it passes once `recovery/reset-link.ts` (T047) and the `reset-link` command and wrapper (T048)
  exist.
- **T046**: `us4-recover.spec.ts` opens `/` after the reset and expects `/sign-in`, the redirect for
  signed-out visitors that T038 adds to `router.tsx`, so it passes once T038 exists.
- **Polish (Phase 7)**: depends on all stories.

### Within Each Story

- Write the tests first and confirm they fail.
- Server logic, then the command or route, then web pages, then docs.

### Parallel Opportunities

- Setup: T003, T004, T005 together after T001 and T002.
- Foundational: T058 and T007 first (T006 imports `secrets.ts`, T008 imports `log.ts`); then T017, T018, T019, T022, T059, T063 together once T006 and T008 exist; T065 once T020 exists, and T066 once T017, T019, T020 and T064 exist; T016 once T012 and T013 exist (`helpers/db.ts` runs the migrations through `migrate.ts`); T021's `main.tsx` renders the router from T032, so it builds once T032's root route and T030's `NoOwnerYet.tsx` exist.
- US1: T025's `helpers/server.ts` and `helpers/owner.ts` first, since T024 imports them; then tests T023 to T026 together; T029 and T030 alongside T027 and T028; T036 and T037 before T032.
- US2: T034 and T035 together; T036 and T037 are already built with US1.
- US3 and US4 can be built in parallel after US1, except that T040's test needs T047 and T048, and T046's test needs T038 (US2).
- Polish: T051, T052, T053 together; T070 after T052, since it adds a job to `images.yml`.

## Parallel Example: User Story 1

```text
# First, the helpers that T024 imports:
Task: "T025 server/tests/helpers/server.ts and server/tests/helpers/owner.ts"

# Then the tests together:
Task: "T023 server/tests/create-owner.test.ts"
Task: "T024 server/tests/signup-closed.test.ts"
Task: "T025 server/tests/status.test.ts"
Task: "T026 e2e/tests/us1-create-owner.spec.ts"
```

## Implementation Strategy

### MVP First

1. Phases 1 and 2.
2. Phase 3 (US1), with T036, T037 and T049 (see Phase Dependencies).
3. Stop and validate quickstart section 1 on localhost.

### Then, in Order

US2 (sign-in), US3 (restarts), US4 (recovery), then Polish. The journey is delivered as a stack of
pull requests into `main`, per the
[decision record](../../docs/architecture/decisions.md#journey-based-specifications): the first
carries this specification with no task checked, and each later one adds one layer that passes its
own checks and checks only the tasks it verifies.
