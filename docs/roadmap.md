# Your Space Roadmap

**Last updated**: 2026-10-29

This roadmap presents the intended delivery path for Your Space: a self-hostable platform for
independent apps, human users, and agents, with a managed offering planned later.

It is a derived view of the [architecture and product decisions](architecture/decisions.md).
That record preserves decisions and rationale; the [constitution](../.specify/memory/constitution.md)
sets governing principles; [feature specifications](../specs/) define delivery scope and acceptance.
The roadmap summarizes what we want to build and the dependencies between those capabilities.

The first feature is being specified; application implementation has not started. Only the first
two deliveries below have an agreed consecutive order. Later areas are unscheduled, and candidates
remain subject to selection. No release dates are committed.

## Agreed Delivery Order

### 1. Workspace Setup and Owner Access

**Status:** Specification in review; implementation not started.

Establish a working platform that a person can deploy and use as its sole initial owner.

- Install manually with documented Docker Compose procedures on supported macOS and Linux hosts.
- Reach browser-guided setup, prove setup authority, and create one owner account and workspace.
- Sign in and out through one server-managed authentication system.
- Access the same server and workspace from another device through a documented encrypted connection.
- Retain account and workspace identity across restarts and service recreation.
- Recover the existing owner account through an operator command without requiring email delivery.

This delivery establishes the real Compose deployment that later tooling will manage. It does
not require a standalone Your Space CLI, independent apps, agents, or additional human members.

Remaining planning decisions include the support matrix, encrypted remote-access pathway, account/password
rules, session and credential lifetimes, and failed-attempt behavior.

**Specification:** [Workspace Setup and Owner Access](../specs/001-workspace-owner-access/spec.md).
**Source:** [Accepted foundation decisions](architecture/decisions.md#accepted-foundation-decisions).

### 2. CLI Installation and Management

**Status:** Agreed follow-up; separate specification not yet written.

Provide a Your Space CLI that guides installation and manages the established Compose deployment
for local and production self-hosting. Its implementation PR follows the owner-access implementation.

The CLI will build on the existing deployment and account behavior. Its specification must define
the command set, distribution format, prerequisite handling, configuration, and management operations.
Those details are not selected by this roadmap.

**Dependency:** A working, verified manual Compose deployment.
**Source:** [CLI delivery sequence](architecture/decisions.md#cli-delivery-sequence).

## App and Agent Foundations

These capabilities need their own specifications after the initial platform and CLI work.
The rows describe related work, not a committed sequence of separate releases.

| Area | Intended outcome | What must be resolved |
| --- | --- | --- |
| Independent app contract and SDK | Developers adapt an app to run independently in Your Space using documented, versioned contracts. The SDK is published from this repository; apps, including first-party apps, remain in separate repositories. | Packaging, execution and isolation, storage, compatibility, SDK languages, and lifecycle contracts. |
| Apps within the web client | Users open installed apps while Your Space navigation remains available. Existing app frontend requests can continue using the app's backend. | Embedding, origins, routing, isolation, and session bridging. No iframe or alternative mechanism is selected yet. |
| Platform identity and app-owned authorization | Apps receive verified human or agent identity and app role assignments while retaining their native role and resource rules. Humans and agents can hold multiple roles. | Identity protocol, role catalog, integration boundary, and compatibility with app authorization semantics. |
| External agent access | Users delegate an exact subset of their assigned role IDs for the same app installation and workspace to distinct agent identities. Removing a human role removes that delegated role from affected agents, including access through existing credentials and sessions. | Credential issuance, attribution, revocation guarantees, and refresh behavior. External agents precede platform-hosted agent execution. |

The app contract must be agreed before implementing independent app installation and SDK integration.
The platform supplies identity and role assignments; each app enforces its own protected operations.

**Sources:** [Platform and independent apps](architecture/decisions.md#platform-and-independent-apps)
and [app UI and authorization direction](architecture/decisions.md#accepted-future-app-ui-and-authorization-direction).

### Candidate Validation Journey: Tasks

**Status:** Candidate app, not a committed next release.

A small Tasks app in its own repository could validate the app contract and SDK through one
complete journey: install the app, create and view a task inside Your Space, recover the task
after restart, and allow limited agent access. Verification would include attribution, denied
actions, and revocation through both UI and programmatic access.

This depends on the platform foundation and an agreed app contract. App and external-agent
integration can be delivered together for this journey; they do not require separate releases.

**Source:** [Later candidate journeys](architecture/decisions.md#later-candidate-journeys).

## Broader Product Direction

These are later areas of work with no agreed order or delivery dates.

| Area | Direction | Status and dependencies |
| --- | --- | --- |
| GitHub app installation and updates | Install compatible apps directly from public repositories and authorized private repositories through connected GitHub access. Preserve app identity, exact version, provenance, and approved update source; updates must not silently expand access. | Accepted direction. Requires the app contract and decisions about artifact trust, installation, updates, and rollback. |
| App discovery | Offer optional curated listings using the same installation contract as direct repository installation. Official, community, and private discovery can coexist without changing installed apps' update routing. | Accepted direction. Discovery is optional for installation; catalog implementation remains open. |
| Shared workspaces | Extend the owner-only foundation with additional human members and role administration while preserving account, workspace, membership, and ownership identities. | Future direction. Membership and collaboration need their own scope and access rules. |
| Platform-hosted agents and workflows | Run workflows such as daily triage through the same identity and authorization contracts used by external agents. | Accepted later direction, after external-agent access. Execution runtime and model-provider integration remain open. |
| Additional deployment pathways | Provide platform-specific guides and adapters while keeping hosting-specific provisioning, networking, and storage outside the core platform. | Accepted direction. Each supported environment needs working persistence and lifecycle checks. Cloudflare and other cloud pathways require investigation before support is claimed. |
| Managed service | Offer hosted Your Space for users who do not want to operate a server, with compatible app contracts and the same authentication model. | Accepted later direction. Provisioning, operations, billing, and email delivery require future planning. |
| Desktop client | Consider an Electron client alongside the web client. | Candidate only. The initial client remains web-only; desktop scope and timing are uncommitted. |

**Sources:** [Owner and workspace model](architecture/decisions.md#owner-and-workspace-model),
[product and repository direction](architecture/decisions.md#accepted-product-and-repository-direction),
[app distribution](architecture/decisions.md#accepted-future-app-distribution-direction),
[later candidate journeys](architecture/decisions.md#later-candidate-journeys), and
[installation and hosting](architecture/decisions.md#installation-and-hosting).

## Maintaining This Roadmap

- Record newly agreed direction or changed decisions in the architecture and product decision record,
  then update the affected roadmap entries in the same PR.
- Keep outcomes and dependencies here; keep rationale in decisions and acceptance criteria in specifications.
- Link a roadmap item to its specification and implementation evidence as those become available.
- Update delivery status from reviewed work and verified outcomes; a specification alone does not mean a feature shipped.
- Preserve the distinction between agreed order, unscheduled direction, and candidates. Do not invent
  dates or promote an open technical choice into a commitment.
