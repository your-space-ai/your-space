# Public Open-Source Release Readiness

**Status:** Proposed checklist; launch scope and readiness bar are not yet approved.

This checklist describes work to implement, prove, and polish before inviting people to use the
public open-source project. It is a proposed product release bar, not a statement that every item
is a legal prerequisite for making a repository public. A public source repository can exist before
the product is ready for general use; a reliable public alpha makes a stronger promise about the
journeys and environments it supports. Choose and describe that promise explicitly.

The [roadmap](roadmap.md) tracks product delivery, and the [architecture and product decisions](architecture/decisions.md)
record agreed direction. The [owner access specification under review](https://github.com/your-space-ai/your-space/pull/3)
defines the first feature's acceptance criteria. This checklist does not expand that specification;
new capabilities need their own specifications and implementation work.

## How to Use This Checklist

- Agree the release scope and intended audience before treating these proposed items as a gate.
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

- [ ] **Agree what the first public release means**
  - [ ] Choose whether the first public milestone is source availability, an owner-only alpha,
    an alpha including the CLI, or an end-to-end alpha including an independent app and external agents.
  - [ ] Record the intended users, release maturity, supported behaviors, and what is explicitly
    deferred; update the roadmap and decisions if the agreed direction changes.
  - [ ] Define supported operating system versions, CPU architectures, browsers, Docker/Compose
    versions, and local or remote deployment paths for the chosen milestone.
  - [ ] Define release blockers and who will accept remaining known limitations.

**Working proposal:** A public alpha demonstrating an independently installed Tasks app and an
external agent would prove the product's core idea end to end. This is a recommendation, not an
accepted scope or a change to the first owner-access specification. An earlier source-only or
owner-only release is also possible if its status and limitations are explicit. The CLI is the
agreed follow-up to the owner-access implementation; whether it must precede public release is open.

## Common Readiness Work

The following is a proposed bar for a usable public alpha. If an earlier source-only publication is
chosen, explicitly decide which items apply and describe what is not ready to use.

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
  - [ ] Select and add an open-source license compatible with the intended self-hosted and commercial
    managed offering; MIT is preferred but the license choice remains to be approved.
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
  - [ ] Review dependencies and container images for known vulnerabilities, remediate release
    blockers, and document accepted risks and how updates are monitored.
  - [ ] Publish a private vulnerability reporting channel and a realistic response policy, including
    how users can report security issues without exposing them publicly.

- [ ] **Prepare a usable project and contributor experience**
  - [ ] Write a README that explains the product, release maturity, supported capabilities and
    environments, prerequisites, installation entry point, and known limitations.
  - [ ] Provide accurate installation, configuration, restart, remote access, troubleshooting,
    owner recovery, and safe removal guidance for the actual release.
  - [ ] Document where durable data lives and how users can back it up and restore it; test the
    documented procedure and state its limitations.
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
    test supported paths or explicitly state when upgrading is unsupported.
  - [ ] Record test evidence, outstanding issues, accepted limitations, and any unsupported paths for
    the exact release candidate.

## Conditional Product Scope

Apply these areas only if the corresponding capability is included in the agreed public release.
Their detailed requirements belong in their own specifications.

- [ ] **CLI installation and management, if included**
  - [ ] Specify and implement the supported commands and CLI distribution for the established
    Compose deployment, including installation, prerequisite handling, and management scope.
  - [ ] Test the CLI on each claimed host for initial setup, repeat invocation, failures, and
    preservation of existing configuration and data; document manual alternatives and limitations.

- [ ] **Independent Tasks app and external agent journey, if included**
  - [ ] Specify and implement the versioned app integration and SDK contract needed by the journey;
    keep the app independently built, running, and maintained in its own repository.
  - [ ] Install the app through the supported path and create and view a task within the Your Space
    interface; verify the task survives a supported restart.
  - [ ] Verify human and external agent identity, app-owned authorization, distinct actor attribution,
    and exact-subset role delegation.
  - [ ] Verify denied actions through UI and programmatic access, and removal of delegated roles and
    access through existing app sessions and credentials.
  - [ ] Review and test the app isolation, credential handling, source and version provenance, and
    installation trust boundaries for the supported installation path.
  - [ ] Document app developer integration and the supported example, including compatibility,
    limitations, and any intentionally deferred distribution or update functionality.

## Launch Decision

- [ ] **Approve the release and publication**
  - [ ] Review checklist evidence for the release candidate, confirm the chosen scope, and resolve
    blockers or record explicitly accepted limitations and follow-up owners.
  - [ ] Review repository configuration, access, branch protections, security reporting, release
    assets, and public-facing metadata for the intended public state.
  - [ ] Obtain explicit authorization for the repository visibility change and record the launch
    decision and release reference before making the repository public.
