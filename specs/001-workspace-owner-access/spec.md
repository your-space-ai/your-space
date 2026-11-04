# Feature Specification: Workspace Setup and Owner Access

**Feature Branch**: `codex/001-workspace-owner-access`

**Created**: 2026-10-28

**Last updated**: 2026-11-03

**Status**: Draft for PR review; implementation has not started

**Journey**: 001 "Set up my space", the first of eight journeys in the [spec map](../../docs/spec-map.md)

**Input**: Establish an owner-only Your Space installation with manual Docker Compose installation,
owner creation by a server command, a web client, durable workspace state, and account recovery. Preserve the agreed platform, app, and agent
architecture without adding those later features to this first delivery.

## At a Glance

- **Who:** the operator who installs Your Space and becomes its owner.
- **Done when:** the operator installs Your Space, creates the owner, signs in, and can recover the owner account.
- **Covers:** manual Docker Compose install on macOS and Linux (ARM and Intel/AMD), creating the
  owner with a server command, sign-in and sessions, an accurate empty workspace, durable state, owner recovery,
  built-in HTTPS with automatic certificates, and access from another device.
- **Next:** spec 002 (install an app and use it), then spec 003, whose CLI wraps this feature's
  setup and recovery behavior.

## Objective and Scope

An operator can install Your Space, establish the initial human owner, sign in to an empty
workspace, recover access if the password is lost, and retain the same account and workspace
after a supported restart. Being able to reach the server over the network is never enough to
create an account or become the owner.

This feature supports exactly one human owner and one workspace. Account identity, workspace
membership, and ownership remain distinct so later membership can be added without replacing
existing identities or reassigning their data.

The first delivery establishes the Compose deployment on supported macOS and Linux hosts,
with documented manual installation and operator procedures. The Compose stack includes a reverse
proxy that serves Your Space over HTTPS with an automatically obtained certificate when the
operator provides a domain. Spec 003 (install and run with the
CLI) follows spec 002 and wraps this feature's setup and recovery behavior; its command names and
mechanics are set there. The desktop app (spec 008) wraps the CLI in turn. Completing this feature must not depend on either; setup
authority and owner recovery remain available through the documented deployment procedures.

The [project-wide decision record](../../docs/architecture/decisions.md) preserves
selected technologies, accepted future app and agent design, and choices still open. That shared
record applies across specifications; its future work is not required to complete this feature. The
[constitution](../../.specify/memory/constitution.md) remains the governing document. The
[spec map](../../docs/spec-map.md) sets the rules every specification follows; FR-001, FR-022 to
FR-027, and the cross-cutting scenarios apply them so later specs build on this feature without
reworking it.

## User Scenarios & Testing

### User Story 1 - Install and Establish the Owner (Priority: P1)

As the operator of a new installation, I can follow the manual Docker Compose guide, create the
owner account with a server command, and set its password in the browser.

**Why this priority**: Every subsequent capability depends on a usable installation with an
unambiguous owner, created only by someone with access to the server.

**Independent Test**: Start from a clean supported environment, follow the published guide, run the
owner-creation command, set the password through the printed link, and reach one empty workspace as
its owner.

**Acceptance Scenarios**:

1. **Given** a documented supported environment, **When** the operator follows the manual Compose
   installation guide, **Then** the system starts and the web client is reachable without a
   standalone Your Space CLI. Before an owner exists, it says how to create one and offers no way to
   create an account. Missing prerequisites produce actionable instructions rather than an apparent
   successful installation.
2. **Given** an installation without an owner, **When** the operator runs the documented
   owner-creation command with a valid name and email, **Then** exactly one account, one workspace,
   and their ownership and membership relationships exist, and the command prints a short-lived,
   single-use set-password link to the operator.
3. **Given** a valid set-password link, **When** the owner sets a valid password, **Then** they can
   sign in and reach their workspace.
4. **Given** someone can reach the server only over the network, **When** they try to create an
   account or become the owner, **Then** nothing is created.
5. **Given** an owner already exists, **When** anyone runs the owner-creation command again or tries
   to register, **Then** no account is created and the owner is not replaced.
6. **Given** the owner-creation command was interrupted, **When** the operator runs it again with the
   same details, **Then** it finishes creating that owner without duplicates, and an installation is
   never marked as having an owner without its account and workspace.
7. **Given** no email delivery service is configured, **When** the owner is created, **Then** the
   email serves as the login identifier, remains unverified, and does not block access.
8. **Given** a script runs the owner-creation command, **When** it completes or fails, **Then** the
   script receives machine-readable output, including the set-password link, and a meaningful exit
   status, so the CLI and desktop app can set the password on the user's behalf.
9. **Given** the operator configures a domain that resolves to the host and ports 80 and 443 are
   reachable, **When** the stack starts, **Then** the built-in proxy obtains a certificate
   automatically and serves Your Space over HTTPS, and plain HTTP requests to that domain are
   redirected to HTTPS.

### User Story 2 - Sign In and Access the Workspace (Priority: P1)

As the owner, I can sign in from a supported browser, access my workspace, and sign out with
confidence that protected operations require an authorized session.

**Why this priority**: Creating an owner is useful only if normal access works and unauthorized
callers cannot obtain the same access by bypassing the interface.

**Independent Test**: Use a prepared claimed installation to verify valid and invalid sign-in,
workspace access from another device, direct protected requests, session expiry, and sign-out.

**Acceptance Scenarios**:

1. **Given** a claimed installation, **When** the owner signs in with the correct email and
   password, **Then** the existing workspace opens under the same account identity.
2. **Given** incorrect credentials, **When** sign-in is attempted, **Then** access is denied
   without exposing protected workspace data or changing ownership.
3. **Given** no authorized session, **When** a caller requests protected data directly rather
   than through the web interface, **Then** the server denies access and protected state is unchanged.
4. **Given** an active owner session, **When** the owner signs out, **Then** that session is
   invalidated and replaying it cannot access protected resources.
5. **Given** an expired or invalidated session, **When** the client attempts a protected action,
   **Then** it requires sign-in again and does not report the action as successful.
6. **Given** a server reachable over HTTPS through the documented encrypted path, **When** the
   owner uses a browser on another device, **Then** the same account and workspace are available
   without a second setup.
7. **Given** an installation with no apps or agents, **When** the owner opens the workspace,
   **Then** the interface shows an accurate empty state and available owner/session controls,
   without implying that app installation or agent functionality already exists.
8. **Given** an unavailable server or rejected request, **When** the client displays the outcome,
   **Then** it distinguishes failure from an empty workspace and provides a recoverable next step.
9. **Given** an active owner session, **When** the browser makes requests to any other host,
   including subdomains of the Your Space host, **Then** the session credential is not sent.

### User Story 3 - Preserve the Workspace Across Restarts (Priority: P1)

As the owner, I can restart the installation without losing my account, workspace, or ownership.

**Why this priority**: A workspace must be durable before users can entrust apps or data to it.

**Independent Test**: Record the identities and ownership of a claimed installation, perform the
documented stop/start and service recreation procedures while retaining its durable storage,
then sign in and compare the records.

**Acceptance Scenarios**:

1. **Given** a completed setup, **When** the system is restarted through a supported procedure,
   **Then** the same account, workspace, membership, and ownership records remain.
2. **Given** that restarted installation, **When** the owner signs in, **Then** the workspace is
   usable without running setup again. An unexpired, unrevoked session from before the restart
   remains valid, so restarts such as starting a local workspace or updating do not force sign-in.
3. **Given** claimed state cannot be read because storage is unavailable, **When** the system
   starts or receives requests, **Then** it reports a storage problem and refuses to treat that
   uncertainty as an unclaimed installation.
4. **Given** storage becomes available again, **When** the operator follows the documented
   recovery steps, **Then** the existing claim and ownership are recovered without replacement.
5. **Given** a claimed installation, **When** every Your Space container is removed and recreated
   from the Compose file, keeping only the documented database and named volumes, **Then** all
   account, workspace, membership, ownership, and claim state is intact.

### User Story 4 - Recover Owner Access (Priority: P1)

As an operator who has lost the owner password, I can recover that same account using access to
the server, without requiring email delivery or creating a new owner.

**Why this priority**: The first self-hosted release must remain recoverable without configuring
an additional delivery service.

**Independent Test**: Use the documented operator recovery command for an existing owner,
complete the issued password-reset flow, and verify identity preservation and session revocation.

**Acceptance Scenarios**:

1. **Given** a claimed installation and authorized operator access to its server, **When** the
   operator runs the recovery command, **Then** it provides a short-lived, single-use reset link
   for the existing owner, even when email delivery is not configured.
2. **Given** a valid reset link, **When** the owner sets a valid new password, **Then** the account,
   workspace, membership, and ownership identities remain unchanged; old sessions are revoked;
   the owner must sign in normally with the new password.
3. **Given** an invalid, expired, or previously used reset link, **When** someone attempts a
   password reset, **Then** it fails without changing the password or ownership.
4. **Given** a reset link has been issued but not successfully used, **When** normal account
   access is attempted, **Then** issuing the link alone has not changed the password or ownership.
5. **Given** only browser or network access without operator authority or a valid reset link,
   **When** someone attempts recovery, **Then** they cannot obtain a usable recovery credential.
6. **Given** recovery completes for an unverified email address, **When** account state is read,
   **Then** the email remains unverified. Server access is not proof of mailbox ownership.

### Cross-Cutting Verification Scenarios

Scenarios 4 to 8 check the [spec map's](../../docs/spec-map.md) shared rules that are not covered
by the user stories.

1. **Given** account creation and a completed password reset, **When** credential storage is
   reviewed, **Then** passwords are represented only by salted, one-way password hashes designed
   for password storage, with the selected algorithm and work factor documented in the plan.
2. **Given** setup, sign-in, failed requests, and recovery have been exercised, **When** ordinary
   application logs and public errors are inspected, **Then** they contain no passwords, reusable
   session credentials, or set-password and reset links. Intentional operator-only delivery of those
   links is assessed separately from ordinary logs.
3. **Given** the documented sign-in limit, **When** repeated invalid sign-in attempts reach it,
   **Then** the documented limiting behavior occurs and no protected state changes. Legitimate retry
   follows the documented policy. Set-password and reset links have the documented length and
   randomness.
4. **Given** an ARM host (including Apple Silicon) and an Intel/AMD host, **When** the operator
   follows the guide on each, **Then** both run Your Space's published images natively and complete
   User Story 1.
5. **Given** outbound network traffic is observed, **When** setup, sign-in, failed requests, and
   recovery are exercised, **Then** Your Space makes no automatic outbound requests other than
   certificate requests for an operator-configured domain.
6. **Given** the owner reaches the empty workspace, **When** the default interface is reviewed,
   **Then** it shows only what the owner needs (the workspace, their account, and sign-out), with
   no configuration, diagnostics, or placeholder controls for future features. Failure and service
   states required by FR-016 are shown when they occur and are not diagnostics.
7. **Given** owner creation and recovery have been exercised, **When** the stored records of those actions
   are inspected, **Then** each names its actor through a stable actor identity that is not tied to
   the human-account type.
8. **Given** an installation created by one build, **When** a newer build with a pending schema
   migration starts against the same storage, **Then** the recorded schema version advances, the
   migration applies in place, and all identities, ownership, and claim state are intact.

### Edge Cases

- Set-password and reset links are missing, malformed, expired, replayed, or submitted concurrently.
- The owner-creation command stops between creating the account and marking the owner as created.
- The set-password link expires before the owner uses it; the operator issues a new one with the
  recovery command, and a network visitor cannot obtain one.
- Repeated failed sign-in attempts exceed the configured limit.
- Storage is temporarily unavailable or inconsistent; the system fails closed rather than
  offering fresh setup over uncertain existing state.
- The web client loses connectivity, retains a stale session, or reconnects after server restart.
- Password recovery runs while sessions remain active on other devices.
- A script runs the owner-creation or recovery command when an owner already exists (or doesn't
  yet), the server is stopped, or storage is unavailable; it gets a clear machine-readable failure.
- The built-in proxy cannot obtain or renew a certificate (the domain does not resolve to the host,
  or ports 80 and 443 are blocked); the operator sees the cause instead of a silent fallback to
  plain HTTP.
- The operator recreates services but retains the documented durable storage. Deliberate storage
  deletion is not a supported restart and must be distinguished in the guide.

## Requirements

### Functional Requirements

- **FR-001**: The installation guide MUST identify supported prerequisites, how to start and
  create the owner, where durable state lives, safe restart procedures, and owner recovery steps.
  It MUST provide a manual Docker Compose pathway on supported macOS and Linux hosts, including
  configuration and owner creation, without requiring a standalone Your Space CLI.
  Failed prerequisites and startup failures MUST provide actionable feedback.
- **FR-002**: Creating the owner MUST require operator access to the server, through a documented
  owner-creation command. Reaching the server over the network MUST NOT allow creating an account or
  becoming the owner. Every installation, local or server, MUST use this one command. It MUST support
  scripted use (machine-readable output and exit status) so the CLI (spec 003), and the desktop app
  through the CLI (spec 008), can wrap it without a separate path.
- **FR-003**: The owner-creation command MUST take a name and email and validate them according to
  documented account rules. The owner MUST set their password through a short-lived, single-use
  set-password link that the command prints; password rules MUST be documented.
- **FR-004**: Owner creation MUST establish one owner account, one workspace, and consistent
  membership and ownership. Rerunning the command after an interruption MUST finish the same owner
  without duplicates, and an installation MUST NOT be marked as having an owner without its required
  records.
- **FR-005**: Once the owner exists, sign-up MUST stay closed. This feature MUST NOT provide another
  account-creation, membership, or owner-replacement path. New people join only by the owner's
  invitation (spec 004).
- **FR-006**: Your Space MUST provide one server-managed authentication and session system for
  local and remote access. Initial self-hosted operation MUST NOT require an external identity
  service or a separately implemented local authentication mode.
- **FR-007**: Email MUST be the owner login identifier. Setup and recovery MUST function without
  email delivery. An address MUST NOT be marked verified without proof of mailbox control.
- **FR-008**: The owner MUST be able to sign in, reach the existing workspace, and sign out.
  Protected access MUST be enforced by the server even when the interface is bypassed.
- **FR-009**: Sessions MUST expire and support server-enforced invalidation. Sign-out MUST
  invalidate the current session; an expired or invalidated session MUST NOT authorize later requests.
  Session state MUST be durable, so an unexpired, unrevoked session survives supported restarts.
- **FR-010**: Passwords MUST use a salted, one-way hashing scheme designed for password storage;
  the algorithm and work factor belong in the implementation plan. Passwords, reusable session credentials,
  and set-password or reset links MUST NOT appear in ordinary application logs, public error
  responses, or committed configuration. Operator-only delivery of setup/reset authority is intentional.
- **FR-011**: Sign-in MUST limit repeated failed attempts. Set-password and reset links MUST be
  random values long enough that guessing them is impractical. Limits, credential lifetimes, and
  observable rejection behavior MUST be documented and verified; exact settings belong in the
  implementation plan.
- **FR-012**: Account, workspace, membership, ownership, and claim state MUST survive documented
  restarts and service recreation when durable storage is retained.
- **FR-013**: Unavailable or unreadable persisted state MUST NOT be interpreted as an unclaimed
  installation. Recovery from storage failure MUST preserve existing identities and ownership.
- **FR-014**: Account identity, workspace membership, and ownership MUST remain distinct concepts
  with explicit relationships. Existing records MUST NOT depend on a universal hard-coded owner
  identity that would need replacement to support future members.
- **FR-015**: The web client MUST use a configured server connection that works on the same
  machine or across machines, and MUST NOT depend on browser-local authoritative workspace state.
  Remote access MUST use HTTPS (FR-028). Plain HTTP is supported only on the same machine
  (localhost), and session credentials MUST NOT be sent over plain HTTP to a remote host.
- **FR-016**: The initial workspace MUST truthfully represent its empty state and available owner
  access. Authentication, connectivity, and storage failures MUST NOT be presented as successful
  operations or an empty/unclaimed workspace.
- **FR-017**: An operator recovery command MUST issue a short-lived, single-use reset link for
  the existing owner without email delivery. It MUST NOT create an account or replace the owner.
  The command MUST be available through the documented deployment procedures without the later CLI,
  and MUST support scripted use (machine-readable output and exit status) so the CLI can wrap it.
- **FR-018**: Invalid, expired, or consumed reset credentials MUST leave protected account state
  unchanged. Merely issuing a reset link MUST NOT change the owner password or ownership.
- **FR-019**: A successful password reset MUST preserve account and workspace identity, replace
  the password, revoke existing owner sessions, and require normal sign-in afterward. Subsequent
  use of revoked sessions MUST be denied.
- **FR-020**: Denied account-creation, authentication, recovery, and protected-access requests MUST NOT
  modify protected workspace or ownership state. Error messages MUST be usable without exposing
  secrets or protected data.
- **FR-021**: The platform session MUST be held in host-only cookies, so it is never sent to other
  hosts, including subdomains where apps may later live (spec 002).
- **FR-022**: Your Space MUST publish its images for both ARM (including Apple Silicon) and
  Intel/AMD machines, and the guide MUST be verified on both.
- **FR-023**: All durable state MUST live in the database or in named volumes listed in the guide;
  nothing that must survive may live only in a container's filesystem. The storage layout MUST let
  the whole workspace be captured and restored consistently, so backup and restore (spec 006) add
  to it rather than change it.
- **FR-024**: Stored data MUST carry a schema version and change only through versioned migrations
  from the first release, so later updates (spec 006) upgrade an installation in place.
- **FR-025**: Records that identify who performed an action MUST reference a stable actor identity
  and MUST NOT assume every actor is a human account, so agents (spec 005) can be credited as the
  actual actor without changing existing records.
- **FR-026**: Your Space MUST NOT send telemetry or make automatic outbound requests in this
  feature, other than the certificate requests the built-in proxy makes to its certificate
  authority after the operator configures a domain. Owner-controllable update checks arrive with update features (spec 006, and spec 008
  for the desktop app).
- **FR-027**: The default interface MUST show only what the owner needs. Settings, diagnostics, and
  controls for features that do not exist yet MUST NOT appear in the default experience.
- **FR-028**: The Compose stack MUST include a reverse proxy that obtains and renews a certificate
  automatically when the operator provides a domain, and serves Your Space over HTTPS. Operators
  with their own reverse proxy or tunnel MUST be able to turn off its certificate handling and
  terminate HTTPS themselves. Operators without a domain MUST have documented private-tunnel
  guidance, such as Tailscale.

### Key Entities

These are domain concepts, not prescribed database tables or framework types.

- **Installation**: A running deployment with claim state (whether its owner exists), durable
  configuration, and a server address. Its claim state must not be inferred from whether storage
  happens to respond.
- **Owner account**: The human identity with name, email, verification state, and authentication
  credentials. Its stable identity survives password changes and recovery.
- **Workspace**: The durable context owned by that account; distinct from both account and deployment.
- **Membership**: The explicit relationship between a human account and workspace. This feature
  creates only the owner's membership; additional members are future work.
- **Ownership**: The authority relationship identifying the workspace's owner. Recovery preserves it.
- **Session**: An authenticated owner session with expiry and invalidation behavior.
- **Set-password and recovery links**: Short-lived, single-use links, issued only by server commands,
  that let the owner set their first password or reset a lost one. Both use one mechanism.
- **Actor**: Whoever performs an action. Only the owner acts in this feature, but records that name
  an actor do not assume a human, so agents can be credited later.

## Success Criteria

### Measurable Outcomes

- **SC-001**: On each environment claimed as supported, following the installation guide from a
  clean state using manual Docker Compose procedures produces exactly one usable owner account
  and workspace without a standalone Your Space CLI or manual database edits.
- **SC-002**: Every attempt to create an account or become the owner without operator access is
  denied, and every invalid, expired, or replayed set-password link is refused. Rerunning the
  owner-creation command produces at most one owner and workspace.
- **SC-003**: Valid owner sign-in reaches the existing workspace; invalid credentials and direct
  unauthenticated protected requests reveal no protected data and cause no protected state change.
- **SC-004**: After sign-out or session expiry, replaying the affected session fails. After a
  successful password reset, all previously active owner sessions fail subsequent protected requests.
- **SC-005**: Documented restarts and service recreation, keeping only the documented database and
  named volumes, retain the same account and workspace identifiers, membership, and ownership, and
  the owner can sign in again without repeating setup. Unexpired, unrevoked sessions remain valid.
- **SC-006**: Storage-failure exercises never reopen setup or overwrite a claim, and restoring
  storage makes the existing account and workspace recoverable.
- **SC-007**: Owner setup and password recovery both succeed with no email delivery configured,
  while the address remains unverified without separate mailbox proof.
- **SC-008**: Recovery preserves the existing owner and workspace. Used and expired recovery
  links cannot reset the password, and recovery does not create a replacement owner.
- **SC-009**: A browser on another device reaches the same server and workspace over HTTPS, through
  the built-in proxy with an automatically obtained certificate or through the documented
  own-proxy or tunnel path, without creating another account or installation. The session
  cookie is host-only and is never sent over plain HTTP to a remote host.
- **SC-010**: The initial workspace, failure states, and guide accurately describe supported
  behavior. Delivery evidence identifies tested versions, environments, procedures, and limitations.
- **SC-011**: The guide completes User Story 1 on both an ARM host (including Apple Silicon) and an
  Intel/AMD host using the published images.
- **SC-012**: The owner-creation and recovery commands produce machine-readable output and exit statuses
  that a script can use for success and each documented failure.
- **SC-013**: Observed outbound traffic during setup, sign-in, and recovery shows no automatic
  requests from Your Space other than certificate requests for an operator-configured domain.

## Assumptions

- The operator can install the documented prerequisites and administer the server. A visitor's
  ability to load a page does not imply operator authority.
- Initial server hosts are macOS and Linux on ARM and Intel/AMD. Windows is not a server host.
  Exact supported OS versions must be documented and verified during implementation.
- The first delivery is an online web client and one server installation with one human owner
  and one workspace. Offline synchronization, multiple servers in one client, and shared access
  are not required here.
- Durable storage is retained across supported restarts. Updates, backup, and restore are spec 006;
  this feature's storage layout and migrations prepare for them (FR-023, FR-024). Installation
  instructions must make destructive storage deletion recognizable.
- Automatic certificates need a domain that resolves to the host and inbound ports 80 and 443.
  Spec 002 adds app routing to the same proxy, and spec 003's CLI asks for the domain during
  installation; neither changes setup, sessions, or stored data.
- The web client's screens are deliberately plain and functional. No visual design or approved
  mockups are required before implementation; layout and styling only need to meet this
  feature's requirements. A later spec designs the interface, starting from what it should show.
- Product behavior is specified here. Selected technologies and unresolved implementation
  choices are preserved in the [project decision record](../../docs/architecture/decisions.md),
  rather than silently selected by this PR.
- Planning must settle the initial host/version support matrix, account validation rules, expiry
  and attempt limits, migration tooling, the operator commands' output format, and encrypted
  remote-connection instructions before claiming those paths work.

## Explicitly Out of Scope

Later journeys in the [spec map](../../docs/spec-map.md) deliver these:

- **Spec 002:** installing or running apps, including Tasks; app UI and sign-in; the app contract,
  TypeScript SDK, and app roles.
- **Spec 003:** the Your Space CLI, including asking for the domain during guided installation.
- **Spec 004:** invitations, additional members, member recovery, and role assignment.
- **Spec 005:** agents, delegation, agent credentials, the gateway, and the activity log.
- **Spec 006:** Your Space and app updates, backup, restore, moving a workspace, and uninstall.
- **Spec 007:** the public developer kit, Python SDK, and external apps.
- **Spec 008:** the desktop app, local mode, and the installable PWA, including offline behavior.

Deferred until after the first public release: email delivery, GitHub account connections, app
catalogs, the managed service, and provider-specific cloud installers.

Not in this feature, and not yet assigned to a spec: the interface's visual design, ownership
transfer, mobile-native clients, offline synchronization, and a multi-server client picker.

The accepted direction for these later features is retained in the project-wide decision record.
Their presence there must not be treated as authorization to implement them in this first slice.
