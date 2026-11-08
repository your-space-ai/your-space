# Verification Record: Workspace Setup and Owner Access

This records what was checked for [spec 001](../../specs/001-workspace-owner-access/spec.md), where,
with which versions, and what was not checked. The [installation guide](README.md) claims support only
for what is listed here as verified (SC-010).

**Date:** 2026-11-07 · **Branch:** `claude/001-implementation`

## Summary

| Check | Result |
| --- | --- |
| Server tests (Vitest, real PostgreSQL 18) | Pass: 88 tests in 9 files |
| Browser journeys, all four stories plus the log scan, against the Compose stack | Pass: 27 journeys in Chromium, Firefox, and WebKit |
| The same checks in GitHub Actions (`ci.yml`, ubuntu-24.04) | Pass: [run 2](https://github.com/your-space-ai/your-space/actions/runs/42418561251) |
| Localhost mode reachable only from this machine | Pass: refused on the host's network address |
| No outbound requests on `localhost` (cross-cutting scenario 5, SC-013) | Pass: none observed |
| Only certificate requests with a domain configured | Pass: only the Let's Encrypt lookup observed |
| Logs hold no credentials (cross-cutting scenario 2) | Pass |
| Idle stack memory under 512 MB (plan constraint) | Pass: about 245 MB |
| Quickstart on an Apple Silicon Mac | **Not run** |
| Quickstart on a real Intel/AMD Linux host, HTTPS with a real domain, Tailscale | **Not run** |
| Published multi-architecture images (`images.yml`) | **Not run**: the workflow runs on GitHub after merge |
| IPv6 | **Not supported yet**; not run |

## Where It Ran

Every check below ran in one cloud development sandbox, not on a physical server:

| Component | Version |
| --- | --- |
| Host | Ubuntu 24.04.5 LTS container, Linux 6.18, x86_64 (Intel/AMD) |
| Docker | Docker Engine 29.9.2, Docker Compose v5.6.1 |
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

- **Server tests** (`server/tests/`): owner creation and its reruns, closed sign-up, status and
  storage failure, sessions and the sign-in limit, migrations, recovery, and log scanning.
- **Browser journeys** (`e2e/tests/`): User Stories 1 to 4 and a log scan, each against a fresh
  Compose stack, including `docker compose restart`, `down`/`up` recreation, a stopped database,
  and a stopped server.

Screenshots of each story in each browser, and a video walking through all four stories, are kept on
the `evidence/claude/001-implementation` branch, which is never merged.

## Each Setup Opens Only Its Own Ports

`e2e/tests/setups.spec.ts` reads each setup's resolved configuration with `docker compose config`
(Compose 5.6.1) and checks:

- the published ports: `127.0.0.1:80` with nothing in `.env`, `127.0.0.1:8081` with
  `YS_PORT=8081`, `0.0.0.0` ports 80, 443, and 443/udp with `YS_DOMAIN`, and `127.0.0.1:8080` with
  `YS_PROXY_URL`;
- that the server and the database publish nothing, and that only the proxy setup joins the edge
  network;
- that setting both keys stops Compose with a message.

The same checks pass on Compose 2.24.6, the oldest version the guide names, run from Docker's official
`docker/compose-bin:v2.24.6` image; CI runs them on that version too. Versions 2.24.0 to 2.24.5
refuse a second Compose file that changes an included service ("conflicts with imported resource"),
which the browser tests' build override and an owner's `compose.override.yaml` both do. On 2.24.6,
a stack started with `YS_PORT=18291` served `/api/status`, and a misspelled key kept every port
closed, as on 5.6.

With a running stack and locally built images (2026-11-08):

- **This machine, with `YS_PORT=18291`:** only `127.0.0.1:18291` was published.
  `http://localhost:18291/api/status` answered 200, and `http://127.0.0.1:18291/sign-in` redirected
  to `http://localhost:18291/sign-in`.
- **Your own proxy, with `YS_PROXY_URL=https://space.example.test` and `YS_PORT=18292`:** only
  `127.0.0.1:18292` was published. A request with `Host: space.example.test` answered 200; one with
  any other `Host` got 421 and the message about `proxy_set_header Host $host`. A container on the
  stack's edge network reached `http://your-space:8080`.
- **A misspelled key (`YS_DOMIAN`), `YS_DOMAIN=myserver.tail1234.ts.net`, and an old `.env` with
  `YS_PUBLIC_URL` and `YS_BIND_ADDRESS`:** `docker compose up -d --wait` failed with "dependency
  failed to start: container ... is unhealthy", Caddy stayed `Created` with no published ports,
  and `docker compose logs server` named the fix ("Did you mean YS_DOMAIN?", "for Tailscale, write
  YS_PROXY_URL=https://… instead", "is no longer used").

- **The default setup, during the browser journeys:** `docker ps` showed Caddy published only on
  `127.0.0.1:80`. `curl http://localhost/api/status` answered 200, and the same request to the
  host's network address, with `Host: localhost`, was refused (connection refused).

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

**Method.** `tcpdump` recorded two things while quickstart sections 1, 3, and 5 ran against a
fresh stack: every packet leaving the stack's Docker network for any other address, and every DNS
packet on the host (Docker's resolver forwards containers' lookups from the host). A browser drove
the steps (no owner yet, `create-owner`, set the password, a wrong and a right sign-in, sign out,
`reset-link`, reset, sign in) and logged every host the page contacted.

These runs used the first configuration (`YS_PUBLIC_URL`), before the setups above replaced it,
and weren't repeated. The default setup serves the same site on the same loopback port.

**Result with `YS_PUBLIC_URL=http://localhost`:** no packets left the stack's network, there were
no DNS lookups, and the web client contacted only `localhost`.

**Controls.** To show the capture would see traffic, the server container then tried
`fetch('https://example.com')`, which appeared as DNS lookups, and `fetch('http://192.0.2.10/')`,
which appeared as outgoing TCP connection attempts on the stack's network.

**Result with a domain** (`YS_PUBLIC_URL=https://space.example.test`, which cannot get a real
certificate): the only outbound activity was Caddy looking up `acme-v02.api.letsencrypt.org`, the
Let's Encrypt certificate authority. Plain HTTP to the domain returned `308` to `https://`, nothing
was served over HTTPS without a certificate (no fallback to plain HTTP), and `docker compose logs
caddy` named the failure (`could not get certificate from issuer ... will retry`).

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
