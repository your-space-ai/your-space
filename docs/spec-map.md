# Spec Map

**Last updated**: 2026-11-03

The pre-public [roadmap](roadmap.md) is delivered through eight specifications. Each one follows a
person through one complete journey, from where they start to a result they can see, and covers
many roadmap items. Every pre-public roadmap item belongs to one of these specs or the release gate;
the [overview tree](roadmap.md#overview) shows the spec number beside each item.

Why: [journey-based specifications](architecture/decisions.md#journey-based-specifications).

## At a Glance

| Spec | Journey | Done when |
| --- | --- | --- |
| 001 | **Set up my space** | The operator installs Your Space, claims it, signs in, and can recover the owner account. |
| 002 | **Install an app and use it** | The owner installs the Tasks app from its URL and uses it inside Your Space. |
| 003 | **Install and run with the CLI** | One guided install on a server or laptop gives a working HTTPS space. |
| 004 | **Invite my team** | A member joins by invitation, gets app roles, and can recover their password. The owner can remove them. |
| 005 | **Let my agent work for me** | An agent uses Tasks through the CLI with some of its person's roles. The owner sees what it did and can revoke it. |
| 006 | **Keep my space safe over time** | The owner updates, backs up, restores, moves, and uninstalls without losing data. |
| 007 | **Build my own app** | A developer builds and installs a second app without changing Your Space. |
| 008 | **Use Your Space as an app on my computer** | The desktop app connects to a server or runs a space locally. |

## Build Order

```text
001 Set up ─► 002 Install an app ─► 003 CLI ─► 004 Invite ─► 005 Agents ─► 006 Keep safe ─┬─► 007 Build an app
                                                                                          └─► 008 Desktop
```

- **002 before 003:** 002 decides where apps live (subdomains or paths), which sets the domains and
  certificates the CLI installs.
- **006 after 004 and 005:** backup and restore must cover members, agents, and app data.
- **008 last:** the desktop app wraps the CLI's finished commands without changing them.
- **007 and 008** can run in parallel.

## What Each Spec Covers

Roadmap layers: [1 Install and operate](roadmap.md#1-install-and-operate) ·
[2 Identity and access](roadmap.md#2-identity-and-access) · [3 Apps](roadmap.md#3-apps) ·
[4 Agents](roadmap.md#4-agents) · [5 Clients](roadmap.md#5-clients) ·
[6 Trust and release](roadmap.md#6-trust-and-release)

**001 Set up my space** ([PR #3](https://github.com/your-space-ai/your-space/pull/3))
- Manual Compose install, data that survives restarts, access from another device, ARM and Intel images.
- Owner setup and sessions: setup code, sign-in, host-only session cookie, recovery.
- The web client.

**002 Install an app and use it**
- App UI and sign-in: where apps live, opening them inside Your Space, verified identity for apps.
- Installing from a URL: deployment file, exact images, approved Compose settings, `x-your-space`,
  settings and secrets, trust warning.
- Running apps: containers, database, storage, isolation, outbound access approval, limits, status
  and logs, removal and retained data.
- The first app contract, including app roles, the TypeScript SDK, and the Tasks app.

**003 Install and run with the CLI**
- Guided install for servers and local machines on macOS and Linux, and Windows (L).
- Commands: install, start, stop, status, logs, owner recovery.
- HTTPS: built-in proxy with automatic certificates, or your own proxy or tunnel.
- The manual Compose guide, kept as an advanced option (L).

**004 Invite my team**
- Invitation links, signup, recovery codes, and temporary passwords from the owner.
- The owner assigns app roles; a person can hold several.
- Removing a member, and keeping former members traceable.

**005 Let my agent work for me**
- Agent identities and credentials: create, view, revoke, rotate.
- Delegating an exact subset of your roles; removal reaches live sessions.
- Your Space as the gateway, and agent commands in the CLI.
- The activity log, which the owner can review.

**006 Keep my space safe over time**
- Updating Your Space and apps, with automatic rollback when an update fails.
- Backup, restore, and moving a workspace (for example, local to a server).
- Uninstall, which keeps data unless the owner confirms deletion.

**007 Build my own app**
- Versioned, documented public contracts that work for managed and external apps.
- The Python SDK, verified with a second working app.
- Adding an external app hosted elsewhere.

**008 Use Your Space as an app on my computer**
- Desktop app on macOS, Linux, and Windows (L), signed and self-updating.
- Local mode: detect Docker, set up through the CLI, start with the app, update, back up, uninstall.
- A clear message when app, CLI, and server versions don't match; the installable PWA (L).

## Rules Every Spec Follows

These apply from the first spec, so later specs don't have to retrofit them:

- **Simple by default.** Show people only what they need; advanced controls stay out of the way.
- **No telemetry.** The only automatic outbound requests are GitHub update checks.
- **ARM and Intel.** Every image ships for both.
- **Known storage.** All durable state lives in the database or named volumes, so backup has one
  clear thing to capture.
- **The actual actor.** Records credit the real actor, human or agent, from the first database schema.
- **Reuse before building.** Use open-source libraries and their native features before writing
  custom code, and keep integrations few and thin.
- **Docs and security included.** Each spec ships its own docs and tests its own security boundaries.

## Release Gate (Not a Spec)

The security review and hardening pass, privacy, legal, and the final release review are tracked in
the [public release readiness checklist](public-release-readiness.md). They check the finished
journeys rather than adding a new one.

## Keeping This Current

- When a roadmap item is added or moved, give it a spec number in the overview tree and update the
  matching section here in the same change.
- When a spec is merged, link it here and replace its PR link.
