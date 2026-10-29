# Feature Specification: Workspace Setup and Owner Access

**Feature Branch**: `codex/001-workspace-owner-access`

**Created**: 2026-10-28

**Status**: Draft for PR review; implementation has not started

**Input**: Establish an owner-only Your Space installation with guided setup, a web client,
durable workspace state, and account recovery. Preserve the agreed platform, app, and agent
architecture without adding those later features to this first delivery.

## Objective and Scope

An operator can install Your Space, establish the initial human owner, sign in to an empty
workspace, recover access if the password is lost, and retain the same account and workspace
after a supported restart. Being able to reach the server is not sufficient authority to claim it.

This feature supports exactly one human owner and one workspace. Account identity, workspace
membership, and ownership remain distinct so later membership can be added without replacing
existing identities or reassigning their data.

[Decisions and follow-up architecture](decisions.md) records selected technologies, accepted
future app and agent design, and choices still open. It is part of this specification package,
but its explicitly future work is not required to complete this feature. The
[constitution](../../.specify/memory/constitution.md) remains the governing document.

## User Scenarios & Testing

### User Story 1 - Install and Establish the Owner (Priority: P1)

As the operator of a new installation, I can follow a guided installation pathway and establish
my account as the owner of its first workspace.

**Why this priority**: Every subsequent capability depends on a usable installation with an
unambiguous owner and a protected claim process.

**Independent Test**: Start from a clean supported environment, follow the published guide,
complete setup with operator-issued authority, and reach one empty workspace as its owner.

**Acceptance Scenarios**:

1. **Given** a documented supported environment, **When** the operator follows the installation
   guide, **Then** the system starts and the web client can reach setup. Missing prerequisites
   produce actionable instructions rather than an apparent successful installation.
2. **Given** an unclaimed installation, **When** the installer prepares setup, **Then** it supplies
   the operator with a temporary, single-use setup code through the installation process.
   Visiting the public setup page does not reveal that authority.
3. **Given** a valid setup code and valid name, email, and password, **When** setup succeeds,
   **Then** exactly one account, one workspace, and their ownership and membership relationships
   exist, and the owner reaches that workspace.
4. **Given** someone can reach setup but lacks a valid code, **When** they attempt to claim the
   installation, **Then** the request is denied and no account or ownership is created.
5. **Given** the installation is already claimed, **When** anyone repeats initial setup or tries
   initial registration, **Then** they cannot create another account or replace the owner.
6. **Given** simultaneous valid claim attempts or a repeated submission, **When** they complete,
   **Then** there is at most one initial owner and workspace, with no contradictory claim state.
7. **Given** setup is interrupted, **When** the operator retries, **Then** the system either resumes
   a valid unclaimed setup or recognizes the completed claim; it does not create duplicates or
   leave a claimed installation without its owner and workspace.
8. **Given** no email delivery service is configured, **When** the owner completes setup,
   **Then** the email serves as the login identifier, remains unverified, and does not block access.

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
6. **Given** a reachable server at its configured address, **When** the owner uses a browser on
   another device, **Then** the same account and workspace are available without a second setup.
7. **Given** an installation with no apps or agents, **When** the owner opens the workspace,
   **Then** the interface shows an accurate empty state and available owner/session controls,
   without implying that app installation or agent functionality already exists.
8. **Given** an unavailable server or rejected request, **When** the client displays the outcome,
   **Then** it distinguishes failure from an empty workspace and provides a recoverable next step.

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
   usable without running setup again. Preserving an existing browser session is not required.
3. **Given** claimed state cannot be read because storage is unavailable, **When** the system
   starts or receives requests, **Then** it reports a storage problem and refuses to treat that
   uncertainty as an unclaimed installation.
4. **Given** storage becomes available again, **When** the operator follows the documented
   recovery steps, **Then** the existing claim and ownership are recovered without replacement.

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

1. **Given** account creation and a completed password reset, **When** credential storage is
   reviewed, **Then** passwords are represented only by salted, one-way password hashes designed
   for password storage, with the selected algorithm and work factor documented in the plan.
2. **Given** setup, sign-in, failed requests, and recovery have been exercised, **When** ordinary
   application logs and public errors are inspected, **Then** they contain no passwords, reusable
   session credentials, setup codes, or reset credentials. Intentional operator-only delivery of
   setup and recovery authority is assessed separately from ordinary logs.
3. **Given** the documented failed-attempt limits for sign-in, setup, and reset validation,
   **When** repeated invalid attempts reach each configured limit, **Then** the documented limiting
   behavior occurs and no protected state changes. Legitimate retry follows the documented policy.

### Edge Cases

- Setup codes and reset links are missing, malformed, expired, replayed, or submitted concurrently.
- The browser retries a claim after a timeout, including when the server already committed it.
- The process stops between preparing initial records and declaring setup complete.
- The owner loses the setup code before a claim; documented operator recovery must preserve
  completed claims and must not allow a network visitor to obtain replacement authority.
- Repeated failed authentication or claim attempts exceed configured limits.
- Storage is temporarily unavailable or inconsistent; the system fails closed rather than
  offering fresh setup over uncertain existing state.
- The web client loses connectivity, retains a stale session, or reconnects after server restart.
- Password recovery runs while sessions remain active on other devices.
- The operator recreates services but retains the documented durable storage. Deliberate storage
  deletion is not a supported restart and must be distinguished in the guide.

## Requirements

### Functional Requirements

- **FR-001**: The installation guide MUST identify supported prerequisites, how to start and
  reach setup, where durable state lives, safe restart procedures, and owner recovery steps.
  Failed prerequisites and startup failures MUST provide actionable feedback.
- **FR-002**: Initial claim MUST require temporary, single-use setup authority supplied through
  the operator's installation process. Public reachability alone MUST NOT establish that authority.
- **FR-003**: Initial owner setup MUST collect a name, email, and password and validate them
  according to documented account rules before completing the claim.
- **FR-004**: Claim completion MUST establish one owner account, one workspace, and consistent
  membership and ownership together. Concurrent requests, retries, and interruptions MUST NOT
  produce multiple initial owners or a claimed installation lacking its required records.
- **FR-005**: A completed claim MUST close initial registration and setup. This feature MUST NOT
  provide another account-creation, membership, or owner-replacement path.
- **FR-006**: Your Space MUST provide one server-managed authentication and session system for
  local and remote access. Initial self-hosted operation MUST NOT require an external identity
  service or a separately implemented local authentication mode.
- **FR-007**: Email MUST be the owner login identifier. Setup and recovery MUST function without
  email delivery. An address MUST NOT be marked verified without proof of mailbox control.
- **FR-008**: The owner MUST be able to sign in, reach the existing workspace, and sign out.
  Protected access MUST be enforced by the server even when the interface is bypassed.
- **FR-009**: Sessions MUST expire and support server-enforced invalidation. Sign-out MUST
  invalidate the current session; an expired or invalidated session MUST NOT authorize later requests.
- **FR-010**: Passwords MUST use a salted, one-way hashing scheme designed for password storage;
  the algorithm and work factor belong in the implementation plan. Passwords, reusable session credentials,
  setup codes, and reset credentials MUST NOT appear in ordinary application logs, public error
  responses, or committed configuration. Operator-only delivery of setup/reset authority is intentional.
- **FR-011**: Sign-in, setup-code validation, and reset-token validation MUST limit repeated failed
  attempts. Their configured limits, credential lifetimes, and observable rejection behavior MUST
  be documented and verified; exact settings belong in the implementation plan.
- **FR-012**: Account, workspace, membership, ownership, and claim state MUST survive documented
  restarts and service recreation when durable storage is retained.
- **FR-013**: Unavailable or unreadable persisted state MUST NOT be interpreted as an unclaimed
  installation. Recovery from storage failure MUST preserve existing identities and ownership.
- **FR-014**: Account identity, workspace membership, and ownership MUST remain distinct concepts
  with explicit relationships. Existing records MUST NOT depend on a universal hard-coded owner
  identity that would need replacement to support future members.
- **FR-015**: The web client MUST use a configured server connection that works on the same
  machine or across machines. Remote access MUST have a documented encrypted connection path;
  it MUST NOT depend on browser-local authoritative workspace state.
- **FR-016**: The initial workspace MUST truthfully represent its empty state and available owner
  access. Authentication, connectivity, and storage failures MUST NOT be presented as successful
  operations or an empty/unclaimed workspace.
- **FR-017**: An operator recovery command MUST issue a short-lived, single-use reset link for
  the existing owner without email delivery. It MUST NOT create an account or reopen initial setup.
- **FR-018**: Invalid, expired, or consumed reset credentials MUST leave protected account state
  unchanged. Merely issuing a reset link MUST NOT change the owner password or ownership.
- **FR-019**: A successful password reset MUST preserve account and workspace identity, replace
  the password, revoke existing owner sessions, and require normal sign-in afterward. Subsequent
  use of revoked sessions MUST be denied.
- **FR-020**: Denied claim, authentication, recovery, and protected-access requests MUST NOT
  modify protected workspace or ownership state. Error messages MUST be usable without exposing
  secrets or protected data.

### Key Entities

These are domain concepts, not prescribed database tables or framework types.

- **Installation**: A running deployment with claim state, durable configuration, and a server
  address. Its claim state must not be inferred from whether storage happens to respond.
- **Owner account**: The human identity with name, email, verification state, and authentication
  credentials. Its stable identity survives password changes and recovery.
- **Workspace**: The durable context owned by that account; distinct from both account and deployment.
- **Membership**: The explicit relationship between a human account and workspace. This feature
  creates only the owner's membership; additional members are future work.
- **Ownership**: The authority relationship identifying the workspace's owner. Recovery preserves it.
- **Session**: An authenticated owner session with expiry and invalidation behavior.
- **Setup authority**: Temporary, single-use authority to claim an unclaimed installation.
- **Recovery authority**: Short-lived, single-use authority to reset the existing owner's password.

## Success Criteria

### Measurable Outcomes

- **SC-001**: On each environment claimed as supported, following the installation guide from a
  clean state produces exactly one usable owner account and workspace without manual data edits.
- **SC-002**: Every acceptance case involving an invalid, expired, missing, or replayed setup
  credential is denied. Concurrent claims and retries produce at most one complete initial claim.
- **SC-003**: Valid owner sign-in reaches the existing workspace; invalid credentials and direct
  unauthenticated protected requests reveal no protected data and cause no protected state change.
- **SC-004**: After sign-out or session expiry, replaying the affected session fails. After a
  successful password reset, all previously active owner sessions fail subsequent protected requests.
- **SC-005**: Documented restarts and service recreation retain the same account and workspace
  identifiers, membership, and ownership, and the owner can sign in again without repeating setup.
- **SC-006**: Storage-failure exercises never reopen setup or overwrite a claim, and restoring
  storage makes the existing account and workspace recoverable.
- **SC-007**: Owner setup and password recovery both succeed with no email delivery configured,
  while the address remains unverified without separate mailbox proof.
- **SC-008**: Recovery preserves the existing owner and workspace. Used and expired recovery
  links cannot reset the password, and recovery does not create a replacement owner.
- **SC-009**: A browser on another device reaches the same server and workspace through the
  documented encrypted connection path, without creating another account or installation.
- **SC-010**: The initial workspace, failure states, and guide accurately describe supported
  behavior. Delivery evidence identifies tested versions, environments, procedures, and limitations.

## Assumptions

- The operator can install the documented prerequisites and administer the server. A visitor's
  ability to load a page does not imply operator authority.
- The first delivery is an online web client and one server installation with one human owner
  and one workspace. Offline synchronization, multiple servers in one client, and shared access
  are not required here.
- Durable storage is retained across supported restarts. Backup/restore automation and upgrades
  are separate work; installation instructions must make destructive storage deletion recognizable.
- Browser sessions may require fresh sign-in after a restart; durable account and ownership
  records must not require recreation.
- Product behavior is specified here. Selected technologies and unresolved implementation
  choices are preserved in [decisions.md](decisions.md), rather than silently selected by this PR.
- Planning must settle the initial host/version support matrix, account validation rules, expiry
  and attempt limits, and encrypted remote-connection instructions before claiming those paths work.

## Explicitly Out of Scope

- Installing or running an independent app, including Tasks; implementing the SDK or app contract.
- GitHub account connections, repository installation, app updates, or marketplace/catalog services.
- Registering agents, assigning app roles, role delegation, programmatic agent credentials, or workflows.
- Additional human accounts, invitations, shared workspaces, membership administration, or ownership transfer.
- Desktop packaging, mobile-native clients, offline synchronization, or a multi-server client picker.
- Managed-service provisioning, billing, email delivery, and provider-specific cloud installers.
- A universal app gateway, embedding mechanism, container orchestration system, or app storage scheme.

The accepted direction for these later features is retained in the companion decision record.
Their presence there must not be treated as authorization to implement them in this first slice.
