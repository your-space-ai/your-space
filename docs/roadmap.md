# Your Space Roadmap

**Last updated**: 2026-11-01

This roadmap tracks the functionality we want to build for Your Space: a self-hostable platform
for independent apps, human users, and agents, with a managed offering planned later.

It is derived from the [architecture and product decisions](architecture/decisions.md).
That record preserves decisions and rationale; the [constitution](../.specify/memory/constitution.md)
sets governing principles; feature specifications define scope and acceptance.

The pre-public checklist describes the intended core experience and work needed before publishing
the repository. The post-public checklist captures later direction and possible enhancements.
Release scope and details may evolve as the remaining questions are resolved. See the
[public release readiness checklist](public-release-readiness.md) for the publication review.

**Current direction:** Owner access with a manual Compose install comes first (PR #3), followed by
a CLI that drives Docker Compose for server and local installs. An Electron desktop app for macOS,
Windows, and Linux connects to a server or drives the CLI to run a local workspace; Windows supports
the desktop app and local workspaces through Docker Desktop, but not server hosting. Before
publication, the release also needs invited members; web, desktop, and PWA clients; app installation
from a pasted Docker Compose deployment file limited to an approved list of settings and exact
published image versions, with app details in an `x-your-space` section; owner-triggered app and
Your Space updates that roll back automatically if they fail; TypeScript and Python SDKs with a small
Tasks app as the first app; app roles and external agents; and a security hardening pass on app and
workspace boundaries. Backup and restore, automatic app updates, building apps from source, and
alternative deployment-file formats are post-open-source work.

**Next discussion:** Member password recovery without email, remaining pre-public open questions,
and whether to reduce the first release's size; then a final consistency review.

Each parent checkbox represents a capability; its nested checkboxes track specific functionality.
Checked items mean delivered and verified work, not completed planning. Keep completed items in
place with their completion date and implementation PR or release link so this remains a record.
All functionality below is currently unchecked because application implementation has not started.

## Pre-public: Core Experience and First Working Version

The first release targets people who can install Docker Desktop and the Your Space desktop app for a
local workspace, or install Docker and follow a guided CLI for a server or local workspace. The
[owner-access feature (PR #3)](https://github.com/your-space-ai/your-space/pull/3) is first; the CLI
follows in a separate specification and implementation PR. The remaining items need their own
specifications; their order here is not a delivery sequence.

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

  - [ ] Guide local and server installation through the Your Space CLI, which drives Docker Compose so users don't run Compose themselves.
  - [ ] Provide at least install, start, stop, status, logs, update Your Space, and owner password recovery.
  - [ ] Before updating Your Space, record versions and snapshot its data; if the update fails, roll back automatically.
  - [ ] Keep the manual Compose procedure documented as an advanced alternative to the CLI.
  - [ ] Run the CLI on macOS, Windows, and Linux so the desktop app can drive it for local workspaces.

  The CLI follows the working, verified manual Compose deployment and owner-access implementation.
  Command names, packaging, prerequisites, and the rest of the management scope remain to be specified.
  The update rollback uses the same snapshot mechanism as app updates. Backup and restore are post-open-source.

- [ ] **Additional workspace members**

  **Source:** [Owner and workspace model](architecture/decisions.md#owner-and-workspace-model).

  - [ ] Let the owner create an invitation link and share it directly with a prospective member.
  - [ ] Let the recipient sign up and join the workspace through the invitation.
  - [ ] Let the owner assign app roles to human members.
  - [ ] Retain existing account, workspace, membership, and ownership identities when adding members.

  Invitation and membership details require their own specification. Member password recovery without
  email or owner action on every reset is open and needs exploration. Workspace roles, such as an
  administrator, may come later.

- [ ] **Workspace clients**

  **Source:** [UI integration](architecture/decisions.md#ui-integration).

  - [ ] Provide web, desktop, and installable PWA clients with the same core workspace and installed-app experience when connected to the server.
  - [ ] Open installed apps within the Your Space interface while platform navigation remains available.
  - [ ] Preserve normal frontend requests to the app backend without requiring each request to be rewritten for Your Space.
  - [ ] Apply equivalent backend authorization checks to human UI and programmatic access.

  The first owner feature uses the web client. PWA offline behavior, embedding, origins, routing,
  isolation, and session bridging remain open.

- [ ] **Desktop app and local workspaces**

  **Source:** [First public-release audience and clients](architecture/decisions.md#first-public-release-audience-and-clients).

  - [ ] Ship an Electron desktop app for macOS, Windows, and Linux.
  - [ ] On Windows, support the desktop app and a local workspace through Docker Desktop; Windows is not a supported server host.
  - [ ] On setup, let the user connect to an existing server by URL or run Your Space locally.
  - [ ] In local mode, drive the Your Space CLI to set up and run the Docker Compose stack on the same machine, then connect to it.
  - [ ] Detect Docker and link to the Docker Desktop download when it is missing.
  - [ ] In local mode, obtain the setup code through the CLI and submit it on the user's behalf, using the same setup flow as every other installation.
  - [ ] Start the local stack when the desktop app opens, and update Your Space when the owner chooses.
  - [ ] Document that a local workspace is unavailable to others while its machine is asleep or off, and state the Docker Desktop license terms.

  Streamlined local setup has its own specification and implementation PR, separate from the
  owner-access feature; it wraps the CLI and setup flow without changing them. Desktop packaging, code signing,
  and self-update need a specification. Your Space updates go through the CLI and roll back
  automatically if they fail. Backup, restore, and moving a local workspace to a server are
  post-open-source. The desktop app drives the CLI rather than managing Docker itself.

- [ ] **Independent app deployment and lifecycle**

  **Source:** [Platform and independent apps](architecture/decisions.md#platform-and-independent-apps) and [app distribution](architecture/decisions.md#accepted-future-app-distribution-direction).

  - [ ] Let the owner install a compatible app by pasting the GitHub URL of its deployment file in a public repository into the UI.
  - [ ] Read the deployment file at that URL and record the exact revision used for installation; updates re-read the file from the same URL.
  - [ ] Download and run published container images using the exact image and version declared in the app's integration files for each container, including database services; validate and retain the installed image identity.
  - [ ] Start and manage each app's independent container or containers using Docker on the same server as Your Space.
  - [ ] Run an app-declared database service alongside the app when needed.
  - [ ] Provide app-specific durable storage that survives restarts and remains after uninstall.
  - [ ] Let the owner explicitly delete retained app data from the administration UI.
  - [ ] Restrict app installation and removal to the owner for the first public release.
  - [ ] Isolate apps from host filesystem access, devices, and Docker controls, and protect platform services and other apps.
  - [ ] Warn the owner when installing an app that it is trusted with its own data, and state in the documentation that Your Space protects itself and other apps but is not a sandbox for hostile code.
  - [ ] Preserve app identity, exact source version, provenance, and approved update source or policy; do not silently expand granted access on update.
  - [ ] Let the owner trigger updates of installed apps, preserving app data and requiring explicit approval for any additional access.
  - [ ] Back up app data and record image versions before each update; if the update fails, automatically roll back to the previous versions and restore the backup.
  - [ ] Accept only Compose settings on an approved list in the app's deployment file, rejecting all others, including settings that would break app isolation.
  - [ ] Read the app's name and requested access from the `x-your-space` section of its Compose file.

  Published images are the only first-release installation path; Your Space does not build app source
  during installation. The deployment file is a Docker Compose file limited to an approved list of
  settings, which starts with what the first app needs. The contents of the `x-your-space` section,
  image identity validation, resource and isolation enforcement, lifecycle, owner-triggered update
  mechanics, and failed-update detection need definition. App updates and Your Space updates share one
  pre-update snapshot and rollback mechanism. A deployment file does not itself guarantee
  isolation; that boundary needs design and verification.

- [ ] **App integration and developer experience**

  **Source:** [Platform and independent apps](architecture/decisions.md#platform-and-independent-apps).

  - [ ] Document versioned public integration contracts for independently built and running apps.
  - [ ] Publish TypeScript and Python SDKs from this repository for apps in their own repositories, including first-party apps.
  - [ ] Verify each SDK with a working app.
  - [ ] Enable developers to create or adapt apps and install them without rebuilding Your Space or including app source in the platform build.
  - [ ] Provide a small Tasks app as the first independently maintained, installable app and verify the complete installation and usage journey.

  A small Tasks app is the first app. SDKs for languages other than TypeScript and Python are
  post-open-source. The app contract and SDK coverage remain open.

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
  - [ ] Complete a security hardening pass on the boundaries between apps and the workspace, enforcing them and protecting users as far as reasonably possible.
  - [ ] Document installation, operation, recovery, developer integration, contribution, and project status.
  - [ ] Verify the core journeys, supported environments, release artifacts, recovery, and maintenance paths.
  - [ ] Review release evidence, unresolved issues, and GitHub settings before authorizing publication.

## Post-public: Later Direction and Enhancements

These capabilities are not required for the first public release. Their order and timing remain open.

- [ ] **Backup, restore, and migration**

  **Deferred (2026-10-31; broadened to every installation 2026-11-01):** [Your Space updates, backup, and restore](architecture/decisions.md#your-space-updates-backup-and-restore).

  - [ ] Back up any installation through the CLI: the Your Space server produces the backup and returns it through its API, wherever the server runs.
  - [ ] Restore a backup into an installation.
  - [ ] Move a workspace between installations, such as from a local machine to a server, through backup and restore.
  - [ ] Back up and restore a local workspace from the desktop app through the same CLI operation.

  One owner-only implementation serves every installation and builds on the pre-update snapshot
  mechanism. The first public release uses snapshots only for automatic rollback of failed updates.

- [ ] **Optional owner-configured email**

  **Deferred (2026-11-02):** [Sessions, persistence, and recovery](architecture/decisions.md#sessions-persistence-and-recovery).

  - [ ] Let the owner add their own email (SMTP) settings to enable email delivery.
  - [ ] Verify member email addresses when email is configured.
  - [ ] Send password-reset links to verified addresses through the existing recovery mechanism.

  No installation requires email. The first public release needs a member recovery path that works without it.

- [ ] **Automatic app updates**

  **Deferred (2026-10-30):** [App update decision](architecture/decisions.md#accepted-future-app-distribution-direction).

  - [ ] Support automatic app updates under the owner's approved update policy.

  The first public release supports updates explicitly triggered by the owner.

- [ ] **App backup history and manual rollback**

  **Deferred (2026-10-31):** [App update decision](architecture/decisions.md#accepted-future-app-distribution-direction).

  - [ ] Keep more than one app backup and let the owner roll back an update that succeeded.

  The first public release rolls back failed updates automatically from a single pre-update backup.

- [ ] **Alternative deployment-file formats**

  **Deferred (2026-10-31):** [App deployment decision](architecture/decisions.md#accepted-future-app-deployment-direction).

  - [ ] Explore a deployment-file format other than Docker Compose if a real need surfaces, such as app
    details the `x-your-space` section cannot express.

  The first public release uses a Docker Compose file with an `x-your-space` section.

- [ ] **Additional SDK languages**

  **Deferred (2026-10-31):** [Platform and independent apps](architecture/decisions.md#platform-and-independent-apps).

  - [ ] Publish SDKs for languages beyond TypeScript and Python, such as Go.

  The first public release publishes TypeScript and Python SDKs.

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
