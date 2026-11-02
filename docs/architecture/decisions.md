# Your Space Architecture and Product Decisions

**Status**: Accepted direction with implementation choices explicitly left open

**Recorded**: 2026-10-28

**Last updated**: 2026-11-01

**Scope**: Project-wide direction, independent of any feature specification

**Delivery view**: [Roadmap](../roadmap.md), derived from this record

**Related feature**: [Workspace Setup and Owner Access specification (PR #3)](https://github.com/your-space-ai/your-space/pull/3)

**Governing document**: [Your Space Constitution](../../.specify/memory/constitution.md)

## Purpose and Scope

This is the canonical project-wide record of accepted architecture and product direction, including decisions for future work.
It remains relevant across feature specifications and must not be archived or replaced when an individual feature is completed.
The constitution establishes governing principles; this record captures shared decisions and open choices; individual specifications define delivery scope and acceptance criteria.
Open proposals remain candidates, even when they have been discussed in detail.

The first feature establishes manual Docker Compose installation, owner setup, authentication, an empty workspace, persistence, and recovery.
It does not install independent apps or implement app roles, agents, a marketplace, or an agent execution runtime.
Later specifications must turn those directions into concrete contracts and acceptance criteria.
Recording an accepted future direction here does not add it to the first feature or claim that it has been implemented.

## How to Use and Maintain This Record

- Consult this record and the constitution before creating or changing specifications, technical plans, or public integration contracts.
- Keep cross-feature decisions here and link to them from feature documents rather than creating competing copies of project direction.
- Update this record in the relevant pull request when a shared decision is agreed or changed. Keep accepted decisions, open proposals, and superseded decisions distinguishable.
- When replacing an accepted decision, record the date, rationale, and what it supersedes; retain its rationale or link to the change that preserves that history.
- Reflect changes to agreed direction and sequencing in the [roadmap](../roadmap.md) in the same PR. The roadmap is a derived delivery view, not a competing source of decisions or acceptance criteria.
- Resolve conflicts with the constitution explicitly through its governance process. A feature plan must not silently override shared decisions.

The repository README and agent guidance link here so future planning can find this record without knowing which feature originally prompted a decision.

## Accepted Foundation Decisions

### Installation and Hosting

- Begin with a documented, manual Docker Compose installation and browser-guided owner setup.
- Initially support macOS and Linux server hosts. Users on other operating systems can access a supported server through the web client.
- The desktop app can also run a local workspace on the same machine on macOS, Windows, and Linux, through the Your Space CLI. The CLI therefore runs on all three.
- On Windows, people can use the desktop app and run a local workspace through Docker Desktop. Windows is not a supported server host.
- Begin with a web client in the owner-access feature. Web, desktop, and PWA clients are part of the first public-release target; the desktop app uses Electron.
- Keep client and server as independent components that can run on the same machine or different machines.
- Store authoritative account and workspace state on the server, rather than relying on a particular browser.
- Use persistent storage so supported restarts retain identity, ownership, and workspace state.
- Document prerequisites, setup, storage, restart, remote client access, and owner recovery.
- Keep Kubernetes and kind outside the initial installation requirements.

Docker Compose provides a concrete first installation target without requiring Kubernetes administration.
This choice does not commit every future deployment to Compose or promise identical deployment configuration everywhere.
Exact supported OS versions and CPU architectures, prerequisites, networking, and transport configuration require an implementation plan.

**Decision update (2026-11-01):** Windows is supported for the desktop app and for a local workspace run through Docker Desktop, but not as a server host. Server hosts remain macOS and Linux.

### CLI Delivery Sequence

**Decision update (2026-10-29)**: Establish and verify the Compose deployment with the owner-access feature first.
A separate specification and the next implementation PR will add a Your Space CLI for installation and management of that deployment.
This replaces the earlier proposed CLI-first ordering: the CLI needs a working deployment to manage.

- The first feature must be installable and operable through documented manual Compose procedures without a standalone Your Space CLI.
- Setup authority and owner recovery remain part of the first feature, with documented operator commands available through the deployment.
- The CLI drives Docker Compose on the user's behalf for both local and server installations, so installation and management are a managed experience rather than users running Compose themselves.
- The desktop app's local mode drives the CLI for the user. People can also run the CLI themselves to set up a local workspace.
- There is one installation and setup behavior. The CLI behaves the same for local and server installations, and wrappers such as the desktop app simplify the experience without changing the CLI or setup behavior.
- The manual Compose procedures stay documented as an advanced alternative; the CLI is the supported way to install.
- Before publication the CLI provides at least these operations: install, start, stop, status, logs, update Your Space, owner password recovery, backup, and restore.
- Updating Your Space through the CLI rolls back automatically if the update fails; see [Your Space updates, backup, and restore](#your-space-updates-backup-and-restore).
- CLI command names, packaging, prerequisite automation, and the rest of its management scope belong in its separate specification.

Guided installation remains the product direction. The initial guide and browser setup establish the working pathway that the CLI will automate.

**Decision update (2026-10-31):** The CLI is the managed installation and management path for both local and server installations, driving Docker Compose for the user. The desktop app's local mode drives the CLI rather than managing Docker itself, and people can run the CLI themselves for a local install. This supersedes the 2026-10-31 position that the CLI is only the server deployment path.

**Decision update (2026-11-01):** The owner-access feature (PR #3) and its manual Compose procedure come first, then the CLI. The minimum CLI operations before publication are install, start, stop, status, logs, update Your Space, and owner password recovery. Backup and restore are not part of the first release (superseded 2026-11-02: backup and restore are required before publication); see [Your Space updates, backup, and restore](#your-space-updates-backup-and-restore).

### Server and Database

- Use Node.js and Express for the platform server.
- Use PostgreSQL as the initially supported platform database.
- Use Drizzle for database access and schema tooling.
- Do not require a second platform database implementation for local installations.

Express is the accepted server framework; future capacity decisions should use measured workloads.
PostgreSQL provides one persistence foundation across local and hosted server deployments.
This choice does not require every independently developed app to use PostgreSQL.
Exact runtime and database versions, migration execution and recovery strategy, and connection configuration remain open.

### Web Client

- Use React, TypeScript, and Vite for the initial web client.
- Router, query/state tooling, styling, and component library remain implementation planning choices.

### Owner and Workspace Model

- Support one human owner and one workspace in the first feature.
- Keep account identity, workspace identity, membership, and ownership as distinct concepts.
- Establish those relationships explicitly so later membership support does not require replacing existing identities.
- Do not expose invitations, additional human accounts, role administration, or ownership transfer in this feature.

Owner-only scope limits the first user journey; it is not a permanent single-user constraint on the product.
These concepts do not prescribe a specific database schema.

### Authentication and Initial Claim

- Your Space defines and operates one server-managed authentication system across deployment modes.
- Use Better Auth as the authentication library within that system.
- Authentication must not depend on an external identity provider.
- Initial account creation collects a name, email address, and password.
- Email serves as a login identifier and is not treated as verified without mailbox verification.
- Initial self-hosted setup does not require SMTP or another email-delivery service.
- A temporary, single-use setup code supplied through the operator-only installation procedure establishes authority to claim an installation.
- Network access to an unclaimed server alone is insufficient authority to create its owner.
- Successful setup creates the initial owner and workspace, then closes initial registration.
- Concurrent or retried setup must not create duplicate owners or replace an existing owner.

The setup code proves installation authority. It does not prove control of the supplied email address.
Every installation uses the same setup-code flow. In desktop local mode, the desktop app obtains the setup code through the CLI and submits it on the user's behalf, so the user never has to enter it; the setup flow itself does not change.
The same account model serves local and remote installations; deployment configuration may govern email delivery and verification policy.
Separate local-only and hosted authentication implementations are not part of the direction.

### Sessions, Persistence, and Recovery

- The owner can sign in, reach the empty workspace, and sign out.
- Protected server operations enforce authentication independently of what the UI displays.
- Expired or invalidated sessions cannot continue accessing protected resources.
- Restarts preserve account identity, workspace identity, and ownership.
- Storage unavailability must not make a claimed installation appear unclaimed.
- An operator recovery command on the server issues a short-lived, single-use password-reset link for the existing owner.
- Completing recovery changes the password, revokes old sessions, and requires normal sign-in.
- Recovery preserves existing identities and ownership; it does not reopen setup or create a replacement owner.

Future email delivery can send reset links to verified addresses through the same recovery mechanism.
A managed service can provide that delivery without introducing a second authentication system.
Token lifetimes, operator command mechanics, session storage, and revocation implementation remain technical planning choices.

Invited members recover their passwords without email in the first release:

- A member receives a recovery code at signup and can use it to reset their own password.
- As a fallback, the owner can reset a member's password and give them a temporary password. The member must replace it the next time they sign in.
- Like owner recovery, a member password reset preserves identity and revokes existing sessions.

**Decision update (2026-11-02):** Member recovery uses a recovery code issued at signup, with an owner-issued temporary password as the fallback. Requiring an email service, or requiring the owner for every reset, were both rejected for the first release. How many codes are issued, whether a used code is replaced, and temporary-password lifetime belong in the members specification.

**Decision update (2026-11-02):** Optional owner-configured email is post-open-source work. The owner can add their own email (SMTP) settings to enable verified email addresses and email password resets through the existing recovery mechanism. No installation requires email, so the first release still needs a recovery path that works without it.

### Your Space Updates, Backup, and Restore

- Updating Your Space has the same safety net as app updates. Before an update, Your Space records its current versions and takes a snapshot of its data. If the update fails, it rolls back automatically to those versions and restores the snapshot.
- Releases are not expected to break on update; automatic rollback is protection, not a substitute for release testing.
- One pre-update snapshot mechanism serves both app updates and Your Space updates, and is built before publication.
- Backup and restore are built before publication, with a single implementation for every installation. The CLI asks a Your Space server to produce a backup, and the server returns it through its API, so the behavior is the same whether the server runs locally or remotely. Wrappers such as the desktop app use the same operation.
- Backup and restore build on the pre-update snapshot mechanism rather than a separate implementation.
- A backup contains everything in the workspace, including credentials and app data, so producing or restoring one requires owner authority.
- Moving a workspace between installations, such as from a local machine to a server, is a backup from one and a restore into the other rather than a separate feature.
- The data model and storage layout are designed from the start so that the whole workspace can be captured and restored consistently, keeping backup a small addition rather than a retrofit.

**Decision update (2026-11-01):** Failed Your Space updates roll back automatically, matching app updates. Backup and restore move to post-open-source work (superseded 2026-11-02 below) and have one server-produced, CLI-driven implementation for local and server installations, superseding the earlier local-only framing of deferred backup and migration.

**Decision update (2026-11-02):** Backup, restore, and moving a workspace between installations are required before publication, superseding their deferral. Without them, a lost disk or a bad change loses the workspace, including members' accounts and app data, and early users will put real data in the first release. A documented manual procedure, such as copying Docker volumes, was rejected in favor of the built-in implementation. Designing the data model and storage for consistent capture from the start keeps the work small.

What counts as a failed Your Space update, snapshot contents and storage, how the CLI authenticates to a remote server, how a restore reaches a broken or fresh installation, and backup format and protection remain open.

## Accepted Product and Repository Direction

### Platform and Independent Apps

- The platform is self-hostable first, with a managed offering planned later.
- Guided installation remains part of the product direction.
- This repository contains the platform server, client, SDK, and public integration contracts.
- Installable apps, including first-party apps, live in separate repositories with their own builds and releases.
- Apps run independently and integrate through documented, versioned public contracts.
- Installing a compatible app does not require rebuilding the platform or including app source in its build.
- The SDK is developed in this repository and published for use by independent app projects.
- First-party apps use the same public integration surface as other apps.
- The first public release publishes TypeScript and Python SDKs. SDKs for other languages are post-open-source work.

**Decision update (2026-10-31):** TypeScript and Python SDKs are required before publication. Together they cover two common stacks: a TypeScript frontend with a Python backend, and TypeScript on both frontend and backend. Developers using other languages can still integrate through the documented public contracts.

The intended developer experience is to adapt an existing app for installation and platform identity integration.
An app should remain independently runnable rather than requiring a replacement frontend networking layer.
Existing app authorization should be reusable where it has a suitable integration boundary.

### First Public-Release Audience and Clients

- The first public release targets two groups: people who can install Docker Desktop and the Your Space desktop app to run a local workspace, and people who can install Docker and follow a guided CLI to deploy a server or a local workspace, both without one-on-one assistance.
- The web, desktop, and PWA clients provide the same core workspace and installed-app experience while connected to a Your Space server; a local network connection is sufficient.
- The desktop app uses Electron and ships for macOS, Windows, and Linux.
- When setting up the desktop app, the user either connects to an existing server by URL or runs Your Space locally. In local mode, the desktop app uses the Your Space CLI to set up and run the Docker Compose stack on that machine, then connects to it.
- The CLI is part of the first public release for setting up Your Space on a server or locally; desktop, web, and PWA clients can connect to a server it sets up.
- Before publication, local mode detects Docker and links to the Docker Desktop download when it is missing, sets up the Your Space stack, starts it when the desktop app opens, and updates Your Space when the owner chooses.
- Every installation, local or server, uses one setup flow with the setup code. In local mode the desktop app obtains the setup code through the CLI and submits it for the user, so the user never has to enter it. Streamlined local setup in the desktop app gets its own specification and implementation PR, separate from the owner-access feature.
- Before publication, the owner can back up and restore local and server installations alike, and move a local workspace to a server, through the CLI; the desktop app uses the same operation in local mode. Owner-triggered Your Space updates in local mode go through the CLI and roll back automatically if they fail.
- A local workspace is unavailable to other people and remote agents while its machine is asleep or off. Install documentation must state this and the Docker Desktop license terms.
- PWA offline support remains open. The first owner-access feature remains web-only.

**Decision update (2026-10-31):** Desktop clients move from the first public release to post-open-source work. They need a separate build for each operating system, code signing including Apple notarization, and their own update mechanism, while the installable PWA already opens in its own app window on macOS, Windows, and Linux.

**Decision update (2026-10-31):** Desktop clients return to the first public release, superseding the deferral above, so that less technical users can run their own workspace. The desktop app can connect to an existing server or set up and run a local Docker Compose stack. The CLI stays for server deployment (superseded by the [CLI delivery sequence](#cli-delivery-sequence): the CLI handles local and server installations). Electron is selected, shipping for macOS, Windows, and Linux, which accepts the per-OS build, signing, and update costs.

**Decision update (2026-10-31):** Local mode's first-release scope is Docker detection with a download link, stack setup, starting the stack with the app, and owner-triggered Your Space updates. Local backup and restore, and moving a local workspace to a server, are deferred (superseded 2026-11-02: required before publication).

**Decision update (2026-10-31):** Local mode skips the setup code: the desktop app sets up the stack and supplies setup authority itself, so network access alone still cannot claim a local workspace. Server installations keep the setup code from the owner-access feature. Streamlined local setup is specified and implemented in its own PR, separate from the owner-access feature.

**Decision update (2026-10-31):** Supersedes the setup-code exception above. There is one setup flow for every installation, and the CLI behaves the same for local and server installations. The desktop app wraps the CLI and handles the setup code on the user's behalf; it does not skip or replace setup authority.

### Deployment Boundaries and Licensing

- Keep core behavior independent of a particular cloud provider.
- Provide platform-specific installation guides and deployment adapters for supported environments.
- Keep provider-specific storage, networking, and provisioning details within those deployment boundaries.
- Preserve compatible, versioned app contracts between self-hosted and managed installations.
- Dependencies must permit the intended commercial distribution and managed hosting. Prefer permissive open-source licenses; MIT is preferred but not mandatory.

A future Cloudflare, VPS, or other cloud pathway must demonstrate persistence and lifecycle behavior in that environment.
Provider neutrality does not mean every runtime already supports the same executable or deployment configuration.
Dependency selection must consider actual licenses, including bundled components and distribution-specific terms.

## Accepted Future App Distribution Direction

- For the first public release, an owner installs a compatible app by pasting the GitHub URL of the app's deployment file in a public repository into Your Space.
- Connected GitHub account access for installing authorized private repositories is future work after the first public release.
- Curated app listings provide discovery and use the same installation contract as direct repository installation.
- The official curated listing is optional, rather than a prerequisite for installing compatible apps.
- Preserve each installation's app identity, exact source version, provenance, and approved update policy or source.
- Changing or disconnecting a discovery source must not silently redirect updates, replace an app, uninstall it, or delete its data.
- App updates must not silently expand granted access.
- The first public release supports owner-triggered updates of installed apps, preserving app data and requiring explicit approval for any additional access.
- Automatic app updates are post-open-source work.
- Before each app update, Your Space records the app's current image versions and backs up its data.
- If an update fails, Your Space automatically rolls the app back to the recorded image versions and restores the pre-update data backup.
- Keep failed-update rollback minimal: only the backup needed to restore the pre-update state is required. Backup history and owner-initiated rollback of a successful update are post-open-source work.

**Decision update (2026-10-30):** Owner-triggered app updates are required before publication so owners can keep installed apps current. Automatic updates are deferred. Update selection, compatibility checks, and failed-update recovery still need definition in the app contract.

**Decision update (2026-10-31):** A failed update rolls back automatically from a pre-update backup instead of relying on a manual recovery procedure. Data is backed up because an update can change app data in ways the previous version cannot read. The mechanism stays simple; the app contract defines what counts as a failed update.

Public, community, and private discovery experiences can coexist without redefining installed app ownership or update routing.
No catalog federation protocol or marketplace implementation is selected here.
Repository access authorizes retrieval of code; it does not grant that code access to workspace resources.
Deployment-file contents, packaging, release verification, installation execution, storage, upgrades, and rollback need a separate app contract.

## Accepted Future App Deployment Direction

- Independent apps run in their own container or containers and integrate with Your Space through APIs. They do not run inside a Your Space-specific application environment.
- Your Space starts and manages installed app containers. For the first public release, it supports Docker on the same machine as the Your Space server. Other machines and deployment backends are future work.
- An app can declare and use its own database service, which Your Space runs alongside it; apps are not required to use the platform's database.
- Apps have isolated environments and app-specific durable storage. They do not receive direct access to host folders, devices, or Docker controls. The enforcement mechanism and precise isolation guarantees require design and verification.
- Uninstalling an app retains its data by default. The owner can explicitly delete retained app data from an administration UI.
- The app developer supplies a separate deployment file in the app's existing repository. The owner installs the app by pasting that file's GitHub URL; Your Space reads the file at that URL and records the exact commit used. Updates re-read the file from the same URL.
- The first public release installs published container images only. The app's integration files must declare the exact image and version to install for each container, including any declared database service.
- Building apps from source during installation is post-open-source work.
- The deployment file is a Docker Compose file. Your Space accepts only Compose settings on an approved list and rejects all others, including settings that would break app isolation, such as host folder mounts, devices, privileged mode, or host networking.
- The approved list is not defined in advance. It starts with the settings the first app needs when that app is implemented, and grows as later apps need more.
- The app describes itself to Your Space, such as its name and the access it needs, in a dedicated `x-your-space` section of the same Compose file.
- Alternative deployment-file formats are post-open-source work, explored only if a real need surfaces, such as app details the Compose file cannot express.

**Decision update (2026-10-30):** Published images with exact declared image versions are required for the first release. This resolves the previously open image-pull-versus-source-build choice. Developers publish their images; Your Space downloads and runs the declared versions. Deferring source builds keeps build execution and its operation outside the initial installation scope.

**Decision update (2026-10-31):** The deployment file uses Docker Compose, resolving the previously open format choice. App developers already know Compose, and it can declare the app and its database service with exact image versions. A new Your Space format would be easier to validate but would require every developer to learn it; it is deferred until a real need surfaces.

**Decision update (2026-10-31):** The owner pastes the URL of the deployment file itself, superseding the earlier choice to paste the repository URL and read the file from the default branch. Because the URL names the exact file, Your Space needs no file-naming or discovery convention, and one repository can hold more than one app.

**Decision update (2026-10-31):** App details for Your Space go in a dedicated `x-your-space` section of the Compose file. Compose permits extension sections and ignores them, so installation stays one file and one URL. A separate details file would need a second URL or file-finding logic. If the Compose section proves too limited, a custom format can be explored later.

**Decision update (2026-10-31):** Your Space accepts only Compose settings on an approved list rather than blocking known-dangerous ones. An approved list fails safe: an unlisted setting is rejected until it is reviewed and added, while a blocked list lets through any setting nobody thought to block. The list is derived from what the first app needs during its implementation instead of being guessed up front.

The deployment file is intended to describe how Your Space launches the app without coupling deployment configuration to application code. It uses Docker Compose. The initial approved list of Compose settings, set when the first app (Tasks) is implemented, the contents of the `x-your-space` section, supported operations, and backend interpretation remain open. The app contract must define how exact image identity is validated and retained alongside the repository commit. Trust verification, owner-triggered update mechanics, and how a failed update is detected still need decisions.

App role authorization controls what users and agents may do within an app. Host isolation is a separate boundary and must not rely on those roles or the SDK alone. The runtime manager's privileges and deployment-file processing must be designed so app-provided configuration cannot bypass the agreed host-access boundary.

## Accepted Future App UI and Authorization Direction

### UI Integration

- Users open installed apps inside the Your Space interface while platform navigation remains available.
- Existing app frontends should continue calling their normal app backend operations.
- UI integration must not require replacing every frontend request with a Your Space-specific SDK call.
- UI and programmatic access must reach equivalent backend authorization checks.

An iframe, reverse proxy, or controlled UI extension system is not selected by this record.
Embedding and routing are separate decisions from how an app interprets authenticated identity and roles.
Frontend controls may reflect granted access, but hiding a control is not authorization enforcement.

### Identity and App-Owned Roles

- Your Space manages identities and app role assignments.
- Apps expose a supported role catalog with stable role identifiers and retain their existing role semantics and domain-specific authorization rules.
- In the first public release, the owner assigns app roles to human members. Workspace roles, such as an administrator, may be added later.
- Both humans and agents can hold multiple roles for an app installation.
- Role assignments are scoped to the specific app installation and workspace.
- Apps receive verified identity and role information through an integration with their authentication and authorization boundary.
- Human access resembles “Sign in with Your Space”; agents use non-interactive credentials from the same platform identity model.
- Agents have their own identities, remain distinguishable from humans, and retain their delegating-user relationship.
- App activity identifies the actual actor rather than making an agent appear to be its human owner.

For apps with centralized authorization, the SDK should adapt platform identity and grants into that existing system.
Apps without an authorization boundary will need additional integration; universal zero-change compatibility is not promised.
The protocol, credential types, role catalog format, and mapping APIs remain open.

### Delegation by Exact Role Subsets

A user may assign an agent any subset of the roles currently assigned to that user for the same app installation and workspace.
Your Space compares role identifiers, not inferred permission equivalence or an ordering of “higher” and “lower” roles.
Multiple roles are supported for both the delegating user and the agent.

For example, a user assigned `viewer` and `contributor` can delegate either role, both roles, or neither.
That user cannot delegate `administrator` unless that exact role is assigned to the user.
No role hierarchy is required or implied.

- Removing a role from a user also removes that role from agents receiving delegated access through that user.
- Removing access must affect existing app sessions and credentials, not only future sign-ins.
- Giving a user an additional role does not automatically grant that role to the user's agents.
- Restoring a user's removed role does not define a restoration policy for prior agent grants in this record.
- Restoration, regrant behavior, propagation guarantees, and credential refresh mechanics require a later specification.

The subset rule is about assigned role identifiers; it is not a general proof of semantic permission containment.
Some app authorization systems use deny roles, role combinations, or contextual rules where removing a role can increase effective access.
Compatibility with those semantics remains unresolved and must be addressed in the app contract before claiming bounded effective authority.
The app remains authoritative for resource-level rules, including workspace ownership of its records.

### Responsibility and Trust Boundary

Your Space supplies verified identities, role assignments, delegation rules, and revocation state.
The app enforces its role and domain rules for protected operations, regardless of whether a human UI or an agent initiated the request.
The SDK connects those responsibilities without imposing a replacement permission system on every application.

A gateway can support deployment and access control, but mandatory endpoint-to-permission manifests are not the selected integration model.
Installing an app still trusts its implementation with data under that app's control.
Platform isolation must protect platform services and other apps; SDK checks alone do not constrain malicious app code.

- Security and flexibility are the two cornerstones of the app foundation.
- The first public release states plainly, in the documentation and when an owner installs an app, that installing an app trusts it with its own data. Your Space protects itself and other apps from an installed app, but is not a sandbox for hostile code.
- Before publication, a security hardening pass reviews the boundaries between apps and the workspace, enforces them, and protects users as far as Your Space reasonably can.

**Decision update (2026-11-01):** Add install-time warnings, documentation disclaimers, and a pre-publication security hardening pass on app and workspace boundaries, so the isolation work is not mistaken for a sandbox for untrusted code.

## Later Candidate Journeys

After the owner-access feature and an agreed app contract, a small Tasks app is the first app and the end-to-end integration slice.
That journey would install the independent app, create and view a task, retain it after restart, and expose permitted operations to an agent.
Verification would cover identity attribution, denied operations, and revocation across UI and programmatic access.
It follows the planned CLI follow-up and an agreed app contract and is not an app implementation included in the current feature.

**Decision update (2026-10-31):** The small Tasks app is selected as the first app, replacing its candidate status. It is small, needs a database, and exercises roles (viewing and editing tasks) and agent access (an agent creating tasks), covering each part of the first-release app journey. Its needs set the initial approved list of Compose settings.

External agents come before platform-hosted agent execution.
Later hosted agents could run workflows such as daily triage through the same identity and authorization contracts.
Identity and permissions remain independent of any model provider or execution runtime.
No hosted workflow engine or model-provider integration is selected here.

## First Public-Release Direction

**Decision update (2026-10-29)**: Plan the roadmap in pre-public and post-public sections. The pre-public section covers the core experience and a working first version; post-public covers capabilities that are not crucial to that release. The owner prefers an installable, usable product before making the repository public rather than publishing only plans.

The intended pre-public experience includes owner setup; additional members signing up through invitation links created and shared by the owner; the installation CLI for servers and local workspaces; a desktop app that can also run a local workspace; web, desktop, and PWA workspace clients; at least one installed independent app; a way for developers to create, integrate, and install more apps; and access for external agents. Only the owner installs or removes apps in the first public release. The first release targets users who can install Docker Desktop and the Your Space desktop app for a local workspace, or install Docker and follow a guided CLI for a server or a local workspace.

This is a developing release roadmap, not a complete acceptance specification or a claim of implementation. Additional requirements may emerge during the interview. These future capabilities do not expand the owner-only first feature. The agreed sequence remains manual Compose and owner access first, then a separate CLI specification and implementation; no further feature order is established.

## Choices Still Open

| Area | Current status |
| --- | --- |
| Client supporting libraries | Router, query/state tooling, styling, and component library remain open. |
| Database configuration | PostgreSQL and Drizzle are selected; versions, migration execution and recovery, and connection configuration need planning. |
| Authentication configuration | Better Auth is selected; password rules, session and credential lifetimes, failed-attempt limits, and adapter configuration need planning. |
| Initial deployment details | macOS and Linux with manual Docker Compose are selected; exact OS/CPU support, versions, transport, networking, and configuration need planning. |
| Desktop app | Electron is selected for macOS, Windows, and Linux; Windows supports the desktop app and local workspaces, not server hosting. Local mode drives the Your Space CLI and covers Docker detection, stack setup and startup, owner setup with the app handling the setup code for the user, and owner-triggered Your Space updates, backup, and restore through the CLI, and migration to a server. Packaging, code signing, and self-update need a specification. |
| CLI delivery | The CLI drives Docker Compose for local and server installations, runs on macOS, Windows, and Linux, and is driven by the desktop app in local mode. Its minimum operations are install, start, stop, status, logs, update Your Space, owner password recovery, backup, and restore. A separate follow-up specification will define packaging, command names, prerequisite automation, and management behavior over the established Compose deployment. |
| Your Space updates and backup | Failed Your Space updates roll back automatically using the pre-update snapshot mechanism shared with app updates. Failed-update detection and snapshot details need definition. Backup, restore, and migration between installations are required before publication; remote CLI authentication, restore into a broken or fresh installation, and backup format and protection remain open. |
| Member password recovery | A recovery code at signup, with an owner-issued temporary password as the fallback, is selected. Code count and replacement, and temporary-password lifetime, need definition in the members specification. Optional owner-configured email resets are post-open-source. |
| Public launch scope | A working core experience before publication is the direction; detailed release criteria and remaining pre-public versus post-public decisions are still being interviewed. See [public release readiness](../public-release-readiness.md). |
| App UI execution | Embedding model, origins, isolation, routing, and session bridging remain open. |
| App identity protocol | OAuth/OIDC or another concrete protocol has not been selected. |
| App integration | TypeScript and Python SDKs are selected for the first release; other languages are post-open-source. Role registration, authorization compatibility, and revocation mechanics need a later specification. |
| App deployment file | A Docker Compose file limited to an approved list of settings, declaring published images with exact versions is selected for the first release; source builds and alternative formats are post-open-source. The owner installs by pasting the file's GitHub URL. App details go in an `x-your-space` section. The approved settings list, set when the first app is implemented, the section's contents, supported operations, and backend interpretation need definition. |
| App runtime and data | Design and verify isolation, lifecycle, networking, persistent storage, retained-data deletion, and runtime-manager privileges. |
| App distribution | Installation from the deployment file's GitHub URL, exact commit recording, and exact declared image versions are accepted for initial installation. Owner-triggered updates are pre-public; automatic updates are post-public. Failed updates roll back automatically to the previous image versions and pre-update data backup. Image identity validation and retention, artifact trust, catalog implementation, update selection and mechanics, and failed-update detection remain open. |

These open choices do not erase the accepted requirements above.
Resolve implementation-critical choices in the relevant technical plan and future app-contract decisions in their own specifications.
