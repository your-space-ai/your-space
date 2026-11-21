# Spec Map

The [roadmap](roadmap.md) follows one owner from a download to a useful action by their AI agent.

| Journey | First-release responsibility |
| --- | --- |
| [001 · Set up my space](../specs/001-workspace-owner-access/spec.md) | Owner claim, sign-in, durable identity and recovery. |
| [002 · Install and use an app](../specs/002-install-an-app/spec.md) | Install and open an independent app in the browser. Verify the supported real-source path. |
| [003 · Run with the CLI](../specs/003-install-with-the-cli/spec.md) | Download and run on existing Docker locally or on a server. Verify localhost, an existing proxy, and a real domain. |
| [005 · Let my agent work for me](../specs/005-owner-agent/spec.md) | Web and CLI tests cover identity, kit-defined roles, server-held credentials, approvals, denial and revocation. A live external agent completed an approved read. Creating and editing recurring records in the independent app still require verification. |
| [008 · Open a workspace from the macOS desktop](../specs/008-desktop-entry/spec.md) | Download the native app. Use a detected or owner-selected Docker engine for local setup, with guidance when Docker is missing, or connect to an existing server without local Docker. Apply an installation kit from the selected dashboard. |
| [010 · Make Your Space look like yours](../specs/010-personal-themes/spec.md) | Pick, customize and share a theme. Store workspace appearance on its server and launcher appearance on the device. |
| Release gate | Repeat the combined journey against release artifacts and complete the [publication review](public-release-readiness.md). |

001–003 supply the foundation for 005. One app must implement the role and action contract needed for 005. Acceptance covers listing, creating and editing a synthetic record in an independent app through kit-defined routes. An app that only offers a browser sign-in can still appear on the dashboard.

008 reuses 001 owner setup, 002 installation kits and the 003 CLI. macOS desktop entry and 005 agent access have independent acceptance checks. Both precede the product release.

004 (teams), 006 (lifecycle tooling), 007 (developer ecosystem), and broader 008 desktop support move to the [post-public roadmap](roadmap.md#post-public-later-direction-and-enhancements). The existing specifications and their historical task records keep their original scope.

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

## Release Gate (Not a Spec)

The security review and hardening pass, privacy, legal, and the final release review are tracked in
the [public release readiness checklist](public-release-readiness.md). They check the finished
journeys rather than adding a new one.

## Keeping This Current

- When a roadmap item is added or moved, give it a spec number in the overview tree and update the
  matching section here in the same change.
- When a spec is merged, link it here and replace its PR link.
