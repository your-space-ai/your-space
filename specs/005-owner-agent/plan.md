# Implementation plan

**Baseline:** [personal dashboard decision](../../docs/architecture/decisions.md#personal-dashboard-release-boundary), [constitution](../../.specify/memory/constitution.md), [005 requirements](spec.md). Reuse the server’s owner authorization, PostgreSQL/Drizzle, actors/events, app installation registry, Caddy boundary, existing web client, CLI and test tooling. No new platform dependencies proposed. No changes to external agent software or an installation’s default permissions.

## Delivery order

1. Define kit roles, allowed methods and routes and credential recipes (result fields were dropped 2026-11-24: the app's response passes through unchanged). Verify the parser and pinned review evidence with neutral fixtures.
2. Resolve the selected service and port on the installation’s private network. Exercise the runtime and edge together before exposing any caller-facing route.
3. Add the owner API and additive storage for identities, keys, app credentials and grants. Verify zero-access defaults and upgrades from a populated installation.
4. Admit and dispatch an agent request under current authority. Exercise owner approval, withdrawal, expiry, recovery, attribution and isolation.
5. Publish discovery, invocation and receipt retrieval through the agent CLI. Test both local and remote workspace rules.
6. Connect the owner dashboard to the same API. Use a running fixture to check approval, denial, key rotation and the final app state from the browser.
7. Let an operator add routes to an existing local kit in place, preserving the installation and its data. Verify the original installation when upgrading and refreshing its interface.

Qualify each independent app against its pinned version before enabling a route. Verify its installation recipe, license and credential scope. For writes, observe one created record after retry and a rejected stale edit. Keep app-specific manifests and credentials outside the platform repository. The [acceptance walkthrough](quickstart.md) covers a real external agent, including denial and revocation.

## Data and request path

Extend the actor/event schema additively. An agent identity references the owner, workspace and durable actor; credentials reference an agent, verifier, public ID and status. Role grants reference immutable installation and Your Space’s versioned role enablements for that installation. Store the pinned kit, encrypted app credential binding, per-agent/installation all-write setting and route overrides. Pending requests have a bounded expiry, encrypted normalized input, a revision, and one owner decision. Atomically claim an approved request once before dispatch; reconcile uncertain outcomes using its operation ID. Enforce uniqueness and transactional version checks. An invocation records request ID, actor, credential ID, installation, action, admission and outcome. Scope operation IDs to installation, actor and action and bind them to a request fingerprint. The app owns resource IDs and data revisions. Prove write receipt and replay guarantees for the mapped route before enabling it.

Separate the human app gate from agent admission. The CLI calls the server. The server authenticates the agent, resolves the pinned installation catalog, checks current authority and sends a constrained request to the kit-declared app API route over an authenticated installation-scoped channel. The server has no general network path to app containers today. Use the existing per-installation edge routing boundary with a dedicated internal gateway route; the runtime continues to own Docker access. Never resolve action targets from agent input or use the owner-published port. Resolve the route and method from the pinned kit and the currently granted role union. Resolve the encrypted app credential by installation and inject it only into the validated internal request. For an integration that consumes an agent identity envelope, also authenticate its audience and request binding. Verify direct or replayed calls cannot convey fresh authority. Qualify that path before accepting real data.

Maintain grant revisions in Your Space. Verify that the owner’s bound credential is valid for the installed service. Disable affected writes if the mapped route cannot provide the required conditional or idempotent behavior. A durable “dispatched/outcome unknown” record survives a crash and is reconciled against the app receipt. Include distinct request IDs for repeated attempts while retaining one operation ID for their common write. Reads and status lookups also require current authority.

## Verification

Unit and integration tests cover additive migration from 003, boundary checks, concurrent revocation/admission, app uninstall/reinstall, independent credentials, idempotency conflicts, approval precedence, kit version migration, community provenance, concurrent approval/revocation, redacted upstream errors and audit redaction. Browser tests exercise the owner controls and reread the changed record from the app. Use a second fixture with unrelated roles and actions to prove the same platform binary works. Only a real external agent run counts for external-agent acceptance. The [delivery checklist](tasks.md) tracks implementation and evidence.
