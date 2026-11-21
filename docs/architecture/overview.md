# Your Space Architecture Overview

**Current release view · 2026-11-21**

    Owner's browser → localhost / HTTPS proxy or domain → web dashboard and server
    Owner's CLI → Docker Compose → server, runtime, installed apps
    External AI agent → CLI → gateway → permitted action in one connected app

The owner manages agent identities and app grants in the web UI. The gateway and the integrated app enforce the supported action path. This is the target for 005. Later journeys add teams (004), lifecycle tooling (006), SDKs (007), and desktop clients (008). The [roadmap](../roadmap.md) gives their delivery stage.

## Layers

```text
Owner's browser ──────► Caddy ─────► web UI and server ─────► PostgreSQL
                         │                  │
                         │                  └──► runtime manager ─► Docker
                         └──► app access gate ─► installed app on its network

Owner's local CLI ────► Docker Compose and operator commands
Agent CLI (005) ──────► edge ─► gateway ─► authorized action in the app
```

## What Each Layer Does

1. **People and agents.** One owner controls the workspace. In 005 the owner delegates a subset of their app roles to an external agent and can revoke its access.
2. **Clients.** The browser displays the dashboard and app panes. The operator runs the CLI on the Docker host. In 005 the agent uses its own credential through the gateway on local or remote installations. See [CLI delivery](decisions.md#cli-delivery-sequence).
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
   app management, and the planned agent activity log. Guided backup, restore and updates follow in 006. The session cookie
   is a `__Host-` cookie over HTTPS and host-only on the plain-HTTP local setup. The access gate is
   a second server listener on port 3001 that only Caddy reaches: it checks an app's pass, turns a
   one-time code into a pass on the app's own host, and allows certificates only for installed
   apps' names. The app manager installs from a GitHub link and an installation kit, keeps
   settings and access requests, and drives the runtime manager. See
   [agent access through Your Space](decisions.md#agent-access-through-your-space),
   [Your Space updates, backup, and restore](decisions.md#your-space-updates-backup-and-restore), and
   [activity log](decisions.md#activity-log).
5. **Platform data.** PostgreSQL through Drizzle, app settings and secrets encrypted in the database
   (see [data-key management](../../specs/009-encrypt-stored-data/spec.md)). The platform's secrets (auth secret, data key and database password) are
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
6. **Apps.** Each managed app runs as a Compose project with its own network and declared storage. Owner-approved outbound hosts and opt-in publishing are described in [running apps and reaching them](decisions.md#running-apps-and-reaching-them). The connector for externally hosted apps belongs to 007.
7. **Host.** The owner supplies a Docker-compatible engine on their personal machine or server. The bundled VM belongs to desktop journey 008.

## Request Paths

- **A person:** client → proxy → Your Space signs them in → the app opens in a pane inside Your
  Space, loaded from `<app>.<Your Space's address>` → Caddy asks the gate → with no pass, the gate
  sends the browser to Your Space, which hands back a one-time code → the gate sets the app's pass →
  Caddy proxies to the app on its network. The app's own sign-in appears (level 0); verified
  identity and roles come with levels 1 and 2. On the plain-HTTP local setup in WebKit, Your Space
  detects the redirect loop and offers the app in its own tab.
- **A person reaching a published app:** the owner's proxy or tunnel (such as `tailscale serve`) →
  the app's port on this machine → its `ys-publish` Caddy → the app's interface on its sealed
  network. Your Space's gate isn't on this path; the app's own sign-in is. Your Space's pane loads
  the app this way, at the owner's link, unless the owner turned "Show inside Your Space" off; then
  the app opens there in its own tab.
- **Installing an app:** the owner pastes a GitHub link → the server reads the file at an exact
  commit and its installation kit → the runtime manager resolves, checks, and pins it → after the
  owner confirms, it starts the app's Compose project.
- **An app reaching the internet:** app → its egress proxy → approved host, or a denial the
  runtime manager reads and the server turns into an access request.
- **An agent:** CLI → proxy → the gateway checks the credential, delegation, and revocation →
  forwards the request to the app → the activity log records it. An agent never reaches an app
  directly.

## Still Open

- How desktop journey 008 provides its engine after publication.
- Messages between Your Space and an app in a pane, such as navigation and theme.
- How identity reaches apps at levels 1 and 2, and whether the gateway enforces per-action roles
  declared by apps.
- The connector for apps someone already runs elsewhere.

## Keeping This Current

Update this overview in the same change whenever a decision adds, removes, or moves a component,
layer, or request path, or when a `(spec)` item is resolved. Keep the diagram 80 columns wide with
aligned box borders. Rationale belongs in the decision record, not here.
