<!--
Sync Impact Report (2026-11-07): 1.1.1 -> 1.2.0 (minor: materially expanded principle)
- Expanded: II. Preserve User Control and Hosting Choice now requires configuration to be optional:
  safe defaults that suit most installations, an owner's configuration that starts empty and holds
  only what they change, derived values instead of extra settings, and generated secrets.
- Rationale: in the 001 implementation review, the owner asked that configuration work like editor
  settings: nothing to fill in by default, one line per change. Every required setting is a chance
  to get an install wrong, and defaults the project owns can improve without owners editing files.
- Impact: the 001 plan and implementation required YS_PUBLIC_URL and two secrets in .env, and a
  YS_BIND_ADDRESS line for own-domain installs. PR #6 brings the setup in line (2026-11-08): no
  line for this machine, one line (YS_DOMAIN or YS_PROXY_URL) for other devices, and the two
  secrets are generated unless .env sets them (research R16). Later plans name the default and the
  derivation for every setting they add.

Sync Impact Report (2026-11-03): 1.1.0 -> 1.1.1 (patch: clarification)
- Clarified: VII. Reuse Before Building now says to use each library only for the purpose it was
  built for, rather than stretching an available feature into a general system for the app.
- Rationale: in the 001 plan review, Better Auth's rate limiter was proposed as the app's rate
  limiter; it only protects Better Auth's own routes and cannot count per account.
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

Installed apps use platform-provided identity and respect platform permissions while enforcing
their own domain rules. Self-hosted and managed deployments expose compatible, versioned app
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

Technical plans name the dependency or native feature each requirement relies on, and justify each
new dependency and each piece of custom machinery.

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

## Governance

This constitution guides feature specifications, technical plans, implementation, and review.

Amendments must record their rationale, affected principles, and impact on existing plans or
implementations. Amendments are reviewed through the repository's normal process. Update the
version when principles change: use a major increment for incompatible removals or redefinitions,
a minor increment for new or materially expanded principles, and a patch increment for
clarifications and other non-semantic changes.

When a proposal conflicts with the constitution, resolve the conflict explicitly by revising the
proposal or amending the relevant principle.

**Version**: 1.2.0 | **Ratified**: 2026-10-28 | **Last Amended**: 2026-11-07
