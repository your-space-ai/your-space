# Your Space Architecture Overview

**Last updated**: 2026-11-03

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
│ 2. CLIENTS                                  │ │ YOUR SPACE CLI               │
│  Web · Desktop (Electron) · PWA (L)         │ │  operators: install, update, │
│  Desktop local mode drives the CLI          │ │  backup, uninstall, ...      │
│  Simple by default; advanced controls       │ │  agents: use app actions     │
│  Version check against the server           │ │  (later: MCP endpoint)       │
└────────────────┬────────────────────────────┘ └────────────┬─────────────────┘
                 └────────────────────┬──────────────────────┘
┌─────────────────────────────────────▼────────────────────────────────────────┐
│ 3. EDGE: Caddy reverse proxy in the Compose stack                            │
│    HTTPS with automatic certificates · or your own proxy/tunnel · HTTP only  │
│    on localhost · routes to Your Space and app origins (spec)                │
└─────────────────────────────────────┬────────────────────────────────────────┘
┌─────────────────────────────────────▼────────────────────────────────────────┐
│ 4. YOUR SPACE CORE (Node.js · Express)                                       │
│ ┌──────────────────┐ ┌──────────────────┐ ┌───────────────────────────────┐  │
│ │ Identity         │ │ Roles and        │ │ GATEWAY                       │  │
│ │ owner setup,     │ │ delegation       │ │ every agent request: verify   │  │
│ │ members, recovery│ │ app roles, agent │ │ credential, delegation, and   │  │
│ │ sessions (host-  │ │ subsets, agent   │ │ revocation, then forward with │  │
│ │ only cookie)     │ │ credentials      │ │ verified identity             │  │
│ └──────────────────┘ └──────────────────┘ └───────────────────────────────┘  │
│ ┌──────────────────┐ ┌──────────────────┐ ┌───────────────────────────────┐  │
│ │ App manager      │ │ Operations       │ │ Activity log                  │  │
│ │ install from URL,│ │ backup, restore, │ │ installs, roles, members,     │  │
│ │ settings and     │ │ pre-update       │ │ delegations, agent requests   │  │
│ │ secrets (spec),  │ │ snapshots and    │ │                               │  │
│ │ updates, limits, │ │ rollback, GitHub │ │                               │  │
│ │ status and logs  │ │ update check     │ │                               │  │
│ └──────────────────┘ └──────────────────┘ └───────────────────────────────┘  │
└───────┬───────────────────────────────────────────────┬──────────────────────┘
        │ data                                          │ identity + requests
┌───────▼───────────────────────┐ ┌─────────────────────▼──────────────────────┐
│ 5. PLATFORM DATA              │ │ 6. APPS (SDKs or public contracts)         │
│  PostgreSQL (Drizzle)         │ │ ┌──────────────────────┐ ┌───────────────┐ │
│  Secrets store (spec)         │ │ │ MANAGED              │ │ EXTERNAL      │ │
│  Backups and snapshots        │ │ │ Your Space runs it:  │ │ hosted        │ │
└───────────────────────────────┘ │ │ own containers, DB,  │ │ anywhere;     │ │
                                  │ │ storage · no ports · │ │ accepts only  │ │
                                  │ │ CPU/memory caps ·    │ │ identity      │ │
                                  │ │ outbound only to     │ │ verified by   │ │
                                  │ │ approved hosts (spec)│ │ Your Space    │ │
                                  │ └──────────────────────┘ └───────────────┘ │
                                  └────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────────┐
│ 7. HOST: Docker / Docker Desktop · macOS + Linux (servers and local) ·       │
│    Windows (local only, L) · ARM (Apple Silicon) + Intel/AMD images          │
└──────────────────────────────────────────────────────────────────────────────┘
```

## What Each Layer Does

1. **People and agents.** The owner, invited members, and agents acting for a member with a subset
   of that member's roles. See [owner and workspace model](decisions.md#owner-and-workspace-model)
   and [delegation by exact role subsets](decisions.md#delegation-by-exact-role-subsets).
2. **Clients.** Web, the Electron desktop app, and the installable PWA give people the same
   workspace. The desktop app's local mode drives the CLI. The CLI serves both operators and agents.
   See [first public-release audience and clients](decisions.md#first-public-release-audience-and-clients),
   [CLI delivery sequence](decisions.md#cli-delivery-sequence), and
   [product experience principles](decisions.md#product-experience-principles).
3. **Edge.** A Caddy reverse proxy in the Compose stack provides HTTPS with automatic certificates, unless
   the owner brings their own proxy or tunnel. See [installation and hosting](decisions.md#installation-and-hosting).
4. **Your Space core.** Identity and sessions, roles and delegation, the gateway for agent requests,
   app management, operations (backup, restore, updates), and the activity log. See
   [agent access through Your Space](decisions.md#agent-access-through-your-space),
   [Your Space updates, backup, and restore](decisions.md#your-space-updates-backup-and-restore), and
   [activity log](decisions.md#activity-log).
5. **Platform data.** PostgreSQL through Drizzle, a secrets store for app settings, and backups and
   snapshots. See [server and database](decisions.md#server-and-database).
6. **Apps.** Managed apps run in their own isolated containers with resource limits and approved
   outbound access. External apps are hosted elsewhere and accept only identity verified by Your
   Space. See [platform and independent apps](decisions.md#platform-and-independent-apps) and
   [app deployment](decisions.md#accepted-future-app-deployment-direction).
7. **Host.** Docker or Docker Desktop on macOS and Linux for servers and local workspaces, and on
   Windows for local workspaces only, with ARM and Intel/AMD images.

## Request Paths

- **A person:** client → proxy → Your Space signs them in → the app opens inside Your Space with
  their verified identity and roles.
- **An agent:** CLI → proxy → the gateway checks the credential, delegation, and revocation →
  forwards the request to the app → the activity log records it. An agent never reaches an app
  directly.

## Still Open

- Where apps live: their own subdomains or paths under Your Space. This is decided in spec 002,
  "install an app and use it" (see the [spec map](../spec-map.md)).
- How the secrets store works.
- How outbound network limits for apps are enforced.
- Whether the gateway enforces per-action roles declared by apps.

## Keeping This Current

Update this overview in the same change whenever a decision adds, removes, or moves a component,
layer, or request path, or when a `(spec)` item is resolved. Keep the diagram 80 columns wide with
aligned box borders. Rationale belongs in the decision record, not here.
