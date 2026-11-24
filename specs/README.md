# Journey specifications

The [roadmap](../docs/roadmap.md) tracks delivery. Open a specification below for its scope and acceptance criteria. The `tasks.md` files beside the specifications record implementation progress where available.

| Journey | First-release responsibility |
| --- | --- |
| [001 · Set up my space](001-workspace-owner-access/spec.md) | Owner claim, sign-in, durable identity and recovery. |
| [002 · Install and use an app](002-install-an-app/spec.md) | Install and open an independent app in the browser. Verify the supported real-source path. |
| [003 · Run with the CLI](003-install-with-the-cli/spec.md) | Download and run on existing Docker locally or on a server. Verify localhost, an existing proxy, and a real domain. |
| [005 · Let my agent work for me](005-owner-agent/spec.md) | Web and CLI tests cover identity, kit-defined roles, server-held credentials, approvals, denial and revocation. A live external agent completed an approved read. Creating and editing recurring records in the independent app still require verification. |
| [008 · Open a workspace from the macOS desktop](008-desktop-entry/spec.md) | Download the native app. Use a detected or owner-selected Docker engine for local setup, with guidance when Docker is missing, or connect to an existing server without local Docker. Apply an installation kit from the selected dashboard. |
| [009 · Encrypt stored app settings](009-encrypt-stored-data/spec.md) | Follow-up to 003. A dedicated encryption key protects installed apps’ settings and can be rotated independently of the owner sign-in secret. |
| [010 · Make Your Space look like yours](010-personal-themes/spec.md) | Pick, customize and share a theme. Store workspace appearance on its server and launcher appearance on the device. 013 supersedes its presentation; its storage, sharing and permission rules still apply. |
| [011 · Build and customize a personal workspace with an agent](011-agent-workspace/spec.md) | Agent setup, portable app authoring, Home read grants, kit links, private kits through the GitHub connection and an optional operator-selected kit directory. Managed GitHub repos and owner-confirmed replacement are deferred beyond the first release (2026-11-23). |
| [012 · Arrange apps and return to a saved view](012-multi-app-layouts/spec.md) | Resize installed apps in four arrangements, share the composition, save named views and order app shortcuts. 013 supersedes its view behavior; its storage, sharing and permission rules still apply. |
| [013 · Redesign the workspace](013-workspace-redesign/spec.md) | New sidebar, tabs, views, Home, Apps, Agents, Approvals and Settings on a component kit that themes restyle. Theme format version 2 with light and dark palettes, a component style and three built-in themes. |

001–003 supply the foundation for 005. One app must implement the role and action contract needed for 005. Acceptance covers listing, creating and editing a synthetic record in an independent app through kit-defined routes. An app that only offers a browser sign-in can still appear on the dashboard.

008 reuses 001 owner setup, 002 installation kits and the 003 CLI. macOS desktop entry and 005 agent access have independent acceptance checks. Both precede the product release.

013 redesigns the dashboard that the other journeys use and supersedes 010's presentation and 012's view behavior. It also precedes the product release, delivered in the order its spec gives.

The roadmap tracks [004 teams](../docs/roadmap.md#accounts-and-access), [006 lifecycle tooling](../docs/roadmap.md#workspace-and-hosting), [007 developer ecosystem](../docs/roadmap.md#apps-and-kits), [broader 008 desktop support](../docs/roadmap.md#dashboard-and-desktop) and [011's managed repositories](../docs/roadmap.md#custom-apps-and-sources) as later work. The existing specifications and their historical task records keep their original scope.

## Rules Every Spec Follows

These apply from the first spec, so later specs don't have to retrofit them:

- **Simple by default.** Show people only what they need; advanced controls stay out of the way.
- **No telemetry.** The only automatic outbound requests are GitHub update checks and the built-in
  proxy's certificate requests for an owner-configured domain.
- **ARM and Intel.** Your Space's own images ship for both. Apps need only images for the engine's
  processor type.
- **Concepts, not technologies.** Build against concepts, such as an engine connection or an app
  endpoint, with each technology behind an adapter (constitution principle VIII).
- **Known storage.** All durable state lives in the database or named volumes, so backup has one
  clear thing to capture.
- **The actual actor.** Records credit the real actor, human or agent, from the first database schema.
- **Reuse before building.** Use open-source libraries and their native features before writing
  custom code, each for the purpose it was built for, while keeping dependencies few and trusted
  and integrations thin.
- **Docs and security included.** Each spec ships its own docs and tests its own security boundaries.

## Packaged release

Follow the [maintainer release guide](../docs/maintainers/releasing.md) to test the combined owner journey, review security, privacy and distribution rights, and record the results for the exact candidate.

## Keeping This Current

- When a journey’s scope or release stage changes, update its entry here and the corresponding
  product area in the roadmap. Keep its journey number and implementation history.
- When a spec is merged, link it here and replace its PR link.
