# Your Space Roadmap

**Last updated**: 2026-11-02

This roadmap tracks the functionality we want to build for Your Space: a self-hostable platform
for independent apps, human users, and agents, with a managed offering planned later.

It is derived from the [architecture and product decisions](architecture/decisions.md). The
[architecture overview](architecture/overview.md) shows the resulting system layer by layer.
That record preserves decisions and rationale; the [constitution](../.specify/memory/constitution.md)
sets governing principles; feature specifications define scope and acceptance.

The pre-public checklist describes the intended core experience and work needed before publishing
the repository. The post-public checklist captures later direction and possible enhancements.
Release scope and details may evolve as the remaining questions are resolved. See the
[public release readiness checklist](public-release-readiness.md) for the publication review.

**Current direction:** Owner access with a manual Compose install comes first (PR #3), followed by
the app UI and sign-in specification, then the CLI, then the remaining pre-public work by priority.
The [overview tree](#overview) summarizes the full pre-public scope by layer, and the
[architecture overview](architecture/overview.md) shows the resulting system. Automatic app updates,
building apps from source, alternative deployment-file formats, and a workspace MCP endpoint are
post-open-source work.

**Next step:** Review and merge PR #3, then write the app UI and sign-in specification. Every
pre-public item below has a priority; Low items move to post-open-source work first if the timeline
slips.

The pre-public section is grouped into layers. Within each layer, each parent checkbox represents a
capability and its nested checkboxes track specific functionality.
Checked items mean delivered and verified work, not completed planning. Keep completed items in
place with their completion date and implementation PR or release link so this remains a record.
All functionality below is currently unchecked because application implementation has not started.

## Pre-public: Core Experience and First Working Version

The first release targets people who can install Docker Desktop and the Your Space desktop app for a
local workspace, or install Docker and follow a guided CLI for a server or local workspace. The
[owner-access feature (PR #3)](https://github.com/your-space-ai/your-space/pull/3) is first. The app
UI and sign-in specification follows, because app origins decide what the CLI sets up for HTTPS and
clients, apps, SDKs, and agents build on it. The CLI follows in a separate specification and
implementation PR. The remaining items need their own specifications; their order here is not a
delivery sequence.

Each item has a priority:

- **[High]** The core story (install, invite, install an app, let an agent use it) or the safety and
  trust it depends on. Publication waits for these.
- **[Medium]** Required for publication, but built after the High items it depends on.
- **[Low]** Wanted for the first release and built last. These are the first items to move to
  post-open-source work if the timeline slips. Windows support and PWA installation are Low.

### Overview

This tree summarizes everything below by layer. Unmarked leaves are High priority; `(M)` is Medium
and `(L)` is Low. It is a view of the checklist, not a separate source of scope: when you add,
remove, move, re-prioritize, or reword a pre-public item, update the tree in the same change. See
[Maintaining the checklist](#maintaining-the-checklist).

```text
Your Space: first public release
│
├── 1. Install and operate
│   ├── Server stack
│   │   ├── Manual Docker Compose install on macOS and Linux (PR #3)
│   │   ├── Identity and data survive restarts and recreation
│   │   ├── Encrypted access from another device
│   │   ├── Images for ARM (Apple Silicon) and Intel/AMD
│   │   └── Manual Compose guide kept as an advanced option (L)
│   ├── HTTPS
│   │   ├── Built-in proxy with automatic certificates; plain HTTP on localhost only
│   │   └── Bring your own proxy or tunnel (M)
│   ├── CLI (drives Compose for you)
│   │   ├── Guided local and server install
│   │   ├── install · start · stop · status · logs · update · owner recovery
│   │   ├── Automatic rollback of failed Your Space updates (M)
│   │   ├── Uninstall: removes app containers, keeps data by default (M)
│   │   └── macOS + Linux · Windows (L)
│   └── Backup, restore, and migration
│       ├── Backup and restore, produced by the server, driven by the CLI
│       └── Move a workspace, e.g. local → server (M)
│
├── 2. Identity and access
│   ├── Owner setup and sessions
│   │   ├── One-time setup code, one owner, no duplicate claims
│   │   ├── Accurate empty workspace and service states
│   │   ├── Sign in/out, expiry and revocation, host-only session cookie
│   │   └── Owner recovery by server command, sessions revoked
│   ├── Workspace members
│   │   ├── Invite link → sign up → join, identities preserved
│   │   ├── Recovery code at signup · temporary password from the owner
│   │   ├── Remove a member: sign out everywhere, revoke roles and agents
│   │   └── Former members and deleted agents stay traceable (M)
│   ├── App roles
│   │   ├── Verified identity supplied to apps
│   │   ├── Apps publish role IDs; owner assigns them; multiple per person
│   │   └── Integrated at the app's own auth boundary
│   ├── Agent identities and delegation
│   │   ├── Own identity and credentials, linked to their human
│   │   ├── Delegate an exact subset of your roles
│   │   ├── Removing a role removes it from agents, including live sessions
│   │   ├── Actions credited to the actual actor
│   │   ├── A removed member's agents are disabled, not deleted (M)
│   │   └── Create, view, revoke, and rotate agent credentials in the app
│   └── Activity log (M)
│       ├── Installs, role and member changes, delegations, agent requests
│       └── Owner can review it; out of the way by default
│
├── 3. Apps
│   ├── Installation
│   │   ├── Owner pastes the deployment file's GitHub URL; revision recorded
│   │   ├── Exact published images; approved Compose settings; `x-your-space` section
│   │   ├── Owner-only install and removal, with a trust warning
│   │   ├── App settings and secrets, stored by a Compose stack component
│   │   ├── Images for ARM and Intel/AMD required; clear error if none match
│   │   └── Add an external app hosted elsewhere (M)
│   ├── Runtime and isolation
│   │   ├── Own containers on the same server
│   │   ├── App database if declared (M)
│   │   ├── Durable app storage, kept after uninstall
│   │   ├── Owner can delete retained app data (M)
│   │   ├── Isolated from host folders, devices, Docker, Your Space, and other apps
│   │   ├── No outbound network by default; declared access approved by the owner
│   │   └── Memory and CPU limits; app status and logs for the owner (M)
│   ├── Updates (M)
│   │   ├── Owner-triggered; new access needs approval; provenance kept
│   │   └── Backup first, automatic rollback on failure
│   ├── Apps inside Your Space
│   │   ├── Apps open in the UI with navigation; normal frontend requests work
│   │   └── Same backend checks for UI and programmatic access
│   └── Developer kit
│       ├── Versioned public contracts, same for managed and external apps
│       ├── TypeScript + Python SDKs, each verified with a working app
│       ├── Build and install apps without rebuilding Your Space
│       └── Tasks app as the first app
│
├── 4. Agents
│   └── Agent access through Your Space
│       ├── Your Space is the gateway; apps expose no ports of their own
│       ├── Agents use apps through the Your Space CLI, locally or remotely
│       └── Permitted, denied, attributed, and revoked actions verified
│
├── 5. Clients
│   ├── Workspace clients
│   │   ├── Web and desktop with the same experience
│   │   ├── Installable PWA (L)
│   │   ├── Simple by default; advanced controls for power users
│   │   └── Clear message when app, CLI, and server versions don't match (M)
│   ├── Desktop app
│   │   ├── macOS · Linux (M) · Windows with a local workspace (L)
│   │   ├── Signed: macOS Developer ID + notarization · Windows (L)
│   │   ├── Connect to a server by URL, or run locally
│   │   └── Updates itself from GitHub releases (M)
│   └── Desktop local mode (wraps the CLI)
│       ├── Detect Docker, set up, submit the setup code, start with the app, update
│       ├── Backup, restore, move to a server, uninstall (M)
│       └── Sleep/off availability and Docker Desktop license documented (M)
│
└── 6. Trust and release
    ├── Security: review, safe defaults, vulnerability reporting, hardening pass
    ├── Privacy: no telemetry; only GitHub update checks, which can be turned off
    ├── Legal: rights and notices; AGPL core, Apache SDKs, trademark, CLA,
    │   lawyer review
    └── Release: secrets review, docs, core journeys verified, release evidence
```

### 1. Install and Operate

- [ ] **Server stack**

  **Source:** [Installation and hosting](architecture/decisions.md#installation-and-hosting).

  - [ ] [High] Install manually with documented Docker Compose procedures on supported macOS and Linux server hosts.
  - [ ] [High] Retain account and workspace identity across restarts and service recreation with durable storage retained.
  - [ ] [High] Access the same server and workspace from another device through a documented encrypted connection.
  - [ ] [Low] Keep the manual Compose procedure documented as an advanced alternative to the CLI.
  - [ ] [High] Publish Your Space images for both ARM (including Apple Silicon) and Intel/AMD machines.

  The manual install is part of the owner-access feature (PR #3). Exact host support and remote
  access details still need planning.

- [ ] **HTTPS**

  **Source:** [Installation and hosting](architecture/decisions.md#installation-and-hosting).

  - [ ] [High] Set up HTTPS during installation: a reverse proxy in the Compose stack obtains and renews a certificate when the owner gives a domain. Plain HTTP is supported only on localhost.
  - [ ] [Medium] Let owners with their own reverse proxy or tunnel turn off the built-in proxy, and document a private tunnel such as Tailscale for owners without a domain.

- [ ] **CLI installation and management**

  **Source:** [CLI delivery sequence](architecture/decisions.md#cli-delivery-sequence).

  - [ ] [High] Guide local and server installation through the Your Space CLI, which drives Docker Compose so users don't run Compose themselves.
  - [ ] [High] Provide at least install, start, stop, status, logs, update Your Space, and owner password recovery, plus the backup, restore, and uninstall commands covered by their own items.
  - [ ] [Medium] Before updating Your Space, record versions and snapshot its data; if the update fails, roll back automatically.
  - [ ] [Medium] Uninstall Your Space and every app container it manages; keep data by default, and require explicit confirmation and offer a backup before deleting it.
  - [ ] [High] Run the CLI on macOS and Linux so the desktop app can drive it for local workspaces.
  - [ ] [Low] Run the CLI on Windows so the desktop app can drive it for local workspaces there.

  The CLI follows the owner-access feature and the app UI and sign-in specification. Command names,
  packaging, prerequisites, and the rest of the management scope remain to be specified. The update
  rollback uses the same snapshot mechanism as app updates, and backup and restore build on it.

- [ ] **Backup, restore, and migration**

  **Source:** [Your Space updates, backup, and restore](architecture/decisions.md#your-space-updates-backup-and-restore). Moved before publication 2026-11-02.

  - [ ] [High] Back up any installation through the CLI: the Your Space server produces the backup and returns it through its API, wherever the server runs.
  - [ ] [High] Restore a backup into an installation.
  - [ ] [Medium] Move a workspace between installations, such as from a local machine to a server, through backup and restore.

  One owner-only implementation serves every installation and builds on the pre-update snapshot
  mechanism; the desktop app uses the same operation (see Desktop local mode). Design the data model
  and storage so the whole workspace can be captured consistently. Remote CLI authentication, restore
  into a broken or fresh installation, and backup format and protection need a specification.

### 2. Identity and Access

- [ ] **Owner setup and sessions**

  **Source:** [Authentication and initial claim](architecture/decisions.md#authentication-and-initial-claim) and [sessions, persistence, and recovery](architecture/decisions.md#sessions-persistence-and-recovery).

  - [ ] [High] Reach browser-guided setup and prove operator authority with a temporary, single-use setup code.
  - [ ] [High] Create one owner account and workspace, keeping account, workspace, membership, and ownership identities distinct.
  - [ ] [High] Prevent duplicate claims and close initial registration after setup.
  - [ ] [High] Reach an accurate empty workspace and distinguish unavailable services from empty or unclaimed state.
  - [ ] [High] Sign in and out through one server-managed authentication system, with server-enforced session expiry and revocation.
  - [ ] [High] Keep the platform session in host-only cookies so it is never sent to app origins.
  - [ ] [High] Recover the existing owner account through an operator command without requiring email delivery or a standalone CLI.
  - [ ] [High] Preserve identity and revoke existing sessions after successful password recovery.

  The owner-access feature (PR #3) is owner-only and web-only. Password rules, session and credential
  lifetimes, and failed-attempt behavior still need planning.

- [ ] **Workspace members**

  **Source:** [Owner and workspace model](architecture/decisions.md#owner-and-workspace-model) and [member and agent removal](architecture/decisions.md#member-and-agent-removal).

  - [ ] [High] Let the owner create an invitation link and share it directly with a prospective member.
  - [ ] [High] Let the recipient sign up and join the workspace through the invitation.
  - [ ] [High] Retain existing account, workspace, membership, and ownership identities when adding members.
  - [ ] [High] Give each member a recovery code at signup that lets them reset their own password.
  - [ ] [High] Let the owner reset a member's password with a temporary password the member must replace at next sign-in.
  - [ ] [High] Let the owner remove a member: sign them out everywhere and revoke their app roles and their agents' access.
  - [ ] [Medium] Keep past app activity traceable to former members and deleted agents.

  Invitation, membership, removal, and recovery-code details require their own specification.
  Workspace roles, such as an administrator, may come later.

- [ ] **App roles**

  **Source:** [Identity and app-owned roles](architecture/decisions.md#identity-and-app-owned-roles).

  - [ ] [High] Supply verified human or agent identity to installed apps.
  - [ ] [High] Let apps publish stable role identifiers while retaining their own role semantics and resource rules.
  - [ ] [High] Let the owner assign app roles to human members.
  - [ ] [High] Assign multiple app roles to humans and agents within an app installation and workspace.
  - [ ] [High] Integrate identity and role assignments at the app's authentication and authorization boundary, reusing existing boundaries where suitable.

  The identity protocol, role catalog, and compatibility with app authorization semantics remain
  open. Your Space supplies identity and assignments; each app enforces its protected operations.

- [ ] **Agent identities and delegation**

  **Source:** [Delegation by exact role subsets](architecture/decisions.md#delegation-by-exact-role-subsets) and [member and agent removal](architecture/decisions.md#member-and-agent-removal).

  - [ ] [High] Give external agents distinct identities and non-interactive credentials linked to their delegating human.
  - [ ] [High] Let a user delegate any exact subset of their assigned role IDs for the same app installation and workspace.
  - [ ] [High] Remove the corresponding delegated role from affected agents when the human loses that role.
  - [ ] [High] Apply access removal to existing app sessions and credentials.
  - [ ] [High] Attribute app actions to the actual actor and retain the delegating-user relationship.
  - [ ] [Medium] Disable a removed member's agents rather than deleting them, and let the owner delete them later.
  - [ ] [High] Let people create, view, revoke, and rotate their agents' credentials in the app; revoking one credential does not change the agent's roles.

  **Source for credentials:** [Agent access through Your Space](architecture/decisions.md#agent-access-through-your-space).

  Credential issuance, revocation guarantees, and refresh behavior remain open. External agents
  precede platform-hosted agent execution.

- [ ] **Activity log**

  **Source:** [Activity log](architecture/decisions.md#activity-log).

  - [ ] [Medium] Record app installs, removals, and updates; role changes and delegations; member changes; and every agent request through the gateway, with the actual actor.
  - [ ] [Medium] Let the owner review the log, available but out of the way by default.

  Retention, detail level, and who besides the owner can view entries need a specification.

### 3. Apps

- [ ] **App installation**

  **Source:** [Platform and independent apps](architecture/decisions.md#platform-and-independent-apps), [app distribution](architecture/decisions.md#accepted-future-app-distribution-direction), and [app deployment](architecture/decisions.md#accepted-future-app-deployment-direction).

  - [ ] [High] Let the owner install a compatible app by pasting the GitHub URL of its deployment file in a public repository into the UI.
  - [ ] [High] Read the deployment file at that URL and record the exact revision used for installation; updates re-read the file from the same URL.
  - [ ] [High] Download and run published container images using the exact image and version declared in the app's integration files for each container, including database services; validate and retain the installed image identity.
  - [ ] [High] Accept only Compose settings on an approved list in the app's deployment file, rejecting all others, including settings that would break app isolation.
  - [ ] [High] Read the app's name and requested access from the `x-your-space` section of its Compose file.
  - [ ] [High] Let the owner provide app settings and secrets at installation and change them later, stored and supplied by a component in the Your Space Compose stack.
  - [ ] [High] Require app images for both ARM and Intel/AMD machines; fail installation with a clear message if no image matches the machine.
  - [ ] [Medium] Let the owner add an external app, hosted elsewhere, by pointing Your Space at its running instance instead of deploying it.
  - [ ] [High] Restrict app installation and removal to the owner for the first public release.
  - [ ] [High] Warn the owner when installing an app that it is trusted with its own data, and state in the documentation that Your Space protects itself and other apps but is not a sandbox for hostile code.

  Published images are the only first-release installation path; Your Space does not build app source
  during installation. The approved list of Compose settings starts with what the first app needs.
  The contents of the `x-your-space` section, image identity validation, the settings and secrets
  mechanism, and how external apps are registered need definition. External apps are outside Your
  Space's isolation, network limits, resource limits, and backups.

- [ ] **App runtime and isolation**

  **Source:** [Responsibility and trust boundary](architecture/decisions.md#responsibility-and-trust-boundary).

  - [ ] [High] Start and manage each app's independent container or containers using Docker on the same server as Your Space.
  - [ ] [Medium] Run an app-declared database service alongside the app when needed.
  - [ ] [High] Provide app-specific durable storage that survives restarts and remains after uninstall.
  - [ ] [Medium] Let the owner explicitly delete retained app data from the administration UI.
  - [ ] [High] Isolate apps from host filesystem access, devices, and Docker controls, and protect platform services and other apps.
  - [ ] [High] Block app outbound network access by default; each app declares the access it needs in its `x-your-space` section, and the owner approves it at installation.
  - [ ] [Medium] Run each managed app with memory and CPU limits so one app cannot take down the host.
  - [ ] [Medium] Show the owner each app's status and logs.

  A deployment file does not itself guarantee isolation; resource and isolation enforcement and
  lifecycle need design and verification.

- [ ] **App updates**

  **Source:** [App distribution](architecture/decisions.md#accepted-future-app-distribution-direction).

  - [ ] [Medium] Preserve app identity, exact source version, provenance, and approved update source or policy; do not silently expand granted access on update.
  - [ ] [Medium] Let the owner trigger updates of installed apps, preserving app data and requiring explicit approval for any additional access.
  - [ ] [Medium] Back up app data and record image versions before each update; if the update fails, automatically roll back to the previous versions and restore the backup.

  App updates and Your Space updates share one pre-update snapshot and rollback mechanism.
  Owner-triggered update mechanics and failed-update detection need definition.

- [ ] **Apps inside Your Space**

  **Source:** [UI integration](architecture/decisions.md#ui-integration).

  - [ ] [High] Open installed apps within the Your Space interface while platform navigation remains available.
  - [ ] [High] Preserve normal frontend requests to the app backend without requiring each request to be rewritten for Your Space.
  - [ ] [High] Apply equivalent backend authorization checks to human UI and programmatic access.

  Embedding, origins, routing, isolation, and session bridging are decided in the app UI and sign-in
  specification.

- [ ] **Developer kit**

  **Source:** [Platform and independent apps](architecture/decisions.md#platform-and-independent-apps).

  - [ ] [High] Document versioned public integration contracts for independently built and running apps.
  - [ ] [High] Design the contract so it works the same whether Your Space runs the app or the app is hosted elsewhere.
  - [ ] [High] Publish TypeScript and Python SDKs from this repository for apps in their own repositories, including first-party apps.
  - [ ] [High] Verify each SDK with a working app.
  - [ ] [High] Enable developers to create or adapt apps and install them without rebuilding Your Space or including app source in the platform build.
  - [ ] [High] Provide a small Tasks app as the first independently maintained, installable app and verify the complete installation and usage journey.

  SDKs for languages other than TypeScript and Python are post-open-source. The app contract and SDK
  coverage remain open.

### 4. Agents

- [ ] **Agent access through Your Space**

  **Source:** [Agent access through Your Space](architecture/decisions.md#agent-access-through-your-space).

  - [ ] [High] Route all agent requests to apps through Your Space as the gateway; agents never call apps directly, and app containers publish no network ports of their own.
  - [ ] [High] Let agents use app actions through the Your Space CLI with their own credentials, for local and remote servers.
  - [ ] [High] Verify permitted operations, denied actions, attribution, and revocation against an installed app.

  A workspace MCP endpoint is post-open-source. Whether the gateway enforces per-action roles is
  decided in the app integration specification.

### 5. Clients

- [ ] **Workspace clients**

  **Source:** [First public-release audience and clients](architecture/decisions.md#first-public-release-audience-and-clients).

  - [ ] [High] Provide web and desktop clients with the same core workspace and installed-app experience when connected to the server.
  - [ ] [Low] Provide an installable PWA client with the same experience.
  - [ ] [High] Keep the default experience simple: show people only what they need, and put advanced settings and configuration behind power-user controls.
  - [ ] [Medium] Define which desktop app, CLI, and server versions work together, and show a clear "update the app" or "update the server" message on a mismatch.

  **Source for simplicity:** [Product experience principles](architecture/decisions.md#product-experience-principles).

  The owner-access feature uses the web client. PWA offline behavior remains open.

- [ ] **Desktop app**

  **Source:** [First public-release audience and clients](architecture/decisions.md#first-public-release-audience-and-clients).

  - [ ] [High] Ship an Electron desktop app for macOS.
  - [ ] [Medium] Ship the desktop app for Linux.
  - [ ] [Low] On Windows, support the desktop app and a local workspace through Docker Desktop; Windows is not a supported server host.
  - [ ] [High] Sign and notarize macOS builds with an Apple Developer ID in CI.
  - [ ] [Low] Sign Windows builds through SignPath, with Microsoft Artifact Signing as fallback, in CI.
  - [ ] [High] On setup, let the user connect to an existing server by URL or run Your Space locally.
  - [ ] [Medium] Update the desktop app itself, checking GitHub for new releases.

  Desktop packaging and self-update mechanics need a specification.

- [ ] **Desktop local mode**

  **Source:** [First public-release audience and clients](architecture/decisions.md#first-public-release-audience-and-clients).

  - [ ] [High] In local mode, drive the Your Space CLI to set up and run the Docker Compose stack on the same machine, then connect to it.
  - [ ] [High] Detect Docker and link to the Docker Desktop download when it is missing.
  - [ ] [High] In local mode, obtain the setup code through the CLI and submit it on the user's behalf, using the same setup flow as every other installation.
  - [ ] [High] Start the local stack when the desktop app opens, and update Your Space when the owner chooses.
  - [ ] [Medium] Back up and restore the local workspace, and move it to a server, through the CLI.
  - [ ] [Medium] Uninstall the local workspace through the CLI's uninstall command.
  - [ ] [Medium] Document that a local workspace is unavailable to others while its machine is asleep or off, and state the Docker Desktop license terms.

  Streamlined local setup has its own specification and implementation PR. It wraps the CLI and setup
  flow without changing them; the desktop app drives the CLI rather than managing Docker itself.

### 6. Trust and Release

- [ ] **Security**

  **Source:** [Responsibility and trust boundary](architecture/decisions.md#responsibility-and-trust-boundary).

  - [ ] [High] Review security and isolation, provide safe defaults, and establish private vulnerability reporting.
  - [ ] [High] Complete a security hardening pass on the boundaries between apps and the workspace, enforcing them and protecting users as far as reasonably possible.

- [ ] **Privacy**

  **Source:** [Telemetry and outbound connections](architecture/decisions.md#telemetry-and-outbound-connections).

  - [ ] [High] Send no telemetry; the only automatic outbound requests are GitHub update checks, which the owner can turn off.

- [ ] **Legal**

  **Source:** [Project license and business model](architecture/decisions.md#project-license-and-business-model).

  - [ ] [High] Review publication rights, project and dependency licensing, and required notices.
  - [ ] [High] License Your Space under AGPL-3.0 and the SDKs under Apache-2.0, file the "Your Space" trademark, and set up a contributor license agreement, all reviewed by a lawyer.

- [ ] **Release**

  **Source:** [Public release readiness checklist](public-release-readiness.md).

  - [ ] [High] Review repository history, GitHub content, and release artifacts for private data and secrets.
  - [ ] [High] Document installation, operation, recovery, developer integration, contribution, and project status.
  - [ ] [High] Verify the core journeys, supported environments, release artifacts, recovery, and maintenance paths.
  - [ ] [High] Review release evidence, unresolved issues, and GitHub settings before authorizing publication.

## Post-public: Later Direction and Enhancements

These capabilities are not required for the first public release. Their order and timing remain open.

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

- [ ] **Workspace MCP endpoint**

  **Deferred (2026-11-02):** [Agent access through Your Space](architecture/decisions.md#agent-access-through-your-space).

  - [ ] Serve one MCP endpoint per workspace through the Your Space gateway.
  - [ ] Let off-the-shelf agents connect with the endpoint URL and a sign-in approved by their human.
  - [ ] Show each agent only the app actions its delegated roles allow, using the same checks as the CLI.

  The first public release gives agents the CLI.

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
  - [ ] Keep managed-service code, such as billing, provisioning, and multi-tenant operations, in a separate private repository that integrates through the core's APIs.

  Provisioning, operations, billing, and email delivery require future planning. See [project license and business model](architecture/decisions.md#project-license-and-business-model).

## Maintaining the Checklist

- Keep the pre-public [overview tree](#overview) in sync with the checklist in the same change.
  Whenever a pre-public item is added, removed, moved between capabilities or layers,
  re-prioritized, reworded in a way that changes its meaning, or deferred to post-public work,
  update the matching tree leaf. Every tree leaf must map to one or more checklist items, every
  checklist item must be represented in the tree, and tree priority markers must match: no marker
  for High, `(M)` for Medium, `(L)` for Low. Mark delivered work in the checklist, not the tree.
- Place new pre-public capabilities in the layer they belong to (install and operate, identity and
  access, apps, agents, clients, or trust and release). Add a layer only when a capability fits none
  of them, and add it to the tree at the same time.
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
