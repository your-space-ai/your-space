# Your Space Roadmap

**Last updated**: 2026-10-29

This roadmap tracks the functionality we want to build for Your Space: a self-hostable platform
for independent apps, human users, and agents, with a managed offering planned later.

It is derived from the [architecture and product decisions](architecture/decisions.md).
That record preserves decisions and rationale; the [constitution](../.specify/memory/constitution.md)
sets governing principles; [feature specifications](../specs/) define scope and acceptance.

Each parent checkbox represents a capability; its nested checkboxes track specific functionality.
Checked items mean delivered and verified work, not completed planning. Keep completed items in
place with their completion date and implementation PR or release link so this remains a record.
All functionality below is currently unchecked because application implementation has not started.

## Agreed Delivery Order

These are the first two deliveries, in order.

- [ ] **1. Workspace setup and owner access**

  **Status:** Specification in review; implementation not started.
  **Specification:** [Workspace Setup and Owner Access](../specs/001-workspace-owner-access/spec.md).
  **Source:** [Accepted foundation decisions](architecture/decisions.md#accepted-foundation-decisions).

  - [ ] Install manually with documented Docker Compose procedures on supported macOS and Linux hosts.
  - [ ] Reach browser-guided setup and prove operator authority with a temporary, single-use setup code.
  - [ ] Create one owner account and workspace, with distinct account, workspace, membership, and ownership concepts and relationships.
  - [ ] Prevent duplicate claims and close initial registration after setup.
  - [ ] Sign in and out through one server-managed authentication system, with server-enforced session expiry and revocation.
  - [ ] Reach an accurate empty workspace and distinguish unavailable services from empty or unclaimed state.
  - [ ] Access the same server and workspace from another device through a documented encrypted connection.
  - [ ] Retain account and workspace identity across restarts and service recreation with durable storage retained.
  - [ ] Recover the existing owner account through an operator command without requiring email delivery or a standalone CLI.
  - [ ] Preserve identity and revoke existing sessions after successful password recovery.

  This establishes the Compose deployment that later tooling will manage. Independent apps,
  agents, additional members, and the standalone CLI remain outside this delivery.
  Remaining planning decisions include the support matrix, encrypted remote-access pathway,
  account/password rules, session and credential lifetimes, and failed-attempt behavior.

- [ ] **2. CLI installation and management**

  **Status:** Agreed follow-up; separate specification not yet written.
  **Dependency:** The working, verified manual Compose deployment and owner-access implementation.
  **Source:** [CLI delivery sequence](architecture/decisions.md#cli-delivery-sequence).

  - [ ] Guide installation of the established Compose deployment through the Your Space CLI.
  - [ ] Support CLI installation for local and production self-hosted deployments.
  - [ ] Manage the existing deployment through the operations defined in the CLI specification.

  Its implementation PR follows owner access. The command set, distribution format, prerequisite
  handling, configuration, and management operations remain to be specified; no particular
  management command is committed by this checklist.

## App and Agent Foundations

These capabilities need their own specifications after the initial platform and CLI work.
Their order here is not a release sequence. The app contract must be agreed before implementing
independent app installation and SDK integration.

- [ ] **Independent apps and SDK**

  **Source:** [Platform and independent apps](architecture/decisions.md#platform-and-independent-apps).

  - [ ] Integrate independently built and running apps through documented, versioned public contracts.
  - [ ] Publish an SDK from this repository for use by apps in their own repositories, including first-party apps.
  - [ ] Install compatible apps without rebuilding Your Space or including their source in the platform build.
  - [ ] Protect platform services and other apps through the app runtime isolation boundary.

  Packaging, execution, isolation, storage, compatibility, SDK languages, and lifecycle contracts
  remain open.

- [ ] **Installed apps within the web client**

  **Source:** [UI integration](architecture/decisions.md#ui-integration).

  - [ ] Open installed apps while Your Space navigation remains available.
  - [ ] Preserve existing app frontend requests to the app's backend without requiring every request to be rewritten.
  - [ ] Apply equivalent backend authorization checks to human UI and programmatic access.

  Embedding, origins, routing, isolation, and session bridging remain open. No iframe or alternative
  mechanism is selected yet.

- [ ] **Platform identity and app-owned authorization**

  **Source:** [Identity and app-owned roles](architecture/decisions.md#identity-and-app-owned-roles).

  - [ ] Supply verified human or agent identity to installed apps.
  - [ ] Let apps publish stable role identifiers while retaining their native role and resource rules.
  - [ ] Assign multiple app roles to humans and agents within an app installation and workspace.
  - [ ] Integrate identity and role assignments at the app's authentication and authorization boundary, reusing existing boundaries where suitable.

  The identity protocol, role catalog, and compatibility with app authorization semantics remain
  open. Your Space supplies identity and assignments; each app enforces its protected operations.

- [ ] **External agent access**

  **Source:** [Delegation by exact role subsets](architecture/decisions.md#delegation-by-exact-role-subsets).

  - [ ] Give agents distinct identities and non-interactive credentials, linked to their delegating human.
  - [ ] Let a user delegate any exact subset of their assigned role IDs for the same app installation and workspace.
  - [ ] Remove the corresponding delegated role from affected agents when the human loses that role.
  - [ ] Apply access removal to existing app sessions and credentials.
  - [ ] Attribute app actions to the actual actor and retain the delegating-user relationship.

  Credential issuance, revocation guarantees, refresh behavior, and compatibility with app role
  semantics remain open. External agents precede platform-hosted agent execution.

- [ ] **Tasks integration journey — candidate**

  **Status:** Candidate app, not a committed next release.
  **Dependency:** The platform foundation and an agreed app contract.
  **Source:** [Later candidate journeys](architecture/decisions.md#later-candidate-journeys).

  - [ ] Install a small Tasks app maintained in its own repository through the public app contract.
  - [ ] Create and view a task inside the Your Space interface.
  - [ ] Recover that task after restarting the deployment.
  - [ ] Allow limited external-agent access to the same app operations.
  - [ ] Verify attribution, denied actions, and revocation through UI and programmatic access.

  This could validate the SDK, app integration, and external-agent access together.

## Broader Product Direction

These areas are unscheduled. No order or release dates are committed; candidate items are labeled.

- [ ] **GitHub app installation and updates**

  **Source:** [App distribution](architecture/decisions.md#accepted-future-app-distribution-direction).

  - [ ] Install compatible apps directly from public GitHub repositories.
  - [ ] Connect GitHub access to install private repositories the user is authorized to access.
  - [ ] Preserve app identity, exact version, provenance, and approved update source or policy.
  - [ ] Update apps without silently expanding granted access.

  This depends on the app contract. Artifact trust, installation, updates, and rollback need specification.

- [ ] **Optional app discovery**

  **Source:** [App distribution](architecture/decisions.md#accepted-future-app-distribution-direction).

  - [ ] Discover apps through curated listings using the same installation contract as direct GitHub installation.
  - [ ] Allow official, community, and private discovery experiences to coexist.
  - [ ] Preserve update routing when users change or disconnect discovery sources.
  - [ ] Keep direct installation available without using an official curated listing.

  Catalog implementation remains open.

- [ ] **Shared workspaces**

  **Source:** [Owner and workspace model](architecture/decisions.md#owner-and-workspace-model).

  - [ ] Add human members without replacing existing account, workspace, membership, or ownership identities.
  - [ ] Let workspace administrators assign app roles to human members.

  Membership and collaboration need their own scope and access rules.

- [ ] **Platform-hosted agents and workflows**

  **Dependency:** External-agent access.
  **Source:** [Later candidate journeys](architecture/decisions.md#later-candidate-journeys).

  - [ ] Run hosted agents through the same identity and authorization contracts as external agents.
  - [ ] Support workflows such as daily triage.
  - [ ] Keep agent identity and permissions independent of a particular runtime or model provider.

  The execution runtime and model-provider integration remain open.

- [ ] **Additional deployment pathways**

  **Source:** [Deployment boundaries](architecture/decisions.md#deployment-boundaries-and-licensing).

  - [ ] Provide platform-specific installation guides and deployment adapters for additional supported environments.
  - [ ] Keep provider-specific provisioning, networking, and storage outside the core platform.
  - [ ] Verify persistence and lifecycle behavior for each newly supported environment.

  Cloudflare and other cloud pathways need investigation before support is claimed.

- [ ] **Managed service**

  **Source:** [Product and repository direction](architecture/decisions.md#accepted-product-and-repository-direction).

  - [ ] Provide hosted Your Space for users who do not want to operate a server.
  - [ ] Preserve compatible app contracts between self-hosted and managed deployments.
  - [ ] Use the same server-managed authentication model across deployment modes.

  Provisioning, operations, billing, and email delivery require future planning.

- [ ] **Desktop client — candidate**

  **Source:** [Installation and hosting](architecture/decisions.md#installation-and-hosting).

  - [ ] Provide a desktop client alongside the web client.

  Electron is a candidate. Desktop scope and timing remain uncommitted; the initial client is web-only.

## Maintaining the Checklist

- Keep high-level functionality as parent checkboxes and specific functionality as nested checkboxes.
  Add detail as specifications are agreed rather than inventing functionality to fill out future items.
- Check an item only after its scoped behavior is delivered and verified. Add the completion date
  and an implementation PR or release link beside it, and retain checked entries in place.
- Check a parent only when all its in-scope children are complete and the combined capability works.
  If agreed scope grows later, add the new children and reopen the parent while retaining completed children.
- Record deferrals, cancellations, or replacements explicitly with a date and decision link. Do not
  delete an item to hide unfinished work or check it off because it was dropped.
- Record changed direction in the decision record first, then update this checklist in the same PR.
  Keep rationale in decisions and acceptance criteria in specifications.
- Update statuses and links as specifications and implementation evidence become available. Preserve
  the distinction between agreed order, unscheduled direction, and candidates.
