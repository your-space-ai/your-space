# Your Space roadmap

The first release is a personal web dashboard. One person runs Your Space on Docker, opens their apps in a browser, and gives an AI agent permission to do useful work in a connected app.

## Pre-public: Core Experience and First Working Version

### Overview

- Install and open the dashboard (001, 003)
  - Download a versioned release and follow one guide on a personal machine with Docker and Compose already installed.
  - Repeat on a Docker server.
- Connect an app (002)
  - Install and open an independent app from the web dashboard.
- Put one AI agent to work (005)
  - In the web UI, create a named agent, issue its own credential, and grant specific roles for one connected app.
  - Use an external AI agent through the CLI and gateway to complete one useful action in that app.
  - Remove the grant and retry with the existing session.
- Prepare the public release (gate)
  - Run the complete owner journey from a clean download on the supported hosts.
  - Close the security, privacy, licensing, documentation, and publication checks in the [release checklist](public-release-readiness.md).

### What is already on main

- Owner setup, sign-in, recovery, and durable workspace identity shipped in [001](../specs/001-workspace-owner-access/tasks.md).
- Independent app installation, isolation, and web panes shipped in [002](../specs/002-install-an-app/tasks.md). Subsequent changes added local Compose files, published-app framing, and complete removal ([PR 54](https://github.com/your-space-ai/your-space/pull/54), [PR 57](https://github.com/your-space-ai/your-space/pull/57)).
- The [003 CLI](../specs/003-install-with-the-cli/tasks.md) includes init/start, stop/status/logs, owner recovery, secret management, and domain/proxy configuration. Stored app settings are [encrypted](../specs/009-encrypt-stored-data/tasks.md). Real-domain and release-host checks remain open.

The [previous detailed delivery checklist](https://github.com/your-space-ai/your-space/blob/eb352241/docs/roadmap.md) preserves dated completions and their implementation PRs. Below, a check means the whole release outcome has been demonstrated.

- [ ] **Install and open the dashboard (001, 003)**
  - [ ] Download a versioned release and follow one guide on a personal machine with Docker and Compose already installed. Create the owner, sign in from localhost, restart, and recover access.
  - [ ] Repeat on a Docker server. Open the web UI over HTTPS from a second device, once behind an owner-managed proxy or tunnel and once at a domain using the built-in proxy and a real certificate.
- [ ] **Connect an app (002)**
  - [ ] Install and open an independent app from the web dashboard. Verify the documented real-source install and the browsers claimed for release. Identify which connected apps support agent actions.
- [ ] **Put one AI agent to work (005)**
  - [ ] In the web UI, create a named agent, issue its own credential, and grant specific roles for one connected app. The owner can inspect and change grants, rotate credentials, and revoke the agent.
  - [ ] Use an external AI agent through the CLI and gateway to complete one useful action in that app. Show the result and actual actor to the owner. Verify a disallowed action and access to an ungranted app are denied.
  - [ ] Remove the grant and retry with the existing session. Verify denial, then verify rotated and revoked credentials lose access. Document the supported app and action so another owner can repeat the example.
- [ ] **Prepare the public release (gate)**
  - [ ] Run the complete owner journey from a clean download on the supported hosts. Record the release candidate, verified configurations, and limitations.
  - [ ] Close the security, privacy, licensing, documentation, and publication checks in the [release checklist](public-release-readiness.md). Obtain the owner’s publication decision.

**Next implementation work:** Shape journey 005 around the first app and useful action. Verify the existing install and browser paths alongside that work.

## Post-public: Later Direction and Enhancements

These capabilities are not required for the first public release. Their order and timing remain open.

### Deferred from the first release

These journeys keep their numbers. Timing and order after publication are open.

- [ ] **004 · Invite a team.** Invitations, additional human accounts, member recovery and removal, and shared workspace administration.
- [ ] **006 · Maintain and move a workspace.** Guided backup, restore, migration, updates with rollback, and lifecycle automation. The first release still documents durable storage and how to protect data on supported installations.
- [ ] **007 · Build and connect more apps.** Public TypeScript and Python SDKs, developer tooling, and connectors for apps running elsewhere. The first agent-enabled app and its role enforcement belong to 005.
- [ ] **008 · Use a desktop client.** Native clients, bundled engine, signed installers and updates, and installable PWA. Additional packaging such as Homebrew and Windows distribution can follow demonstrated demand.

### Other later directions

- [ ] **Optional owner-configured email**

  **Deferred (2026-11-02):** [Sessions, persistence, and recovery](architecture/decisions.md#sessions-persistence-and-recovery).

  - [ ] Let the owner add their own email (SMTP) settings to enable email delivery.
  - [ ] Verify owner and member email addresses when email is configured.
  - [ ] Send password-reset links to verified addresses through the existing recovery mechanism.

  No installation requires email. The first public release needs a member recovery path that works without it.

- [ ] **Optional open sign-up**

  **Source:** [Authentication and initial claim](architecture/decisions.md#authentication-and-initial-claim).

  - [ ] Let the owner choose to allow people to sign up without an invitation.

  Until then, new people join only when the owner invites them.

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

  - [ ] Explore an app format other than Docker Compose if a real need surfaces, added as another
    importer for the app description.

  **Reworded (2026-11-14):** the first public release reads apps' own Compose files, with
  installation kits, instead of a Compose file with an `x-your-space` section.

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

## Maintaining the checklist

Keep the overview and spec map in step with the release checklist. Date each completed outcome and link its implementation and verification. Move deferred work into the post-public section and preserve its journey number and delivery history.
