# Implementation Plan: Install an App and Use It

**Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

## Summary

The owner pastes the GitHub link to an app's own Compose file. Your Space reads it at an exact commit,
applies the app's installation kit if there is one, has the runtime manager resolve the file and
check it against Docker adapter rules, pins every image, shows the review, and runs the app as its own
Compose project on a sealed network. The app opens in a pane at `<app>.<Your Space's address>`; Caddy
lets a request through only with a short-lived pass that Your Space issues to its signed-in owner.
Each app reaches the internet only through its own allowlisting egress proxy, and blocked hosts become
access requests.

The journey is delivered in the slice order the spec sets.

## Technical Context

- **Language and runtime**: TypeScript on Node.js 26 (native type stripping), as in journey 001.
- **Existing stack**: Express 5, Better Auth, Drizzle with PostgreSQL 18, React 19 with TanStack
  Router and Query, Caddy 2.11, Docker Compose, Playwright and Vitest.
- **Runtime**: any Docker-compatible engine, version 28 or newer (isolated gateway mode). Tested on
  Docker Engine 29.
- **Target**: one installation, one owner, one engine shared by Your Space and its apps.

## Constitution Check

| Principle | How this plan meets it |
| --- | --- |
| I. Platform and apps independent | Apps are installed from their own repositories and published images; kits live outside Your Space (separate repository). Your Space contains no app-specific code. |
| II. User control and hosting choice | No new setting is required. One optional setting, `YS_ENGINE_SOCKET`, points at another engine's socket. App addresses are derived from Your Space's address. Generated secrets. Since 1.5.0 (2026-11-19), an app the owner publishes on a port is reached through their own network setup, by their explicit choice, listening on `127.0.0.1` by default. |
| III. Identity, permissions, ownership | Every app route checks the owner server-side; installs, setting changes, approvals and removals record the actor. An installed app gets no access to workspace resources. |
| IV. Apps directly installable | Install from a public GitHub link; the exact commit, kit commit and image digests are recorded. The server command also installs from a Compose file on this machine, recorded by its digest. |
| V. Protect private data | Settings are encrypted at rest; secret values never leave the server except to the runtime manager over a local socket, and never appear in logs, output or reviews. |
| VI. Proportionate discipline | Isolation, gate and cookie rules have their own tests; the review, pass and egress designs are written down here and in research. |
| VII. Reuse before building | Docker Compose resolves and runs app files; Caddy routes, gates (`forward_auth`) and rewrites headers; Squid enforces outbound allowlists. Custom code is the policy around them. One new npm dependency (`yaml`). |
| VIII. Concepts, not technologies | The server talks to a runtime API in terms of apps, services, endpoints and egress hosts; only the runtime manager knows Docker. |

## Architecture

```text
browser ──► Caddy ─┬─ space.localhost ────────► web client, /api ──► server :3000 ──► PostgreSQL
                   │                                                     │
                   └─ <app>.space.localhost                               │ unix socket
                        forward_auth ──► server :3001 (gate)              ▼ (shared volume)
                        reverse_proxy ──► app interface ◄── runtime manager ──► Docker engine
                                          (app network)     (no network)        (mounted socket)

app network (internal, isolated gateway): app services, Caddy, the app's egress proxy
egress network: the app's egress proxy only ──► approved internet hosts
```

### New and changed services

| Service | Change |
| --- | --- |
| `runtime` (new) | The runtime manager. `network_mode: none`; mounts the engine socket (`YS_ENGINE_SOCKET`, default `/var/run/docker.sock`) and serves its API on a Unix socket in the `ys-runtime` volume. Image: Node.js plus the Docker CLI and Compose plugin copied from `docker:29-cli`. Its process restarts don't touch apps. |
| `server` | Mounts `ys-runtime` to reach the runtime manager. Adds the apps module, the install and list commands, and a second listener on port 3001 that only Caddy uses: the gate, the pass handoff and the on-demand TLS check. |
| `caddy` | Adds a wildcard site for apps: removes any client-sent routing header, asks the gate, then proxies to the upstream the gate names. Rewrites framing headers, removes the pass cookie and `Domain=` attributes. The runtime manager connects it to each app network. |
| Each app | One Compose project `ys-<app>`, labelled with the installation's project name. Services join only the app network; the interface service gets the alias `ys-<app>-ui`. An injected `ys-egress` service (Squid) is on the app network and an egress network. |

### Runtime manager (Docker adapter)

The runtime manager is the Docker adapter. It knows only Docker; the server sends it apps in Your
Space's terms. It runs `docker compose` for everything Compose does (resolving files, pulling,
starting, stopping, logs) and calls the engine API on the socket for what the CLI doesn't expose as
data (image platforms and digests without downloading, engine info, network connections, stats).

**Resolving and checking a file (FR-D03, FR-D04).** `docker compose config --format json`, with the
settings as its environment, resolves anchors, `extends`, `include`, placeholders and profiles. The
same command with `--profile '*'` lists services behind profiles, which are left out and reported.
`config --variables` lists the settings the file reads. The resolved JSON is then checked service by
service:

| Setting | Rule |
| --- | --- |
| `image`, `command`, `entrypoint`, `environment`, `working_dir`, `user`, `healthcheck`, `depends_on`, `restart`, `stop_signal`, `stop_grace_period`, `init`, `tty`, `stdin_open`, `labels`, `expose`, `hostname`, `read_only`, `shm_size`, `tmpfs`, `ulimits`, `platform`, `pull_policy` | Allowed |
| `ports` | Removed: Your Space routes to the interface instead (reported) |
| `networks`, `network_mode: bridge`, `links` | Replaced by the app network (reported) |
| `dns`, `dns_search`, `extra_hosts`, `container_name`, `logging`, `mem_limit`, `cpus`, `deploy.resources` | Removed or replaced by Your Space's values (reported) |
| `build` with an `image` | Build removed, image used (reported) |
| `volumes` of type `volume` (named) or `tmpfs` | Allowed; anonymous volumes allowed |
| Bind mounts, `devices`, `privileged`, `cap_add`, `security_opt`, `pid`/`ipc`/`uts`/`userns_mode`/`cgroup` other than private, `network_mode: host` or `service:`/`container:`, `volumes_from`, `sysctls`, `env_file` left after resolution, `secrets`/`configs` from files, `group_add`, `runtime`, `isolation`, `gpus`, `build` without `image`, `external` volumes or networks, volume `driver`/`driver_opts` | Refused with the reason |
| Any other key | Refused, so a new Compose feature can't slip through |

**The adapted file.** Built from the checked JSON (not the raw text): images pinned to
`name@sha256:…`; every service on the `app` network with `HTTP_PROXY`, `HTTPS_PROXY` and lower-case
forms pointing at `ys-egress:3128` and `NO_PROXY` listing the app's own services; `mem_limit`,
`cpus`, `oom_score_adj: 500`, `security_opt: [no-new-privileges:true]`; labels
`ai.your-space.installation` and `ai.your-space.app`; and a dependency on the egress proxy's health,
so no service starts before it can reach approved hosts. Every service restarts `unless-stopped`,
so it comes back after a restart of the machine, except one the file says runs once, such as a
database migration: `restart: "no"` or `on-failure`, or `deploy.restart_policy` with `none` or
`on-failure` (kept from the otherwise replaced `deploy`). Such a service that exits 0 shows as
completed, not as a problem (2026-11-19). Networks: `app` is `internal` with
`com.docker.network.bridge.gateway_mode_ipv4=isolated` (no route to the host or out); `egress` is a
normal bridge. Apps' raised out-of-memory score makes the kernel stop them before Your Space's own
services, which keep the default; a negative score would fail on rootless engines (FR-D06).

**Pinning (FR-004).** The engine's `GET /distribution/{name}/json` returns the image index digest and
its platforms without downloading anything, so the review can show exact versions. An image without
the engine's platform stops the install with a message.

**Egress (FR-019, FR-D05).** Squid (`ubuntu/squid`, maintained by Canonical), one per app, with its
configuration in the Compose file's inline `configs`: allow the approved host names, deny private and
link-local addresses, deny everything else. Its access log, unbuffered, records denials with the
host; the runtime manager reads the recent log for the server, which turns new hosts into access
requests. Changing the approved hosts re-applies the project; a label with the configuration's hash
makes Compose recreate only the egress service, and the app's services keep running. An app that
ignores proxy settings has no route out at all. 16 MB of memory per app, with its open files capped
at 4,096, because Squid sizes its tables by that limit (research R3).

**Stopping (FR-008).** The documented stop runs `docker compose exec runtime stop-apps` before
`docker compose stop`: the runtime manager stops every app it manages and refuses to start any until
it restarts itself. A restart or update of Your Space doesn't run it, so apps keep running. When the
server starts, it reconciles: apps that should run and don't are started; recorded states are
corrected.

### Server apps module

| Part | What it does |
| --- | --- |
| `apps/github.ts` | Turns `https://github.com/<owner>/<repo>/blob/<ref>/<path>` into the commit (GitHub API, `application/vnd.github.sha`) and the file at that commit (raw content). Refuses other hosts, private repos (404), files over 256 KB. |
| `apps/kits.ts` | Reads `apps/<owner>/<repo>.yaml` from the kits repository at its current commit, a kit link the owner gives, or, from `install-app --kit`, a kit file, kits folder or standard input on this machine. A kit names the source file it fits (a kit given with a Compose file on this machine may leave it out), the app's name, the interface service and port, values to generate, values to derive (`app_origin`), plain values from the app's own example settings, settings that are secret, starter outbound hosts, limits, and whether the app can run in a pane. Parsed with `yaml` and validated by hand. |
| `apps/local.ts` | From `install-app --compose`, a Compose file on this machine or standard input, for an app whose own file doesn't fit Your Space's rules: read with the same 256 KB limit, and recorded by its digest and file name, with no repository or commit. The rules for the command's sources: a link or `--compose`, and only one of `--compose` and `--kit` on standard input. |
| `apps/settings.ts` | The file's variables become settings. Kit-generated values, and without a kit any variable whose name contains `SECRET`, `PASSWORD`, `TOKEN`, `KEY` and that has a published default, are generated (32 random bytes unless the kit says otherwise) and never use the default (FR-006). Values are encrypted with AES-256-GCM under a key derived from the auth secret. |
| `apps/runtime-client.ts` | The runtime API client over the Unix socket. |
| `apps/install.ts` | Preview (fetch, kit, settings, check, pin) and install (record, then a background job that streams the runtime's progress into `install_job`). |
| `apps/reconcile.ts` | At start and every 15 seconds: marks interrupted jobs failed, starts apps that should run, records each app's state, collects egress denials into access requests. |
| `apps/routes.ts` | Owner-only HTTP API ([contracts/http-api.md](contracts/http-api.md)). |
| `apps/gate.ts` | The port-3001 listener: `GET /gate` checks the app pass and names the upstream; `GET /handoff` turns a one-time code into the pass; `GET /tls-ask` allows certificates only for installed apps' names. |
| `commands/install-app.ts`, `list-apps.ts` | Scripted install and list, with `--json` (FR-009). The actor is the operator. |

### The access gate (FR-014, FR-014a)

1. The pane loads `http://sure.space.localhost/`. Caddy asks the gate, which finds no pass and
   answers with a redirect to `http://space.localhost/api/apps/sure/open?return=/`.
2. That request carries Your Space's session (the pane is same-site). The server checks the owner,
   makes a one-time code valid for 60 seconds, and redirects to
   `http://sure.space.localhost/__ys/handoff?code=…&return=/`.
3. The gate exchanges the code for a pass cookie on the app's own host (`HttpOnly`, `SameSite=Lax`,
   no `Domain`), valid for 12 hours, and redirects to the return path. The pass is signed with the
   auth secret and names the app and the session; the gate checks that the session still exists, so
   signing out of Your Space closes every app.
4. Caddy removes the pass from the `Cookie` header before the app sees it, removes `Domain=` from
   the app's `Set-Cookie` headers, removes `X-Frame-Options`, and sets `frame-ancestors` to Your
   Space's origin in the app's CSP (adding one if the app sends none).

Someone not signed in is sent to Your Space's sign-in at step 2.

**Where the owner returns.** `return` is only ever a path on the app's own origin: it must start
with a single `/`, and anything else (a scheme, `//`, or a backslash) becomes `/`. The open and
handoff redirects carry `Referrer-Policy: no-referrer`, so the one-time code in their address
isn't sent on as a referrer, and Caddy keeps no access log.

**When a browser blocks the pane's cookies.** WebKit on the plain-HTTP local setup treats each
`*.localhost` name as its own site and drops the pass, so steps 1 to 3 repeat. Step 2 counts the
requests the browser marks `Sec-Fetch-Dest: iframe`; more than three for the same app and session in
15 seconds answer with a page that offers the app in its own tab, where it works (research R3).

**Session cookie.** Over HTTPS, Your Space's cookies are `__Host-` cookies, which no app can set or
overwrite. On the plain-HTTP local setup they are host-only cookies without the prefix: WebKit refuses
`__Host-` over HTTP even on `*.localhost` (tested; Chromium and Firefox accept it). On that setup an
app's script could set a cookie for Your Space's host with the same name; it holds no valid session to
set, so the worst it can do is sign the owner out. Research R3 records this.

### App addresses (FR-013)

| Setup | Your Space | Apps | Caddy |
| --- | --- | --- | --- |
| This machine | `http://space.localhost` (`localhost` redirects) | `http://<app>.space.localhost` | Two sites on port 80 |
| Own domain | `https://space.example.com` | `https://<app>.space.example.com` | Wildcard site with on-demand certificates, asked through `/tls-ask` |
| Own proxy | `YS_PROXY_URL` | `<app>.<proxy host>` | One `:8080` site, split by host |

Tailscale Services need one service per app name, created by the owner for now; automating them is
left for journey 003. (2026-11-19: Tailscale names can't hold these; there the owner publishes the
app on a port and gives its link; see [Publishing an app on a port](#publishing-an-app-on-a-port).)

### Publishing an app on a port

Since 2026-11-19 ([decision record](../../docs/architecture/decisions.md#running-apps-and-reaching-them)),
the owner can publish an app's interface on a port of this machine for their own proxy or tunnel.
The app record keeps `publish: { port, bind, link }`. The runtime manager adds a `ys-publish`
service, BusyBox's `nc -lk -e nc ys-<app>-ui <port>` as user 65534 with a read-only root and no
capabilities, on the app network and a `publish` network of its own, and publishes only its port
on `bind:port`. The app's services stay on the sealed network, where Docker publishes nothing.
Before saving the owner's choice, the server refuses a port another published app uses, then asks
the runtime manager, which has no network of its own and can't see the machine's ports: it names a
running container that publishes the port (the app's own forwarder doesn't count), and otherwise
starts a short-lived container of the forwarder's pinned image, hardened like it, that publishes
the port on Docker's default bridge and exits at once; Docker's bind error means another program
uses it. A check that can't run doesn't stop saving, and Docker's bind error at the start names a
port taken since. With a link, `app_origin` and `app_host` settings are the link's on every start.

### Limits and resources (FR-021, FR-021a)

Defaults per service: 1 GiB memory and 1 CPU; the egress proxy 64 MiB and 0.25 CPU. A kit can set
others; the owner can change them in the app's advanced settings. Sure's services use at most
449 MiB; Twenty's server 706 MiB, so its kit sets 2 GiB (research R3). The Engine page reads the engine's CPUs and memory and each app's use from the engine.

### Removal (FR-023)

Removing runs `docker compose down` without volumes: containers and networks go, named volumes stay,
and the app's record and settings stay as retained data so a reinstall gets back the same database
password. Installing the same app again offers to reuse them: one with the same name and
repository, or with the same name when either came from a Compose file on this machine, which has no
repository to compare. Deleting retained data removes the volumes, then the record.

## Dependencies

| Dependency | Where | Why | Alternative rejected |
| --- | --- | --- | --- |
| Docker CLI and Compose plugin (Apache-2.0), from the `docker:29-cli` image | Runtime manager image | Compose resolves, validates and runs app files exactly as their authors tested them | Reimplementing Compose with dockerode: large and would drift from Compose's semantics |
| `ubuntu/squid` image (Squid is GPL-2.0, image by Canonical) | One per app, unmodified | Allowlisting forward proxy with denial logs, maintained and published | Smokescreen (MIT) publishes no image and identifies clients by TLS certificate; a custom proxy is security code to maintain |
| `yaml` (ISC), server | Parse installation kits | Kits are YAML for people to write | JSON kits: harder to review |
| `busybox` image (GPL-2.0) | `ys-publish`, one per published app, unmodified | Its `nc` passes connections to the interface unchanged, in a tiny official image for ARM and Intel/AMD | Caddy rewrites forwarded headers unless told which proxies to trust; Squid isn't built for websockets; a custom forwarder is code to maintain |
| `traefik/whoami` (MIT), `busybox` (GPL-2.0) images | Tests only | Q8 | |

No new dependency for jobs (a table and the server process), encryption (`node:crypto`), Docker API
calls (`node:http` over the socket) or the gate (Caddy built-ins).

## Data Model

See [data-model.md](data-model.md): `app`, `app_setting`, `app_outbound`, `app_access_request`,
`install_job`, and `event.subject_app_id`.

## Contracts

- [contracts/runtime-api.md](contracts/runtime-api.md): the runtime manager's API on its Unix socket.
- [contracts/http-api.md](contracts/http-api.md): the owner-only apps API, the gate, and the commands.
- [contracts/kit-format.md](contracts/kit-format.md): the installation kit format.

## Testing

- **Server (Vitest, PostgreSQL)**: link parsing, kit validation, settings generation and
  encryption, the pass and handoff, owner-only routes, reconcile against a fake runtime.
- **Runtime manager (Vitest, no Docker)**: the allowlist and the adapted file, from resolved JSON
  fixtures, including Sure's.
- **Browser (Playwright, Compose stack)**: a stand-in for GitHub serves fixture Compose files and
  kits (`YS_E2E_GITHUB_API`, `YS_E2E_GITHUB_RAW`, `YS_E2E_KITS`). Install whoami from the UI, open it
  in a pane (in WebKit, its own tab), sign out and be refused, isolation probes with busybox, egress
  requests and approval, settings, limits, restart and stop, removal and reuse, two apps side by
  side, the phone layout. Test machines add the test names to `/etc/hosts`, because Node and so
  Playwright's API requests don't resolve `*.localhost`; browsers resolve them themselves.
- **Real apps**: Sure and Twenty installed from their real files through the stand-in, run by hand
  and recorded in research R3. Their kits go to the kits repository once it exists.

## Risks and Open Points

- Squid's licence is GPL-2.0; Your Space runs the unmodified published image, as it runs app images.
- The one-setting engine override covers sockets (Docker Engine, rootless Docker, Colima, OrbStack).
  `ssh://` and `tcp://` engines need network access for the runtime manager and are left for when an
  engine on another machine is in scope.
- Safari on macOS with `*.localhost` is still to check. Tailscale Services are the owner's, one per
  published app (2026-11-19).
