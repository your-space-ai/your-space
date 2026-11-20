# Your Space Architecture Overview

**Last updated**: 2026-11-19

This is a picture of Your Space as a running system for the first public release, layer by layer.
It is a view of the [architecture and product decisions](decisions.md), not a separate source of
truth. Decisions hold the rationale; the [roadmap](../roadmap.md) tracks delivery. Items marked
`(spec)` are decided, but their mechanism is set in a later specification. `(L)` marks low-priority
work from the roadmap.

## Layers

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. PEOPLE AND AGENTS                                                         │
│    Owner · Members · Agents (act for a member, with delegated roles)         │
└──────────────────────────────────────────────────────────────────────────────┘
                 │ humans                                    │ agents
┌────────────────▼────────────────────────────┐ ┌────────────▼─────────────────┐
│ 2. CLIENTS                                  │ │ YOUR SPACE CLI (your-space)  │
│  Desktop (Electron, primary) · Web          │ │  operators, on the server's  │
│  PWA (L)                                    │ │  machine: init, start, stop, │
│  Apps in panes: native views (desktop),     │ │  status, ... (via Compose)   │
│  cross-origin iframes (web, PWA)            │ │  agents: use app actions     │
│  Desktop local mode drives the CLI          │ │                              │
│  Simple by default; advanced controls       │ │                              │
│  Version check against the server           │ │                              │
└────────────────┬────────────────────────────┘ └────────────┬─────────────────┘
                 └────────────────────┬──────────────────────┘
┌─────────────────────────────────────▼────────────────────────────────────────┐
│ 3. EDGE: Caddy reverse proxy in the Compose stack                            │
│    HTTPS with automatic certificates · or your own proxy/tunnel · HTTP only  │
│    on this machine (space.localhost) · serves the web client · routes /api   │
│    to the server                                                             │
│    App sites (*.space.localhost, *.<domain>): forward_auth to the gate, then │
│    proxy to the app's interface on its network · strips Your Space's         │
│    cookies and the app pass · rewrites framing headers                       │
└─────────────────────────────────────┬────────────────────────────────────────┘
┌─────────────────────────────────────▼────────────────────────────────────────┐
│ 4. YOUR SPACE CORE (Node.js · Express)                                       │
│ ┌──────────────────┐ ┌──────────────────┐ ┌───────────────────────────────┐  │
│ │ Identity         │ │ Roles and        │ │ GATEWAY                       │  │
│ │ owner setup,     │ │ delegation       │ │ every agent request: verify   │  │
│ │ members, recovery│ │ app roles, agent │ │ credential, delegation, and   │  │
│ │ sessions (__Host-│ │ subsets, agent   │ │ revocation, then forward with │  │
│ │ cookie on HTTPS) │ │ credentials      │ │ verified identity             │  │
│ └──────────────────┘ └──────────────────┘ └───────────────────────────────┘  │
│ ┌──────────────────┐ ┌──────────────────┐ ┌───────────────────────────────┐  │
│ │ App manager      │ │ Operations       │ │ Activity log                  │  │
│ │ install from a   │ │ backup, restore, │ │ installs, roles, members,     │  │
│ │ link + kit,      │ │ pre-update       │ │ delegations, agent requests   │  │
│ │ settings and     │ │ snapshots and    │ │                               │  │
│ │ secrets, access  │ │ rollback, GitHub │ │                               │  │
│ │ requests, limits,│ │ update check     │ │                               │  │
│ │ status and logs  │ │                  │ │                               │  │
│ └──────────────────┘ └──────────────────┘ └───────────────────────────────┘  │
│ ┌─────────────────────────────────────────────────────────────────────────┐  │
│ │ ACCESS GATE: a second listener on :3001 that only Caddy reaches         │  │
│ │ checks the app pass · one-time handoff to a pass · on-demand TLS check  │  │
│ └─────────────────────────────────────────────────────────────────────────┘  │
└───────┬───────────────────────────────────────────────┬──────────────────────┘
        │ data                                          │ Unix socket
┌───────▼───────────────────────┐ ┌─────────────────────▼──────────────────────┐
│ 5. PLATFORM DATA              │ │ RUNTIME MANAGER (the Docker adapter)       │
│  PostgreSQL (Drizzle)         │ │  no network · the only part that holds the │
│  Platform secrets volume      │ │  engine socket · serves the server on a    │
│  App settings, encrypted      │ │  Unix socket in the ys-runtime volume ·    │
│  Backups and snapshots        │ │  runs docker compose: resolve, check, pin, │
└───────────────────────────────┘ │  start, stop, logs, remove                 │
                                  └─────────────────────┬──────────────────────┘
┌───────────────────────────────────────────────────────▼──────────────────────┐
│ 6. APPS (their own Compose files, fitted by installation kits)               │
│ ┌──────────────────────────────────────────────┐ ┌─────────────────────────┐ │
│ │ MANAGED: one Compose project per app         │ │ RUN ELSEWHERE (later)   │ │
│ │  own containers, database, named volumes ·   │ │  a connector next to    │ │
│ │  no ports · CPU and memory limits            │ │  the app connects out   │ │
│ │  sealed network (isolated gateway, no route  │ │  to Your Space; same    │ │
│ │  out); Caddy joins it to reach the interface │ │  gate and panes; not    │ │
│ │  own egress proxy (Squid), also on an egress │ │  managed by Your Space  │ │
│ │  network: approved hosts only; other hosts   │ │                         │ │
│ │  become access requests · published (opt-in):│ │                         │ │
│ │  a Caddy of Your Space's puts the interface  │ │                         │ │
│ │  on a port for the owner's proxy or tunnel   │ │                         │ │
│ └──────────────────────────────────────────────┘ └─────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────────┐
│ 7. HOST: a Docker-compatible engine (28 or newer), shared by Your Space and  │
│    its apps · Linux: the host's Docker Engine · macOS: Your Space's own VM   │
│    by default (spec), or the owner's engine · Windows (local only, L) ·      │
│    Your Space's images for ARM + Intel/AMD; apps for the engine's processor  │
│    type                                                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

## What Each Layer Does

1. **People and agents.** The owner, invited members, and agents acting for a member with a subset
   of that member's roles. See [owner and workspace model](decisions.md#owner-and-workspace-model)
   and [delegation by exact role subsets](decisions.md#delegation-by-exact-role-subsets).
2. **Clients.** The Electron desktop app, the web client, and the installable PWA give people the
   same workspace; the desktop app is the intended primary client. Installed apps open in panes,
   several side by side on larger screens: native views in the desktop app, cross-origin iframes on
   the web. See [UI integration](decisions.md#ui-integration). People sign in only through these
   clients. The `your-space` CLI runs the installation on the server's own machine, through Docker
   Compose and the server's operator commands rather than the API, with the authority of access to
   that machine; the desktop app's local mode drives it. Agents (journey 005) will use the CLI with
   a credential a person issued in the client, through the edge like any client. See
   [spec 003](../../specs/003-install-with-the-cli/spec.md#client-and-cli).
   See [first public-release audience and clients](decisions.md#first-public-release-audience-and-clients),
   [CLI delivery sequence](decisions.md#cli-delivery-sequence), and
   [product experience principles](decisions.md#product-experience-principles).
3. **Edge.** A Caddy reverse proxy in the Compose stack provides HTTPS with automatic certificates, unless
   the owner brings their own proxy or tunnel. Then the owner's proxy sits in front of Caddy and
   reaches it on `127.0.0.1:8080`, or over the stack's `edge` network when the proxy runs in a
   container. Caddy also serves the web client's static files and forwards `/api` to the server, so
   both share one origin. On this machine Your Space is at `http://space.localhost`, and
   `localhost` redirects there. Each app is at `<app>.<Your Space's address>`: Caddy's app sites
   (`*.space.localhost`, or `*.<domain>` with certificates obtained on demand) ask the server's gate
   with `forward_auth`, then proxy to the upstream the gate names on the app's own network. Caddy
   removes Your Space's cookies and the app pass from requests to apps, removes `Domain` from
   cookies apps set, and replaces apps' framing headers so only Your Space can frame them. See
   [installation and hosting](decisions.md#installation-and-hosting) and
   [UI integration](decisions.md#ui-integration).
4. **Your Space core.** Identity and sessions, roles and delegation, the gateway for agent requests,
   app management, operations (backup, restore, updates), and the activity log. The session cookie
   is a `__Host-` cookie over HTTPS and host-only on the plain-HTTP local setup. The access gate is
   a second server listener on port 3001 that only Caddy reaches: it checks an app's pass, turns a
   one-time code into a pass on the app's own host, and allows certificates only for installed
   apps' names. The app manager installs from a GitHub link and an installation kit, keeps
   settings and access requests, and drives the runtime manager. See
   [agent access through Your Space](decisions.md#agent-access-through-your-space),
   [Your Space updates, backup, and restore](decisions.md#your-space-updates-backup-and-restore), and
   [activity log](decisions.md#activity-log).
5. **Platform data.** PostgreSQL through Drizzle, app settings and secrets encrypted in the database
   (AES-256-GCM, under a key derived from the auth secret), and backups and snapshots. The platform's own secrets (the auth secret and the database password) are
   generated into a separate `ys-secrets` volume by a one-shot step that runs before the database
   and the server, unless the owner sets them
   ([2026-11-08 decision](decisions.md#installation-and-hosting)). See
   [server and database](decisions.md#server-and-database).
   **Runtime manager.** The Docker adapter and the only part of Your Space that holds the engine
   connection. It has no network, mounts the engine socket, and serves the server on a Unix socket
   in the `ys-runtime` volume. It runs `docker compose` to resolve, check, pin, start, stop, log, and
   remove apps, connects Caddy to each app's network, and reads each egress proxy's denials. See
   [app deployment](decisions.md#accepted-future-app-deployment-direction) and
   [concepts and adapters](decisions.md#concepts-and-adapters).
6. **Apps.** Apps install from their own Compose files, fitted by installation kits. Each managed
   app is one Compose project with its own containers, database, named volumes, and resource
   limits, and publishes no ports. Its network is sealed (internal, Docker's isolated gateway mode),
   so it has no route to the host or out; Caddy joins it to reach the app's interface. The app's own
   egress proxy (Squid) sits on that network and an egress network and lets through only approved
   hosts; other hosts become access requests. When the owner publishes an app, a Caddy of Your
   Space's (`ys-publish`, from Your Space's own web image) joins that network and one of its own and
   puts the app's interface on a port of this machine, for the owner's own proxy or tunnel, with the
   same framing rules as Your Space's Caddy; the app's services still publish nothing ([running apps and reaching them](decisions.md#running-apps-and-reaching-them)). Apps someone already runs elsewhere will connect
   through a connector next to them (later work). See
   [platform and independent apps](decisions.md#platform-and-independent-apps) and
   [app deployment](decisions.md#accepted-future-app-deployment-direction).
7. **Host.** One Docker-compatible engine, version 28 or newer, shared by Your Space and its apps:
   the host's Docker Engine on Linux servers, and Your Space's own virtual machine by default on
   macOS (and later Windows, for local workspaces only), or an engine the owner already runs. How
   Your Space provides the VM is settled in journey 003 or 008. Your Space's images ship for ARM
   and Intel/AMD; apps need images for the engine's processor type.

## Request Paths

- **A person:** client → proxy → Your Space signs them in → the app opens in a pane inside Your
  Space, loaded from `<app>.<Your Space's address>` → Caddy asks the gate → with no pass, the gate
  sends the browser to Your Space, which hands back a one-time code → the gate sets the app's pass →
  Caddy proxies to the app on its network. The app's own sign-in appears (level 0); verified
  identity and roles come with levels 1 and 2. On the plain-HTTP local setup in WebKit, Your Space
  detects the redirect loop and offers the app in its own tab.
- **A person reaching a published app:** the app opens in a pane inside Your Space, loaded from the
  owner's link → the owner's proxy or tunnel (such as `tailscale serve`) → the app's port on this
  machine → its `ys-publish` Caddy, which lets only Your Space frame the app → the app's interface on
  its sealed network. Your Space's gate isn't on this path; the app's own sign-in is.
- **Installing an app:** the owner pastes a GitHub link → the server reads the file at an exact
  commit and its installation kit → the runtime manager resolves, checks, and pins it → after the
  owner confirms, it starts the app's Compose project.
- **An app reaching the internet:** app → its egress proxy → approved host, or a denial the
  runtime manager reads and the server turns into an access request.
- **An agent:** CLI → proxy → the gateway checks the credential, delegation, and revocation →
  forwards the request to the app → the activity log records it. An agent never reaches an app
  directly.

## Still Open

- How Your Space provides the engine's virtual machine on macOS (journey 003 or 008).
- Messages between Your Space and an app in a pane, such as navigation and theme.
- How identity reaches apps at levels 1 and 2, and whether the gateway enforces per-action roles
  declared by apps.
- The connector for apps someone already runs elsewhere.

## Keeping This Current

Update this overview in the same change whenever a decision adds, removes, or moves a component,
layer, or request path, or when a `(spec)` item is resolved. Keep the diagram 80 columns wide with
aligned box borders. Rationale belongs in the decision record, not here.
