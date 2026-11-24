---
title: "Your Space Architecture Overview"
---

**Current release view · 2026-11-21**

    Mac launcher → local setup via CLI or existing server by URL → dashboard
    Owner's browser → localhost / HTTPS proxy or domain → dashboard and server
    Owner's CLI → Docker Compose → server, runtime, installed apps
    External AI agent → CLI → gateway → permitted action in one connected app

The owner manages agent identities, kit-defined app roles and request approval settings in the web UI. Before forwarding, the gateway checks the kit route and HTTP method, obtains any required owner approval, then injects the server-held app credential. The runtime identifies the installed service on its private Docker network. The app checks the injected credential and enforces its native permissions. The [Mac launcher](../install/macos-desktop.md) opens this same dashboard. It can be built from source ahead of the first public DMG. Teams (004), lifecycle tooling (006), SDKs (007), Windows and Linux desktops, and the bundled engine follow publication. The [roadmap](../roadmap.md) gives their delivery stage.

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

1. **People and agents.** One owner controls the workspace. The owner chooses which kit roles to enable for each installation, then grants any subset to an agent. They can narrow or revoke that access.
2. **Clients.** The browser displays the dashboard and app panes. The macOS launcher opens the same dashboard for a local or remote workspace. Headless operators run the CLI on the Docker host. An agent uses its own Your Space key through the gateway on local or remote installations. See [CLI delivery](decisions.md#cli-delivery-sequence).
3. **Edge.** A Caddy reverse proxy in the Compose stack provides HTTPS with automatic certificates, unless
   the owner brings their own proxy or tunnel. Then the owner's proxy sits in front of Caddy and
   reaches it on `127.0.0.1:8080`, or over the stack's `edge` network when the proxy runs in a
   container. Caddy also serves the web client's static files and forwards `/api` to the server, so
   both share one origin. On this machine Your Space is at `http://space.localhost`, and
   `localhost` redirects there. Each app is at `<app>.<Your Space's address>`: Caddy's app sites
   (`*.space.localhost`, or `*.<domain>` with certificates obtained on demand) ask the server's gate
   with `forward_auth`, then proxy to the upstream the gate names on the app's own network. Caddy
   removes the app pass from requests to apps (Your Space's session cookies are host-only, so
   browsers don't send them to apps), removes `Domain` from cookies apps set, and replaces apps'
   framing headers so only Your Space can frame them. See
   [installation and hosting](decisions.md#installation-and-hosting) and
   [UI integration](decisions.md#ui-integration).
4. **Your Space core.** Identity and sessions, roles and delegation, the gateway for agent requests,
   app management, and the agent activity log. Guided backup, restore and updates follow in 006. The session cookie
   is a `__Host-` cookie over HTTPS and host-only on the plain-HTTP local setup. The access gate is
   a second server listener on port 3001 that only Caddy reaches: it checks an app's pass, turns a
   one-time code into a pass on the app's own host, and allows certificates only for installed
   apps' names. The app manager installs from an installation kit's link, keeps
   settings and access requests, and drives the runtime manager. See
   [agent access through Your Space](decisions.md#agent-access-through-your-space),
   [Your Space updates, backup, and restore](decisions.md#your-space-updates-backup-and-restore), and
   [activity log](decisions.md#activity-log).
5. **Platform data.** PostgreSQL through Drizzle, app settings and secrets encrypted in the database
   (see [data-key management](https://github.com/your-space-ai/your-space/blob/main/specs/009-encrypt-stored-data/spec.md)). The platform's secrets (auth secret, data key and database password) are
   generated into a separate `ys-secrets` volume by a one-shot step that runs before the database
   and the server, unless the owner sets them
   ([2026-11-08 decision](decisions.md#installation-and-hosting)). See
   [server and database](decisions.md#server-and-database).
6. **Runtime manager.** The Docker adapter and the only part of Your Space that holds the engine
   connection. It has no network, mounts the engine socket, and serves the server on a Unix socket
   in the `ys-runtime` volume. It runs `docker compose` to resolve, check, pin, start, stop, log, and
   remove apps, connects Caddy to each app's network, and reads each egress proxy's denials. See
   [app deployment](decisions.md#accepted-future-app-deployment-direction) and
   [concepts and adapters](decisions.md#concepts-and-adapters).
7. **Apps.** Each managed app runs as a Compose project with its own network and declared storage. Owner-approved outbound hosts and opt-in publishing are described in [running apps and reaching them](decisions.md#running-apps-and-reaching-them). The connector for externally hosted apps belongs to 007.
8. **Host.** The owner supplies a Docker-compatible engine on their personal machine or server. Only the workspace host needs Docker. A Mac connecting to an existing server needs its URL and the owner's sign-in. A bundled engine or VM follows publication.

The dashboard reads presentation tokens from its workspace server. The Mac launcher uses the same portable theme format with a local device preference before connection. [Appearance](../appearance.md)

The signed-in dashboard arranges installed app panes in a resizable grid. A named view stores app names, arrangement and divider percentages on the selected workspace server. Shortcut order is a separate owner preference. Each app continues through its own existing pane or published link. [Multi-app layouts](https://github.com/your-space-ai/your-space/blob/main/specs/012-multi-app-layouts/spec.md)

## Request Paths

- **Starting on a Mac (008).** For local setup the app detects Docker, lets the owner select a different engine and guides them through installing or starting it if needed. The existing CLI sets up the stack and starts the owner flow. For a remote workspace the owner enters its URL and signs in without starting Docker on the Mac. In either case, kit review, confirmation and installation run against the selected workspace.

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
- **Installing an app:** the owner pastes the GitHub link to the app's kit → the server reads the
  kit, then the Compose file it names, each at an exact commit (through the owner's GitHub
  connection when there is one) → the runtime manager resolves, checks, and pins it → after the
  owner confirms, it starts the app's Compose project. A Compose file's link alone is refused.
- **An app reaching the internet:** app → its egress proxy → approved host, or a denial the
  runtime manager reads and the server turns into an access request.
- **An agent.** The CLI sends the agent’s key and requested action to the server through the edge.
  The gateway checks the current grant against the kit’s allowed method and route and obtains any
  required owner approval. The server adds the stored app credential and sends the request through
  Caddy’s private socket to the installed app. The owner can review the action in the activity log.

## Still Open

- How the later desktop release provides and maintains its own engine.
- Messages between Your Space and an app in a pane, such as navigation and theme.
- How a signed-in person’s identity and roles reach apps at integration levels 1 and 2.
- The connector for apps someone already runs elsewhere.

## Keeping This Current

Update this overview in the same change whenever a decision adds, removes, or moves a component,
layer, or request path, or when a `(spec)` item is resolved. Keep the diagram 80 columns wide with
aligned box borders. Rationale belongs in the decision record, not here.


## Creator workflows

```text
Authorized agent on host → setup CLI → Docker workspace → private owner claim
Home app frame → exact-origin message → dashboard → Home read policy → installed app
Kit URL or directory → pinned kit, then the Compose file it names → install preview
Private kit → owner's server-held GitHub connection, read only → GitHub
```

[Author a Home app](../apps/build-an-app.md) · [Connect GitHub](../apps/github-connection.md)
