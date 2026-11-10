# Verification Record: Workspace Setup and Owner Access

This records what was checked for [spec 001](../../specs/001-workspace-owner-access/spec.md), where,
with which versions, and what was not checked. The [installation guide](README.md) claims support only
for what is listed here as verified (SC-010).

**Date:** 2026-11-08 · **Branch:** `claude/001-9-record`

## Summary

| Check | Result |
| --- | --- |
| Server tests (Vitest, real PostgreSQL 18) | Pass: 163 tests in 11 files |
| Browser journeys, all four stories plus the log scan, against the Compose stack | Pass: 27 journeys in Chromium, Firefox, and WebKit |
| Setups and secrets against the Compose stack (run once, in Chromium) | Pass: 12 checks, on Compose 5.6.1; the setup and secrets checks also on 2.26.0 |
| The default setup reachable only from this machine | Pass: refused on the host's network address |
| No outbound requests on `localhost` (cross-cutting scenario 5, SC-013) | Pass: none observed |
| Only certificate requests with a domain configured | Pass: only the Let's Encrypt lookup observed |
| Logs hold no credentials (cross-cutting scenario 2) | Pass |
| Idle stack memory under 512 MB (plan constraint) | Pass: 237 MiB (about 250 MB) |
| Quickstart on an Apple Silicon Mac | **Not run** |
| Quickstart on a real Intel/AMD Linux host, HTTPS with a real domain, Tailscale | **Not run** |
| Published multi-architecture images (`images.yml`) | **Not run**: the workflow runs on GitHub after merge |
| IPv6 | **Not supported yet**; not run |

## Where It Ran

Every check below ran in one cloud development sandbox, not on a physical server:

| Component | Version |
| --- | --- |
| Host | Ubuntu 24.04.5 LTS container, Linux 6.18, x86_64 (Intel/AMD) |
| Docker | Docker Engine 29.9.2, Docker Compose v5.6.1; Compose v2.26.0 and older versions as the standalone binaries from Docker's `docker/compose-bin` images |
| Base images | `node:26-slim` (Node.js 26.13.0), `caddy:2.11` (Caddy 2.11.9), `postgres:18` (PostgreSQL 18.6) |
| Browsers | Playwright 1.64.1: Chromium 156.0.8078.4, Firefox 157.0, WebKit 27.2 |
| Libraries | Better Auth 1.7.18, Drizzle ORM 0.45.4, Express 5.3.0, React 19.3.1, Vite 8.3.6, TypeScript 7.0.2, Vitest 5.1.0 |

The images were built from this repository with `deploy/compose.build.yaml`. The sandbox reaches
the npm registry only through a TLS-inspecting proxy, so for the sandbox builds only, the
`node:26-slim` base image was replaced through a Buildx named context with a copy that trusts that
proxy's certificate. The Dockerfiles themselves were not changed, and those images were never
published.

## Automated Tests

```sh
npm ci
npm run typecheck
TEST_DATABASE_URL=postgres://... npm test        # PostgreSQL 18 from `docker run postgres:18`
npm run build
npm run e2e                                      # builds the images, then runs the journeys
```

The npm commands ran in `node:26-slim` (Node.js 26.13.0), and once more in a clean copy of the
branch the way the `check` job in `ci.yml` runs them. The journeys ran as `npx playwright test` in
`e2e/`, which is what `npm run e2e` runs, with the sandbox's build override passed to Compose
through `YS_E2E_COMPOSE`.

- **Server tests** (`server/tests/`): settings and generated secrets, owner creation and its reruns,
  closed sign-up, status and storage failure, the Host check, database outages, sessions and the
  sign-in limit, migrations, recovery, and log scanning.
- **Browser journeys** (`e2e/tests/`): User Stories 1 to 4 and a log scan, each against a fresh
  Compose stack, including `docker compose restart`, `down`/`up` recreation, a stopped database,
  and a stopped server.

Screenshots of each story step in each browser are in Argos, which CI uploads them to on every run,
and each CI run's `playwright-report` artifact holds a video of every journey.

## Each Setup Opens Only Its Own Ports

`e2e/tests/setups.spec.ts` reads each setup's resolved configuration with `docker compose config`
(Compose 5.6.1) and checks:

- the published ports: `127.0.0.1:80` with nothing in `.env`, `127.0.0.1:8081` with
  `YS_PORT=8081`, `0.0.0.0` ports 80, 443, and 443/udp with `YS_DOMAIN`, and `127.0.0.1:8080` with
  `YS_PROXY_URL`;
- that the server and the database publish nothing, and that only the proxy setup joins the edge
  network;
- that setting both keys stops Compose with a message.

The same checks, and the secrets checks below, pass on Compose 2.26.0, the oldest version the guide
names, run from Docker's official `docker/compose-bin:v2.26.0` image; CI runs the setup checks on
that version too. Older versions fail in two ways, checked the same way:

- 2.24.0 to 2.24.7 stop before they start anything: they don't know the `subpath` setting that
  gives PostgreSQL only its own folder of `ys-secrets` ("Additional property subpath is not
  allowed").
- 2.25 accepts the `subpath`, but ignores it when it runs the stack: it mounted all of `ys-secrets`
  in PostgreSQL. PostgreSQL then can't find its password and refuses to create a new database, so
  this fails safe, but 2.26.0 is the first version that works.

With a running stack and locally built images (2026-11-08):

- **This machine, with `YS_PORT=18291`:** only `127.0.0.1:18291` was published.
  `http://localhost:18291/api/status` answered 200, `http://127.0.0.1:18291/sign-in` redirected to
  `http://localhost:18291/sign-in`, and the same port on the host's network address was refused.
- **Your own proxy, with `YS_PROXY_URL=https://space.example.test` and `YS_PORT=18292`:** only
  `127.0.0.1:18292` was published. A request with `Host: space.example.test` answered 200; one with
  any other `Host` got 421 and the message saying to pass the original `Host` header. A container on the
  stack's edge network reached `http://your-space:8080`, with the same two answers.
- **A misspelled key (`YS_DOMIAN`) and `YS_DOMAIN=myserver.tail1234.ts.net`:** `docker compose up
  -d --wait` failed with "dependency failed to start: container ... is unhealthy", Caddy stayed
  `Created` with no published ports, and `docker compose logs server` named the fix ("Did you mean
  YS_DOMAIN?", "for Tailscale, write YS_PROXY_URL=https://… instead").

- **The default setup, with an empty `.env`:** `docker ps` showed Caddy published only on
  `127.0.0.1:80`. `curl http://localhost/api/status` answered 200, and the same request to the
  host's network address, with `Host: localhost`, was refused (connection refused).

## Secrets

`e2e/tests/secrets.spec.ts`, on Compose 5.6.1 and 2.26.0 (2026-11-08):

- **An empty `.env`:** the first start generated both secrets as 43-character base64url values.
  `show-secrets` reported each as generated, the `secrets` service's log noted `secrets.generated`
  without the values, and the browser journeys' log scan found neither value in any service's log.
- PostgreSQL's view of the volume held only its password file. The server got "Read-only file
  system" writing where it owns the files, and its environment had no generated value, so
  `docker inspect` can't show one.
- After `docker compose down` and `up`, both values were unchanged and the log noted `secrets.kept`.
- **A lost volume:** with `ys-secrets` deleted and the database kept, `docker compose up -d` failed,
  the `secrets` log named both missing secrets and pointed to the guide, and the server didn't
  start. The guide's "Lost Secrets" steps then brought it back with the same account and workspace.
- **Both secrets set in `.env`**, with a password containing `@ / # : % ? & =`: the stack started,
  `show-secrets` reported both as set in `.env`, and the volume held no copy. After the password in
  `.env` changed, the server stopped with "PostgreSQL refused the database password"; the guide's
  "Give PostgreSQL the Database Password" command, run from the test with the same text the guide
  prints (a test checks the two match), brought it back with the same workspace.

Server tests cover the rest: an empty line treated as no line, values with surrounding spaces and a
too-short auth secret refused, a leftover temporary file removed, the database detected in
PostgreSQL 18's layout and older ones, `--new` (including leaving a value set in `.env` alone), and
a password with URL characters percent-encoded into the database URL and decoded unchanged.

## Review

Independent reviewers checked the full diff against the constitution, spec, plan, and contracts
along six lines: security, owner creation and recovery, durability and storage, the web client,
deployment and docs, and tests. Every finding was reproduced or checked against library source
before it was fixed, and each fix has a regression test where one is possible. Fixes include:
keeping raw database errors (which can contain a reset token) out of logs; reporting sign-out as
failed when the session can't be deleted; surviving a lost database connection mid-transaction;
binding localhost mode to `127.0.0.1`; serializing `create-owner` runs; and closing unused
organization routes. Skeptic reviewers then confirmed the findings they checked were fixed.

## Outbound Traffic (Cross-Cutting Scenario 5, SC-013)

**Method.** `tcpdump` recorded two things against a fresh stack: every packet leaving the stack's
Docker network for any other address, and every DNS packet on the host (Docker's resolver forwards
containers' lookups from the host). Both captures started before any container did. With an empty
`.env`, a browser then ran quickstart sections 1, 3, and 5 (no owner yet, `create-owner`, set the
password, a wrong and a right sign-in, sign out, `reset-link`, reset, sign in) and logged every host
the page contacted.

**Result with an empty `.env`** (this machine, `http://localhost`): no packets left the stack's
network, there were no DNS lookups, and the web client contacted only `localhost`.

**Controls.** To show the capture would see traffic, the server container then tried
`fetch('https://example.com')`, which appeared as DNS lookups, and `fetch('http://192.0.2.10/')`,
which appeared as outgoing TCP connection attempts on the stack's network.

**Result with a domain** (`YS_DOMAIN=space.example.com`, which the server accepts but which can't
get a certificate here): the only outbound activity was Caddy looking up
`acme-v02.api.letsencrypt.org`, the Let's Encrypt certificate authority. Plain HTTP to the domain
returned `308` to `https://`, nothing was served over HTTPS without a certificate (no fallback to
plain HTTP), and `docker compose logs caddy` named the failure (`could not get certificate from
issuer ... will retry`).

**Limitation.** The sandbox can't resolve or reach Let's Encrypt, so the domain run shows what Caddy
tries to contact, not a completed certificate exchange.

## Not Verified

These are required before the guide can claim them. They need real machines and a real domain:

- **Apple Silicon (ARM) and a physical Intel/AMD Linux host** (FR-022, SC-011). Only the x86_64
  sandbox above was used. The ARM image is built by `.github/workflows/images.yml` with QEMU, but no
  ARM image has been run.
- **macOS 15 and 26 with Docker Desktop, Debian 13** (plan, research R15): not run.
- **HTTPS with a real domain**: obtaining and renewing a Let's Encrypt certificate (User Story 1,
  scenario 9; SC-009).
- **Another device over HTTPS** (User Story 2, scenario 6): through the built-in proxy, your own
  proxy, or Tailscale (`tailscale serve`). The own-proxy setup was checked with `curl` and a
  container on the edge network standing in for a proxy, not with nginx, Traefik, or Tailscale.
- **Branded browsers**: Chrome, Edge, and Safari (including iOS) were not run; Playwright's
  Chromium, Firefox, and WebKit builds stand in for their engines.
- **Downloading `your-space.tar.gz` from a release**: no release exists yet. The workflow step that
  builds it and pins `stack.yaml` to the release's image version was run locally with a pretend tag,
  and the unpacked files resolved with `docker compose config`.
- **IPv6**: not supported yet. Your own domain is published on `0.0.0.0` (IPv4) only, because a
  literal `[::]` fails on hosts without IPv6, so the guide says not to add an `AAAA` record.
- **Docker Desktop's networking**: whether Your Space sees each visitor's own address there (which
  the per-address sign-in limit relies on) has not been checked.
