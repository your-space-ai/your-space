<!--
Sync Impact Report (2026-11-19): 1.4.1 -> 1.5.0 (minor: narrowed principle)
- Changed: II. Preserve User Control and Hosting Choice. Your Space controls who reaches every
  installed app at Your Space's own addresses; an app the owner publishes on a port of the machine
  is reached through the owner's own network setup instead.
- Rationale: the owner decided to separate running apps from reaching them (decision record,
  "Running Apps and Reaching Them"). Your Space runs and manages apps; reaching them belongs to the
  owner's proxy, tunnel or platform edge, which setups such as Tailscale need, since their names
  can't hold an app's built-in address. Publishing meets the same principle's "opened by an
  explicit choice": it is opt-in per app and listens on 127.0.0.1 unless the owner chooses another
  address.
- Impact: journey 002's FR-014 and FR-015 note the published port as the exception; its access gate
  stays the default way to reach an app, unchanged. How agents reach a published app is left to
  journey 005's gateway. A major increment is the alternative if this is read as a redefinition.

Sync Impact Report (2026-11-17): 1.4.0 -> 1.4.1 (patch: clarification)
- Clarified: VII. Reuse Before Building now says to check whether an existing dependency handles a
  need well before adding a new one, to use each dependency appropriately and as needed through its
  own features, and not to build custom extensions, wrappers or parallel layers on top of it; when
  its own features fall short, revisit the choice rather than growing code around it.
- Rationale: the owner asked, while journey 003 chose its CLI libraries, that the project add as
  few dependencies as possible, prefer one it already has when that one handles the problem well,
  and use them without custom extensions. The principle already asked for few dependencies and
  native features; this makes the rest explicit.
- Impact: journey 003's plan uses Commander's own help, version, errors and exit handling and
  Clack's own prompts, spinners, logs and notes, with no output layer of its own beyond `--json`.

Sync Impact Report (2026-11-14): 1.3.0 -> 1.4.0 (minor: new principle)
- Added: VIII. Build Around Concepts, Not Technologies. Your Space implements against concepts, such
  as an engine connection, an app endpoint or a secret store, that different technologies sit behind
  through adapters. Only an adapter knows its technology, and a plan names the concept and its first
  adapter.
- Rationale: running apps ties Your Space to a runtime for the first time, and other runtimes are
  already in view (k3s, an engine on another machine, apps someone already runs). Written against
  concepts, each is a new adapter rather than a change through Your Space.
- Impact: journey 002's plan follows it: the server talks to the runtime in terms of apps, services,
  endpoints and outbound hosts, and only the runtime manager, the Docker adapter, knows Docker.
  The decision record gains a Concepts and Adapters section; later plans name concepts and adapters.
- Clarified: II. Preserve User Control and Hosting Choice no longer requires every installed app to
  use platform-provided identity. Your Space controls who reaches every app; apps that integrate use
  its identity and permissions, and existing apps that don't keep their own accounts (journey 002,
  integration levels).

Sync Impact Report (2026-11-10): 1.2.0 -> 1.3.0 (minor: materially expanded section)
- Expanded: Development Workflow now says code lands with its first use. In a stack of pull
  requests, each file, top-level function or component, script, and configuration entry arrives in
  the first pull request where something runs it, or where a developer first needs it to run,
  develop, or test the app. Code inside a function is not split across pull requests.
- Rationale: code that lands before anything runs it can't be checked by its own pull request, and
  reviewers end up judging it without seeing it work.
- Impact: journey 001's stack (#8 to #15) was rearranged to follow it on 2026-11-10; later journeys
  plan their stacks this way.

Sync Impact Report (2026-11-07): 1.1.1 -> 1.2.0 (minor: materially expanded principle)
- Expanded: II. Preserve User Control and Hosting Choice now requires configuration to be optional:
  safe defaults that suit most installations, an owner's configuration that starts empty and holds
  only what they change, derived values instead of extra settings, and generated secrets.
- Rationale: the owner asked that configuration work like editor settings: nothing to fill in by
  default, one line per change. Every required setting is a chance to get an install wrong, and
  defaults the project owns can improve without owners editing files.
- Impact: since 2026-11-08 the 001 plan follows it: no line in .env for this machine, one line
  (YS_DOMAIN or YS_PROXY_URL) for other devices, and the two secrets are generated unless .env sets
  them (research R16). Later plans name the default and the derivation for every setting they add.

Sync Impact Report (2026-11-03): 1.1.0 -> 1.1.1 (patch: clarification)
- Clarified: VII. Reuse Before Building now says to use each library only for the purpose it was
  built for, rather than stretching an available feature into a general system for the app.
- Rationale: Better Auth's rate limiter protects only Better Auth's own routes and cannot count per
  account, so using it as the app's rate limiter would stretch it past the purpose it was built for.
- Impact: the 001 plan keeps Better Auth's limiter on Better Auth's own routes and adds no app-wide
  rate limiting yet; no implementations exist yet.

Sync Impact Report (2026-11-03): 1.0.0 -> 1.1.0 (minor: new principle)
- Added: VII. Reuse Before Building, With Few Trusted Dependencies
- Rationale: custom code must be maintained, secured, and documented by the project; proven
  libraries already solve most of it, while every dependency adds supply-chain and upgrade cost.
- Impact: no existing plans or implementations; decision record and spec map updated to match.
-->
# Your Space Constitution

## Core Principles

### I. Keep the Platform and Apps Independent

The Your Space repository contains the platform server, client, SDK, and public integration
contracts. Installable apps, including first-party apps, live in separate repositories with their
own builds, tests, and releases.

Apps consume documented, versioned interfaces. They must not import private platform code or
require their source to be included in the platform build.

On a compatible platform version, installing an app must not require rebuilding Your Space.
First-party apps use the same public interfaces available to other developers.

Agent identities and permissions must remain independent of any particular model provider or
execution runtime.

### II. Preserve User Control and Hosting Choice

Your Space must support self-hosting with guided installation and understandable recovery from
setup failures.

Configuration is optional. Every setting has a safe default that suits most installations, so an
owner's configuration starts empty and holds only the lines they change. Values that follow from
other settings are derived rather than asked for, wherever the tooling can derive them, and
secrets are generated when none are given. A default never exposes more than the most common setup
needs: anything reachable from the network is opened by an explicit choice.

Your Space defines the authentication model and provides server-managed user accounts and
sessions. Authentication must not require an external identity service.

Your Space controls who reaches every installed app at Your Space's own addresses. An app the owner
chooses to publish on a port of their machine is reached through the owner's own network setup
instead, such as a proxy or tunnel, and only its own sign-in guards it there. Apps that integrate with it use
platform-provided identity and respect platform permissions while enforcing their own domain rules;
apps that don't keep their own accounts. Self-hosted and managed deployments expose compatible, versioned app
contracts.

Hosting-specific dependencies must have explicit boundaries. Support for a deployment environment
must be demonstrated through working installation, persistence, and lifecycle checks. Apps must
declare additional hosting requirements.

Feature plans may support one environment first while preserving the agreed portability direction.

### III. Make Identity, Permissions, and Ownership Explicit

Humans, agents, and apps must have distinct identities where they act independently. Creating an
identity or installing an app must not automatically grant access to workspace resources.

Authorization must check the actor, workspace, operation, and current permissions. UI actions,
external agents, and platform-operated agents must follow the same authorization rules.

Access must be independently revocable. Activity must identify the responsible actor, and denied
operations must not modify protected data.

Workspace ownership, human membership, and actor attribution must remain separate concepts so
future collaboration can extend the system without reassigning existing data.

### IV. Make Apps Directly Installable

Users must be able to install compatible apps directly from GitHub repositories, including public
repositories and private repositories accessible through their connected account.

Curated app listings must use the same installation contract as direct installation.

Each installation must retain its app identity, exact source version, provenance, and update
policy. Browsing another listing must not change those records.

Repository access does not grant an app access to workspace resources. Installation and updates
must respect explicitly granted permissions.

### V. Protect Private Data

Credentials and private user data must not be committed to source control or included in published
artifacts.

Tests, examples, screenshots, and documentation must use synthetic data or material explicitly
approved for publication.

Personal workflows should be expressible through app behavior and user configuration. Platform
services should expose reusable capabilities through public contracts.

### VI. Apply Proportionate Engineering Discipline

Changes must receive specification, review, and verification appropriate to their scope and
impact.

Significant architectural decisions must document their rationale and tradeoffs. Changes affecting
authorization, data integrity, or public contracts must include evidence addressing those
behaviors.

Completion claims must accurately describe what was verified and any known limitations.

### VII. Reuse Before Building, With Few Trusted Dependencies

Do not reinvent the wheel. Prefer proven open-source libraries and tools to custom code, and use
their native features as intended rather than wrapping or reimplementing them. Custom code fills
only the gaps they leave.

Use each library for the purpose it was built for. Do not stretch a feature that happens to be
available into a general system for the app; when the app needs that system, choose a library made
for the job.

Keep the set of dependencies small and trusted. A dependency must be actively maintained, widely
used, and license-compatible, and must earn its place by replacing substantial custom code or
providing a capability the project should not own. Small, simple needs are written directly rather
than imported. Prefer one dependency that covers several needs over several narrow ones, and keep
integrations thin.

Before adding a dependency, check whether one the project already has handles the need well, and
use it rather than adding another. "Well" matters: an existing dependency stretched past what it
does well is no better than a new one. Use each dependency appropriately and as needed, through its
own features, configuration, and extension points. Do not build custom extensions, wrappers, or
parallel layers on top of it to add what it already offers or to reshape how it works; when its own
features fall short, revisit the choice rather than growing code around it.

Technical plans name the dependency or native feature each requirement relies on, and justify each
new dependency and each piece of custom machinery.

### VIII. Build Around Concepts, Not Technologies

Your Space implements against concepts, such as an engine connection, an app endpoint, or a secret
store, never against one specific tool. Different technologies sit behind a concept through
adapters.

Only an adapter knows its technology. The rest of Your Space works with the concept, so a
technology can be swapped or added by writing an adapter rather than changing Your Space.

Technical plans name the concept each technology serves and its first adapter.

## Data and Compatibility

User data must survive supported restarts and upgrades. Changes affecting stored data or public
contracts must define compatibility, migration, and recovery behavior.

Apps remain responsible for their domain rules and data migrations. The platform remains
responsible for the shared services and boundaries it exposes.

SDK and platform releases must communicate compatibility clearly. Breaking changes require an
explicit migration path or a documented limit on support.

## Development Workflow

The depth of specification, planning, and verification must be proportionate to the change. Where
feature specifications are useful, they define user outcomes. Technical plans record significant
architecture choices and their tradeoffs. Implementation tasks can connect changes to acceptance
criteria where useful.

Reviews must check applicable constitutional principles. Automated checks should enforce
repeatable requirements where practical.

Passing a checklist establishes only what that checklist evaluates; it does not substitute for
demonstrated working behavior.

Code lands with its first use. When a change is delivered as a stack of pull requests, each file,
top-level function or component, script, and configuration entry arrives in the first pull request
where something runs it: code that runs calls or renders it, a test runs it, CI or the deployment
runs it, or a developer first needs it there to run, develop, or test the app, as with a migration
generator or a local start script. Code that runs may reach it only from an error path or an event
handler; code inside a function is not split across pull requests. Anything that would land earlier
moves up to the pull request that first uses it.

## Governance

This constitution guides feature specifications, technical plans, implementation, and review.

Amendments must record their rationale, affected principles, and impact on existing plans or
implementations. Amendments are reviewed through the repository's normal process. Update the
version when principles change: use a major increment for incompatible removals or redefinitions,
a minor increment for new or materially expanded principles, and a patch increment for
clarifications and other non-semantic changes.

When a proposal conflicts with the constitution, resolve the conflict explicitly by revising the
proposal or amending the relevant principle.

**Version**: 1.5.0 | **Ratified**: 2026-10-28 | **Last Amended**: 2026-11-19
