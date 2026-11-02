# Public Open-Source Release Readiness

**Status:** Working checklist; the public-release interview and detailed readiness bar are in progress.

The current direction is to make the repository public with an installable first version that
demonstrates the core experience. This checklist captures work to implement, prove, and polish
before that release. More requirements and the exact launch bar remain under discussion.

The [roadmap](roadmap.md) tracks product delivery, and the [architecture and product decisions](architecture/decisions.md)
record agreed direction. The [owner access specification under review](https://github.com/your-space-ai/your-space/pull/3)
defines the first feature's acceptance criteria. This checklist does not expand that specification;
new capabilities need their own specifications and implementation work.

## How to Use This Checklist

- Finalize the release scope before treating every item as an agreed gate.
- Each parent represents a readiness area, and its children identify concrete work or evidence.
- Check an item only when completed and verified. Add the date, tested commit or release version,
  and a link to the implementation, review, or test evidence; retain checked items as a record.
- Record any accepted exception or deferral with its rationale, owner, and follow-up. A deferred
  item remains unchecked. Check a parent only when every applicable child is complete and the area
  works as a whole. Mark conditional items that do not apply as out of scope with a decision link,
  without checking them as delivered.
- Revalidate evidence affected by later changes against the release candidate. Resolve blockers and
  record accepted limitations before launch.

## Release Scope and Promise

- [ ] **Define the public release promise**
  - [ ] Target people who can install Docker Desktop and the desktop app for a local workspace, or
    install Docker and follow a guided CLI for a server or local workspace, without one-on-one help.
  - [ ] Record the intended users, release maturity, supported behaviors, and what is explicitly
    deferred; update the roadmap and decisions if the agreed direction changes.
  - [ ] For milestones that claim supported environments, define supported operating system versions,
    CPU architectures, browsers, Docker/Compose versions, and local or remote deployment paths.
  - [ ] Define release blockers and who will accept remaining known limitations.

**First public version:** Owner setup, invited member signup, the CLI for servers and local
workspaces, a desktop app that drives the CLI to run a local workspace, web, desktop, and PWA
workspace clients, at least one independently installed app, developer ability to create and install
additional apps, and external-agent access. The interview is ongoing, so additional requirements may
emerge. A small Tasks app is the first app. This scope does not change the owner-only first
specification.

## Early Source Publication: Building in Public

Early source publication remains an alternative if the owner later chooses it. It is not the current
release plan. These checks are a proposed minimum for that alternative, not a promise of a usable release.

- [ ] **Prepare the repository for public development**
  - [ ] Review repository history, branches, tags, commit identities, issues, PRs, logs, artifacts,
    and other potentially public material for private data and secrets; remediate findings and
    rotate or revoke exposed credentials where needed.
  - [ ] Confirm publication rights for existing material, add the selected project licenses, and meet
    applicable third-party license and notice obligations.
  - [ ] Explain the project's purpose, current state, unimplemented functionality, and participation
    expectations in the README, with links to the roadmap and relevant development instructions.
  - [ ] Review the security and safe-use implications of any runnable code and provide a private
    security reporting route appropriate to the project state.
  - [ ] Review public repository settings and the effects of publication, then authorize the visibility
    change separately. Making source public does not imply a supported or production-ready product.

## Public Release Readiness Work

The following work supports the intended usable public release. If an earlier source-only publication
is chosen instead, explicitly decide which items apply and describe what is not ready to use.

- [ ] **Install and use the owner workspace**
  - [ ] Implement the owner-access specification and its manual Docker Compose pathway, including
    browser setup, one owner and workspace, sign-in, sign-out, and server-enforced access.
  - [ ] Document and test installation from a clean state on each claimed host and architecture,
    including prerequisites, configuration, startup, and actionable failure handling.
  - [ ] Verify operator-only setup authority, single-use and expiry behavior, concurrent claim and
    retry handling, and denial of unauthorized or duplicate claims.
  - [ ] Verify protected requests are denied without valid authentication, including direct API
    requests; test session expiry, sign-out, and invalidation.
  - [ ] Verify owner and workspace identity survive documented restart and service recreation
    with storage retained, and storage failure cannot reopen setup or appear as an empty workspace.
  - [ ] Verify operator recovery without email delivery preserves ownership and identity, rejects
    invalid or used credentials, revokes old sessions, and requires a new sign-in.
  - [ ] Document and test the claimed remote access path with encrypted transport from another device.
  - [ ] Set and document account validation, password rules, credential and session lifetimes,
    and failed-attempt controls; verify their intended behavior.

- [ ] **Protect private information before publication**
  - [ ] Inventory and review all repository history and reachable branches and tags, including files,
    examples, screenshots, generated content, and commit author and committer names and email
    addresses, for personal data and secrets.
  - [ ] Review GitHub issues, pull requests, comments, attachments, release assets, workflow logs,
    workflow artifacts, and other metadata that could become visible; remove or remediate sensitive
    content as needed.
  - [ ] Inspect published artifacts and container images for private data, credentials, and sensitive
    build material; use synthetic or explicitly approved public examples.
  - [ ] Remove exposed secrets and private material from all applicable locations, rotate or revoke
    exposed credentials, and recheck the release candidate and relevant history. Follow
    [GitHub's sensitive data removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
    and account for cached copies, forks, and other exposure paths.
  - [ ] Review the actual consequences and settings of a visibility change using
    [GitHub's visibility guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).

- [ ] **Establish project rights and licensing**
  - [ ] Add AGPL-3.0 for Your Space (server, web client, CLI, and desktop app) and Apache-2.0 for the
    SDKs, with license files and headers where needed.
  - [ ] Have a lawyer review the license setup, trademark, and contributor agreement before publication.
  - [ ] Clear and file the "Your Space" trademark, and publish a short trademark policy for forks.
  - [ ] Set up a contributor license agreement, enforced on pull requests, before accepting outside
    contributions.
  - [ ] Verify every shipped dependency's license is compatible with AGPL-3.0 distribution, and the SDKs'
    dependencies with Apache-2.0.
  - [ ] Keep managed-service code in a separate private repository that integrates through the core's APIs.
  - [ ] Review ownership and permission to publish project code, documentation, assets, and generated
    material, including contributions and any imported material.
  - [ ] Inventory shipped dependencies, container images, and imported, vendored, or generated
    material, including Spec Kit files; review their licenses and satisfy applicable attribution,
    notice, and redistribution obligations.
  - [ ] Document the project's license and any third-party notices in their appropriate locations;
    consult [GitHub's licensing guidance](https://docs.github.com/en/enterprise-cloud@latest/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).

- [ ] **Review security and operational defaults**
  - [ ] Review the threat model and trust boundaries for setup, authentication, remote access,
    recovery, deployment secrets, and persistent storage; track and resolve release blockers.
  - [ ] Verify password hashing, session and recovery credential protections, failed-attempt limits,
    and safe handling of secrets in ordinary logs, configuration, and public errors.
  - [ ] Review default network exposure, access to operator commands and setup credentials, encrypted
    remote access, and the documented deployment's configuration for supported environments.
  - [ ] Verify the server, CLI, and desktop app send no telemetry, make no automatic outbound
    requests other than update checks, and stop update checks when the owner turns them off.
  - [ ] Review dependencies and container images for known vulnerabilities, remediate release
    blockers, and document accepted risks and how updates are monitored.
  - [ ] Publish a private vulnerability reporting channel and a realistic response policy, including
    how users can report security issues without exposing them publicly.
  - [ ] Complete a security hardening pass on the boundaries between apps and the workspace: review
    them, enforce them, test them, and protect users as far as Your Space reasonably can.

- [ ] **Prepare a usable project and contributor experience**
  - [ ] Write a README that explains the product, release maturity, supported capabilities and
    environments, prerequisites, installation entry point, and known limitations. State that Your
    Space collects no telemetry and that update checks to GitHub are its only automatic outbound
    requests.
  - [ ] Provide accurate installation, configuration, restart, remote access, troubleshooting,
    owner recovery, and uninstall guidance for the actual release.
  - [ ] Document where durable data lives, and how to back up, restore, and move a workspace
    between installations with the CLI.
  - [ ] Explain local development, tests, contribution and review expectations, issue reporting,
    maintainer support expectations, and where to find the roadmap and security policy.
  - [ ] Decide and publish the project's community participation expectations and contact paths.
  - [ ] Walk through the instructions from a clean environment, preferably with a person who did
    not write them; resolve confusing or broken steps.

- [ ] **Prove and polish the release**
  - [ ] Run automated build, lint, type and meaningful behavior checks in CI for the release candidate.
  - [ ] Test security-sensitive behavior, data integrity, recovery, startup and restart failures, and
    the owner journey against the documented environment matrix; record versions and results.
  - [ ] Check the web experience for keyboard access, labels, focus, readable errors, and usable
    layouts on supported screen sizes; track and resolve release-blocking accessibility problems.
  - [ ] Check setup, loading, empty, disconnected, and error states for understandable guidance and
    truthful representation of the system's state.
  - [ ] Build and identify versioned release artifacts and images, verify installation uses the
    intended versions, and document their source and integrity verification where available.
  - [ ] Define the initial upgrade and rollback policy, including schema migrations and data safety;
    test supported paths and document unsupported transitions. The first release must include the
    owner-triggered app update path and the CLI's Your Space update path, both with automatic rollback
    of failed updates.
  - [ ] Record test evidence, outstanding issues, accepted limitations, and any unsupported paths for
    the exact release candidate.

## First Public Product Scope

These areas capture the scope agreed so far for the first public version. Their detailed requirements
belong in their own specifications; the scope remains subject to the ongoing interview.

- [ ] **CLI installation and management**
  - [ ] Specify and implement the supported commands and CLI distribution for the established
    Compose deployment, including installation, prerequisite handling, and management scope. Provide
    at least install, start, stop, status, logs, update Your Space, owner password recovery, backup,
    restore, and uninstall.
  - [ ] Verify uninstall removes Your Space and every app container it manages, keeps data by default,
    and deletes data only after explicit confirmation with a backup offered first.
  - [ ] Verify a failed Your Space update through the CLI automatically restores the previous
    versions and the pre-update data snapshot.
  - [ ] Verify owner-only backup and restore through the CLI for local and remote installations,
    including members' accounts, credentials, and app data, and restore into a fresh installation.
  - [ ] Verify moving a local workspace to a server through backup and restore, and that the desktop
    app backs up and restores a local workspace through the same CLI operation.
  - [ ] Verify the CLI drives Docker Compose for both local and server installations on macOS,
    Windows, and Linux, and that the desktop app drives it in local mode.
  - [ ] Test the CLI on each claimed host for initial setup, repeat invocation, failures, and
    preservation of existing configuration and data; document manual alternatives and limitations.
  - [ ] Verify the guided installation is usable by someone comfortable installing Docker and following a CLI.
  - [ ] Verify HTTPS through the built-in proxy with automatic certificates for a domain, the
    bring-your-own-proxy option, and the documented tunnel path; verify PWA installation and secure
    session cookies work on each.

- [ ] **Additional members and signup**
  - [ ] Let the owner create invitation links and share them directly so recipients can sign up and join.
  - [ ] Verify membership and access controls while preserving existing owner, account, and workspace identities.
  - [ ] Let the owner assign app roles to human members.
  - [ ] Verify member password recovery with the signup recovery code, and with an owner-issued
    temporary password that must be replaced at next sign-in; both revoke existing sessions.
  - [ ] Verify removing a member immediately revokes their sessions, app roles, and their agents'
    access, including existing app sessions and credentials; their agents are disabled, not deleted.
  - [ ] Verify past app activity still identifies former members and deleted agents.
  - [ ] Document and test invitation, signup, and recovery paths; detailed invitation and signup rules remain open.

- [ ] **Workspace clients on web, desktop, and PWA**
  - [ ] Provide the same core workspace and installed-app experience on web, desktop, and installable
    PWA clients.
  - [ ] Ship and test the Electron desktop app on macOS, Windows, and Linux. Support server hosts on
    macOS and Linux; on Windows, support the desktop app and a local workspace through Docker Desktop.
  - [ ] Verify release builds are signed in CI: macOS with an Apple Developer ID and notarization,
    Windows through SignPath or Microsoft Artifact Signing. Verify a downloaded macOS build opens with
    the standard prompt and updates itself.
  - [ ] Verify the desktop app can connect to an existing server by URL, or set up, run, and connect to
    a local Your Space Docker Compose stack on the same machine through the CLI.
  - [ ] In local mode, verify Docker detection with a download link when missing, stack startup when
    the app opens, and owner-triggered Your Space updates.
  - [ ] Verify the desktop app completes local-mode owner setup by submitting the setup code from the
    CLI on the user's behalf, through the same setup flow as every other installation.
  - [ ] Document that a local workspace is unavailable to others while its machine is asleep or off,
    and state the Docker Desktop license terms.
  - [ ] Verify supported clients connect to the same workspace and handle authentication and failures;
    a connection to the server is required.
  - [ ] Define and test supported devices, platforms, installation and accessibility expectations.

  Desktop packaging, self-update, and PWA offline behavior remain open.

- [ ] **Independent apps and developer integration**
  - [ ] Specify and implement the versioned app integration and SDK contract needed by the journey;
    keep the app independently built, running, and maintained in its own repository.
  - [ ] Let only the owner install and remove apps; support installing apps from public GitHub
    repositories by pasting the deployment file's URL in the workspace UI. Private repository
    support is post-public.
  - [ ] Read the deployment file at the pasted URL and record the exact repository revision used for
    installation; verify updates re-read the file from the same URL.
  - [ ] Require published container images with exact images and versions declared in the app's
    integration files, including declared database services; verify the installed image identities
    match those declarations and are retained with installation provenance.
  - [ ] Let the owner trigger updates of installed apps; verify app data is preserved, the installed
    revision and image provenance reflect the update, and additional access requires explicit approval.
  - [ ] Read the app's name and requested access from the `x-your-space` section of its Compose
    file.
  - [ ] Accept only Compose settings on an approved list, starting with what the first app needs;
    verify unlisted settings and settings that would break app isolation, such as host folder
    mounts, devices, privileged mode, or host networking, are rejected.
  - [ ] Back up app data and record image versions before each update; verify a failed update
    automatically restores the previous image versions and the pre-update data.
  - [ ] Have Your Space manage each app's Docker container or containers on the server host, including
    an app-declared database service when needed. Apps integrate with Your Space through APIs.
  - [ ] Isolate apps from host folders, devices, and Docker controls; verify the boundary for the
    supported deployment path and do not assume containers alone make untrusted code safe.
  - [ ] Warn the owner at installation, and state in the documentation, that an installed app is
    trusted with its own data; Your Space protects itself and other apps but is not a sandbox for
    hostile code.
  - [ ] Provide persistent app-specific storage; keep data after uninstall and allow the owner to
    explicitly delete retained data through an administration UI.
  - [ ] Install the Tasks app as the first independent app, exercise its core workflow inside the
    Your Space interface, and verify its data survives a supported restart.
  - [ ] Enable a developer to create or adapt and install an additional independent app using the
    documented SDK and contracts; validate the process beyond the first app.
  - [ ] Publish TypeScript and Python SDKs and verify each with a working app.
  - [ ] Review and test the app isolation, source and version provenance, and installation trust
    boundaries for the supported installation path.
  - [ ] Document app developer integration and the supported example, including compatibility,
    limitations, and any intentionally deferred distribution or update functionality.

  Published images are the only first-release installation path. Building apps from source during
  installation is explicitly [post-open-source
  work](roadmap.md#post-public-later-direction-and-enhancements). Owner-triggered app updates with
  automatic rollback of failed updates are required before publication; automatic app updates, backup
  history, and manual rollback are post-open-source. The deployment file is a Docker Compose file;
  alternative formats are post-open-source. App details go in an `x-your-space` section of that file.
  The approved list of Compose settings is set when the first app is implemented. The section's
  contents, image identity validation, owner-triggered update mechanics, and failed-update detection
  remain open.

- [ ] **External agent access**
  - [ ] Implement external-agent access to the installed app through the supported identity and role integration.
  - [ ] Verify human and external agent identity, app-owned authorization, distinct actor attribution,
    and exact-subset role delegation.
  - [ ] Verify denied actions through UI and programmatic access, and removal of delegated roles and
    access through existing app sessions and credentials.
  - [ ] Review and test agent credential handling and revocation for the supported integration.
  - [ ] Verify agents reach apps only through the Your Space gateway: app containers are not reachable
    directly, and the gateway rejects unauthenticated, undelegated, and revoked requests.
  - [ ] Verify an agent can use the installed app's actions through the Your Space CLI against local
    and remote servers.

## Product Release Decision

- [ ] **Approve the product release**
  - [ ] Review checklist evidence for the release candidate, confirm the chosen scope, and resolve
    blockers or record explicitly accepted limitations and follow-up owners.
  - [ ] Review repository configuration, access, branch protections, security reporting, release
    assets, and public-facing metadata for the intended public state.
  - [ ] Record the launch decision and release reference. If the source is still private, complete
    the separate early-publication checks and obtain authorization before changing visibility.
