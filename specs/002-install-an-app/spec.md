# Feature Specification: Install an App and Use It

**Feature Branch**: `002-install-an-app`

**Created**: 2026-11-12

**Status**: Draft for discussion. Nothing in it is delivered yet.

**Journey**: 002 "Install an app and use it", the second of eight journeys in the
[spec map](../../docs/spec-map.md)

**Input**: The owner installs an existing open-source app from its public GitHub repository and
uses it inside Your Space, without the app's authors changing anything. The first app is
[Sure](https://github.com/we-promise/sure), a personal finance app.

## At a Glance

- **Who:** the owner of a Your Space installation from journey 001.
- **Done when:** the owner pastes the link to Sure's Compose file, reviews what will run, confirms,
  and uses Sure in a pane inside Your Space. Sure keeps its data across restarts, reaches only the
  internet hosts the owner approved, and can be removed without losing its data.
- **Covers:** running apps' containers, installing from a GitHub link, adapting an app's own
  Compose file to Your Space's rules, generated secrets and settings, opening apps in panes on their
  own origins, access only through Your Space, outbound access approval, isolation, limits, status
  and logs, removal and retained data, and several apps side by side.
- **Not covered:** app updates (journey 006), external apps and the Python SDK (journey 007),
  native views in the desktop app (journey 008), and identity and roles for apps that integrate
  with Your Space (a later slice; see [Later: deeper integration](#later---deeper-integration)).
- **Next:** journey 003, whose CLI sets up HTTPS for the app origins this journey decides.

## Objective and Scope

An owner can install an app from a link to its Compose file in a public GitHub repository. Your
Space reads the file at an exact commit, adapts it to its rules or refuses it with reasons, shows
the owner what will run and the trust warning, and runs the app's containers on the same machine.
The owner opens the app in a pane inside Your Space, and only people signed in to Your Space can
reach it.

Apps are not written for Your Space. An app keeps its own interface, its own accounts and its own
data; Your Space runs it, protects the platform and other apps from it, and controls who can reach
it. Apps that want deeper integration (verified identity and roles from Your Space) are a later,
opt-in slice, so that any app with a published image and a Compose file can be installed.

This journey is delivered as a stack of pull requests, one per slice. Each slice ends with something
the owner can see working, tested end to end in the browser, and later slices build on it without
reworking it. The [slice plan](#slices-and-their-dependencies) orders them by what each needs.

The [constitution](../../.specify/memory/constitution.md), the
[decision record](../../docs/architecture/decisions.md) and the
[spec map](../../docs/spec-map.md)'s shared rules apply. Where this spec departs from the decision
record's accepted app direction, it says so in
[Changes to Shared Direction](#changes-to-shared-direction), and the decision record changes in the
first pull request.

## Slices and Their Dependencies

Your Space needs these components. Each slice brings in only what it uses.

| | Component | What it does | Needs |
| --- | --- | --- | --- |
| A | App records | Each installed app's source link, commit, adapted Compose file, pinned images and state | |
| B | Runtime manager | The only part of Your Space that holds the Docker engine connection: starts, stops, reports and removes one Compose project per app | A |
| C | Source fetch | Turns a GitHub link into one file at an exact commit | |
| D | Compose adapter | Reads the file, checks it against the approved list, adapts what it safely can, refuses the rest with reasons | |
| E | Image pinning | Resolves each image to an exact version available for both ARM and Intel/AMD | |
| F | Settings and secrets | Values for the file's variables; generates secrets; keeps them out of logs and output | A |
| G | Restart recovery | Brings apps back when Your Space starts, and corrects recorded state that no longer matches | A, B |
| H | Install jobs | Runs an install in the background and reports progress | A, B |
| I | Apps API | Owner-only endpoints to preview, install, list and manage apps | A, H |
| J | Apps UI | The Apps area: the list, the install flow, the trust warning, progress | I |
| K | App routing | Each app on its own origin through the built-in proxy, reached through its app endpoint | A, B |
| L | Access gate | Only people signed in to Your Space reach an app's origin | K |
| M | Panes | Your Space's navigation around the app in a pane | J, K, L |
| N | Outbound control | No outbound access by default; owner-approved hosts only | B, F |
| O | Limits and logs | Memory and CPU limits; per-service status and logs | B, J |
| P | Removal and retained data | Removing keeps data; deleting it is a separate, confirmed step | A, B, J |

```text
A ─┬─ B ─┬─ G
   │     ├─ H ── I ── J ──┬── M
   │     ├─ K ── L ───────┘
   │     ├─ N (with F)
   │     ├─ O (with J)
   │     └─ P (with J)
   └─ F
C, D and E feed the install.
```

| Pull request | Slice | Brings in | What the owner can see |
| --- | --- | --- | --- |
| Base | Spec and plan | | This specification, its plan and research, the decision record and the constitution changes |
| 1 | Run an app from a link | A, B, C, E, G; D for a small fixture app | A server command installs a small app from a GitHub link; it runs, and comes back after a restart |
| 2 | Run Sure | D; F's generated secrets | The same command runs Sure's web, worker, database and Redis services |
| 3 | Apps in Your Space | H, I, J | An Apps area lists Sure and its state; installing from the UI with a review and trust warning |
| 4 | Open an app | K, L, M | Sure opens in a pane on its own origin, reachable only through Your Space |
| 5 | Change settings | F | The owner changes Sure's settings, such as an AI key; Sure restarts with them |
| 6 | Outbound access | N | Sure starts with no internet access; the owner approves the hosts its features need |
| 7 | Isolation, tested | | Tests show an app can't reach the platform, other apps or the host |
| 8 | Limits, status and logs | O | Limits, per-service status and logs, behind an advanced view |
| 9 | Remove and delete data | P | Removing keeps the data; deleting it is its own confirmed step |
| 10 | A second app, side by side | | Two apps side by side, one in its own tab, and the phone layout |

The spec pull request is the base of the stack; each slice after it is one pull request, and the
user stories below are numbered to match the slices.

## User Scenarios & Testing

### User Story 1 - Run an App From a Link (Priority: P1)

As the operator, I can give Your Space the GitHub link to an app's Compose file, and Your Space runs
the app's containers on this machine and keeps them running across restarts.

**Why this priority**: Everything else in this journey depends on Your Space running containers
safely. Controlling Docker is the most security-sensitive part of the journey, so it comes first and
on its own.

**Independent Test**: In a running stack, run the install command with the link to a small fixture
app's Compose file, check its status, restart the stack, and check it again.

**Acceptance Scenarios**:

1. **Given** a running Your Space with an owner, **When** the operator runs the install command with
   the GitHub link to a public repository's Compose file, **Then** Your Space records the file at the
   exact commit the link resolves to, pins each image to an exact version, starts the app's
   containers, and reports the app as running.
2. **Given** an installed app, **When** the operator lists apps, **Then** each app's name, source,
   commit and state are shown, and the state matches what is running.
3. **Given** an installed app, **When** Your Space is restarted or the stack is recreated with
   `docker compose down` and `up`, **Then** the app comes back with the same data.
4. **Given** Your Space is stopped, **When** the operator checks the engine, **Then** none of the
   apps it manages is running, and containers it doesn't manage are untouched; **When** Your Space
   starts again, **Then** its apps come back.
5. **Given** a link that isn't a public GitHub file, a file that isn't Compose, or an image missing
   for this machine's architecture, **When** the operator runs the install command, **Then** nothing
   is installed, nothing runs, and the message says what is wrong.
6. **Given** two installs of apps with the same service names, **When** both run, **Then** their
   containers, networks and volumes don't collide.

### User Story 2 - Run Sure (Priority: P1)

As the operator, I can install Sure from the link to its own `compose.example.yml`, which its authors
wrote for running by hand, and Your Space adapts it, generates its secrets and runs every service.

**Why this priority**: Real apps' Compose files are written for people, not for Your Space. Running
one unchanged is the point of the journey.

**Independent Test**: Run the install command with the link to Sure's `compose.example.yml` and
check that its web, worker, database and Redis services are running and healthy.

**Acceptance Scenarios**:

1. **Given** the link to Sure's Compose file, **When** the operator installs it, **Then** Your Space
   reports what it changed (for example the published port, moving image tags and the fixed DNS
   servers) and what it left out (for example the backup services behind profiles, which mount host
   folders), and runs the rest.
2. **Given** the file sets a secret's default in plain text (Sure's `SECRET_KEY_BASE` and
   `POSTGRES_PASSWORD`), **When** Your Space installs it, **Then** it generates a new value for each
   and never uses the published default.
3. **Given** a running Sure, **When** its services start, **Then** they start in the order the file's
   health conditions require, and its database and Redis data live in named volumes.
4. **Given** the install output and Your Space's logs, **When** they are read, **Then** no generated
   secret appears in them.
5. **Given** a Compose file with a setting Your Space can neither allow nor adapt, such as a
   privileged container or a host device, **When** the operator installs it, **Then** nothing is
   installed and the message names the setting and why it isn't allowed.

### User Story 3 - Apps in Your Space (Priority: P1)

As the owner, I can see my apps in Your Space and install one by pasting its link, reviewing what
will run, and confirming after a clear trust warning.

**Why this priority**: The owner manages apps in Your Space, not on the command line.

**Independent Test**: Sign in, open Apps, paste Sure's link, review and confirm, and watch it reach
running.

**Acceptance Scenarios**:

1. **Given** a signed-in owner, **When** they open Apps, **Then** they see each installed app and its
   state, or that no app is installed yet.
2. **Given** the owner pastes a link, **When** Your Space has read the file, **Then** it shows the
   app's services, the images and versions it will run, what it changed and left out, the settings it
   needs, and the warning that installing an app trusts it with its own data.
3. **Given** the review, **When** the owner confirms, **Then** the install runs in the background and
   the page shows its progress, including image downloads, until the app is running or the install
   fails with a reason.
4. **Given** an install in progress, **When** the owner closes the page or the server restarts,
   **Then** the install either finishes or ends in a clear failed state; it is never left reported as
   running when it isn't.
5. **Given** a person who isn't signed in, or a request made directly to the API, **When** they try
   to install or list apps, **Then** they are refused and nothing changes.
6. **Given** a signed-in owner, **When** they open the Engine page, **Then** they see the engine
   connection Your Space uses, whether it is reachable, its version and its resources. Controls
   for an engine Your Space provides itself (starting, stopping and sizing its virtual machine)
   arrive with that virtual machine in journey 003 or 008.

### User Story 4 - Open an App (Priority: P1)

As the owner, I can open an installed app in a pane inside Your Space, with Your Space's navigation
around it, and only people signed in to Your Space can reach the app.

**Why this priority**: This is where the owner actually uses the app.

**Independent Test**: Install Sure, open it from Apps, sign up in Sure inside the pane, and use it;
then try to reach Sure's address while signed out of Your Space.

**Acceptance Scenarios**:

1. **Given** a running app, **When** the owner opens it, **Then** it loads in a pane on its own
   origin, separate from Your Space's and from other apps', with Your Space's navigation still
   available.
2. **Given** Sure in a pane, **When** the owner signs up or signs in to Sure there, **Then** Sure's
   own accounts and sessions work inside the pane.
3. **Given** someone not signed in to Your Space, **When** they open an app's address directly,
   **Then** they are sent to Your Space's sign-in and reach no part of the app.
4. **Given** an app whose interface can't run in a pane, **When** the owner opens it, **Then** it
   opens in its own tab, behind the same access check.
5. **Given** each setup from journey 001 (this machine, your own domain, your own proxy or
   Tailscale), **When** the owner opens an app, **Then** its address works there.
   [NEEDS DISCUSSION: app origins per setup; see Q5]

### User Story 5 - Change an App's Settings (Priority: P2)

As the owner, I can see and change an app's settings, such as adding an AI provider's key to Sure,
and Your Space applies them by restarting the app.

**Independent Test**: Add a value to one of Sure's optional settings, and check that Sure restarted
with it while generated secrets stayed hidden.

**Acceptance Scenarios**:

1. **Given** an installed app, **When** the owner opens its settings, **Then** they see the settings
   its Compose file reads, with their current values, and secrets shown only as set or not set.
2. **Given** the owner changes a setting, **When** they save, **Then** Your Space restarts the
   affected services with the new value and keeps the app's data.
3. **Given** a secret, **When** the owner replaces it, **Then** the new value is stored and never
   shown again, and replacing a generated secret warns what it may break.

### User Story 6 - Approve Outbound Access (Priority: P2)

As the owner, I decide which internet hosts an app can reach. It reaches none until I approve them.

**Independent Test**: With Sure installed and no hosts approved, check that it can't reach the
internet; approve one host and check that only that host is reachable.

**Acceptance Scenarios**:

1. **Given** a newly installed app, **When** it tries to reach the internet, **Then** the request
   fails, and Your Space shows that it was blocked.
2. **Given** the owner approves a host for an app, **When** the app reaches it, **Then** it succeeds,
   and every other host still fails.
3. **Given** an approved host, **When** the owner removes it, **Then** the app can no longer reach it.

[NEEDS DISCUSSION: how the owner learns which hosts an app needs when its authors don't declare
them; see Q7]

### User Story 7 - Isolation, Tested (Priority: P1)

As the owner, I can trust that an installed app can't reach Your Space's own data, other apps or the
host, even if the app misbehaves.

**Independent Test**: A test app tries each boundary, and each attempt fails.

**Acceptance Scenarios**:

1. **Given** an installed app, **When** it tries to reach Your Space's database, server, secrets or
   the runtime manager, **Then** it can't.
2. **Given** two installed apps, **When** one tries to reach the other's containers or volumes,
   **Then** it can't.
3. **Given** an installed app, **When** it tries to reach host folders, devices or Docker, **Then** it
   can't.
4. **Given** a Compose file that asks for any of these, **When** it is installed, **Then** it is
   refused with the reason.

### User Story 8 - Limits, Status and Logs (Priority: P2)

As the owner, I can see each app's services, their state and their logs, and one app can't use up
the machine.

**Acceptance Scenarios**:

1. **Given** an installed app, **When** the owner opens its details, **Then** they see each service's
   state, and its recent logs behind an advanced view.
2. **Given** an app that uses too much memory, **When** it reaches its limit, **Then** only that app
   is affected, and its state says why it stopped.
3. **Given** the default limits, **When** the owner changes an app's limits, **Then** the app restarts
   with them. [NEEDS DISCUSSION: default limits and whether the owner can change them in this
   journey; see Q9]

### User Story 9 - Remove an App and Delete Its Data (Priority: P2)

As the owner, I can remove an app without losing its data, and delete its data separately when I
choose.

**Acceptance Scenarios**:

1. **Given** an installed app, **When** the owner removes it, **Then** its containers and networks
   are gone and its data is kept, listed as retained data.
2. **Given** retained data, **When** the owner installs the same app again, **Then** Your Space offers
   to reuse it, and the app comes back with its data.
3. **Given** retained data, **When** the owner deletes it and confirms, **Then** it is gone, and Your
   Space says this can't be undone before it happens.

### User Story 10 - Several Apps Side by Side (Priority: P3)

As the owner, I can install a second app and use both, side by side on a larger screen, one at a
time on a phone.

**Acceptance Scenarios**:

1. **Given** two installed apps, **When** the owner opens both, **Then** they show side by side on a
   larger screen, each in its own pane and origin.
2. **Given** a phone-sized screen, **When** the owner opens an app, **Then** it fills the screen, and
   Your Space's navigation still switches between apps.
3. **Given** any app, **When** the owner chooses to open it in its own tab, **Then** it does, behind
   the same access check.

### Later - Deeper Integration

Not part of this journey's delivery. Apps that choose to integrate could receive the signed-in
person's verified identity and app roles from Your Space, through the TypeScript SDK, instead of
running their own accounts. This waits until several unmodified apps run, so the integration fits
real apps. Journey 004 (members and their app roles) and 005 (agents) depend on what it decides.
[NEEDS DISCUSSION: see Q11]

### Edge Cases

- The GitHub link points to a branch that moves after install; the install keeps the exact commit
  it read.
- GitHub or the image registry is unreachable or rate-limits the request during install.
- An image's tag exists only for one architecture, or its digest changes between preview and
  install.
- An install is interrupted during an image download, or by a server restart.
- The machine runs out of disk during an install.
- A Compose file uses features Your Space reads but doesn't run: profiles, `extends`, `include`,
  `build`, YAML anchors and `x-` sections, and `${VAR:-default}` and `${VAR:?error}` placeholders.
- Two apps ask for the same service names, volume names or ports.
- An app's interface sends headers that forbid framing, or sets cookies that a pane blocks.
- Docker itself is restarted while apps run.
- The owner removes an app during its install.

## Requirements

### Functional Requirements

**Running apps (slices 1 and 2)**

- **FR-001**: Only the runtime manager may hold the Docker engine connection. The web-facing server
  must not hold it, and nothing reachable from an app or the network may reach the runtime manager.
- **FR-001a**: Your Space runs apps through one Docker engine connection, in Docker's standard
  forms (a local socket, `ssh://`, or `tcp://` with TLS). It is found without configuration and can
  be overridden with one setting. Your Space's behavior must not depend on where the engine runs:
  on the host, in a virtual machine Your Space provides, or elsewhere. Docker Desktop is not
  required; any Docker-compatible engine of version 28 or newer works.
- **FR-002**: Each installed app must run as its own Compose project, with its own network and named
  volumes, so apps can't collide with each other or with Your Space.
- **FR-003**: An install must record the source link, the exact commit it resolved to, the adapted
  Compose file, each image's exact version, and the actor who installed it.
- **FR-004**: Every image must be pinned to an exact version. An image missing for the machine's
  architecture must stop the install with a clear message. [NEEDS DISCUSSION: require both ARM and
  Intel/AMD, or only this machine's; see Q4]
- **FR-005**: Your Space must accept only Compose settings on an approved list. It may adapt a setting
  only by a documented rule, and must refuse the install with reasons for anything else.
- **FR-006**: Secrets that the file sets in plain text must be replaced with generated values, and
  generated values must never appear in output, logs or the review. [NEEDS DISCUSSION: how Your
  Space recognizes a secret; see Q3]
- **FR-007**: Apps must come back when Your Space starts, and Your Space must not report a state that
  doesn't match what is running.
- **FR-008**: Your Space and the apps it manages start and stop as one unit: stopping Your Space
  stops its apps, and starting it brings them back. Containers on the same engine that Your Space
  doesn't manage are never touched.
- **FR-008a**: Clients don't change app state. Closing the web client or, later, the desktop app
  leaves apps as they are; only someone allowed to manage apps (the owner in this journey) starts
  or stops them.
- **FR-009**: The install command must support scripted use (machine-readable output and exit
  status), as `create-owner` does, so journey 003's CLI can wrap it.

**Managing apps in Your Space (slice 3)**

- **FR-010**: Only the owner may install, change or remove apps in this journey, enforced by the
  server whatever the interface shows.
- **FR-011**: The review must show the services, images and versions, adaptations and omissions,
  settings, and the trust warning before anything is downloaded or run.
- **FR-012**: Installs must run in the background with visible progress, and end in running or a
  clear failure, including after a server restart.
- **FR-012a**: An Engine page shows the engine connection's status, version and resources, whatever
  kind of engine it is.

**Opening apps (slice 4)**

- **FR-013**: Each app's interface must run on its own origin, separate from Your Space and from other
  apps.
- **FR-013a**: Your Space reaches each app's interface through an app endpoint. Routing, the app
  origin, the access gate and panes must depend only on the endpoint, not on how it is reached. In
  this journey the only endpoint is a container on Your Space's engine; later endpoint types (an
  app on another engine, or an app someone already runs, reached through a connector) add to it
  without changing these.
- **FR-014**: Only people signed in to Your Space may reach an app's origin. The platform session
  stays on the platform's own host.
- **FR-015**: Apps must be reachable only through Your Space; app containers publish no ports of their
  own.
- **FR-016**: Apps open in panes inside Your Space, with its navigation available, and in their own
  tab when they can't run in a pane.
- **FR-017**: Your Space must not require apps to change their code, their requests or their sign-in
  to open in a pane. [NEEDS DISCUSSION: what Your Space may change in an app's responses, such as
  framing headers and cookie attributes; see Q6]

**Settings, outbound access and isolation (slices 5 to 7)**

- **FR-018**: The owner can change an app's settings and secrets; Your Space applies them by
  restarting the affected services and keeps the app's data.
- **FR-019**: Apps have no outbound network access until the owner approves hosts for them.
- **FR-020**: Apps must not reach Your Space's database, server, secrets or runtime manager, other
  apps, host folders, devices or Docker.

**Limits, status, logs and removal (slices 8 and 9)**

- **FR-021**: Each app runs with memory and CPU limits.
- **FR-022**: The owner can see each service's state and recent logs.
- **FR-023**: Removing an app keeps its data; deleting retained data is a separate step that the
  owner confirms.

**Shared rules**

- **FR-024**: All durable state lives in Your Space's database or in named volumes.
- **FR-025**: Installs, setting changes, approvals and removals are recorded with the actual actor.
- **FR-026**: Fetching a file from GitHub and images from their registries are actions the owner
  starts; Your Space makes no other outbound requests for apps.
- **FR-027**: Simple by default: the review, settings and logs show what most owners need, with
  details behind advanced controls.
- **FR-028**: The installation guide documents installing, opening, settings, outbound access,
  removal, the trust warning, and what Your Space protects and doesn't.

### Key Entities

- **Installed app**: an app on this installation: its name, source link, commit, the adapted Compose
  file, its services, its state, and who installed it.
- **Source**: the GitHub link and the exact commit read.
- **Service**: one container of an app, with its pinned image and state.
- **Adaptation**: a change Your Space made to the app's file, or a part it left out, with the reason.
- **Setting**: a value the app's file reads; secrets are settings that are never shown.
- **App origin**: the address an app's interface is served on.
- **App endpoint**: how Your Space reaches an app's interface; in this journey, a container on its own
  engine.
- **Engine connection**: the one Docker engine Your Space runs apps on.
- **Outbound approval**: an internet host the owner allowed an app to reach.
- **Retained data**: an app's named volumes kept after removal.

## Success Criteria

- **SC-001**: An owner installs Sure from the link to its own Compose file, unchanged, and uses it in
  a pane, with no command line after journey 001's setup.
- **SC-002**: Sure keeps its data across a restart and a `docker compose down` and `up`.
- **SC-003**: No generated secret appears in any output, log or review screen.
- **SC-004**: An installed app can't reach the platform, other apps, the host or unapproved internet
  hosts, shown by tests.
- **SC-005**: Someone not signed in to Your Space reaches no part of any app.
- **SC-006**: Two apps with the same service names run side by side without colliding.
- **SC-007**: Removing an app and installing it again brings back its data.

## Assumptions

- Your Space's own stack and its apps share one Docker engine in this journey, wherever that engine
  runs. An engine on another machine, and apps that someone already runs elsewhere, are later work.
- The owner is the only person in this journey; members arrive in journey 004.
- Only public GitHub repositories; private repositories and catalogs come later.
- Apps run published images only; Your Space doesn't build images.
- Apps keep their own accounts in this journey; Your Space controls who reaches them.

## Changes to Shared Direction

These change the decision record's accepted app direction, and are recorded there in the first pull
request after agreement.

1. **Journeys are delivered in slices**: one specification for the journey, then one pull request
   per slice in a stack, each ending with something working end to end.
2. **Apps install from their own Compose files**: Your Space adapts an upstream file to its rules,
   instead of requiring a Your Space-specific deployment file. An `x-your-space` section stays
   optional, for apps that want to declare more. [NEEDS DISCUSSION: see Q2]
3. **The first app is Sure**, an existing open-source app, instead of a Tasks app written for Your
   Space.
4. **No Docker Desktop dependency**: Your Space needs a Docker-compatible engine, not Docker Desktop.
   On macOS (and later Windows), Your Space provides its own virtual machine with Docker Engine by
   default, and an engine the owner already runs is an advanced option; on Linux servers the host's
   Docker Engine is the default. How Your Space provides the engine is settled in journey 003 or
   008. This changes the decision record's statement that the local audience installs Docker
   Desktop.
5. **Build around concepts, not technologies**: Your Space implements against concepts, such as an
   engine connection, an app endpoint or a secret store, that different technologies can sit
   behind, never against one specific tool. Added to the constitution as a principle (version
   1.4.0).
6. **Apps someone already runs**: an app hosted elsewhere is added through a connector that runs
   next to it and connects out to Your Space, so the app needs no open port and its authors change
   nothing. Your Space gives it routing, the access gate and panes, and doesn't manage or police
   the rest of its setup. This is later work; journey 002 builds the app endpoint it plugs into.
7. **Apps keep their own sign-in**: Your Space controls who reaches an app, and verified identity
   and app roles move to an opt-in integration in a later slice. This moves the TypeScript SDK and
   app roles out of journey 002. [NEEDS DISCUSSION: see Q11]

## Questions for Discussion

1. **Q1, Docker access (decided 2026-11-12)**: a runtime manager in Your Space's stack alone holds the
   engine connection (FR-001, FR-001a). It runs only files whose fully resolved form
   (`docker compose config`, after `include` and `extends`) passes an allowlist; each app gets its own
   sealed network (Docker 28's isolated gateway mode), outbound access goes through an allowlisting
   proxy, and limits are set per app. Nothing is configured by the owner. Kubernetes (k3s) was
   considered and not chosen for the default: on macOS it runs inside the same kind of VM, adds about
   1 to 1.5 GB of memory, and loses Compose features Sure relies on; TrueNAS moved from k3s to
   Compose for similar reasons. It stays possible later behind the engine-connection concept.
   Socket proxies, Docker-in-Docker, gVisor, Kata and Docker Desktop's Enhanced Container Isolation
   were considered; optional hardening for servers (Sysbox, rootless Docker) is later work. The
   research behind this goes in `research.md`.
2. **Q2, the deployment file**: adapt upstream Compose files, with an optional `x-your-space`
   section, or require a Your Space file next to them.
3. **Q3, recognizing secrets**: upstream files don't mark secrets. Options: names that look like
   secrets (`SECRET`, `PASSWORD`, `TOKEN`, `KEY`), an `x-your-space` list when present, and the owner
   marking them in the review.
4. **Q4, architectures**: require images for both ARM and Intel/AMD, as the decision record says, or
   only for this machine, since apps run on this machine.
5. **Q5, app origins per setup**: a subdomain per app (`sure.localhost`, `sure.example.com`) needs
   wildcard DNS for your own domain; Tailscale and your own proxy may need a port per app instead.
6. **Q6, panes and cookies**: Sure sends a header that forbids framing and uses cookies that browsers
   block in a cross-site pane. What Your Space may change in an app's responses so it works in a
   pane, and when it falls back to its own tab.
7. **Q7, outbound hosts**: how the owner learns which hosts an app needs (from the app's file or
   documentation, from blocked attempts shown in Your Space, or both).
8. **Q8, test apps (decided 2026-11-12)**: `traefik/whoami` (MIT) as the small web app for fast
   checks, and `alpine` or `busybox` as the app that probes the isolation boundaries, each pinned to
   an exact version; Sure for the full journey test. Tests serve fixture Compose files from a local
   stand-in for GitHub, plus one real check against Sure's public repository.
9. **Q9, limits**: default memory and CPU limits, and whether the owner can change them in this
   journey.
10. **Q10, the second app**: Memos, or another app the owner uses.
11. **Q11, deeper integration**: when the SDK, verified identity and app roles return, given that
    journey 004 assigns app roles and journey 005 delegates them to agents.
12. **Q12, stopping Your Space (decided 2026-11-12)**: Your Space and the apps it manages come up and
    go down as one unit, locally and on servers (FR-008). Clients never change app state (FR-008a).
