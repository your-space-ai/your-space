# Implementation Plan: Workspace Setup and Owner Access

**Branch**: `001-workspace-owner-access` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-workspace-owner-access/spec.md`

**Note**: This template is filled in by the `$speckit-plan` command; its definition describes the execution workflow.

## Summary

The operator installs Your Space with Docker Compose and runs `create-owner` on the server with a
name and email. That creates the owner account, one workspace, and the owner membership, and prints
a single-use link where the owner sets their password. The owner signs in over HTTPS from any
device, sessions survive restarts, and `reset-link` prints a new link if the password is lost.
Sign-up is always off; there is no setup page.

The stack is three containers, after a one-shot step:

- **secrets** runs first on each start and exits. It generates the auth secret and database
  password into the `ys-secrets` volume unless `.env` sets them ([R16](research.md#r16-platform-secrets)).
- **Caddy** handles HTTPS and serves the web client.
- **The Node.js/Express server** is the API.
- **PostgreSQL** stores all state.

Better Auth supplies accounts, sessions, password hashing, and password reset. Its
organization plugin supplies the workspace, membership, and owner role. Custom code is limited to
the operator commands (`create-owner`, `reset-link`, `show-secrets`), the secrets step, a status
endpoint, and a small actor and event record.

## Technical Context

**Language/Version**: TypeScript 7 on Node.js 26 LTS. The server runs `.ts` files directly through
Node's stable type stripping, so it has no build step ([R1](research.md#r1-runtime-and-language-versions)).
The web client is built by Vite 8.

**Primary Dependencies**:

| Area | Dependency (license) | What it provides here |
| --- | --- | --- |
| Server | Express 5 (MIT) | HTTP routing for the API |
| Auth | Better Auth 1.7 (MIT) with its organization plugin | Accounts, scrypt hashing, sessions, host-only cookies, password reset, workspace, membership, owner role |
| Database | Drizzle ORM 0.45 (Apache-2.0), `pg` 8 (MIT) | Queries, schema, runtime migrations |
| Web | React 19, Vite 8, TanStack Router 1, TanStack Query 5 (all MIT) | UI, build, routes with redirects, server state |
| Proxy | Caddy 2.11 (Apache-2.0) | Automatic HTTPS, static files, routing `/api` |
| Dev only | Drizzle Kit, Better Auth CLI (`auth`), TypeScript, Vitest 5, Playwright 1.64 | Migrations, schema generation, type checks, tests |

That is 8 runtime npm packages: `express`, `better-auth`, `drizzle-orm`, and `pg` on the server, and
`react`, `react-dom`, `@tanstack/react-router`, and `@tanstack/react-query` in the web client.
Caddy and PostgreSQL ship as their official images. The decision record already selects Express,
Better Auth, Drizzle, PostgreSQL, React, Vite, and Caddy; this plan adds TanStack Router and
TanStack Query ([R12](research.md#r12-web-client)).

**Storage**: PostgreSQL 18 (official image) on the `ys-postgres` named volume. Caddy's certificates
are on the `ys-caddy-data` named volume, and the generated auth secret and database password on
`ys-secrets` ([R16](research.md#r16-platform-secrets)). Nothing durable lives in a container
filesystem (FR-023).
The tables are in [data-model.md](data-model.md).

**Testing**:

- Vitest server tests run against a real PostgreSQL. They cover owner creation and its reruns,
  storage failure, closed sign-up, and log scanning for secrets.
- Playwright runs the four stories in Chromium, Firefox, and WebKit against the full Compose stack,
  including restart and recreation.
- [quickstart.md](quickstart.md) is the manual check on real hosts.

**Target Platform**:

- Server hosts: macOS 15 and 26 with Docker Desktop, and Ubuntu 24.04 LTS and Debian 13 with Docker
  Engine 28.3.3 or newer (CVE-2025-54388) and Docker Compose 2.26.0 or newer. Each runs on ARM and
  Intel/AMD.
- Browsers: the current and previous versions of Chrome, Edge, Firefox, and Safari, including iOS.

Only verified combinations are claimed in the guide ([R15](research.md#r15-supported-hosts-and-browsers)).

**Project Type**: Web service with a single-page web client, shipped as a Docker Compose stack.

**Performance Goals**:

- The web client's first screen is interactive within 2 seconds on a local network.
- API responses take under 200 ms at the 95th percentile, except password hashing.

**Constraints**:

- The idle stack uses under 512 MB of memory, so it fits small servers and laptops.
- No outbound requests except ACME certificate requests (FR-026).
- Plain HTTP only on localhost.
- No secrets in logs.

**Scale/Scope**: one installation, one owner, one workspace, and 3 screens (sign-in, home, set or
reset password), plus the "no owner yet" and error states.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this plan meets it |
| --- | --- | --- |
| I. Platform and apps independent | Pass | No app code. The host-only session cookie keeps the platform session away from future app origins (FR-021). |
| II. User control and hosting choice | Pass | Self-hosted Compose with a guide. Server-managed accounts with no external identity service. Recovery works without email. |
| III. Identity, permissions, ownership explicit | Pass | Account, workspace, membership, and ownership are separate tables or roles. Actions are credited to an `actor`. Denied requests change nothing. |
| IV. Apps directly installable | N/A | No apps in this feature (spec 002). |
| V. Protect private data | Pass | The auth secret and database password come from `.env` when set there, otherwise they are generated into the `ys-secrets` volume, outside the database (R16). Passwords are stored as Better Auth scrypt hashes, and link tokens only as SHA-256 hashes (`verification.storeIdentifier`). Logs exclude credentials. Tests use synthetic data. |
| VI. Proportionate discipline | Pass | Auth, owner creation, and data-integrity behavior gets automated tests plus the quickstart run on real hosts. Rationale is recorded in research.md. |
| VII. Reuse before building | Pass | Each requirement maps to a library feature (below). The custom code is listed and justified. No new dependency beyond the decision record and the TanStack libraries this plan selects. |

**Post-design re-check (after Phase 1)**: Pass. The design added no dependencies.

Two Better Auth details shaped the design:

- `disableSignUp` also blocks server-side sign-up, so `create-owner` uses its own instance with
  sign-up on ([R4](research.md#r4-owner-first-then-invite-only)).
- Better Auth's reset link puts the token in the URL path and query, so the link puts it in the URL
  fragment instead ([R8](research.md#r8-owner-recovery-link)).

Both use only documented options. Nothing sits in front of Better Auth and no hooks are added.

### Requirement to Library Feature (principle VII)

| Requirement | Native feature used |
| --- | --- |
| FR-003 account rules | Better Auth `minPasswordLength`/`maxPasswordLength` + HTML form validation |
| FR-002, FR-003 owner from a server command; first password | `auth.api.signUpEmail` in the command's own instance; Better Auth reset flow for the first password |
| FR-004 owner, workspace, membership | `auth.api.signUpEmail`; organization plugin `auth.api.createOrganization` (creator gets `owner`) |
| FR-005 closed registration | Better Auth `disableSignUp`; organization plugin `allowUserToCreateOrganization: false` |
| FR-006, FR-008 one auth system, sign-in/out | Better Auth email and password, sessions |
| FR-009 expiry, revocation, durable sessions | Better Auth database sessions (7 days, refreshed daily), sign-out deletes the row |
| FR-010 password hashing | Better Auth scrypt (N=16384, r=16, p=1, 64-byte key, 16-byte salt) |
| FR-011 attempt limits | Better Auth's built-in sign-in limits (defaults); set-password and reset tokens are too long to guess |
| FR-012, FR-023 durability | PostgreSQL on a named volume; Caddy data volume; generated secrets volume |
| FR-015, FR-021 HTTPS-only remote cookies, host-only | Better Auth cookie defaults with an `https` `baseURL` |
| FR-017 to FR-019 recovery | `auth.api.requestPasswordReset`, `sendResetPassword`, single-use tokens, `revokeSessionsOnPasswordReset` |
| FR-022 ARM and Intel images | Docker Buildx multi-platform builds |
| FR-024 schema version | Drizzle Kit migrations, `drizzle-orm` `migrate()`, `__drizzle_migrations` |
| FR-028 HTTPS | Caddy automatic HTTPS and HTTP→HTTPS redirect |
| Web routing and redirects | TanStack Router `beforeLoad` |
| Web server state and errors | TanStack Query wrapping Better Auth's React client |

### Custom Code and Why No Library Covers It

| Custom code | Size | Why it is needed |
| --- | --- | --- |
| `create-owner` command | Small | Creates the owner from the server, the only authority that can't be hijacked over the network (FR-002 to FR-004). Calls Better Auth and the organization plugin, writes the actor and event, and prints the link. [R5](research.md#r5-creating-the-owner-with-a-server-command) |
| Status and health endpoints | Small | Tells "no owner yet" apart from "storage down" (FR-013). |
| `reset-link` command | Small | Thin glue: finds the owner, calls `requestPasswordReset`, prints the link (FR-017). |
| `actor` and `event` tables | Small | Credits actions to a non-human-specific actor (FR-025). The full activity log is spec 005. |
| JSON log helper | Tiny | One line per event, with no request bodies or credentials. |

## Project Structure

### Documentation (this feature)

```text
specs/001-workspace-owner-access/
├── spec.md
├── plan.md                    # This file
├── research.md                # Phase 0: decisions and verified library behavior
├── data-model.md              # Phase 1: tables and owner creation
├── quickstart.md              # Phase 1: end-to-end validation on real hosts
├── contracts/
│   ├── http-api.md            # Custom endpoints and the Better Auth routes used
│   └── operator-commands.md   # create-owner and reset-link: output and exit codes
├── checklists/requirements.md
└── tasks.md                   # Phase 2 ($speckit-tasks): 70 tasks by user story
```

### Source Code (repository root)

```text
package.json                 # npm workspaces: server, web, e2e
server/
├── Dockerfile               # node:26-slim; runs src/index.ts directly
├── drizzle.config.ts
├── drizzle/                 # generated SQL migrations (committed)
├── bin/                     # create-owner, reset-link (on PATH in the image)
├── src/
│   ├── index.ts             # start: migrate, then listen
│   ├── app.ts               # Express app: Better Auth handler, then JSON routes
│   ├── config.ts            # environment variables, validated at startup
│   ├── auth.ts              # Better Auth config: public instance + server-only instance
│   ├── db/
│   │   ├── client.ts
│   │   ├── auth-schema.ts   # generated by the Better Auth CLI
│   │   └── schema.ts        # installation, actor, event
│   ├── owner/               # create-owner logic and the status endpoint
│   ├── recovery/            # reset-link logic
│   ├── commands/            # CLI entry points for bin/
│   └── log.ts
└── tests/                   # Vitest, against real PostgreSQL
web/
├── Dockerfile               # builds with Vite, then caddy:2.11 + dist + Caddyfile
├── index.html
└── src/
    ├── main.tsx
    ├── router.tsx           # 3 routes, beforeLoad redirects
    ├── auth-client.ts       # Better Auth React client + organizationClient
    ├── queries.ts           # TanStack Query: status, session, workspace
    ├── pages/               # NoOwnerYet, SignIn, Home, ResetPassword
    ├── components/          # ErrorState, Form fields
    └── styles.css
e2e/                         # Playwright journeys against the Compose stack
deploy/
├── compose.yaml             # includes stack.yaml and the mode file picked by .env (R9)
├── stack.yaml               # secrets step, caddy (web image), server, postgres; named volumes
├── modes/                   # one file per setup, with its port addresses written out
├── Caddyfile                # copied into the web image
└── .env.example             # every line optional: YS_DOMAIN, YS_PROXY_URL, YS_PORT, the two secrets
docs/install/                # the installation guide (FR-001)
.github/workflows/           # typecheck, tests, multi-arch image publishing
```

**Structure Decision**: one repository with npm workspaces for `server`, `web`, and `e2e`, and two
published images ([R2](research.md#r2-repository-layout-and-packaging)). The CLI (spec 003),
desktop app (spec 008), and SDKs (spec 002) will be added as further workspaces.

## Settled Values

These are the exact settings the spec left to the plan.

| Setting | Value |
| --- | --- |
| Password | 12 to 128 characters; scrypt N=16384, r=16, p=1 |
| Name / email | 1 to 100 characters / valid address up to 254 characters, stored lowercase |
| Session | 7 days, extended daily while used; database-backed; no cookie cache |
| Owner creation | `create-owner --email --name`; prints a set-password link (30 minutes, single use) |
| Reset link | 30 minutes, single use, token in the URL fragment, revokes all sessions |
| Sign-in limit | Better Auth default: 3 attempts per 10 seconds per IP |
| Sign-up | Always off; new people join by owner invitation (spec 004) |
| Operator commands | human text by default, `--json` for scripts, exit codes 0 to 4 ([contract](contracts/operator-commands.md)) |
| Remote HTTPS paths | Caddy with your domain; your own proxy; Tailscale `serve` |

## Complexity Tracking

No constitution violations to justify.
