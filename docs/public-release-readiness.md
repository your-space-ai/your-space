# Public open-source release readiness

## Release Scope and Promise

One owner can download the macOS app, choose a local Docker workspace or an existing server, and apply an installation kit in the selected dashboard. A headless Docker installation and browser access also remain supported. The owner decides what an AI agent can do in a connected app. The [roadmap](roadmap.md) tracks product scope and the [spec map](spec-map.md) assigns the work.

## First Public Product Scope

- [ ] Verify a clean local installation and a server installation from the published candidate artifacts. Record host, CPU, Docker/Compose and browser versions.
- [ ] Test the versioned [Apple Silicon and Intel DMGs](../specs/008-desktop-entry/spec.md) on clean supported Macs. Download each release asset, verify its checksum, Developer ID signature, stapled notarization tickets and Gatekeeper assessment, drag Your Space to Applications in Finder, eject the image and launch the installed copy. Record each asset, processor and macOS version tested.
- [ ] From local setup, use a detected Docker engine and repeat with an owner-selected engine. Verify guidance and retry for a missing or stopped engine, then start the stack and complete the existing owner setup.
- [ ] On a Mac without Docker, choose the existing-server path and sign in to a verified HTTPS workspace. From each desktop path, review and confirm an installation kit, then open the app on the chosen workspace.
- [ ] Verify owner claim, sign-in, restart and recovery. Open the dashboard on localhost, behind an existing proxy, and at a domain with a real certificate.
- [ ] Install and open an independent app. Use the web UI to create an agent and grant access to a supported app action.
- [ ] Repeat the [002 installation and isolation checks](../specs/002-install-an-app/tasks.md) on the release candidate. Verify digest pins and source provenance, owner confirmation and secrets, resource limits, network boundaries and persistent app storage.
- [ ] Run a real external AI agent through the gateway. Capture the app result and attribution. Verify denial outside the grant, loss of access after a role change, rotation, and revocation.
- [ ] Link the public roadmap and document supported integrations, storage, recovery and release limitations.

## Early Source Publication: Building in Public

Prepare a quiet developer preview from source, with the local Docker quickstart as its entry point. Complete the publication checks below and obtain the owner’s decision before changing visibility. The tagged desktop and server downloads follow the product release checks.

- [ ] **Prepare the repository for public development**
  - [ ] Review repository history, branches, tags, commit identities, issues, PRs, logs, artifacts,
    and other potentially public material for private data and secrets; remediate findings and
    rotate or revoke exposed credentials where needed.
    On 2026-11-21 the repository review covered the four-PR candidate, 421 reachable commits across
    branches and pull request refs, and the GitHub discussions, revision history and retained Actions
    artifacts available at the start of the review. The only secret scanner matches in Git were
    two verified test fixture values. The owner accepted historical Git email attribution.
    The historical preview builds and browser reports were removed from Actions. The repository
    listed zero retained artifacts after cleanup. External session links were removed from the
    affected pull request descriptions and remain in their edit histories. Review the exposure of
    those edits and access to third-party reports before changing visibility.
  - [x] Keep AGPL-3.0-only and the DCO for the quiet source preview. The owner approved proceeding without counsel review on 2026-11-21.
  - [ ] Confirm publication rights for existing material, add the selected project licenses, and meet
    applicable third-party license and notice obligations.
  - [ ] Explain the project's purpose, current state, unimplemented functionality, and participation
    expectations in the README, with links to the roadmap and relevant development instructions.
  - [ ] Review the security and safe-use implications of any runnable code and provide a private
    security reporting route appropriate to the project state. The [security policy](../SECURITY.md)
    and [Code of Conduct](../CODE_OF_CONDUCT.md) list separate project email aliases for private
    reports.
  - [ ] Confirm the Compose setup checks run on each layer of a public pull request stack. The
    workflow limits this check to the bottom layer while the repository is private.
  - [ ] On a public fork, confirm the required **Contribution checks** status runs the synthetic
    Chromium journeys and the DCO check. Verify outside-run approvals and repository protection
    while the subscription-backed review workflow stays disabled. The product release checklist tracks external
    visual comparison and an open-source review service.
  - [ ] Review public repository settings and the effects of publication, then authorize the visibility
    change separately. Making source public does not imply a supported or production-ready product.

## Public Release Readiness Work

The following work supports the intended usable public release. If an earlier source-only publication
is chosen instead, explicitly decide which items apply and describe what is not ready to use.

- [ ] **Install and use the owner workspace**
  - [ ] Implement the owner-access specification and its manual Docker Compose pathway, including
    owner creation by a server command with the password set in the browser, one owner and
    workspace, sign-in, sign-out, and server-enforced access.
  - [ ] Document and test installation from a clean state on each claimed host and architecture,
    including prerequisites, configuration, startup, and actionable failure handling.
  - [ ] Verify that only the operator's server command can create the owner, that set-password links
    are single-use and expire, that concurrent runs and reruns create no duplicates, and that
    network-only attempts to create an account are denied.
  - [ ] Verify protected requests are denied without valid authentication, including direct API
    requests; test session expiry, sign-out, and invalidation.
  - [ ] Verify the platform session uses host-only cookies that are not sent to app origins, and a
    `__Host-` cookie over HTTPS that apps can't set or overwrite (spec 002).
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
  - [ ] Verify the shipped release includes the AGPL-3.0-only license and notices. The MIT SDK license applies when SDKs ship under journey 007.
  - [ ] Have a lawyer review the license setup, trademark, and contributor terms (DCO) before the packaged release. The owner waived counsel review for the earlier source preview.
  - [ ] Clear and file the "Your Space" trademark, and publish a short trademark policy for forks.
  - [ ] Require a DCO sign-off before publication, enforced on pull requests from outside contributors
    by the contribution workflow. A maintainer verifies the required check on a public fork.
    **Replaced (2026-11-16):** "Set up a contributor license agreement…". See the
    [2026-11-16 decision update](architecture/decisions.md#project-license-and-business-model).
  - [ ] Verify the licenses and notices of dependencies shipped in the AGPL-3.0-only release.
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
  - [ ] Verify the shipped server, CLI, and web client send no telemetry, make no automatic outbound
    requests other than update checks and the built-in proxy's certificate requests for an
    owner-configured domain, and stop update checks when the owner turns them off.
  - [ ] Review dependencies and container images for known vulnerabilities, remediate release
    blockers, and document accepted risks and how updates are monitored.
  - [ ] Publish a private vulnerability reporting channel and a realistic response policy, including
    how users can report security issues without exposing them publicly.
  - [ ] Complete a security hardening pass on the boundaries between apps and the workspace: review
    them, enforce them, test them, and protect users as far as Your Space reasonably can.

- [ ] **Prepare a usable project and contributor experience**
  - [ ] Write a README that explains the product, release maturity, supported capabilities and
    environments, prerequisites, installation entry point, and known limitations. State that Your
    Space collects no telemetry and that update checks to GitHub and the built-in proxy's
    certificate requests for an owner-configured domain are its only automatic outbound requests.
  - [ ] Provide accurate installation, configuration, restart, remote access, troubleshooting,
    owner recovery, and uninstall guidance for the actual release.
  - [ ] Document where durable data lives, which files and volumes to protect, and which recovery procedures have been tested.
  - [ ] Explain local development, tests, contribution and review expectations, issue reporting,
    maintainer support expectations, and where to find the roadmap and security policy.
  - [ ] Decide and publish the project's community participation expectations and contact paths.
  - [ ] Confirm the Compose setup checks run on each layer of a public pull request stack. The
    workflow limits this check to the bottom layer while the repository is private.
  - [ ] Give pull requests from forks screenshots in Argos: CircleCI doesn't pass `ARGOS_TOKEN` to
    them, so either run the browser tests for forks on GitHub Actions again, where Argos accepts a
    tokenless upload, or choose another fork-safe route (see the CircleCI e2e decision in
    [journey-based specifications](architecture/decisions.md#journey-based-specifications)).
  - [ ] Move AI code review from the Claude Code GitHub Action on the owner's subscription to the
    free open-source plan of Greptile or CodeRabbit, so pull requests from forks are reviewed too
    (see the AI code review decision in [journey-based specifications](architecture/decisions.md#journey-based-specifications)).
  - [ ] Walk through the instructions from a clean environment, preferably with a person who did
    not write them; resolve confusing or broken steps.

- [ ] **Prove and polish the release**
  - [ ] Run automated build, lint, type and meaningful behavior checks in CI for the release candidate.
  - [ ] Test security-sensitive behavior, data integrity, recovery, startup and restart failures, and
    the owner journey against the documented environment matrix; record versions and results.
  - [ ] Check desktop setup and the web experience for keyboard access, labels, focus, readable errors, and usable
    layouts on supported screen sizes; track and resolve release-blocking accessibility problems.
  - [ ] Check setup, loading, empty, disconnected, and error states for understandable guidance and
    truthful representation of the system's state.
  - [ ] Build and identify versioned release artifacts and images, verify installation uses the
    intended versions, and document their source and integrity verification where available.
  - [ ] Define the initial upgrade and rollback policy, including schema migrations and data safety;
    test supported paths and document unsupported transitions. Automated update and rollback tooling is scheduled after publication.
  - [ ] Verify Your Space images run on ARM (including Apple Silicon) and Intel/AMD hosts.
  - [ ] Record test evidence, outstanding issues, accepted limitations, and any unsupported paths for
    the exact release candidate.

## Product Release Decision

- [ ] **Approve the product release**
  - [ ] Review checklist evidence for the release candidate, confirm the chosen scope, and resolve
    blockers or record explicitly accepted limitations and follow-up owners.
  - [ ] Review repository configuration, access, branch protections, security reporting, release
    assets, and public-facing metadata for the intended public state.
  - [ ] Record the launch decision and release reference. If the source is still private, complete
    the separate early-publication checks and obtain authorization before changing visibility.

## Personal app creation

- [ ] Run a clean agent-led setup on a supported host and install an agent-built Home with a working authorized read.
- [ ] Connect a disposable GitHub account, install an authorized private repo and a kit URL, then fork, commit and confirm a compatible replacement using the release artifacts. Verify retained data and denied access after revocation.
