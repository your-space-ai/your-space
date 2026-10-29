# Your Space Architecture and Product Decisions

**Status**: Accepted direction with implementation choices explicitly left open

**Recorded**: 2026-10-28

**Scope**: Project-wide direction, independent of any feature specification

**Related feature**: [Workspace Setup and Owner Access](../../specs/001-workspace-owner-access/spec.md)

**Governing document**: [Your Space Constitution](../../.specify/memory/constitution.md)

## Purpose and Scope

This is the canonical project-wide record of accepted architecture and product direction, including decisions for future work.
It remains relevant across feature specifications and must not be archived or replaced when an individual feature is completed.
The constitution establishes governing principles; this record captures shared decisions and open choices; individual specifications define delivery scope and acceptance criteria.
Open proposals remain candidates, even when they have been discussed in detail.

The first feature establishes installation, owner setup, authentication, an empty workspace, persistence, and recovery.
It does not install independent apps or implement app roles, agents, a marketplace, or an agent execution runtime.
Later specifications must turn those directions into concrete contracts and acceptance criteria.
Recording an accepted future direction here does not add it to the first feature or claim that it has been implemented.

## How to Use and Maintain This Record

- Consult this record and the constitution before creating or changing specifications, technical plans, or public integration contracts.
- Keep cross-feature decisions here and link to them from feature documents rather than creating competing copies of project direction.
- Update this record in the relevant pull request when a shared decision is agreed or changed. Keep accepted decisions, open proposals, and superseded decisions distinguishable.
- When replacing an accepted decision, record the date, rationale, and what it supersedes; retain its rationale or link to the change that preserves that history.
- Resolve conflicts with the constitution explicitly through its governance process. A feature plan must not silently override shared decisions.

The repository README and agent guidance link here so future planning can find this record without knowing which feature originally prompted a decision.

## Accepted Foundation Decisions

### Installation and Hosting

- Begin with a guided Docker Compose installation.
- Begin with a web client. An Electron client may be considered later.
- Keep client and server as independent components that can run on the same machine or different machines.
- Store authoritative account and workspace state on the server, rather than relying on a particular browser.
- Use persistent storage so supported restarts retain identity, ownership, and workspace state.
- Document prerequisites, setup, storage, restart, remote client access, and owner recovery.
- Keep Kubernetes and kind outside the initial installation requirements.

Docker Compose provides a concrete first installation target without requiring Kubernetes administration.
This choice does not commit every future deployment to Compose or promise identical deployment configuration everywhere.
The supported operating systems, prerequisites, versions, networking, and transport configuration require an implementation plan.

### Server and Database

- Use Node.js and Express for the platform server.
- Use PostgreSQL as the initially supported platform database.
- Do not require a second platform database implementation for local installations.

Express is the accepted server framework; future capacity decisions should use measured workloads.
PostgreSQL provides one persistence foundation across local and hosted server deployments.
This choice does not require every independently developed app to use PostgreSQL.
Exact runtime and database versions, schema tooling, migration tooling, and connection configuration remain open.

### Owner and Workspace Model

- Support one human owner and one workspace in the first feature.
- Keep account identity, workspace identity, membership, and ownership as distinct concepts.
- Establish those relationships explicitly so later membership support does not require replacing existing identities.
- Do not expose invitations, additional human accounts, role administration, or ownership transfer in this feature.

Owner-only scope limits the first user journey; it is not a permanent single-user constraint on the product.
These concepts do not prescribe a specific database schema or authentication library.

### Authentication and Initial Claim

- Your Space defines and operates one server-managed authentication system across deployment modes.
- Authentication must not depend on an external identity provider.
- Initial account creation collects a name, email address, and password.
- Email serves as a login identifier and is not treated as verified without mailbox verification.
- Initial self-hosted setup does not require SMTP or another email-delivery service.
- An installer-issued, temporary, single-use setup code establishes authority to claim an installation.
- Network access to an unclaimed server alone is insufficient authority to create its owner.
- Successful setup creates the initial owner and workspace, then closes initial registration.
- Concurrent or retried setup must not create duplicate owners or replace an existing owner.

The setup code proves installation authority. It does not prove control of the supplied email address.
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

The intended developer experience is to adapt an existing app for installation and platform identity integration.
An app should remain independently runnable rather than requiring a replacement frontend networking layer.
Existing app authorization should be reusable where it has a suitable integration boundary.

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

- Users can install compatible apps directly from public GitHub repositories.
- Connected GitHub account access can enable installation from private repositories the user is authorized to access.
- Curated app listings provide discovery and use the same installation contract as direct repository installation.
- The official curated listing is optional, rather than a prerequisite for installing compatible apps.
- Preserve each installation's app identity, exact source version, provenance, and approved update policy or source.
- Changing or disconnecting a discovery source must not silently redirect updates, replace an app, uninstall it, or delete its data.
- App updates must not silently expand granted access.

Public, community, and private discovery experiences can coexist without redefining installed app ownership or update routing.
No catalog federation protocol or marketplace implementation is selected here.
Repository access authorizes retrieval of code; it does not grant that code access to workspace resources.
Packaging, release verification, installation execution, runtime isolation, storage, upgrades, and rollback need a separate app contract.

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
- Workspace administrators assign app roles to human users.
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

## Later Candidate Journeys

After the owner-access feature and an agreed app contract, a small Tasks app is a candidate for an end-to-end integration slice.
That journey would install the independent app, create and view a task, retain it after restart, and expose permitted operations to an agent.
Verification would cover identity attribution, denied operations, and revocation across UI and programmatic access.
This is a candidate next slice, not an app implementation included in the current feature.

External agents come before platform-hosted agent execution.
Later hosted agents could run workflows such as daily triage through the same identity and authorization contracts.
Identity and permissions remain independent of any model provider or execution runtime.
No hosted workflow engine or model-provider integration is selected here.

## Choices Still Open

| Area | Current status |
| --- | --- |
| Web client | React, TypeScript, and Vite are candidates; the client stack has not been approved. |
| Client supporting libraries | Router, query/state tooling, styling, and component library remain open. |
| Database tooling | Drizzle is a candidate; ORM and migration tooling are not selected. |
| Authentication library | Better Auth is a candidate; the account and recovery requirements are accepted independently. |
| Initial deployment details | Supported host matrix, exact versions, transport, networking, and configuration need planning. |
| App UI execution | Embedding model, origins, isolation, routing, and session bridging remain open. |
| App identity protocol | OAuth/OIDC or another concrete protocol has not been selected. |
| App integration | Packaging, SDK language support, role registration, authorization compatibility, and revocation mechanics need a later specification. |
| App distribution | GitHub access, artifact trust, catalog implementation, update mechanics, and rollback remain open. |

These open choices do not erase the accepted requirements above.
Resolve implementation-critical choices in the relevant technical plan and future app-contract decisions in their own specifications.
