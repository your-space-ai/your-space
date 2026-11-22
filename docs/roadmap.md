# Your Space roadmap

The first release serves one owner. They can download the macOS app to set up a local Docker workspace or connect to an existing server. They can also run a headless Docker server and use a browser. In the selected workspace they install apps using kits and decide what their AI agent can do.

The first publication milestone is a quiet source preview with a Docker quickstart, AGPL-3.0-only licensing and DCO sign-offs. The checklist below tracks the first packaged release. [Source publication checks](public-release-readiness.md#early-source-publication-building-in-public)

## Core Experience and First Packaged Release

### Overview

- Install and open the dashboard (001, 003)
  - Download a versioned release and follow one guide on a personal machine with Docker and Compose already installed.
  - Repeat on a Docker server.
- Connect an app (002)
  - Install and open an independent app from the web dashboard.
- Put one AI agent to work (005)
  - In the web UI, create a named agent, issue its own credential, and grant specific roles for one connected app.
  - Use an external AI agent through the CLI and gateway to complete one useful action in that app, with kit-defined roles, server-held app credentials and owner-configurable approvals.
  - Remove the grant and retry with the existing session.
- Open a workspace from the macOS desktop (008)
  - Install the appropriate DMG by dragging the app into Applications, then choose local setup or connection to an existing server. Use the selected workspace's dashboard to review and apply a kit.
- Personalize the dashboard (010)
  - Pick one of three starter themes, edit colors and fonts, and share a custom theme file.
- Build and customize a personal workspace with an agent (011)
  - Provision the workspace, scaffold an app and choose its Home read roles.
  - Manage GitHub sources, install from a kit URL or an optional directory, and confirm an in-place deployment.
- Arrange installed apps (012)
  - Resize app panes, open named views and reorder app shortcuts in the sidebar.
- Prepare the public release (gate)
  - Run the complete owner journey from a clean download on the supported hosts.
  - Close the security, privacy, licensing, documentation, and publication checks in the [release checklist](public-release-readiness.md).

### What is already on main

- Owner setup, sign-in, recovery, and durable workspace identity shipped in [001](../specs/001-workspace-owner-access/tasks.md).
- Independent app installation, isolation, and web panes shipped in [002](../specs/002-install-an-app/tasks.md). Subsequent changes added local Compose files, published-app framing, and complete removal ([PR 54](https://github.com/your-space-ai/your-space/pull/54), [PR 57](https://github.com/your-space-ai/your-space/pull/57)).
- The [003 CLI](../specs/003-install-with-the-cli/tasks.md) includes init/start, stop/status/logs, owner recovery, secret management, and domain/proxy configuration. Stored app settings are [encrypted](../specs/009-encrypt-stored-data/tasks.md). Real-domain and release-host checks remain open.
- The [Mac launcher](../specs/008-desktop-entry/spec.md), [portable themes](../specs/010-personal-themes/spec.md), [agent setup and GitHub-backed apps](../specs/011-agent-workspace/spec.md), and [resizable saved views](../specs/012-multi-app-layouts/spec.md) are on main. Clean installation of the signed desktop downloads remains a release check.

The [previous detailed delivery checklist](https://github.com/your-space-ai/your-space/blob/eb352241/docs/roadmap.md) preserves dated completions and their implementation PRs. Below, a check means the whole release outcome has been demonstrated.

<details>
<summary>Previously verified features and their implementation PRs</summary>

- [x] **Owner setup and sessions** (2026-11-08, [PR #14](https://github.com/your-space-ai/your-space/pull/14))

- [x] Retain account and workspace identity across restarts and service recreation with durable storage retained. (2026-11-08, [PR #14](https://github.com/your-space-ai/your-space/pull/14))
- [x] Create the owner with a server command that prints a single-use set-password link; the network alone can never create an account or the owner. (2026-11-08, [PR #12](https://github.com/your-space-ai/your-space/pull/12))
- [x] Create one owner account and workspace, keeping account, workspace, membership, and ownership identities distinct. (2026-11-08, [PR #12](https://github.com/your-space-ai/your-space/pull/12))
- [x] Prevent duplicate owners and keep sign-up closed; new people join only by invitation. (2026-11-08, [PR #12](https://github.com/your-space-ai/your-space/pull/12))
- [x] Reach an accurate empty workspace and distinguish unavailable services from empty or unclaimed state. (2026-11-08, [PR #14](https://github.com/your-space-ai/your-space/pull/14))
- [x] Sign in and out through one server-managed authentication system, with server-enforced session expiry and revocation. (2026-11-08, [PR #13](https://github.com/your-space-ai/your-space/pull/13))
- [x] Keep the platform session in host-only cookies so it is never sent to app origins. (2026-11-08, [PR #13](https://github.com/your-space-ai/your-space/pull/13))
- [x] Recover the existing owner account through an operator command without requiring email delivery or a standalone CLI. (2026-11-08, [PR #14](https://github.com/your-space-ai/your-space/pull/14))
- [x] Preserve identity and revoke existing sessions after successful password recovery. (2026-11-08, [PR #14](https://github.com/your-space-ai/your-space/pull/14))
- [x] Let the owner install an app by pasting the GitHub link to its own Compose file in a public repository into the UI. (2026-11-17, [PR #26](https://github.com/your-space-ai/your-space/pull/26))
- [x] Read the file at the exact commit the link resolves to and record it, with the commit of any installation kit applied; updates re-read the file from the same link. (2026-11-17, [PR #25](https://github.com/your-space-ai/your-space/pull/25))
- [x] Pin every image, including database services, to an exact version by digest, and validate and retain the installed image identity. (2026-11-17, [PR #25](https://github.com/your-space-ai/your-space/pull/25))
- [x] Check the app's fully resolved Compose file against an allowlist of settings; adapt it only by rules that hold for every app, reporting each change, and refuse anything else with reasons, including settings that would break app isolation. (2026-11-17, [PR #25](https://github.com/your-space-ai/your-space/pull/25))
- [x] Apply an installation kit, kept in a separate repository, for what a particular app needs (its interface, generated values, starter hosts, limits), with no app-specific logic in Your Space; an app without a kit installs if its own files are enough. (2026-11-17, [PR #25](https://github.com/your-space-ai/your-space/pull/25))
- [x] Let the owner provide app settings and secrets at installation and change them later; generate secrets instead of using published defaults, keep them out of output and logs, and store them encrypted in Your Space's database. (2026-11-17, [PR #28](https://github.com/your-space-ai/your-space/pull/28))
- [x] Install an app if its images run on the engine's processor type (ARM or Intel/AMD); fail installation with a clear message if no image matches. (2026-11-17, [PR #25](https://github.com/your-space-ai/your-space/pull/25))
- [x] Restrict app installation and removal to the owner for the first public release. (2026-11-17, [PR #26](https://github.com/your-space-ai/your-space/pull/26))
- [x] Warn the owner when installing an app that it is trusted with its own data, and state in the documentation that Your Space protects itself and other apps but is not a sandbox for hostile code. (2026-11-17, [PR #26](https://github.com/your-space-ai/your-space/pull/26))
- [x] Run each app's containers through a runtime manager, the only part of Your Space that holds the engine connection, on any Docker-compatible engine shared with Your Space; apps keep running through Your Space restarts and updates, and come back when it starts. (2026-11-17, [PR #25](https://github.com/your-space-ai/your-space/pull/25))
- [x] Run an app-declared database service alongside the app when needed. (2026-11-17, [PR #25](https://github.com/your-space-ai/your-space/pull/25))
- [x] Provide app-specific durable storage that survives restarts and remains after uninstall. (2026-11-17, [PR #30](https://github.com/your-space-ai/your-space/pull/30))
- [x] Let the owner explicitly delete retained app data from the administration UI. (2026-11-17, [PR #30](https://github.com/your-space-ai/your-space/pull/30))
- [x] Isolate apps from host filesystem access, devices, and Docker controls, and protect platform services and other apps: each app on its own sealed network with its own volumes. (2026-11-17, [PR #29](https://github.com/your-space-ai/your-space/pull/29))
- [x] Let apps reach only approved internet hosts: the installation kit's starter hosts, approved with the install, and hosts the owner approves when an app's attempt shows up as an access request. (2026-11-17, [PR #28](https://github.com/your-space-ai/your-space/pull/28))
- [x] Run each managed app with memory and CPU limits so one app cannot take down the host. (2026-11-17, [PR #29](https://github.com/your-space-ai/your-space/pull/29))
- [x] Show the owner each app's status and logs. (2026-11-17, [PR #29](https://github.com/your-space-ai/your-space/pull/29))
- [x] Show the owner an Engine page with the engine connection, its version, and the space's resources and each app's use. (2026-11-17, [PR #26](https://github.com/your-space-ai/your-space/pull/26))
- [x] Open installed apps within the Your Space interface while platform navigation remains available. (2026-11-17, [PR #27](https://github.com/your-space-ai/your-space/pull/27))
- [x] Preserve normal frontend requests to the app backend without requiring each request to be rewritten for Your Space. (2026-11-17, [PR #27](https://github.com/your-space-ai/your-space/pull/27))
- [x] Run each app's interface on its own origin, isolated from Your Space and other apps, at `<app>.<Your Space's address>` in every setup (`space.localhost` on this machine), in a cross-origin iframe in the web client. (2026-11-17, [PR #27](https://github.com/your-space-ai/your-space/pull/27))
- [x] Let only people signed in to Your Space reach an app's origin, through an access gate at the built-in proxy; Your Space's cookies never reach apps, and apps' cookies never reach Your Space or each other. (2026-11-17, [PR #27](https://github.com/your-space-ai/your-space/pull/27))
- [x] Open several apps side by side in one layout on larger screens; show one app at a time on phones. (2026-11-17, [PR #30](https://github.com/your-space-ai/your-space/pull/30))
- [x] Open any app in its own browser tab or window when it cannot run in a pane. (2026-11-17, [PR #27](https://github.com/your-space-ai/your-space/pull/27))

</details>

- [ ] **Install and open the dashboard (001, 003)**
  - [ ] Download a versioned release and follow one guide on a personal machine with Docker and Compose already installed. Create the owner, sign in from localhost, restart, and recover access.
  - [ ] Repeat on a Docker server. Keep the manual Compose guide as an advanced installation path. Open the web UI over HTTPS from a second device, once behind an owner-managed proxy or tunnel and once at a domain using the built-in proxy and a real certificate.
- [ ] **Connect an app (002)**
  - [ ] Install and open an independent app from the web dashboard. Verify the documented real-source install and the browsers claimed for release. Identify which connected apps support agent actions. Keep app publishing opt-in for owners using their own proxy.
- [ ] **Put one AI agent to work (005)**
  - [ ] In the web UI, create a named agent, issue its own credential, and grant specific roles for one connected app. Installation kits define stable roles and their allowed HTTP methods and routes. The gateway enforces the granted role union and the app enforces native permissions. The owner can delegate any subset of the kit roles they have enabled for that installation, inspect and change grants, rotate credentials independently of roles, and revoke the agent.
  - [ ] Use an external AI agent through the CLI and gateway to complete one useful action in that app, with kit-defined roles, server-held app credentials and owner-configurable approvals. Let the owner review agent requests in the activity log, with the result, agent identity and delegating owner. Verify a disallowed action and access to an ungranted app are denied.
  - [ ] Remove the grant and retry with the existing session. Verify denial, then verify rotated and revoked credentials lose access. Document the supported app and action so another owner can repeat the example.
- [ ] **Open a workspace from the macOS desktop (008)**
  - [ ] Download the Apple Silicon and Intel DMGs from GitHub Releases and verify Developer ID and notarization. Drag the app into Applications, eject the image and test the installed app and its CLI on the supported Macs.
  - [ ] Choose local setup. Detect Docker, let the owner override the detected engine, guide them through installing or starting it when needed, then set up and start the workspace through the existing CLI. Use its normal owner setup. Document local availability while the Mac is asleep or off and license terms for owners who choose Docker Desktop.
  - [ ] Choose an existing server, enter its URL and sign in on a Mac without local Docker. From either path, review and confirm an independent app's installation kit on the selected workspace and open the app.
- [ ] **Personalize the dashboard (010)**
  - [ ] Verify all three starters and a custom theme across the dashboard and isolated Mac launcher. Edit colors and fonts, export a theme and apply it in another workspace. [Appearance journey](../specs/010-personal-themes/spec.md)
- [ ] **Build and customize a personal workspace with an agent (011)**
  - [ ] Verify unattended, resumable provisioning and an agent-built Home with reads from owner-selected apps and roles. [Creator journey](../specs/011-agent-workspace/spec.md)
  - [ ] Verify managed public and private repos, agent edits, a direct kit URL and the kit directory. Confirm a pinned deployment preserving installation identity and named volumes.
- [ ] **Arrange installed apps (012)**
  - [ ] Verify four resizable layouts, composition links, saved views and sidebar app order across a large screen and a phone-sized display. [Layout journey](../specs/012-multi-app-layouts/spec.md)
- [ ] **Prepare the public release (gate)**
  - [ ] Run the complete owner journey from a clean download on the supported hosts. Record the release candidate, verified configurations, and limitations.
  - [ ] Close the security, privacy, licensing, documentation, and publication checks in the [release checklist](public-release-readiness.md). Obtain the owner’s publication decision.

Qualify the outstanding real-app writes in [005](../specs/005-owner-agent/spec.md) and deliver [macOS desktop entry in 008](../specs/008-desktop-entry/spec.md). Both need release-candidate evidence alongside the existing headless install and browser paths.

## Post-public: Later Direction and Enhancements

These capabilities are not required for the first public release. Their order and timing remain open.

### Deferred from the first release

These journeys keep their original numbers. Their order after publication is open.

- [ ] **004 · Invite a team**
  - [ ] Support app single sign-on through OpenID Connect with Your Space as the identity provider (level 1 integration).
  - [ ] Let the owner create an invitation link and share it directly with a prospective member.
  - [ ] Let the recipient sign up and join the workspace through the invitation.
  - [ ] Retain existing account, workspace, membership, and ownership identities when adding members.
  - [ ] Give each member a recovery code at signup that lets them reset their own password.
  - [ ] Let the owner reset a member's password with a temporary password the member must replace at next sign-in.
  - [ ] Let the owner remove a member: sign them out everywhere and revoke their app roles and their agents' access.
  - [ ] Keep past app activity traceable to former members and deleted agents.
  - [ ] Let the owner assign app roles to human members.
  - [ ] Assign multiple roles per member and app. When a member loses a role, remove that delegation from their agents and active sessions.
  - [ ] Disable a removed member's agents rather than deleting them, and let the owner delete them later.
  - [ ] Extend the owner’s agent activity log to team invitations, membership changes and member-role delegations.

- [ ] **006 · Maintain and move a workspace**
  - [ ] Include app installation, removal and update events in the broader workspace activity history.
  - [ ] Back up any installation through the CLI: the Your Space server produces the backup and returns it through its API, wherever the server runs.
  - [ ] Restore a backup into an installation.
  - [ ] Make backup and restore easy to script, so a person or their agent can move a workspace between installations themselves.
  - [ ] Before updating Your Space, record versions and snapshot its data; if the update fails, roll back automatically.
  - [ ] Uninstall Your Space and every app container it manages; keep data by default, and require explicit confirmation and offer a backup before deleting it.
  - [ ] Preserve app identity, exact source version, provenance, and approved update source or policy; do not silently expand granted access on update.
  - [ ] Extend 011’s owner-confirmed compatible replacements to general upstream updates with reviewed data migrations.
  - [ ] Back up app data and record image versions before each update; if the update fails, automatically roll back to the previous versions and restore the backup.

- [ ] **007 · Build and connect more apps**
  - [ ] Document versioned public integration contracts for independently built and running apps.
  - [ ] Design the contract so it works the same whether Your Space runs the app or the app is hosted elsewhere.
  - [ ] Publish TypeScript and Python SDKs from this repository for apps in their own repositories, including first-party apps.
  - [ ] Verify each SDK with a working app.
  - [ ] Build on journey 011’s portable Compose apps with the full SDK for deeper integrations.
  - [ ] Let the owner add an app someone already runs elsewhere through a connector that runs next to it and connects out to Your Space, instead of deploying it.
  - [ ] Verify the broader app-installation example with Sure and Twenty side by side. The personal release verifies one real app installation and one permission-aware integration.

- [ ] **008 · Extend desktop support beyond the first Mac release**
  - [ ] Bring the full desktop workspace and installed-app experience to the additional supported operating systems.
  - [ ] Provide an installable PWA client with the same experience.
  - [ ] Define which desktop app, CLI, and server versions work together, and show a clear "update the app" or "update the server" message on a mismatch.
  - [ ] Ship the desktop app for Linux.
  - [ ] On Windows, support the desktop app and a local workspace in an engine Your Space provides; Windows is not a supported server host.
  - [ ] Sign Windows builds through SignPath, with Microsoft Artifact Signing as fallback, in CI.
  - [ ] Show installed apps in native views, one per app, instead of iframes.
  - [ ] Update the desktop app itself, checking GitHub for new releases.
  - [ ] Provide a Docker-compatible engine: Your Space's own virtual machine by default on macOS (and later Windows), or an engine the owner already runs as an advanced option.
  - [ ] Streamline local owner setup with one desktop form that drives the existing owner command and sets the password on the user's behalf.
  - [ ] Update a local Your Space installation when the owner chooses.
  - [ ] Back up and restore the local workspace through the CLI.
  - [ ] Uninstall the local workspace through the CLI's uninstall command.
  - [ ] Qualify the CLI with the Linux desktop for local workspaces.
  - [ ] Run the CLI on Windows so the desktop app can drive it for local workspaces there.
  - [ ] Distribute and verify standalone macOS CLI executables and a Homebrew formula.

### Other later directions

- [ ] **Optional owner-configured email**

  **Deferred (2026-11-02):** [Sessions, persistence, and recovery](architecture/decisions.md#sessions-persistence-and-recovery).

  - [ ] Let the owner add their own email (SMTP) settings to enable email delivery.
  - [ ] Verify owner and member email addresses when email is configured.
  - [ ] Send password-reset links to verified addresses through the existing recovery mechanism.

  Member recovery in 004 must work without configuring email.

- [ ] **Optional open sign-up**

  **Source:** [Authentication and initial claim](architecture/decisions.md#authentication-and-initial-claim).

  - [ ] Let the owner choose to allow people to sign up without an invitation.

  The personal release has one owner. Journey 004 adds invitation-only membership.

- [ ] **Automatic app updates**

  **Deferred (2026-10-30):** [App update decision](architecture/decisions.md#accepted-future-app-distribution-direction).

  - [ ] Support automatic app updates under the owner's approved update policy.

  Journey 011 covers owner-confirmed compatible replacements. Journey 006 adds broader upstream updates.

- [ ] **App backup history and manual rollback**

  **Deferred (2026-10-31):** [App update decision](architecture/decisions.md#accepted-future-app-distribution-direction).

  - [ ] Keep more than one app backup and let the owner roll back an update that succeeded.

  Journey 006 restores the pre-update backup when an update fails.

- [ ] **Alternative deployment-file formats**

  **Deferred (2026-10-31):** [App deployment decision](architecture/decisions.md#accepted-future-app-deployment-direction).

  - [ ] Explore an app format other than Docker Compose if a real need surfaces, added as another
    importer for the app description.

  **Reworded (2026-11-14):** the first public release reads apps' own Compose files, with
  installation kits, instead of a Compose file with an `x-your-space` section.

- [ ] **Additional SDK languages**

  **Deferred (2026-10-31):** [Platform and independent apps](architecture/decisions.md#platform-and-independent-apps).

  - [ ] Publish SDKs for languages beyond TypeScript and Python, such as Go.

  Journey 007 delivers the TypeScript and Python SDKs first.

- [ ] **Build apps from source during installation**

  **Deferred (2026-10-30):** [App deployment decision](architecture/decisions.md#accepted-future-app-deployment-direction).

  - [ ] Support building app images from repository source as an additional installation path.

  The first release requires developers to publish the exact images and versions declared by their
  app's integration files. Build execution and its operational requirements belong to this later work.

- [ ] **Additional discovery sources**

  Journey 011 supports private GitHub sources, direct kit URLs and one optional operator-selected GitHub directory. Later discovery work includes combining multiple directories and preserving update routing when a directory changes.

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

## Maintaining the checklist

Keep the overview and spec map in step with the release checklist. Date each completed outcome and link its implementation and verification. Move deferred work into the post-public section and preserve its journey number and delivery history.
