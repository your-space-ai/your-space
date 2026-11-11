# Your Space Architecture and Product Decisions

**Status**: Accepted direction with implementation choices explicitly left open

**Recorded**: 2026-10-28

**Last updated**: 2026-11-10

**Scope**: Project-wide direction, independent of any feature specification

**Delivery view**: [Roadmap](../roadmap.md), derived from this record, and the [spec map](../spec-map.md)

**Related feature**: [Workspace Setup and Owner Access specification](../../specs/001-workspace-owner-access/spec.md)

**Governing document**: [Your Space Constitution](../../.specify/memory/constitution.md)

## Purpose and Scope

This is the canonical project-wide record of accepted architecture and product direction, including decisions for future work.
It remains relevant across feature specifications and must not be archived or replaced when an individual feature is completed.
The constitution establishes governing principles; this record captures shared decisions and open choices; individual specifications define delivery scope and acceptance criteria.
Open proposals remain candidates, even when they have been discussed in detail.
The [architecture overview](overview.md) diagrams the resulting system layer by layer.

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

- Begin with a documented, manual Docker Compose installation. The owner is created with a server command and sets their password in the browser.
- Initially support macOS and Linux server hosts. Users on other operating systems can access a supported server through the web client.
- The desktop app can also run a local workspace on the same machine on macOS, Windows, and Linux, through the Your Space CLI. The CLI therefore runs on all three.
- On Windows, people can use the desktop app and run a local workspace through Docker Desktop. Windows is not a supported server host.
- Begin with a web client in the owner-access feature. Web, desktop, and PWA clients are part of the first public-release target; the desktop app uses Electron.
- Keep client and server as independent components that can run on the same machine or different machines.
- Store authoritative account and workspace state on the server, rather than relying on a particular browser.
- Use persistent storage so supported restarts retain identity, ownership, and workspace state.
- Document prerequisites, setup, storage, restart, remote client access, and owner recovery.
- Keep Kubernetes and kind outside the initial installation requirements.
- Your Space publishes its images for both ARM (including Apple Silicon) and Intel/AMD machines.
- Remote access uses HTTPS. The Compose stack includes a reverse proxy that obtains and renews a certificate automatically when the owner provides a domain during installation; this needs the domain and inbound ports 80 and 443.
- Owners who already run their own reverse proxy or tunnel can turn off the built-in proxy and terminate HTTPS themselves.
- Owners without a domain get documented guidance for a private tunnel such as Tailscale. Plain HTTP is supported only on the same machine (localhost), because browsers require HTTPS for PWA installation and secure session cookies.

Docker Compose provides a concrete first installation target without requiring Kubernetes administration.
This choice does not commit every future deployment to Compose or promise identical deployment configuration everywhere.
Exact supported OS versions, prerequisites, networking, and proxy configuration require an implementation plan.

**Decision update (2026-11-01):** Windows is supported for the desktop app and for a local workspace run through Docker Desktop, but not as a server host. Server hosts remain macOS and Linux.

**Decision update (2026-11-02):** HTTPS for remote access is built in rather than left to the owner: a reverse proxy in the Compose stack provides automatic certificates for a domain, with a bring-your-own-proxy option and documented tunnel guidance for owners without a domain. The proxy implementation (for example, Caddy) is chosen in the CLI specification.

**Decision update (2026-11-03):** The built-in proxy moves from the CLI specification into the
owner-access feature (spec 001), and Caddy is selected. Caddy obtains and renews certificates
natively, so HTTPS needs configuration rather than custom code ([constitution principle VII](../../.specify/memory/constitution.md#vii-reuse-before-building-with-few-trusted-dependencies)).
Shipping it with the first Compose stack means remote access is HTTPS from the first install instead
of relying only on the owner's own proxy or tunnel. Spec 002 adds app routing to the same proxy,
and the CLI asks for the domain during installation. This supersedes the 2026-11-02 note that the
proxy is chosen in the CLI specification.

**Decision update (2026-11-08):** In the manual Compose install, the settings line the owner
writes picks the setup, and the setup decides which ports open. With no line, Your Space runs on
this machine only, at `http://localhost`, published on `127.0.0.1`. `YS_DOMAIN=<name>` publishes
ports 80 and 443 to the network and turns on automatic HTTPS. `YS_PROXY_URL=https://<address>`
publishes plain HTTP on `127.0.0.1:8080` for the owner's own proxy or Tailscale, and offers a
Docker network for proxies that run in containers. With `YS_PROXY_URL` the built-in proxy is not
removed: it still serves the web client and forwards `/api` behind the owner's proxy, which
terminates HTTPS, so only Caddy's certificate handling is off. This refines the bullet above about
turning off the built-in proxy. `YS_PORT` moves the local port when another program has it. Compose
selects one file per setup by which key is set, so every port address is written out in a file
rather than computed or left to Docker's defaults, and the server refuses a wrong value or a
misspelled setting before any port opens. The alternative most projects use, one address setting
with ports open on every interface, was rejected because a fresh local install on a Linux server
would put its sign-in page on the network. The research and the designs
considered are summarized in [research R9](../../specs/001-workspace-owner-access/research.md#r9-https-and-the-caddy-configuration).
The CLI (spec 003) writes the same lines.

**Decision update (2026-11-08):** Your Space generates its own platform secrets. A secret the owner
sets in `.env` is used as given and never copied, so owners can supply secrets from their own
store. Otherwise each secret is generated once, as random bytes, into a dedicated `ys-secrets`
volume kept apart from the database, and never regenerated on its own: if the database exists but
a secret is missing, start-up stops with recovery steps. The owner can replace a generated secret
on request with the secrets step's `--new` option. No sample or default secret ever runs. A
dedicated secret manager was rejected for now, because on one machine its unseal key sits on the
same disk and it adds a container and bootstrap secrets of its own; OpenBao (MPL-2.0) is the
upgrade path.
The research and alternatives are summarized in
[research R16](../../specs/001-workspace-owner-access/research.md#r16-platform-secrets).

### CLI Delivery Sequence

**Decision update (2026-10-29)**: Establish and verify the Compose deployment with the owner-access feature first.
A separate specification and implementation PR will add a Your Space CLI for installation and management of that deployment (sequence updated 2026-11-02 below: the app UI and sign-in specification comes first, and is now part of journey 002; the CLI is journey 003, and since 2026-11-08 it is delivered, like every journey, as a stack of pull requests; see [journey-based specifications](#journey-based-specifications)).
This replaces the earlier proposed CLI-first ordering: the CLI needs a working deployment to manage.

- The first feature must be installable and operable through documented manual Compose procedures without a standalone Your Space CLI.
- Owner creation and owner recovery remain part of the first feature, with documented operator commands available through the deployment.
- The CLI drives Docker Compose on the user's behalf for both local and server installations, so installation and management are a managed experience rather than users running Compose themselves.
- The desktop app's local mode drives the CLI for the user. People can also run the CLI themselves to set up a local workspace.
- There is one installation and setup behavior. The CLI behaves the same for local and server installations, and wrappers such as the desktop app simplify the experience without changing the CLI or setup behavior.
- The manual Compose procedures stay documented as an advanced alternative; the CLI is the supported way to install.
- Before publication the CLI provides at least these operations: install, start, stop, status, logs, update Your Space, owner password recovery, backup, restore, and uninstall.
- Uninstall removes Your Space and every app container it manages, not only the main Compose stack. It keeps data by default; deleting data requires explicit confirmation and offers a backup first. The desktop app uses the same command for local workspaces.
- Updating Your Space through the CLI rolls back automatically if the update fails; see [Your Space updates, backup, and restore](#your-space-updates-backup-and-restore).
- The CLI also gives agents their first-release way to use apps: agent commands call app actions through Your Space with the agent's own credential. See [Agent access through Your Space](#agent-access-through-your-space).
- CLI command names, packaging, prerequisite automation, and the rest of its management scope belong in its separate specification.

Guided installation remains the product direction. The initial guide and browser setup establish the working pathway that the CLI will automate. (Browser setup was replaced by the owner command 2026-11-03; see [authentication and initial claim](#authentication-and-initial-claim).)

**Decision update (2026-10-31):** The CLI is the managed installation and management path for both local and server installations, driving Docker Compose for the user. The desktop app's local mode drives the CLI rather than managing Docker itself, and people can run the CLI themselves for a local install. This supersedes the 2026-10-31 position that the CLI is only the server deployment path.

**Decision update (2026-11-01):** The owner-access feature (spec 001) and its manual Compose procedure come first, then the CLI. The minimum CLI operations before publication are install, start, stop, status, logs, update Your Space, and owner password recovery. Backup and restore are not part of the first release (superseded 2026-11-02: backup, restore, and uninstall are required before publication); see [Your Space updates, backup, and restore](#your-space-updates-backup-and-restore).

**Decision update (2026-11-02):** The app UI and sign-in specification (now part of journey 002 "install an app and use it"; see [journey-based specifications](#journey-based-specifications)) comes between the owner-access feature (spec 001) and the CLI specification. It decides app origins and routing, which set the DNS, certificates, and proxy configuration the CLI installs, and clients, apps, SDKs, and agent access all build on it. Settling it before the CLI avoids reworking the CLI's HTTPS setup. The resulting order is spec 001, then the app UI and sign-in specification, then the CLI specification, then the remaining pre-public items.

**Decision update (2026-11-02):** The CLI provides an uninstall command before publication instead of documented manual removal. Apps run in containers Your Space starts outside the main Compose file, so `docker compose down` alone would leave app containers and data behind; only Your Space knows what it started.

### Server and Database

- Use Node.js and Express for the platform server.
- Use PostgreSQL as the initially supported platform database.
- Use Drizzle for database access and schema tooling.
- Do not require a second platform database implementation for local installations.

Express is the accepted server framework; future capacity decisions should use measured workloads.
PostgreSQL provides one persistence foundation across local and hosted server deployments.
This choice does not require every independently developed app to use PostgreSQL.
Exact runtime and database versions, migration execution and recovery strategy, and connection configuration remain open.

**Decision update (2026-11-03):** The [001 technical plan](../../specs/001-workspace-owner-access/plan.md) selects Node.js 26 LTS and PostgreSQL 18, with Drizzle and `pg`, and applies Drizzle Kit migrations at server startup. Recovery from a failed migration belongs with update rollback in spec 006.

### Web Client

- Use React, TypeScript, and Vite for the initial web client.
- Router, query/state tooling, styling, and component library remain implementation planning choices.

**Decision update (2026-11-03):** The [001 technical plan](../../specs/001-workspace-owner-access/plan.md) selects TanStack Router and TanStack Query, with Better Auth's React client for session calls, plain CSS, native form validation, and no component library. Caddy serves the built web client as static files and forwards `/api` to the Express server, so the client and API share one origin. A server-rendered frontend was considered and deferred until a spec needs public, logged-out pages.

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
- Initial account creation collects a name and email address; the owner then sets a password.
- Email serves as a login identifier and is not treated as verified without mailbox verification.
- Initial self-hosted setup does not require SMTP or another email-delivery service.
- A server command run by the operator creates the owner account and workspace and prints a short-lived, single-use set-password link. Access to the server is the authority to create the owner.
- Network access alone can never create an account or the owner: before an owner exists there is no setup page, and sign-up is always off.
- After setup, sign-up stays closed: new people join only when the owner invites them. Open sign-up
  may be offered later as an optional feature.
- Concurrent runs or reruns of the owner command must not create duplicate owners or replace an existing owner.

Server access proves installation authority. It does not prove control of the supplied email address.
Every installation uses the same owner command. In desktop local mode, the desktop app asks for the name, email, and password, runs the command through the CLI, and sets the password through the printed link on the user's behalf; the flow itself does not change.

**Decision update (2026-11-03):** The owner is created by a server command that prints a set-password link, replacing the setup code and browser claim form. Bots watch public certificate logs and complete the setup pages of new sites within minutes, so a fresh install must not be claimable over the network. A server command closes that hole with the fewest parts: no setup code, no claim endpoint, and no setup page. The set-password link reuses Better Auth's password-reset flow, so no temporary password exists. Better Auth has no "change password on first sign-in" feature, so a temporary password would need custom code. Sign-up stays off on the running server; the command creates the owner from its own process. This supersedes the earlier setup-code decisions: browser-guided owner setup, in which a temporary, single-use setup code from the operator-only installation procedure established the authority to claim an installation and successful setup then closed initial registration; initial account creation that also collected the password; and, in desktop local mode, the desktop app obtaining the setup code through the CLI and submitting it for the user. Server access now proves installation authority, as the setup code did; neither proves control of the email address.
The same account model serves local and remote installations; deployment configuration may govern email delivery and verification policy.
Separate local-only and hosted authentication implementations are not part of the direction.

**Decision update (2026-11-03):** The [001 technical plan](../../specs/001-workspace-owner-access/plan.md) uses Better Auth's organization plugin for the workspace, membership, and owner role, and settles password rules, session and link lifetimes, and sign-in limits in its [settled values](../../specs/001-workspace-owner-access/plan.md#settled-values).

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

### Reuse Before Building

Governed by [constitution principle VII](../../.specify/memory/constitution.md#vii-reuse-before-building-with-few-trusted-dependencies).

- Prefer established open-source libraries and tools over custom code. Before building something,
  check whether a selected library already provides it.
- Use selected libraries' native features as intended rather than wrapping or reimplementing them.
  Custom code fills only the gaps they leave.
- Use each library only for the purpose it was built for. Don't stretch an available feature into
  a general system for the app; pick a library made for that job.
- Keep dependencies few and trusted. Not every small need gets a dependency: add one only when it
  replaces substantial custom code, and prefer one library that covers several needs over several
  narrow ones. Keep integrations thin.
- Technical plans name the library feature each requirement relies on and justify each new
  dependency and any custom code.

**Decision update (2026-11-03):** Reuse before building is a project-wide principle, balanced
against keeping as few trusted dependencies as possible. Custom code must be maintained, secured,
and documented by the project, and mature libraries already solve most of it; every dependency also
adds supply-chain and upgrade cost. Dependencies still follow the licensing rule in
[deployment boundaries and licensing](#deployment-boundaries-and-licensing). Added to the
constitution as principle VII (version 1.1.0).

**Decision update (2026-11-03):** Reuse means using libraries for what they were built for. Better
Auth's rate limiter protects Better Auth's own routes, so it is not the app's rate limiter. The
owner-access feature adds no rate limiting of its own and keeps Better Auth's defaults on its own
routes. When a spec needs app-wide or per-account limits, it adds a dedicated rate-limiting library.
Clarified in constitution principle VII (version 1.1.1). Simplicity also governs: libraries and
custom code are added only when a requirement needs them.

## Accepted Product and Repository Direction

### Platform and Independent Apps

- The platform is self-hostable first, with a managed offering planned later.
- Guided installation remains part of the product direction.
- This repository contains the platform server, web client, CLI, desktop app, SDKs, and public integration contracts.
- Installable apps, including first-party apps, live in separate repositories with their own builds and releases.
- Apps run independently and integrate through documented, versioned public contracts.
- Installing a compatible app does not require rebuilding the platform or including app source in its build.
- The SDKs are developed in this repository and published for use by independent app projects.
- First-party apps use the same public integration surface as other apps.
- The first public release publishes TypeScript and Python SDKs. SDKs for other languages are post-open-source work.
- An app can be managed or external. Your Space deploys and runs a managed app from its deployment file. An external app is hosted anywhere; the owner adds it to the workspace by pointing Your Space at the running instance. Both use the same public integration contract, so the contract must not assume Your Space runs the app.
- External apps are outside Your Space's container isolation, outbound network limits, resource limits, and backups; whoever hosts them is responsible for those. They still integrate through Your Space identity and the gateway, and accept only requests that carry identity verified by Your Space.

**Decision update (2026-10-31):** TypeScript and Python SDKs are required before publication. Together they cover two common stacks: a TypeScript frontend with a Python backend, and TypeScript on both frontend and backend. Developers using other languages can still integrate through the documented public contracts.

**Decision update (2026-11-02):** Apps can be external as well as managed. Your Space managing deployment makes self-hosting apps quick, while power users and larger deployments can host an app elsewhere and add it to the workspace by pointing Your Space at it. The integration surface between Your Space and apps is designed for both from the start.

**Decision update (2026-11-02):** Deferring the Python SDK to reduce first-release size was considered and rejected; both SDKs remain required.

The intended developer experience is to adapt an existing app for installation and platform identity integration.
An app should remain independently runnable rather than requiring a replacement frontend networking layer.
Existing app authorization should be reusable where it has a suitable integration boundary.

### First Public-Release Audience and Clients

- The first public release targets two groups: people who can install Docker Desktop and the Your Space desktop app to run a local workspace, and people who can install Docker and follow a guided CLI to deploy a server or a local workspace, both without one-on-one assistance.
- The web, desktop, and PWA clients provide the same core workspace and installed-app experience while connected to a Your Space server; a local network connection is sufficient.
- The desktop app uses Electron and ships for macOS, Windows, and Linux.
- The desktop app is the intended primary way people use Your Space. The web client and PWA stay full clients with the same core experience, so the workspace also works in a browser and on phones.
- Desktop releases are signed before publication. macOS builds are signed with an Apple Developer ID and notarized, so people see the standard "downloaded from the Internet" prompt rather than a block, and the app can update itself. Windows builds are signed through the SignPath Foundation's free open-source program, with Microsoft Artifact Signing as the fallback. Linux builds need no signing.
- Signing runs in CI with keys held as CI secrets, never on a personal machine.
- When setting up the desktop app, the user either connects to an existing server by URL or runs Your Space locally. In local mode, the desktop app uses the Your Space CLI to set up and run the Docker Compose stack on that machine, then connects to it.
- The CLI is part of the first public release for setting up Your Space on a server or locally; desktop, web, and PWA clients can connect to a server it sets up.
- Before publication, local mode detects Docker and links to the Docker Desktop download when it is missing, sets up the Your Space stack, starts it when the desktop app opens, and updates Your Space when the owner chooses.
- Every installation, local or server, uses one setup flow: the owner command. In local mode the desktop app runs it through the CLI and sets the password for the user, so the user only fills in one form. Streamlined local setup in the desktop app gets its own specification and implementation PR, separate from the owner-access feature (superseded: part of journey 008 since 2026-11-02, and since 2026-11-08 delivered, like every journey, as a stack of pull requests; see [journey-based specifications](#journey-based-specifications)).
- Before publication, the owner can back up and restore local and server installations alike, and move a local workspace to a server, through the CLI; the desktop app uses the same operation in local mode. Owner-triggered Your Space updates in local mode go through the CLI and roll back automatically if they fail.
- A local workspace is unavailable to other people and remote agents while its machine is asleep or off. Install documentation must state this and the Docker Desktop license terms.
- PWA offline support remains open. The first owner-access feature remains web-only.
- The desktop app updates itself. Its update check goes to GitHub, consistent with the no-telemetry rule.
- Your Space defines which desktop app, CLI, and server versions work together. On a mismatch, clients show a clear message saying whether to update the app or the server.
- Windows support (the desktop app, the CLI, local workspaces, and Windows signing) and PWA installation are low priority: built last, and the first work to move to post-open-source if the timeline slips. The [roadmap](../roadmap.md) assigns a priority to every pre-public item.

**Decision update (2026-10-31):** Desktop clients move from the first public release to post-open-source work. They need a separate build for each operating system, code signing including Apple notarization, and their own update mechanism, while the installable PWA already opens in its own app window on macOS, Windows, and Linux. (Superseded below: desktop clients return to the first public release.)

**Decision update (2026-10-31):** Desktop clients return to the first public release, superseding the deferral above, so that less technical users can run their own workspace. The desktop app can connect to an existing server or set up and run a local Docker Compose stack. The CLI stays for server deployment (superseded by the [CLI delivery sequence](#cli-delivery-sequence): the CLI handles local and server installations). Electron is selected, shipping for macOS, Windows, and Linux, which accepts the per-OS build, signing, and update costs.

**Decision update (2026-10-31):** Local mode's first-release scope is Docker detection with a download link, stack setup, starting the stack with the app, and owner-triggered Your Space updates. Local backup and restore, and moving a local workspace to a server, are deferred (superseded 2026-11-02: required before publication).

**Decision update (2026-10-31):** Local mode skips the setup code: the desktop app sets up the stack and supplies setup authority itself, so network access alone still cannot claim a local workspace. Server installations keep the setup code from the owner-access feature. Streamlined local setup is specified and implemented in its own PR, separate from the owner-access feature. (Superseded below: one setup flow for every installation.)

**Decision update (2026-10-31):** (The setup code was later replaced by the owner command; see [authentication and initial claim](#authentication-and-initial-claim).) Supersedes the setup-code exception above. There is one setup flow for every installation, and the CLI behaves the same for local and server installations. The desktop app wraps the CLI and handles the setup code on the user's behalf; it does not skip or replace setup authority.

**Decision update (2026-11-02):** Pre-public roadmap items carry High, Medium, or Low priority. Windows support and PWA installation are Low: they remain first-release goals, built last, and are the first to move to post-open-source work if the timeline slips.

**Decision update (2026-11-02):** Signed desktop releases are required before publication. An unsigned macOS app is blocked with a malware-verification warning and cannot update itself, which is too rough for the less technical audience. The Apple Developer Program ($99/year) covers macOS. Windows uses SignPath's free open-source signing, which needs a public repository and an OSI-approved license and lists SignPath Foundation as the publisher; Microsoft Artifact Signing (about $10/month) is the fallback if approval timing or the publisher name is a problem. New Windows apps may still show a SmartScreen warning until they build download reputation.

**Decision update (2026-11-03):** The desktop app is the intended primary client. It can show installed apps in native views instead of iframes (see [UI integration](#ui-integration)), which gives the best in-app experience. The web client and PWA remain full clients, so people can use Your Space from a browser or phone. This does not change the build order: the desktop app is still built in journey 008.

### Deployment Boundaries and Licensing

- Keep core behavior independent of a particular cloud provider.
- Provide platform-specific installation guides and deployment adapters for supported environments.
- Keep provider-specific storage, networking, and provisioning details within those deployment boundaries.
- Preserve compatible, versioned app contracts between self-hosted and managed installations.
- Dependencies must permit the intended commercial distribution and managed hosting, and be compatible with the project licenses below. Prefer permissive open-source licenses.

A future Cloudflare, VPS, or other cloud pathway must demonstrate persistence and lifecycle behavior in that environment.
Provider neutrality does not mean every runtime already supports the same executable or deployment configuration.
Dependency selection must consider actual licenses, including bundled components and distribution-specific terms.

### Project License and Business Model

- The business maintains the open-source core and offers a managed service for people who don't want to self-host.
- Your Space itself (server, web client, CLI, and desktop app) is licensed under AGPL-3.0. Anyone may self-host and modify it; anyone who runs a modified version as a network service must publish their changes.
- The SDKs are licensed under Apache-2.0, so apps can use any license. Apps are separate programs that integrate through APIs and are not covered by the core's license.
- "Your Space" is protected as a trademark, so others cannot offer services under the name. A short trademark policy explains how forks may and may not use the name. getyourspace.ai is the project domain.
- Outside contributions require a contributor license agreement that lets the project use contributions under other terms, so the managed service and future licensing stay possible.
- Code specific to the managed service, such as billing, provisioning, and multi-tenant operations, lives in a separate private repository and integrates with the core through its APIs.
- The license, trademark, and contributor agreement are in place before publication, after review by a lawyer.

**Decision update (2026-11-02):** AGPL-3.0 for Your Space and Apache-2.0 for the SDKs replace the earlier MIT preference. AGPL keeps the core open source while preventing closed hosted forks; the trademark and maintainership protect the managed offering. Source-available licenses such as FSL were considered and rejected because the business depends on an open-source core.

### Product Experience Principles

- Simple by default. Show people only what they need to see, and avoid filling the interface with settings and configuration that can overwhelm beginners.
- Deeper controls are available for power users, but they stay out of the default experience.
- Configuration works like editor settings: the defaults live in Your Space, the owner's file starts empty, and each line in it overrides one default. Every setting needs a safe default that suits most installations; a value that follows from other settings is derived, not asked for; secrets are generated when the owner doesn't supply them.

**Decision update (2026-11-02):** Simplicity by default is a product principle for every client and feature. New settings, logs, and configuration go behind advanced controls unless most users need them.

**Decision update (2026-11-08):** Configuration is optional, part of [constitution principle II](../../.specify/memory/constitution.md#ii-preserve-user-control-and-hosting-choice) since version 1.2.0 (2026-11-07). Required settings are each a chance to get an install wrong, and they freeze today's choice into every owner's file, so a better default later reaches nobody. Plans name each setting's default and how it is derived, and the documentation lists the defaults so an owner can see what a line would change. Where a tool can't derive a value, the setting stays and the CLI (spec 003) derives it; in the manual Compose install, the one line the owner writes picks the port bindings (see [Installation and Hosting](#installation-and-hosting)).

### Telemetry and Outbound Connections

- Your Space collects no telemetry. Neither the server, the CLI, nor the desktop app reports usage, errors, or any other data to the project.
- The only automatic outbound requests are update checks that ask GitHub for the latest release. The owner can turn them off. Actions the owner starts, such as installing or updating an app, contact the sources they name.
- Opt-in reporting, off until the owner turns it on, is the only acceptable future extension. Opt-out telemetry is prohibited.

**Decision update (2026-11-02):** No telemetry in the first release. Any future reporting must be opt-in; opt-out collection is an anti-pattern and is ruled out permanently.

**Decision update (2026-11-03):** Certificate requests the built-in proxy makes for an owner-configured domain are part of HTTPS setup, not reporting. This qualifies the bullet above on automatic outbound requests: with a domain configured, these certificate requests are the only automatic outbound requests besides update checks.

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
- The owner provides app settings and secrets, such as API keys, at installation and can change them later. A component in the Your Space Compose stack stores and supplies them; the mechanism is decided in the app specification.
- App images must be published for both ARM and Intel/AMD machines. Installation fails with a clear message if no image matches the machine.
- Apps have no outbound network access by default. Each app declares the outbound access it needs in its `x-your-space` section, and the owner approves it at installation; an update that asks for more needs new approval.
- Each managed app runs with memory and CPU limits so one app cannot take down the host. The owner can see each app's status and logs.

**Decision update (2026-11-02):** App settings and secrets, multi-architecture images, declared and limited outbound network access, and resource limits with app status and logs are required before publication. The settings and secrets mechanism, how outbound access is declared and enforced, and default limits are decided in the app specification.

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
- The platform session stays confined to the platform's own host (host-only cookies), so it is never sent to app origins. The owner-access implementation follows this so it does not need rework once app origins are decided.
- Apps open in panes inside the Your Space interface. Several apps can be open side by side in one layout on larger screens; phones show one app at a time.
- Each app's interface runs on its own origin, separate from Your Space and from other apps, so the browser isolates them from each other. A subdomain per app is the default; a port per app is the fallback where wildcard DNS is unavailable. Spec 002 settles the mechanism.
- In the web client and PWA, each pane is a cross-origin iframe. In the desktop app, each pane is a native view (for example, Electron's `WebContentsView`), not an iframe.
- Any app can also open in its own browser tab or window, for apps that cannot run in a pane.
- The app UI and sign-in specification comes right after the owner-access feature and before the CLI specification; see the [CLI delivery sequence](#cli-delivery-sequence). It is part of journey 002; see [journey-based specifications](#journey-based-specifications).

**Decision update (2026-11-03):** Selects cross-origin panes for app interfaces: iframes in the web client and PWA, and native views in the desktop app. This supersedes the earlier statement that no iframe, reverse proxy, or UI extension system was selected. Rationale:

- Only cross-origin panes run existing apps from any stack unchanged while keeping them isolated from Your Space and from each other. That keeps apps stack-agnostic.
- Serving apps under paths on the Your Space origin was rejected. App code would share the origin, so it could call the Your Space API as the user, read platform storage, and reach other panes. Many frameworks also assume they own the root path.
- Micro-frontends (apps shipping components that load into the Your Space page) were rejected. They run app code with the user's Your Space session and require apps to be built as JavaScript components.
- Declarative UI (apps describe their interface and Your Space draws it) was rejected for full apps, because every app would have to rewrite its interface. Server-side composition of app HTML was rejected because it breaks most apps' scripts and routing.
- The desktop app uses native views instead of iframes because it is the intended primary client and native views give each app its own process.

Spec 002 still defines framing permission, the optional messages between Your Space and an app (such as navigation, deep links, and theme), sign-in inside a pane, and the fallback for hosts without wildcard DNS, such as Tailscale `ts.net` names. Small native pieces drawn by Your Space from app-provided descriptions (such as dashboard cards) were discussed as a possible later developer-kit contract and are not decided.

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

### Member and Agent Removal

- Removing a member signs them out everywhere and revokes their app roles, including existing app sessions and credentials.
- Removing a member also revokes access for agents that act on their behalf.
- The member's agents are disabled, not deleted. The owner can delete them later.
- Deleting an agent never makes past app activity untraceable. Your Space keeps a minimal record of the deleted agent, including its name and the member it acted for, and never reuses its identifier.
- A removed member's data in apps stays with the app. Your Space keeps the member's identity as a former member so history still shows who did what; apps decide what happens to their own records.

**Decision update (2026-11-02):** Member removal is part of the first release. It revokes the member's and their agents' access immediately, disables rather than deletes their agents, and preserves attribution for past activity even after agents are deleted. Removal flow, the retained record's contents, and whether a removed member can be re-invited under the same identity belong in the members specification.

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

### Agent Access Through Your Space

- Agents never call apps directly. Your Space is the API gateway between agents and apps, so every agent request passes its permission checks.
- App containers are reachable only through Your Space and do not publish their own network ports. External apps keep the same guarantee by accepting only requests that carry identity verified by Your Space.
- People create, view, revoke, and rotate their agents' credentials in the app. Revoking one leaked credential does not change the agent's roles.
- For each agent request, Your Space verifies the agent's credential, confirms the agent holds an active delegation for that app installation, applies revocation immediately, and forwards the request with the verified identity and delegated roles. The app still enforces its own role and domain rules.
- In the first public release, agents use apps through the Your Space CLI with their own credentials. The CLI talks to the gateway, wherever the server runs.
- A workspace MCP endpoint is post-open-source work. It uses the same gateway and permission checks, so off-the-shelf agents can connect with a URL and sign-in.

**Decision update (2026-11-02):** Your Space is the gateway for all agent access to apps, selecting the gateway that the trust boundary above left optional. Agents use the CLI before publication; MCP follows after publication on the same gateway. Whether the gateway also enforces per-action role requirements declared by apps, beyond identity, delegation, and revocation, is decided in the app integration specification; mandatory endpoint-to-permission manifests remain unselected until then.

### Activity Log

- Your Space records workspace activity: app installs, removals, and updates; role changes and delegations; member changes; and every agent request through the gateway, with the actual actor.
- The owner can review the log. It stays available but out of the way, following the [simple-by-default principle](#product-experience-principles).

**Decision update (2026-11-02):** An activity log is part of the first release, so the owner can see what happened in the workspace and what agents did. Retention, detail level, and who besides the owner can view entries are decided in a specification.

## Later Candidate Journeys

After the owner-access feature and an agreed app contract, a small Tasks app is the first app and the end-to-end integration slice.
That journey would install the independent app, create and view a task, retain it after restart, and expose permitted operations to an agent.
Verification would cover identity attribution, denied operations, and revocation across UI and programmatic access.
It follows the app UI and sign-in specification, the CLI, and an agreed app contract, and is not an app implementation included in the current feature.

**Decision update (2026-10-31):** The small Tasks app is selected as the first app, replacing its candidate status. It is small, needs a database, and exercises roles (viewing and editing tasks) and agent access (an agent creating tasks), covering each part of the first-release app journey. Its needs set the initial approved list of Compose settings.

External agents come before platform-hosted agent execution.
Later hosted agents could run workflows such as daily triage through the same identity and authorization contracts.
Identity and permissions remain independent of any model provider or execution runtime.
No hosted workflow engine or model-provider integration is selected here.

## First Public-Release Direction

**Decision update (2026-10-29)**: Plan the roadmap in pre-public and post-public sections. The pre-public section covers the core experience and a working first version; post-public covers capabilities that are not crucial to that release. The owner prefers an installable, usable product before making the repository public rather than publishing only plans.

The intended pre-public experience includes owner setup; additional members signing up through invitation links created and shared by the owner; the installation CLI for servers and local workspaces; a desktop app that can also run a local workspace; web, desktop, and PWA workspace clients; at least one installed independent app; a way for developers to create, integrate, and install more apps; and access for external agents through the Your Space gateway and CLI. It also includes built-in backup, restore, and moving a workspace between installations; owner-triggered Your Space and app updates that roll back automatically if they fail; app roles; member removal; an activity log; built-in HTTPS; uninstall; and signed desktop releases. Only the owner installs or removes apps in the first public release. The first release targets users who can install Docker Desktop and the Your Space desktop app for a local workspace, or install Docker and follow a guided CLI for a server or a local workspace.

This is a developing release roadmap, not a complete acceptance specification or a claim of implementation. Additional requirements may emerge during specification. These future capabilities do not expand the owner-only first feature. The agreed sequence is manual Compose and owner access (spec 001) first, then the app UI and sign-in specification, then the CLI specification and implementation; the remaining pre-public items have no set order beyond their priorities.

### Journey-Based Specifications

**Decision update (2026-11-02):** Pre-public work is specified as eight user journeys rather than one specification per roadmap capability. Each journey follows a person from where they start to a result they can see, so one specification covers many roadmap items and is tested the way people will use it. The [spec map](../spec-map.md) lists the journeys, what each covers, and the build order.

- The build order is 001 set up my space ([spec](../../specs/001-workspace-owner-access/spec.md)), 002 install an app and use it, 003 install and run with the CLI, 004 invite my team, 005 let my agent work for me, 006 keep my space safe over time, then 007 build my own app and 008 use Your Space as an app on my computer in parallel.
- The app UI and sign-in specification becomes part of 002, which ends with the Tasks app working inside Your Space. It still comes before the CLI, so app origins are settled before the CLI sets up HTTPS. If 002 proves too large, it can split into opening an app inside Your Space and installing an app from a URL.
- The app contract defines app roles in 002, although only the owner exists then, so 004 adds role assignment without changing the contract.
- The activity log arrives with agents in 005, since reviewing what agents did is its main purpose. App installs and member changes are logged from then on.
- The app database moves from Medium to High, because the Tasks app in 002 needs one.
- Security, privacy, legal, and the final release review stay in the [public release readiness checklist](../public-release-readiness.md) as a release gate rather than becoming a journey.
- Every specification follows shared rules from the start: simple by default, no telemetry, ARM and Intel images, all durable state in the database or named volumes, the actual actor credited from the first schema, and its own docs and security tests.

This refines the sequence above without changing scope: it groups existing pre-public items into journeys and orders the work after the CLI.

**Decision update (2026-11-08):** A journey is delivered as a stack of pull requests into `main`. The first carries the specification and its supporting documents (plan, research, contracts, and the task list) with no task checked. Each later one adds one layer that passes its own checks, checks only the tasks it verifies, and checks roadmap items only for what it delivers. A spec on `main` describes agreed design; only checked tasks, checked roadmap items, and the verification record claim delivered work, so a spec never claims work that doesn't exist yet. This supersedes the earlier wording that the CLI or streamlined local setup gets its own implementation PR; each is specified in its journey (2026-11-02) and delivered the same way.

**Decision update (2026-11-10):** In a stack, code lands with its first use: each file, top-level function or component, script, and configuration entry arrives in the first pull request where something runs it (code that runs, a test, CI, or the deployment) or where a developer first needs it to run, develop, or test the app. Code inside a function is not split across pull requests, so error paths and event handlers land with their function. Anything that would land earlier moves up. Code that lands before it runs can't be checked by its own pull request, and reviewers end up judging it without seeing it work. Added to the constitution's Development Workflow (version 1.3.0).

**Decision update (2026-11-10):** Claude reviews each pull request through the Claude Code GitHub Action when it is opened or marked ready, and again when someone with write access comments `@claude review`, such as after a fix round. It reports bugs, security and data-integrity problems, and breaks of the project's rules, checked against the constitution, this record, and the journey's spec and plan, and skips style; its guide is `.github/code-review.md`. Its findings are review comments, resolved before the pull request merges, and it changes no code. While the repository is private it runs on the owner's Claude subscription, so reviews add no cost and draw on that subscription's usage limits. The alternatives cost more for how often this project pushes: Greptile charges a credit per review beyond a small free allowance, Copilot code review spends credits on each review, and CodeRabbit adds a monthly seat price with hourly limits. Claude also writes much of this code, so its review is a weaker second opinion than an independent reviewer's, and GitHub doesn't give the subscription token to workflows for pull requests from forks. Before the repository is public, review therefore moves to the free open-source plan of Greptile or CodeRabbit, which reviews contributors' pull requests too.

**Decision update (2026-11-10):** Pull request descriptions follow one template (`.github/pull_request_template.md`) that shows a reviewer only what they need first: a summary, where to look, and the decisions they must make; the results of CI, code review and visual evidence stay in the pull request's checks rather than being copied into the text. Everything else, such as the stack, spec links, file-by-file contents, task ticks, check commands and review fixes, sits in collapsed sections. Journey 001's stack descriptions grew past 20,000 characters each, so the few decisions a reviewer had to make were buried in detail; the detail stays available but collapsed. The template and `AGENTS.md` guide this; no check enforces it.

**Decision update (2026-11-10):** CircleCI runs the checks on Linux on Arm (aarch64), the second architecture Your Space ships images for, while GitHub Actions covers x86_64: the server's checks from the first code layer, and the whole Compose stack with the browser journeys in Chromium once the stack exists. Its macOS and Windows machines are left for the desktop app, since they can't run the Docker stack. CircleCI's free plan covers this while the repository is private (30,000 credits a month); it builds pull requests from forks without the project's secrets, and the jobs need none.

**Decision update (2026-11-10):** CI produces the visual evidence for every pull request, so neither contributors nor maintainers take screenshots or keep evidence branches. The browser tests screenshot each user-story step, and CI uploads the screenshots to Argos, a hosted visual-testing service whose code is open source (MIT). Argos compares them with the screenshots from `main` and posts a check and a comment on the pull request, where a person approves or rejects each visual change. Uploads authenticate with GitHub's OIDC token, and pull requests from forks, which get no token or secrets, fall back to Argos's tokenless check of the running workflow, so contributors' pull requests get the same evidence and no secret is exposed. Each run also keeps the Playwright report with a video of every journey as a CI artifact for 7 days. Argos takes uploads from GitHub Actions only, so every screenshot it compares comes from the same x86_64 runners; the Arm journeys on CircleCI check behaviour, not looks. Screenshots hold only test data. Workflows never use `pull_request_target`, and the Argos check is not required to merge at first, so an Argos outage blocks nothing. Argos's hosted service is used rather than self-hosting it, which needs AWS, PostgreSQL, RabbitMQ, Redis, S3, and DynamoDB; self-hosting stays the fallback because the code is open. Alternatives considered: Playwright's own screenshot comparison with baselines committed to the repository (no service, but images in history and no review step); Percy and Happo (no fork-safe upload without a secret); and Chromatic (its free open-source plan covers only UI libraries and design systems).

**Decision update (2026-11-10):** While the repository is private, CI spends its limited GitHub Actions minutes once per stack of pull requests instead of once per pull request. Only the pull request based on `main` runs the browser tests and the Compose setups checks; the ones above it run the typecheck, server tests and build, and get the browser tests when they reach `main`. Pushes to `main` run only the check job, since the pull request they merge has just run the rest on the same code. Every job has a time limit, so a stuck run can't use up minutes, and the browser tests' reports are kept 7 days, which covers a review and stays within the plan's artifact storage. A newer push to a pull request cancels its running CI, and pull requests that change only docs or specs skip CI, except the installation guide, which a browser test checks. Restacking a journey's stack reran the full suite on every pull request in it and used a month's minutes in a day; the browser tests are most of each run. Contributors run the checks locally before pushing. Once the repository is public, Actions minutes are free and every pull request runs the browser tests again.

**Decision update (2026-11-11):** Pushes to `main` run the browser tests again, superseding the part of the 2026-11-10 decision that ran only the check job there. Argos compares a pull request's screenshots with the closest approved build in `main`'s history, and builds on `main` are approved automatically. Pull requests are squash-merged, so a pull request's own build is not in that history, and with no build on `main` every pull request showed all its screenshots as new instead of only the ones it changed. Pushes to `main` still skip the Compose setups checks, which the merged pull request has just run on the same code.

## Choices Still Open

| Area | Current status |
| --- | --- |
| Client supporting libraries | TanStack Router, TanStack Query, plain CSS, and no component library are selected in the [001 plan](../../specs/001-workspace-owner-access/plan.md). A design system is open for the later interface design spec. |
| Database configuration | PostgreSQL 18 with Drizzle and `pg`; Drizzle Kit migrations applied at server startup. Settled in the [001 plan](../../specs/001-workspace-owner-access/plan.md). Recovery from a failed migration belongs with update rollback in spec 006. |
| Authentication configuration | Better Auth with its organization plugin; password rules, lifetimes, attempt limits, and adapter configuration are settled in the [001 plan](../../specs/001-workspace-owner-access/plan.md). |
| Initial deployment details | macOS and Linux with manual Docker Compose are selected. HTTPS comes from a Caddy reverse proxy in the Compose stack, delivered in the owner-access feature, with automatic certificates for an owner-provided domain, a bring-your-own-proxy option, and documented tunnel guidance; plain HTTP is supported only on localhost. Host versions (Docker Engine 28.3.3 and Compose 2.26.0 or newer), the one-line setups, and generated platform secrets are settled in the [001 plan](../../specs/001-workspace-owner-access/plan.md); support claims wait for verification on real hosts. |
| Desktop app | Electron is selected for macOS, Windows, and Linux; Windows supports the desktop app and local workspaces, not server hosting. Local mode drives the Your Space CLI and covers Docker detection, stack setup and startup, owner setup with the app running the owner command and setting the password for the user, and owner-triggered Your Space updates, backup, restore, migration to a server, and uninstall, all through the CLI. Windows support is low priority. Releases are signed before publication: Apple Developer ID with notarization on macOS, SignPath's open-source program on Windows with Microsoft Artifact Signing as the fallback, all in CI. Self-update is required; packaging and self-update mechanics need a specification. |
| CLI delivery | The CLI drives Docker Compose for local and server installations, runs on macOS, Windows, and Linux, and is driven by the desktop app in local mode. Its minimum operations are install, start, stop, status, logs, update Your Space, owner password recovery, backup, restore, and uninstall; uninstall removes managed app containers and keeps data unless the owner confirms deletion. A separate follow-up specification will define packaging, command names, prerequisite automation, and management behavior over the established Compose deployment. |
| Your Space updates and backup | Failed Your Space updates roll back automatically using the pre-update snapshot mechanism shared with app updates. Failed-update detection and snapshot details need definition. Backup, restore, and migration between installations are required before publication; remote CLI authentication, restore into a broken or fresh installation, and backup format and protection remain open. |
| Member and agent removal | Removal revokes the member's and their agents' access, disables their agents, and keeps former members and deleted agents traceable in past activity. Removal flow, retained record contents, and re-invitation need definition in the members specification. |
| Member password recovery | A recovery code at signup, with an owner-issued temporary password as the fallback, is selected. Code count and replacement, and temporary-password lifetime, need definition in the members specification. Optional owner-configured email resets are post-open-source. |
| Public launch scope | A working core experience before publication is the direction. The pre-public scope was settled in the 2026-11-02 interview, and every pre-public roadmap item has a High, Medium, or Low priority; Windows support and PWA installation are Low. Detailed release criteria remain to be defined. See [public release readiness](../public-release-readiness.md). |
| App UI execution | Apps open in panes, side by side on larger screens: cross-origin iframes in the web client and PWA, native views in the desktop app. Each app runs on its own origin, a subdomain by default with a port as the fallback. Framing permission, shell-to-app messages, sign-in inside a pane, and the no-wildcard-DNS fallback are specified in journey 002, after the owner-access feature and before the CLI. The platform session uses host-only cookies. |
| Project license | AGPL-3.0 for Your Space and Apache-2.0 for the SDKs, with a "Your Space" trademark and a contributor license agreement, all in place and reviewed by a lawyer before publication. Trademark filing details and agreement wording remain open. |
| Telemetry | None; update checks to GitHub are the only automatic outbound requests and can be turned off, apart from the built-in proxy's certificate requests for an owner-configured domain, which are part of HTTPS setup (2026-11-03). Future reporting must be opt-in; opt-out is prohibited. |
| External apps | Apps can be managed or hosted elsewhere and added by pointing Your Space at them. How an external app is registered, verifies Your Space identity, and is reached through the gateway needs definition in the app integration specification. |
| App settings, egress, and limits | A Compose stack component stores app settings and secrets; apps declare outbound access for owner approval; managed apps have resource limits, status, and logs. Mechanisms and defaults need definition in the app specification. |
| Activity log | Records installs, role and member changes, delegations, and agent requests. Retention, detail, and viewers need definition. |
| Version compatibility | Supported desktop app, CLI, and server version combinations and the mismatch message need definition. |
| Agent access | Agents reach apps only through the Your Space gateway, using the CLI in the first release; a workspace MCP endpoint is post-open-source. Gateway request format, how apps declare actions for the CLI, and whether the gateway enforces per-action roles need definition. |
| App identity protocol | OAuth/OIDC or another concrete protocol has not been selected. |
| App integration | TypeScript and Python SDKs are selected for the first release; other languages are post-open-source. Role registration, authorization compatibility, and revocation mechanics need a later specification. |
| App deployment file | A Docker Compose file limited to an approved list of settings, declaring published images with exact versions is selected for the first release; source builds and alternative formats are post-open-source. The owner installs by pasting the file's GitHub URL. App details go in an `x-your-space` section. The approved settings list, set when the first app is implemented, the section's contents, supported operations, and backend interpretation need definition. |
| App runtime and data | Design and verify isolation, lifecycle, networking, persistent storage, retained-data deletion, and runtime-manager privileges. |
| App distribution | Installation from the deployment file's GitHub URL, exact commit recording, and exact declared image versions are accepted for initial installation. Owner-triggered updates are pre-public; automatic updates are post-public. Failed updates roll back automatically to the previous image versions and pre-update data backup. Image identity validation and retention, artifact trust, catalog implementation, update selection and mechanics, and failed-update detection remain open. |

These open choices do not erase the accepted requirements above.
Resolve implementation-critical choices in the relevant technical plan and future app-contract decisions in their own specifications.
