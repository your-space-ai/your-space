# Your Space Roadmap

**Last updated**: 2026-10-30

This roadmap tracks the functionality we want to build for Your Space: a self-hostable platform
for independent apps, human users, and agents, with a managed offering planned later.

It is derived from the [architecture and product decisions](architecture/decisions.md).
That record preserves decisions and rationale; the [constitution](../.specify/memory/constitution.md)
sets governing principles; feature specifications define scope and acceptance.

The pre-public checklist describes the intended core experience and work needed before publishing
the repository. The post-public checklist captures later direction and possible enhancements.
Release scope and details may evolve as the remaining questions are resolved. See the
[public release readiness checklist](public-release-readiness.md) for the publication review.

**Next discussion:** Define the remaining app deployment-file and lifecycle scope, including whether
app updates are required before publication. Published images with exact declared versions are selected
for the first release; building from source is post-open-source work.

Each parent checkbox represents a capability; its nested checkboxes track specific functionality.
Checked items mean delivered and verified work, not completed planning. Keep completed items in
place with their completion date and implementation PR or release link so this remains a record.
All functionality below is currently unchecked because application implementation has not started.

## Pre-public: Core Experience and First Working Version

The first release targets people comfortable installing Docker and following a guided CLI. The
[owner-access feature (PR #3)](https://github.com/your-space-ai/your-space/pull/3) is first; the
CLI follows in a separate specification and implementation PR. The remaining items need their
own specifications; their order here is not a delivery sequence.

- [ ] **Workspace setup and owner access**

  **Source:** [Accepted foundation decisions](architecture/decisions.md#accepted-foundation-decisions).

  - [ ] Install manually with documented Docker Compose procedures on supported macOS and Linux server hosts.
  - [ ] Reach browser-guided setup and prove operator authority with a temporary, single-use setup code.
  - [ ] Create one owner account and workspace, keeping account, workspace, membership, and ownership identities distinct.
  - [ ] Prevent duplicate claims and close initial registration after setup.
  - [ ] Sign in and out through one server-managed authentication system, with server-enforced session expiry and revocation.
  - [ ] Reach an accurate empty workspace and distinguish unavailable services from empty or unclaimed state.
  - [ ] Access the same server and workspace from another device through a documented encrypted connection.
  - [ ] Retain account and workspace identity across restarts and service recreation with durable storage retained.
  - [ ] Recover the existing owner account through an operator command without requiring email delivery or a standalone CLI.
  - [ ] Preserve identity and revoke existing sessions after successful password recovery.

  This first feature is owner-only and web-only. Exact host support, remote access, password rules,
  session and credential lifetimes, and failed-attempt behavior still need planning.

- [ ] **CLI installation and management**

  **Source:** [CLI delivery sequence](architecture/decisions.md#cli-delivery-sequence).

  - [ ] Guide local and production self-hosted installation of the established Compose deployment through the Your Space CLI.
  - [ ] Manage the deployment through operations defined in the CLI specification.

  The CLI follows the working, verified manual Compose deployment and owner-access implementation.
  Commands, packaging, prerequisites, and management scope remain to be specified.

- [ ] **Additional workspace members**

  **Source:** [Owner and workspace model](architecture/decisions.md#owner-and-workspace-model).

  - [ ] Let the owner create an invitation link and share it directly with a prospective member.
  - [ ] Let the recipient sign up and join the workspace through the invitation.
  - [ ] Let workspace administrators assign app roles to human members.
  - [ ] Retain existing account, workspace, membership, and ownership identities when adding members.

  Invitation and membership details require their own specification.

- [ ] **Workspace clients**

  **Source:** [UI integration](architecture/decisions.md#ui-integration).

  - [ ] Provide web, desktop, and installable PWA clients with the same core workspace and installed-app experience when connected to the server.
  - [ ] Support and test the desktop client on macOS, Windows, and Linux.
  - [ ] Open installed apps within the Your Space interface while platform navigation remains available.
  - [ ] Preserve normal frontend requests to the app backend without requiring each request to be rewritten for Your Space.
  - [ ] Apply equivalent backend authorization checks to human UI and programmatic access.

  The first owner feature uses the web client. Desktop technology, PWA offline behavior, embedding,
  origins, routing, isolation, and session bridging remain open.

- [ ] **Independent app deployment and lifecycle**

  **Source:** [Platform and independent apps](architecture/decisions.md#platform-and-independent-apps) and [app distribution](architecture/decisions.md#accepted-future-app-distribution-direction).

  - [ ] Let the owner install a compatible public GitHub repository by pasting its URL into the UI.
  - [ ] Read the app's separate deployment file from the repository's default branch and record the exact revision used for installation.
  - [ ] Download and run published container images using the exact image and version declared in the app's integration files for each container, including database services; validate and retain the installed image identity.
  - [ ] Start and manage each app's independent container or containers using Docker on the same server as Your Space.
  - [ ] Run an app-declared database service alongside the app when needed.
  - [ ] Provide app-specific durable storage that survives restarts and remains after uninstall.
  - [ ] Let the owner explicitly delete retained app data from the administration UI.
  - [ ] Restrict app installation and removal to the owner for the first public release.
  - [ ] Isolate apps from host filesystem access, devices, and Docker controls, and protect platform services and other apps.
  - [ ] Preserve app identity, exact source version, provenance, and approved update source or policy; do not silently expand granted access on update.

  Published images are the only first-release installation path; Your Space does not build app source
  during installation. Remaining deployment-file contents, format, discovery details, image identity
  validation, resource and isolation enforcement, lifecycle, update mechanics, and rollback need
  definition. A deployment file does not itself guarantee isolation; that boundary needs design and
  verification.

- [ ] **App integration and developer experience**

  **Source:** [Platform and independent apps](architecture/decisions.md#platform-and-independent-apps).

  - [ ] Document versioned public integration contracts for independently built and running apps.
  - [ ] Publish an SDK from this repository for apps in their own repositories, including first-party apps.
  - [ ] Enable developers to create or adapt apps and install them without rebuilding Your Space or including app source in the platform build.
  - [ ] Provide at least one independently maintained, installable app and verify the complete installation and usage journey.

  The app contract, SDK language and coverage, and first app choice remain open. A small Tasks app
  is a candidate, not a committed choice.

- [ ] **Platform identity and app-owned roles**

  **Source:** [Identity and app-owned roles](architecture/decisions.md#identity-and-app-owned-roles).

  - [ ] Supply verified human or agent identity to installed apps.
  - [ ] Let apps publish stable role identifiers while retaining their own role semantics and resource rules.
  - [ ] Assign multiple app roles to humans and agents within an app installation and workspace.
  - [ ] Integrate identity and role assignments at the app's authentication and authorization boundary, reusing existing boundaries where suitable.

  The identity protocol, role catalog, and compatibility with app authorization semantics remain
  open. Your Space supplies identity and assignments; each app enforces its protected operations.

- [ ] **External agent access**

  **Source:** [Delegation by exact role subsets](architecture/decisions.md#delegation-by-exact-role-subsets).

  - [ ] Give external agents distinct identities and non-interactive credentials linked to their delegating human.
  - [ ] Let a user delegate any exact subset of their assigned role IDs for the same app installation and workspace.
  - [ ] Remove the corresponding delegated role from affected agents when the human loses that role.
  - [ ] Apply access removal to existing app sessions and credentials.
  - [ ] Attribute app actions to the actual actor and retain the delegating-user relationship.
  - [ ] Verify permitted operations, denied actions, attribution, and revocation against an installed app.

  Credential issuance, revocation guarantees, refresh behavior, and compatibility with app role
  semantics remain open. External agents precede platform-hosted agent execution.

- [ ] **Public release readiness**

  **Details:** [Public release readiness checklist](public-release-readiness.md).

  - [ ] Review repository history, GitHub content, and release artifacts for private data and secrets.
  - [ ] Review publication rights, project and dependency licensing, and required notices.
  - [ ] Review security and isolation, provide safe defaults, and establish private vulnerability reporting.
  - [ ] Document installation, operation, recovery, developer integration, contribution, and project status.
  - [ ] Verify the core journeys, supported environments, release artifacts, recovery, and maintenance paths.
  - [ ] Review release evidence, unresolved issues, and GitHub settings before authorizing publication.

## Post-public: Later Direction and Enhancements

These capabilities are not required for the first public release. Their order and timing remain open.

- [ ] **Build apps from source during installation**

  **Deferred (2026-10-30):** [App deployment decision](architecture/decisions.md#accepted-future-app-deployment-direction).

  - [ ] Support building app images from repository source as an additional installation path.

  The first release requires developers to publish the exact images and versions declared by their
  app's integration files. Build execution and its operational requirements belong to this later work.

- [ ] **Private GitHub app installation**

  **Source:** [App distribution](architecture/decisions.md#accepted-future-app-distribution-direction).

  - [ ] Connect a GitHub account to install private repositories the user is authorized to access.

- [ ] **Optional app discovery**

  **Source:** [App distribution](architecture/decisions.md#accepted-future-app-distribution-direction).

  - [ ] Discover apps through curated listings using the same installation contract as direct GitHub installation.
  - [ ] Allow official, community, and private discovery experiences to coexist.
  - [ ] Preserve update routing when users change or disconnect discovery sources.
  - [ ] Keep direct installation available without using an official curated listing.

  Catalog implementation remains open.

- [ ] **Platform-hosted agents and workflows**

  **Source:** [Later candidate journeys](architecture/decisions.md#later-candidate-journeys).

  - [ ] Run hosted agents through the same identity and authorization contracts as external agents.
  - [ ] Support workflows such as daily triage.
  - [ ] Keep agent identity and permissions independent of a particular runtime or model provider.

  The execution runtime and model-provider integration remain open.

- [ ] **Additional deployment pathways**

  **Source:** [Deployment boundaries](architecture/decisions.md#deployment-boundaries-and-licensing).

  - [ ] Support running app containers on hosts other than the Your Space server.
  - [ ] Add app deployment backends beyond Docker as they are specified and supported.
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
