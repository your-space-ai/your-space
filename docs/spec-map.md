# Spec Map

**Last updated**: 2026-11-17

The pre-public [roadmap](roadmap.md) is delivered through eight specifications. Each one follows a
person through one complete journey, from where they start to a result they can see, and covers
many roadmap items. Every pre-public roadmap item belongs to one of these specs or the release gate;
the [overview tree](roadmap.md#overview) shows the spec number beside each item.

Why: [journey-based specifications](architecture/decisions.md#journey-based-specifications).

## At a Glance

| Spec | Journey | Done when |
| --- | --- | --- |
| 001 | **Set up my space** | The operator installs Your Space, creates the owner, signs in, and can recover the owner account. |
| 002 | **Install an app and use it** | The owner installs Sure from the link to its own Compose file and uses it in a pane inside Your Space, with Twenty beside it. |
| 003 | **Install and run with the CLI** | `your-space init` and `your-space start` in a folder give a working space, over HTTPS with your own domain. |
| 004 | **Invite my team** | A member joins by invitation, gets app roles, and can recover their password. The owner can remove them. |
| 005 | **Let my agent work for me** | An agent uses an app through the CLI with some of its person's roles. The owner sees what it did and can revoke it. |
| 006 | **Keep my space safe over time** | The owner updates, backs up, restores, moves, and uninstalls without losing data. |
| 007 | **Build my own app** | A developer builds and installs a second app without changing Your Space. |
| 008 | **Use Your Space as an app on my computer** | The desktop app connects to a server or runs a space locally. |

## Build Order

```text
001 Set up ─► 002 Install an app ─► 003 CLI ─► 004 Invite ─► 005 Agents ─► 006 Keep safe ─┬─► 007 Build an app
                                                                                          └─► 008 Desktop
```

- **002 before 003:** 002 puts every app at `<app>.<Your Space's address>`, which sets the wildcard
  DNS, certificates and Tailscale Services the CLI configures on the proxy from 001.
- **006 after 004 and 005:** backup and restore must cover members, agents, and app data.
- **008 last:** the desktop app wraps the CLI's finished commands without changing them.
- **007 and 008** can run in parallel.

## What Each Spec Covers

Roadmap layers: [1 Install and operate](roadmap.md#1-install-and-operate) ·
[2 Identity and access](roadmap.md#2-identity-and-access) · [3 Apps](roadmap.md#3-apps) ·
[4 Agents](roadmap.md#4-agents) · [5 Clients](roadmap.md#5-clients) ·
[6 Trust and release](roadmap.md#6-trust-and-release)

**001 Set up my space** ([spec](../specs/001-workspace-owner-access/spec.md))
- Manual Compose install, data that survives restarts, access from another device, ARM and Intel images.
- HTTPS: built-in proxy with automatic certificates, or your own proxy or tunnel.
- Owner setup and sessions: owner command with a set-password link, sign-in, host-only session cookie, recovery.
- The web client.

**002 Install an app and use it** ([spec](../specs/002-install-an-app/spec.md))
- Installing from a GitHub link to the app's own Compose file, with installation kits from a
  separate repository: exact commit, images pinned by digest, an allowlist of Compose settings,
  generated settings and secrets, the trust warning, and images for the engine's processor type.
- Running apps: a runtime manager that alone holds the engine connection, a Compose project per app
  with its database and named volumes, a sealed network, outbound access through starter hosts and
  access requests, limits, status and logs, removal with retained data, and the Engine page.
- Opening apps: each app at `<app>.<Your Space's address>` (`space.localhost` on this machine)
  behind an access gate, in panes inside Your Space (iframes on the web, several side by side on
  larger screens) or in its own tab. Apps keep their own sign-in (level 0).
- Sure as the first app and Twenty as the second. App roles, verified identity for apps and the
  TypeScript SDK moved to 004, 005 and 007 on 2026-11-14.

**003 Install and run with the CLI** ([spec](../specs/003-install-with-the-cli/spec.md))
- The `your-space` command, shaped like the Supabase CLI: from npm, Linux packages and standalone
  executables; `init` then `start` in a folder, with a summary of what is running.
- Commands: init, start, stop, status, logs, configure, owner recovery and secrets.
- Choosing how the space is reached: this machine, your own domain (names checked, HTTPS waited
  for, failures explained), or your own proxy or tunnel (the names to forward, each app's included).
- The CLI runs the installation on its own machine; people sign in only through the client.
- Linux in this journey. macOS packaging and checks on a real Mac come in the macOS and Windows pass
  before release; Windows moves to 008.
- The manual Compose guide, kept as an advanced option (L).

**004 Invite my team**
- Invitation links, signup, recovery codes, and temporary passwords from the owner.
- The owner assigns app roles; a person can hold several.
- Deeper app integration left out of 002, placed with 004, 005 and 007 and settled there: level 1,
  Your Space as an OpenID Connect provider, matters most once there are members.
- Removing a member, and keeping former members traceable.

**005 Let my agent work for me**
- Agent identities and credentials: create, view, revoke, rotate.
- Delegating an exact subset of your roles; removal reaches live sessions.
- Your Space as the gateway, and agent commands in the CLI.
- Level 2 integration for agents: verified identity and app roles in apps through an SDK, and the
  same backend checks for UI and programmatic access.
- The activity log, which the owner can review.

**006 Keep my space safe over time**
- Updating Your Space and apps, with automatic rollback when an update fails.
- Backup and restore, easy for people and their agents to script; moving a workspace to another
  installation is a backup and restore they do themselves.
- Uninstall, which keeps data unless the owner confirms deletion.

**007 Build my own app**
- Versioned, documented public contracts that work for managed and external apps (level 2).
- The TypeScript and Python SDKs, each verified with a working app.
- Adding an app someone already runs elsewhere, through a connector.

**008 Use Your Space as an app on my computer**
- Desktop app on macOS, Linux, and Windows (L), signed and self-updating; the intended primary client.
- Installed apps in native views instead of iframes.
- Windows (L), moved from 003: the CLI and a local workspace there.
- Local mode: provide the engine (Your Space's own VM by default, settled into 008 by spec 003), set up
  through the CLI, start with the app, update, back up, uninstall.
- A clear message when app, CLI, and server versions don't match; the installable PWA (L).

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
