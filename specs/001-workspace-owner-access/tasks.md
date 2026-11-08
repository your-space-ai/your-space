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

- [X] T001 Create root `package.json` with npm workspaces `server`, `web`, `e2e`, plus root `tsconfig.base.json` (TypeScript 7, `strict`, `erasableSyntaxOnly`, `rewriteRelativeImportExtensions`) and `.gitignore` (`node_modules`, `dist`, `.env`)
- [X] T002 Create `server/package.json` (Node 26, `"type": "module"`) with runtime dependencies `express`, `better-auth`, `drizzle-orm`, `pg`, and dev dependencies `drizzle-kit`, `vitest`, `@types/express`, `@types/pg`, plus `server/tsconfig.json`
- [X] T003 [P] Create the Vite React app in `web/` (`web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`) with `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`, `better-auth`
- [X] T004 [P] Create `e2e/package.json` and `e2e/playwright.config.ts` with Chromium, Firefox, and WebKit projects and a base URL of `http://localhost` (`YS_PORT` moves it)
- [X] T005 [P] Add `.github/workflows/ci.yml`: install, `tsc --noEmit` in every workspace, server tests with a PostgreSQL 18 service container, web build

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Configuration, database, Better Auth, the HTTP app, and the Compose stack. Every story
depends on these.

- [X] T006 Implement `server/src/config.ts`: derive the setup and public address from the optional `YS_DOMAIN`, `YS_PROXY_URL`, and `YS_PORT` ([research R9](research.md#r9-https-and-the-caddy-configuration)), refuse unknown and retired `YS_*` keys, read the auth secret and database password from `.env` or the `ys-secrets` volume ([research R16](research.md#r16-platform-secrets)), and validate them and `DATABASE_URL` at startup; exit with a clear message when one is missing or malformed
- [X] T007 [P] Implement `server/src/log.ts`: one JSON line per event to stdout, never including request bodies, cookies, `Authorization` headers, passwords, or tokens
- [X] T008 Implement `server/src/db/client.ts`: a `pg` pool and Drizzle instance from `DATABASE_URL`, with a pool `error` handler so losing the database never crashes the process
- [X] T009 Implement `server/src/auth.ts` with one shared options builder ([research R3, R4](research.md#r3-authentication-with-better-auth)):
  - `emailAndPassword` with `disableSignUp`, `minPasswordLength: 12`, `maxPasswordLength: 128`, `autoSignIn: false`, `revokeSessionsOnPasswordReset: true`, `resetPasswordTokenExpiresIn: 1800`
  - `baseURL` from the derived public address, `advanced.database.generateId: "uuid"`, `telemetry: { enabled: false }`
  - `organization({ allowUserToCreateOrganization: false })`, and the Drizzle adapter
  - export `auth`, the public instance with sign-up off and no `sendResetPassword`
  - export `createCommandAuth(onLink)`, the command-only instance with sign-up on and `sendResetPassword` calling `onLink`
- [X] T010 Generate `server/src/db/auth-schema.ts` with `npx auth@latest generate` from `server/src/auth.ts`
- [X] T011 Define `installation`, `actor`, and `event` in `server/src/db/schema.ts` per [data-model.md](data-model.md): single-row check on `installation`, a `claimed` row requires `workspace_id` and `claimed_at`, `workspace_id` references `organization.id` `on delete restrict`
- [X] T012 Add `server/drizzle.config.ts`, generate the first migration into `server/drizzle/`, and append inserts for the `installation` row (`state = 'unclaimed'`) and the `operator` actor
- [X] T013 Implement `server/src/migrate.ts` (`drizzle-orm` `migrate()` under a PostgreSQL advisory lock, logging old and new schema versions) and `server/src/index.ts` (validate config, migrate, then listen on port 3000)
- [X] T014 Implement `server/src/app.ts`: Express 5 with `trust proxy` set to 1 hop, Better Auth via `toNodeHandler(auth)` at `/api/auth/*splat` mounted before `express.json()`, then JSON routes, and an error handler that returns `{ error, message }` without stack traces
- [X] T015 Implement `server/src/owner/installation.ts`: read the `installation` row and return `claimed` or `unclaimed`, or throw `StorageUnavailable` when the query fails or the row is missing ([research R10](research.md#r10-storage-unavailable-handling-fr-013))
- [X] T016 [P] Add `server/tests/helpers/db.ts`: create a fresh database per test file, run migrations, and expose helpers to stop and restore the connection
- [X] T017 [P] Add `server/Dockerfile` (`node:26-slim`, production dependencies, `bin/` on `PATH`, `CMD ["node", "src/index.ts"]`)
- [X] T018 [P] Add `deploy/Caddyfile`:
  - site address `{$YS_SITE}` from the mode file, with `encode`, and `http://127.0.0.1` redirecting to the public address
  - `/api/*` to `server:3000`, with `X-Forwarded-For` set to `{client_ip}`
  - the web files served with `try_files {path} /index.html`
  - no access log, and `trusted_proxies` (strict, `private_ranges`) on the `:8080` proxy listener only
- [X] T019 [P] Add `web/Dockerfile`: build with Vite, then `caddy:2.11` with `dist/` and `deploy/Caddyfile`
- [X] T020 Add `deploy/compose.yaml`, `deploy/stack.yaml`, `deploy/modes/`, and `deploy/.env.example`:
  - services `caddy` (web image), `server`, and `postgres:18`;
  - named volumes `ys-postgres` (mounted at `/var/lib/postgresql`) and `ys-caddy-data`;
  - one mode file per setup, picked by which of `YS_DOMAIN` and `YS_PROXY_URL` is set, with literal port addresses ([research R9](research.md#r9-https-and-the-caddy-configuration));
  - a one-shot `secrets` service that generates the auth secret and database password into the `ys-secrets` volume unless `.env` sets them, and `show-secrets` ([research R16](research.md#r16-platform-secrets));
  - health checks: `pg_isready` and `/api/health`;
  - `server` starts after Postgres is healthy, and `caddy` after the server is healthy.
- [X] T021 [P] Implement `web/src/auth-client.ts` (Better Auth `createAuthClient` with `organizationClient`), `web/src/queries.ts` (TanStack Query hooks for `/api/status`, the session, and the workspace that unwrap `{ data, error }`), and `web/src/main.tsx` (QueryClient and RouterProvider)
- [X] T022 [P] Implement `web/src/components/ErrorState.tsx` (storage unavailable, server unreachable, session expired, each with a next step) and `web/src/styles.css` (plain CSS)

**Checkpoint**: `docker compose up` starts all three services healthy, and migrations apply.

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
- [X] T025 [P] [US1] `server/tests/status.test.ts`: `GET /api/status` returns `{ owner: false }`, then `{ owner: true }`, and 503 `storage_unavailable` when the database is down or the row is missing; `GET /api/health` returns 200 or 503
- [X] T026 [P] [US1] `e2e/tests/us1-create-owner.spec.ts`: a fresh stack shows "no owner yet" with no form; run `create-owner --json` through `docker compose exec`; open the link; set the password; sign in; the home screen shows the workspace, name, email, and sign out only

### Implementation for User Story 1

- [X] T027 [US1] Implement `server/src/owner/create-owner.ts` per [data-model.md](data-model.md#creating-the-owner):
  - validate the name and email;
  - stop with `owner_exists` if claimed;
  - sign up with a random password, or reuse an existing account for that email;
  - create or reuse the organization "&lt;name&gt;'s space";
  - in one transaction, create the actor and event and claim the installation;
  - request the reset link through `createCommandAuth`.
- [X] T028 [US1] Implement `server/src/commands/create-owner.ts` (`util.parseArgs` for `--email`, `--name`, `--json`; human and JSON output; exit codes 0 to 4) and the `server/bin/create-owner` wrapper
- [X] T029 [P] [US1] Implement `server/src/owner/routes.ts`: `GET /api/status` and `GET /api/health` per [http-api](contracts/http-api.md); register them in `server/src/app.ts`
- [X] T030 [P] [US1] Implement `web/src/pages/NoOwnerYet.tsx`: explains running `create-owner` and has no form
- [X] T031 [US1] Implement `web/src/pages/ResetPassword.tsx`:
  - read the token from `location.hash`, then clear the hash;
  - collect the new password with native validation (12 to 128 characters);
  - post it with Better Auth `resetPassword`;
  - on success go to sign-in; on an invalid or expired link, explain how to get a new one with `reset-link`.
- [X] T032 [US1] Implement `web/src/router.tsx` with routes `/sign-in`, `/`, and `/reset-password`; the root `beforeLoad` shows NoOwnerYet when there is no owner and ErrorState when storage is unavailable
- [X] T033 [US1] Write `docs/install/README.md` sections for prerequisites, download and `.env` (the one-line setups from [research R9](research.md#r9-https-and-the-caddy-configuration)), starting the stack, `create-owner`, setting the password, and certificate troubleshooting with `docker compose logs caddy` (FR-001, FR-028)

**Checkpoint**: User Story 1 works end to end on localhost, and on a domain with automatic HTTPS.

---

## Phase 4: User Story 2 - Sign In and Access the Workspace (Priority: P1)

**Goal**: The owner signs in and out from any device over HTTPS, and protected data needs a valid
session.

**Independent Test**: [quickstart.md section 3](quickstart.md#3-sign-in-remote-access-sign-out-story-2).

### Tests for User Story 2

- [X] T034 [P] [US2] `server/tests/session.test.ts`:
  - correct sign-in creates a session and a wrong password does not;
  - `get-session` without a cookie returns no session;
  - after sign-out, replaying the cookie fails;
  - an expired session fails;
  - with an `https` public address the cookie is `__Secure-`, `Secure`, and `HttpOnly`, with no `Domain` attribute;
  - in production mode the 4th sign-in within 10 seconds returns 429.
- [X] T035 [P] [US2] `e2e/tests/us2-sign-in.spec.ts`: wrong password is refused; sign in reaches home; sign out returns to sign-in; a replayed session cookie is refused; a stopped server shows the "server unreachable" state, not an empty workspace

### Implementation for User Story 2

- [X] T036 [P] [US2] Implement `web/src/pages/SignIn.tsx`: email and password with native validation, Better Auth `signIn.email`, and clear errors for wrong credentials and rate limiting
- [X] T037 [P] [US2] Implement `web/src/pages/Home.tsx`: workspace name from `organization.list`, the owner's name and email, and sign out; nothing else (FR-027)
- [X] T038 [US2] Extend `web/src/router.tsx`: the root `beforeLoad` sends signed-out visitors to `/sign-in` and signed-in visitors away from it; an expired session mid-use returns to sign-in without reporting success (FR-016)
- [X] T039 [US2] Add a remote-access section to `docs/install/README.md`: your own domain, your own proxy, and Tailscale (`tailscale serve` with `YS_PROXY_URL`), including proxies in containers through the `your-space_edge` network and the `Host` check, and why plain `http://<LAN IP>` is not supported

**Checkpoint**: User Stories 1 and 2 both work; a second device signs in over HTTPS.

---

## Phase 5: User Story 3 - Preserve the Workspace Across Restarts (Priority: P1)

**Goal**: Restarts and container recreation keep everything. A database outage shows "storage
unavailable" and never "no owner yet".

**Independent Test**: [quickstart.md section 4](quickstart.md#4-restart-and-recreate-story-3).

### Tests for User Story 3

- [X] T040 [P] [US3] `e2e/tests/us3-restart.spec.ts`:
  - after `docker compose restart` and after `down` then `up`, user, workspace, and membership IDs match and an existing session still works;
  - with Postgres stopped, the web shows "storage unavailable", `/api/status` returns 503, and `create-owner` exits 3;
  - after Postgres restarts, everything returns unchanged.
- [X] T041 [P] [US3] `server/tests/migrations.test.ts`: a database at the first migration upgrades to a later test migration in place, records the new version in `drizzle.__drizzle_migrations`, and keeps all identities and claim state (cross-cutting scenario 8)

### Implementation for User Story 3

- [X] T042 [US3] Make `server/src/owner/routes.ts` and `server/src/index.ts` keep serving 503 while the database is down and recover when it returns, without a restart
- [X] T043 [US3] Add a retry action to the storage-unavailable state in `web/src/components/ErrorState.tsx` that refetches `/api/status`
- [X] T044 [US3] Add a restart and storage section to `docs/install/README.md`: the named volumes, safe `restart` and `down`/`up`, a clear warning that `down -v` deletes the workspace, and recovery after a database outage

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
- [X] T046 [P] [US4] `e2e/tests/us4-recover.spec.ts`: sign in on two browser contexts, run `reset-link`, set a new password through the link, both old sessions are signed out, the new password works and the old one does not

### Implementation for User Story 4

- [X] T047 [US4] Implement `server/src/recovery/reset-link.ts`: find the owner through the `owner` membership, call `requestPasswordReset` through `createCommandAuth`, and record `recovery.link_issued` against the operator actor
- [X] T048 [US4] Implement `server/src/commands/reset-link.ts` (`--json`, exit codes 0 to 4) and the `server/bin/reset-link` wrapper
- [X] T049 [US4] Record `recovery.password_reset` against the owner's actor using Better Auth's `emailAndPassword.onPasswordReset` option in `server/src/auth.ts`
- [X] T050 [US4] Add a recovery section to `docs/install/README.md`: running `reset-link`, link lifetime, and that using it signs out every device

**Checkpoint**: All four stories work independently.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Shared rules from the spec map, release evidence, and multi-architecture images.

- [X] T051 [P] `server/tests/logs.test.ts` and an e2e log check in `e2e/tests/logs.spec.ts`: after exercising create-owner, sign-in, failures, and recovery, server and Caddy logs contain no passwords, tokens, set-password links, or session values (cross-cutting scenario 2)
- [ ] T052 [P] Add `.github/workflows/images.yml`: Docker Buildx with QEMU builds and publishes `your-space-server` and `your-space-web` for `linux/amd64` and `linux/arm64` to GitHub Container Registry; point `deploy/compose.yaml` at the published tags (FR-022)
- [X] T053 [P] Add an e2e job to `.github/workflows/ci.yml` that builds the images, starts `deploy/compose.yaml`, and runs Playwright in all three browsers
- [X] T054 Capture outbound traffic while running quickstart sections 1, 3, and 5, and confirm the only outbound connections are certificate requests for a configured domain (cross-cutting scenario 5, SC-013); record the method and result in `docs/install/VERIFICATION.md`
- [ ] T055 Run [quickstart.md](quickstart.md) on an Apple Silicon Mac and an Intel/AMD Linux host with the published images, including HTTPS with a real domain and Tailscale, and record versions, environments, results, and limitations in `docs/install/VERIFICATION.md` (SC-010, SC-011)
- [ ] T056 Finish `docs/install/README.md`: the supported hosts and browsers verified in T055, password rules and hashing (scrypt with Better Auth defaults), sign-in limits, and session lifetime (FR-001, FR-010, FR-011)
- [X] T057 Self-review and an independent review of the full diff against the constitution, spec, and plan; then check off the delivered 001 roadmap items in `docs/roadmap.md` and the overview tree, each with the PR #3 link

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
- **Polish (Phase 7)**: depends on all stories.

### Within Each Story

- Write the tests first and confirm they fail.
- Server logic, then the command or route, then web pages, then docs.

### Parallel Opportunities

- Setup: T003, T004, T005 together after T001 and T002.
- Foundational: T007, T016, T017, T018, T019, T021, T022 together once T006 and T008 exist.
- US1: tests T023 to T026 together; T029 and T030 alongside T027 and T028.
- US2: T034, T035, T036, T037 together.
- US3 and US4 can be built in parallel after US1.
- Polish: T051, T052, T053 together.

## Parallel Example: User Story 1

```text
Task: "T023 server/tests/create-owner.test.ts"
Task: "T024 server/tests/signup-closed.test.ts"
Task: "T025 server/tests/status.test.ts"
Task: "T026 e2e/tests/us1-create-owner.spec.ts"
```

## Implementation Strategy

### MVP First

1. Phases 1 and 2.
2. Phase 3 (US1).
3. Stop and validate quickstart section 1 on localhost and with a domain.

### Then, in Order

US2 (sign-in), US3 (restarts), US4 (recovery), then Polish. Everything lands in PR #3 together with
the spec and plan, per the one-PR-per-journey rule in the
[decision record](../../docs/architecture/decisions.md#journey-based-specifications).
