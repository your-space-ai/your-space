# Feature Specification: Install an App and Use It

**Feature Branch**: `002-install-an-app`

**Created**: 2026-11-12

**Implementation**: The [task record](tasks.md) lists the delivered slices and outstanding real-source installation checks.

**Updated 2026-11-23**: Apps install only from the link to their kit, which names the app's Compose
file and pins it to an exact commit
([Kits define apps](../../docs/architecture/decisions.md#kits-define-apps)). Where this
specification has the owner or operator give the link to an app's Compose file, they now give the
link to the app's kit; a bare Compose link is refused with an explanation of kits. Every installed
app has a kit, a Compose file given on this machine included. The kit's link resolves to the kit's
commit at review, and Your Space reads the Compose file at exactly the commit the kit's
`source.commit` names, never at a branch's latest commit; both commits are recorded.

**Journey**: 002 "Install an app and use it" in the
[spec map](../README.md)

**Input**: The owner installs an existing open-source app from its public GitHub repository and
uses it inside Your Space, without the app's authors changing anything. The first app is
an existing open-source personal finance app, called the finance app below.

## At a Glance

- **Who:** the owner of a Your Space installation from journey 001.
- **Done when:** the owner pastes the link to the finance app's Compose file (2026-11-23: to its
  kit, which names that file), reviews what will run, confirms, and uses it in a pane inside Your
  Space. The app keeps its data across restarts, reaches only the internet hosts the owner approved,
  and can be removed without losing its data.
- **Covers:** running apps' containers, installing from a GitHub link, adapting an app's own
  Compose file to Your Space's rules, generated secrets and settings, opening apps in panes on their
  own origins, access only through Your Space, outbound access approval, isolation, limits, status
  and logs, removal and retained data, and several apps side by side.
- **Not covered:** app updates (journey 006), external apps and the Python SDK (journey 007),
  native views in the desktop app (journey 008), and identity and roles for apps that integrate
  with Your Space (a later slice; see [Later: deeper integration](#later---deeper-integration)).
- **Next:** journey 003, whose CLI sets up HTTPS for the app origins this journey decides.

## Objective and Scope

An owner can install an app from a link to its Compose file in a public GitHub repository
(2026-11-23: from the link to the app's kit, which names its Compose file; see the update at the
top). Your Space reads the file at an exact commit, adapts it to its rules or refuses it with
reasons, shows the owner what will run and the trust warning, and runs the app's containers on its
runtime. The owner opens the app in a pane inside Your Space, and only people signed in to Your
Space can reach it.

Apps are not written for Your Space. An app keeps its own interface, its own accounts and its own
data; Your Space runs it, protects the platform and other apps from it, and controls who can reach
it. Deeper integration (sign-in through Your Space, verified identity and roles) comes later, in
levels apps opt into, so that any app with a published image and a Compose file can be installed.

The journey is delivered as a stack of pull requests that build up to it, one per slice or pair
of small slices. Each slice ends with
something the owner can see working, tested end to end in the browser, and later slices build on it
without reworking it. The [slice plan](#slices-and-their-dependencies) orders them by what each needs.

The [constitution](../../.specify/memory/constitution.md), the
[decision record](../../docs/architecture/decisions.md) and the
[spec map](../README.md)'s shared rules apply. Where this spec departs from the decision
record's accepted app direction, it says so in
[Changes to Shared Direction](#changes-to-shared-direction), and the decision record changes in the
first pull request.

## Concepts and Adapters

Your Space is built around concepts, not around one technology, so that a technology can be swapped
by adding an adapter rather than changing Your Space
([Changes to Shared Direction](#changes-to-shared-direction), item 5).

| Concept | What Your Space knows | First adapter | Later adapters |
| --- | --- | --- | --- |
| **App description** | An app's services, images, volumes, settings, start order, health checks and interface | Compose importer: reads an app's own Compose file | Other app formats, if a real need appears |
| **Runtime** | Install, start, stop, report on, log and remove an app; apply its network, outbound and limit policies | Docker adapter | k3s or another orchestrator |
| **Runtime connection** | The one runtime Your Space runs apps on | A Docker engine connection | A cluster connection |
| **App endpoint** | How Your Space reaches an app's interface | A container on Your Space's own runtime | An app on another runtime; an app someone already runs, through a connector |
| **Installation kit** | What makes a particular app fit Your Space without changing it | Kits in a separate repository | Community kits |

Only an adapter knows its technology. Requirements in this spec are written in terms of the
concepts; the [Docker adapter](#docker-adapter) section holds what is specific to Docker and
Compose.

**Installation kits.** Some apps need help to fit: which service is the interface, which values
must be generated rather than taken from published defaults, which outbound hosts a feature needs.
An owner can supply a kit from a local file or a GitHub link. They can configure
`YS_KITS_REPOSITORY` to discover kits in a GitHub repository of their choice. A kit refers to the app's own files by link and exact commit and
lists the adjustments; it never copies the app's code or files, so the app's license is untouched.
A kit can set a setting to a value Your Space works out itself, such as the app's own address (the
second app, a CRM, needs it in a setting), so the owner isn't asked for it.
Your Space reads a kit as another input, and contains no app-specific logic. An app with no kit
installs if its own files are enough. (Superseded 2026-11-23: a kit is the app's definition, and
every app installs with one: from the kit's link, or, with the server command, a kit file on this
machine, alone or with a Compose file given there. The kit's `source` names the Compose file by
repository, path and exact commit, and is required; only a kit given with a Compose file on this
machine leaves it out and goes with that file. A kit can live anywhere, apart from the app's
repository or in it, and never names "the file beside it" by default. See the
[kit format](contracts/kit-format.md). The configured directory lists kits and holds review evidence;
it no longer finds a kit from a Compose link.)

## Slices and Their Dependencies

Your Space needs these components. Each slice brings in only what it uses.

| | Component | What it does | Needs |
| --- | --- | --- | --- |
| A | App records | Each installed app's source link, commit, adapted Compose file, pinned images and state | |
| B | Runtime manager | The only part of Your Space that holds the runtime connection; drives the runtime adapter to start, stop, report on and remove apps | A |
| C | Source fetch | Turns a GitHub link into one file at an exact commit | |
| D | App description and kits | Imports the app's own file into an app description, applies its installation kit, checks it against Your Space's rules, refuses the rest with reasons | |
| E | Image pinning | Resolves each image to an exact version that runs on the runtime's processor type | |
| F | Settings and secrets | Values for the variables the kit's environment defines; generates secrets; keeps them out of logs and output | A |
| G | Restart recovery | Brings apps back when Your Space starts, and corrects recorded state that no longer matches | A, B |
| H | Install jobs | Runs an install in the background and reports progress | A, B |
| I | Apps API | Owner-only endpoints to preview, install, list and manage apps | A, H |
| J | Apps UI | The Apps area: the list, the install flow, the trust warning, progress | I |
| K | App routing | Each app on its own origin through the built-in proxy, reached through its app endpoint | A, B |
| L | Access gate | Only people signed in to Your Space reach an app's origin | K |
| M | Panes | Your Space's navigation around the app in a pane | J, K, L |
| N | Outbound control | Only the kit's starter hosts and the hosts the owner approves; other attempts become access requests | B, F |
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

| Pull request | Slices | Brings in | What the owner can see |
| --- | --- | --- | --- |
| Base | Spec and plan | | This specification, its plan and research, the decision record and the constitution changes |
| 1 | 1, 2: Run an app from a link | A, B, C, D, E, F, G | A server command installs an app from a GitHub link, the finance app included, with its kit and generated secrets; it runs on its sealed network and comes back after a restart |
| 2 | 3: Apps in Your Space | H, I, J | An Apps area lists apps and their state; installing from the UI with a review and trust warning; the Engine page |
| 3 | 4: Open an app | K, L, M | Apps open in a pane on their own origin, reachable only through Your Space, at `space.localhost` |
| 4 | 5, 6: Settings and outbound access | F, N | The owner changes an app's settings; apps reach only approved hosts, and other attempts become access requests |
| 5 | 7, 8: Isolation, limits, status and logs | O | Tests show an app can't reach the platform, other apps or the host; limits, per-service status and logs behind an advanced view |
| 6 | 9, 10: Remove, and apps side by side | P | Removing keeps the data, and deleting it is its own confirmed step; two apps side by side, and the phone layout |

The spec pull request is the base of the stack. Small slices that share a screen go together, so
the stack has six pull requests after it. The user stories below are numbered by slice.

## User Scenarios & Testing

### User Story 1 - Run an App From a Link (Priority: P1)

As the operator, I can give Your Space the GitHub link to an app's Compose file (2026-11-23: to its
kit, which names that file), and Your Space runs the app's containers on its runtime and keeps them
running across restarts.

**Why this priority**: Everything else in this journey depends on Your Space running containers
safely. Controlling Docker is the most security-sensitive part of the journey, so it comes first and
on its own.

**Independent Test**: In a running stack, run the install command with the link to a small fixture
app's Compose file (2026-11-23: to its kit, which names that file), check its status, restart the
stack, and check it again.

**Acceptance Scenarios**:

1. **Given** a running Your Space with an owner, **When** the operator runs the install command with
   the GitHub link to a public repository's Compose file, **Then** Your Space records the file at
   the exact commit the link resolves to, pins each image to an exact version, starts the app's
   containers, and reports the app as running. (2026-11-23: the command takes the link to the app's
   kit, and Your Space records the kit at the commit its link resolves to and the Compose file it
   names at exactly the commit the kit pins; see the [kit format](contracts/kit-format.md).)
2. **Given** an installed app, **When** the operator lists apps, **Then** each app's name, source,
   commit and state are shown, and the state matches what is running.
3. **Given** an installed app, **When** Your Space is restarted or the stack is recreated with
   `docker compose down` and `up`, **Then** the app comes back with the same data.
4. **Given** the operator stops Your Space with the documented stop command, **When** they check the
   engine, **Then** none of the apps it manages is running, and containers it doesn't manage are
   untouched; **When** Your Space starts again, **Then** its apps come back.
5. **Given** a running app, **When** Your Space is restarted or updated, **Then** the app keeps
   running throughout, and Your Space reports its state correctly once it is back.
6. **Given** a link that isn't a public GitHub file, a file that isn't Compose, or an image missing
   for this machine's architecture, **When** the operator runs the install command, **Then** nothing
   is installed, nothing runs, and the message says what is wrong. (2026-11-23: the command takes
   the link to the app's kit, and the file that must be Compose is the one the kit names; given a
   Compose file's link, it installs nothing and says that installs need a kit's link.)
7. **Given** two installs of apps with the same service names, **When** both run, **Then** their
   containers, networks and volumes don't collide.

### User Story 2 - Run the Finance App (Priority: P1)

As the operator, I can install the finance app from the link to its own example Compose file, which
its authors wrote for running by hand (2026-11-23: from the link to its kit, which names that file),
and Your Space adapts it, generates its secrets and runs every service.

**Why this priority**: Real apps' Compose files are written for people, not for Your Space. Running
one unchanged is the point of the journey.

**Independent Test**: Run the install command with the link to the finance app's example Compose
file (2026-11-23: to its kit, which names that file) and check that its web, worker, database and
Redis services are running and healthy. The runtime manager's tests keep the file's resolved form,
and the [README of those fixtures](../../runtime/tests/README.md) records its source and commit.

**Acceptance Scenarios**:

1. **Given** the link to the finance app's Compose file (2026-11-23: to its kit, which names that
   file), **When** the operator installs it, **Then** Your Space reports what it changed (for
   example the published port, moving image tags and the fixed DNS servers) and what it left out
   (for example the backup services behind profiles, which mount host folders), and runs the rest.
2. **Given** the file sets a secret's default in plain text (the finance app's `SECRET_KEY_BASE` and
   `POSTGRES_PASSWORD`), **When** Your Space installs it, **Then** it generates a new value for each,
   as the finance app's installation kit says, and never uses the published default.
3. **Given** the finance app running, **When** its services start, **Then** they start in the order
   the file's health conditions require, and its database and Redis data live in named volumes.
4. **Given** the install output and Your Space's logs, **When** they are read, **Then** no generated
   secret appears in them.
5. **Given** a Compose file with a setting Your Space can neither allow nor adapt, such as a
   privileged container or a host device, **When** the operator installs it, **Then** nothing is
   installed and the message names the setting and why it isn't allowed.

### User Story 3 - Apps in Your Space (Priority: P1)

As the owner, I can see my apps in Your Space and install one by pasting its link, reviewing what
will run, and confirming after a clear trust warning.

**Why this priority**: The owner manages apps in Your Space, not on the command line.

**Independent Test**: Sign in, open Apps, paste the finance app's link, review and confirm, and
watch it reach running.

**Acceptance Scenarios**:

1. **Given** a signed-in owner, **When** they open Apps, **Then** they see each installed app and its
   state, or that no app is installed yet.
2. **Given** the owner pastes a link, **When** Your Space has read the file, **Then** it shows the
   app's services, the images and versions it will run, what it changed and left out, the settings it
   needs, and the warning that installing an app trusts it with its own data. (2026-11-23: the link
   is the kit's; the review also shows the kit's repository, path and commit, and the Compose file at
   the commit the kit pins. A pasted Compose file's link gets a message that explains kits and that
   installs need a kit's link, and a kit that doesn't pin its Compose file's commit is refused with
   a message naming `source.commit`.)
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

**Independent Test**: Install the finance app, open it from Apps, sign up in it inside the pane, and
use it; then try to reach its address while signed out of Your Space.

**Acceptance Scenarios**:

1. **Given** a running app, **When** the owner opens it, **Then** it loads in a pane on its own
   origin, separate from Your Space's and from other apps', with Your Space's navigation still
   available.
2. **Given** the finance app in a pane, **When** the owner signs up or signs in to it there, **Then**
   the app's own accounts and sessions work inside the pane.
3. **Given** someone not signed in to Your Space, **When** they open an app's address directly,
   **Then** they are sent to Your Space's sign-in and reach no part of the app.
4. **Given** an app whose interface can't run in a pane, **When** the owner opens it, **Then** it
   opens in its own tab, behind the same access check.
5. **Given** each setup from journey 001, **When** the owner opens an app, **Then** it is at
   `<app>.<Your Space's address>`: `finance.space.localhost` on this machine with no setup,
   `finance.space.example.com` on your own domain after one wildcard DNS record, a Tailscale Service
   name on Tailscale, and the forwarded wildcard name behind your own proxy. (2026-11-19: Tailscale
   names can't hold these; there the owner publishes the app on a port, with a Tailscale Service
   per app; see the decision record's "Running Apps and Reaching Them".)
6. **Given** the finance app in a pane, **When** its requests reach the app, **Then** none of them
   carries Your Space's sign-in cookie, and no cookie the app sets reaches Your Space or another app.
7. **Given** an app that sends a header forbidding framing, **When** it opens in a pane, **Then** it
   shows, and no other site can frame it.
8. **Given** an app published on a port with a link (2026-11-20), **When** the owner opens it, **Then**
   it shows at its link in its pane, framed only by Your Space even when it sends a header forbidding
   framing; with "Show inside Your Space" off, its headers reach the browser unchanged and it opens at
   its link in its own tab.

### User Story 5 - Change an App's Settings (Priority: P2)

As the owner, I can see and change an app's settings, such as adding an AI provider's key to the
finance app, and Your Space applies them by restarting the app.

**Independent Test**: Add a value to one of the finance app's optional settings, and check that the
app restarted with it while generated secrets stayed hidden.

**Acceptance Scenarios**:

1. **Given** an installed app, **When** the owner opens its settings, **Then** they see the settings
   its Compose file reads, with their current values, and secrets shown only as set or not set.
2. **Given** the owner changes a setting, **When** they save, **Then** Your Space restarts the
   affected services with the new value and keeps the app's data.
3. **Given** a secret, **When** the owner replaces it, **Then** the new value is stored and never
   shown again, and replacing a generated secret warns what it may break.

### User Story 6 - Approve Outbound Access (Priority: P2)

As the owner, I decide which internet hosts an app can reach. An app starts with only the hosts it
needs to work, and asks for more as I use more of its features.

**Independent Test**: Install the finance app with its installation kit and check that only the
kit's starter hosts are reachable; use a feature that needs another host, see the access request,
approve it, and check that the host is now reachable and every other host still isn't.

**Acceptance Scenarios**:

1. **Given** an app with an installation kit, **When** the owner reviews the install, **Then** the
   review lists the kit's starter hosts, the ones the app needs to work at all, and confirming the
   install approves exactly those.
2. **Given** an app without a kit, **When** it is installed, **Then** it starts with no outbound
   access. (2026-11-23: every app installs with a kit; one whose kit names no hosts starts with no
   outbound access.)
3. **Given** an installed app, **When** it tries to reach a host it hasn't been allowed, **Then** the
   attempt fails, and Your Space shows an access request naming the app, the host, and when and how
   often it was tried.
4. **Given** an access request, **When** the owner approves it, **Then** the app can reach that host
   and every other unapproved host still fails; **When** the owner dismisses it, **Then** nothing
   changes and repeated attempts don't raise it again.
5. **Given** an approved host, **When** the owner removes it, **Then** the app can no longer reach it.
6. **Given** any approval, dismissal or removal, **When** the activity is read, **Then** it names the
   actor who made it.

### User Story 7 - Isolation, Tested (Priority: P1)

As the owner, I can trust that an installed app can't reach Your Space's own data, other apps or the
host, even if the app misbehaves.

**Independent Test**: A test app tries each boundary, and each attempt fails.

**Acceptance Scenarios**:

1. **Given** an installed app, **When** it tries to reach Your Space's database, server, secrets or
   the runtime manager, **Then** it can't.
2. **Given** two installed apps, **When** one tries to reach the other's containers or volumes,
   **Then** it can't.
3. **Given** an installed app, **When** it tries to reach host folders, devices or the runtime's own
   controls (for Docker, its socket), **Then** it can't.
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
3. **Given** an installed app, **When** the owner opens its advanced settings, **Then** they see each
   service's memory and CPU limit (the fixed default, or the installation kit's value), and
   changing one restarts that service with it.
4. **Given** the machine runs short of memory, **When** the system has to stop something, **Then** it
   stops an app's service before any of Your Space's own services.
5. **Given** the Engine page, **When** the owner opens it, **Then** it shows the workspace's
   resources and how much of them each app uses.

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

Not part of this journey's delivery, which stops at level 0. Integration with apps comes in levels:

| Level | What the owner gets | What the app needs |
| --- | --- | --- |
| 0. Gate only (this journey) | Only people signed in to Your Space reach the app; the app's own login still appears | Nothing |
| 1. Your Space as an identity provider | Opening an app signs the person in as themselves | OpenID Connect support, set through the app's own settings by its installation kit (the finance app reads a client ID, client secret, issuer and redirect address) |
| 2. Built for Your Space | Verified identity and app roles from Your Space, and agents through the gateway | The TypeScript or Python SDK |

Level 1 matters most once there are members (journey 004); level 2 is for developers' own apps
(journey 007) and for agents (journey 005). Where each lands is settled with those journeys.

### Edge Cases

- The GitHub link points to a branch that moves after install; the install keeps the exact commit
  it read. (2026-11-23: the kit's link resolves to the kit's commit at review, and the kit pins the
  Compose file's commit, so a branch that moves after the review changes nothing until the owner
  chooses to install a newer kit.)
- GitHub or the image registry is unreachable or rate-limits the request during install.
- An image's tag exists only for one architecture, or its digest changes between preview and
  install.
- An install is interrupted during an image download, or by a server restart.
- The machine runs out of disk during an install.
- A Compose file uses features Your Space reads but doesn't run: profiles, `extends`, `include`,
  `build`, YAML anchors and `x-` sections, and `${VAR:-default}` and `${VAR:?error}` placeholders.
- Two apps ask for the same service names, volume names or ports.
- An app's interface sends headers that forbid framing, or sets cookies that a pane blocks.
- The runtime itself restarts while apps run.
- The owner removes an app during its install.

## Requirements

### Functional Requirements

**Running apps (slices 1 and 2)**

- **FR-001**: Only the runtime manager may hold the runtime connection. The web-facing server must
  not hold it, and nothing reachable from an app or the network may reach the runtime manager.
- **FR-001a**: Your Space runs apps through one runtime connection, found without configuration and
  overridable with one setting. Your Space's behavior must not depend on where the runtime runs: on
  the host, in a virtual machine Your Space provides, or elsewhere.
- **FR-001b**: Everything specific to a runtime technology lives in its adapter. Your Space's core
  works only with the concepts in [Concepts and Adapters](#concepts-and-adapters).
- **FR-002**: Each installed app must be kept apart from other apps and from Your Space: its own
  network, its own durable volumes, and names that can't collide.
- **FR-002a**: App-specific adjustments come only from installation kits, kept outside Your Space.
  Your Space contains no logic for a particular app.
- **FR-003**: An install must record the source link, the exact commit it resolved to, the adapted
  Compose file, each image's exact version, and the actor who installed it. (2026-11-23: the kit's
  link at the commit it resolved to at review, and the Compose file at the commit the kit's
  `source.commit` pins; nothing is read at a branch's latest commit.)
- **FR-004**: Every image must be pinned to an exact version. An app installs if its images run on
  the runtime's processor type (ARM or Intel/AMD); if not, the install stops with a clear message.
- **FR-005**: Your Space runs only what its rules allow. It may adapt an app's file only by a
  documented rule that applies to every app, and must refuse the install with reasons for anything
  else. Each runtime adapter defines its rules; the Docker adapter's are FR-D03 and FR-D04.
- **FR-006**: Published defaults for secrets are never used. An installation kit can say which
  values Your Space generates; generated values never appear in output, logs or the review. How the
  owner sees and sets these values is designed with the review screen in slice 3 (see Q3).
  (2026-11-23: one exception, a reinstall that reuses a removed app's data. A setting kept with the
  data keeps its value, even an unset one, so a secret never set before leaves the app on its
  published default until the owner gives it a value; see Q3.) (2026-11-23, later: the kit's `env`
  is the app's whole environment and says which values Your Space generates; Your Space no longer
  generates a value for a variable the kit leaves out because its name looks secret. A variable the
  kit doesn't define gets the file's default, and one with no default is refused; see Q3.)
- **FR-007**: Apps must come back when Your Space starts, and Your Space must not report a state that
  doesn't match what is running.
- **FR-008**: Stopping Your Space on purpose stops the apps it manages, and starting it brings them
  back. Restarting or updating Your Space, or a crash, leaves its apps running: when Your Space
  returns, it takes them back over without restarting them and corrects any recorded state that no
  longer matches. Containers on the same engine that Your Space doesn't manage are never touched.
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
  apps, at `<app>.<Your Space's address>` in every setup. Ports and paths are not used for apps,
  because browsers don't keep cookies apart by either. On this machine Your Space's address is
  `space.localhost` rather than `localhost`, because browsers treat `localhost` and
  `finance.localhost` as different sites; every `*.localhost` name reaches the machine itself with no
  setup (RFC 6761).
- **FR-013a**: Your Space reaches each app's interface through an app endpoint. Routing, the app
  origin, the access gate and panes must depend only on the endpoint, not on how it is reached. In
  this journey the only endpoint is a container on Your Space's engine; later endpoint types (an
  app on another engine, or an app someone already runs, reached through a connector) add to it
  without changing these.
- **FR-014**: Only people signed in to Your Space may reach an app's origin (2026-11-19: apart from a
  port the owner publishes the app on, which is outside the gate; see FR-015). The platform session
  stays on the platform's own host: a `__Host-` cookie that apps can't overwrite. An app's origin
  gets its own short-lived pass, issued by Your Space to someone already signed in, and the proxy
  removes that pass before forwarding requests to the app.
- **FR-014a**: The proxy removes Your Space's cookies from every request to an app, and removes any
  `Domain` attribute from cookies an app sets, so no app's cookie reaches Your Space or another app.
- **FR-015**: Apps must be reachable only through Your Space; app containers publish no ports of their
  own. (2026-11-19: the owner can publish an app's interface on a port of this machine, through a
  Caddy of Your Space's, for their own proxy or tunnel; that port is outside the access gate. See
  the decision record's "Running Apps and Reaching Them".)
- **FR-016**: Apps open in panes inside Your Space, with its navigation available, and in their own
  tab when they can't run in a pane. When a browser blocks an app's cookies in a pane, Your Space
  notices and offers the app in its own tab instead of failing silently. WebKit does this on the
  plain-HTTP local setup, where it treats each `*.localhost` name as a separate site (research R3).
  (2026-11-20: an app published with a link opens at the link in its pane unless the owner turns
  "Show inside Your Space" off for it; then it opens there in its own tab.)
- **FR-017**: Your Space must not require apps to change their code, their requests or their sign-in
  to open in a pane. The proxy may change only what every app needs the same way: it replaces an
  app's framing headers so that only Your Space can frame it, and applies FR-014a. It doesn't change
  an app's own cookies otherwise; an app that can't run in a pane opens in its own tab, and its
  installation kit can say so. (2026-11-20: a published app's own Caddy replaces its framing headers
  the same way, and only them, while "Show inside Your Space" is on, as it is by default; see the
  decision record's "Running Apps and Reaching Them".)

**Settings, outbound access and isolation (slices 5 to 7)**

- **FR-018**: The owner can change an app's settings and secrets; Your Space applies them by
  restarting the affected services and keeps the app's data.
- **FR-019**: Apps reach only the internet hosts approved for them. An installation kit can name
  starter hosts that the install review shows and the confirmed install approves; anything else an
  app tries to reach is blocked and becomes an access request the owner approves or dismisses.
  Nothing is approved without the owner, and there is no "all internet" option in this journey.
- **FR-020**: Apps must not reach Your Space's database, server, secrets or runtime manager, other
  apps, host folders, devices or Docker.

**Limits, status, logs and removal (slices 8 and 9)**

- **FR-021**: Each app's services run with memory and CPU limits: a fixed default per service, which
  an installation kit can override and the owner can change behind an advanced control. Limits
  that scale with the workspace's resources are left to explore.
- **FR-021a**: A space has workspace resources: the CPU and memory of the engine it runs apps on, as
  the engine reports them. Your Space reads them the same way whatever the engine runs on (a server,
  a laptop, a VM Your Space provides, or a managed tier's VM) and never depends on which. The Engine
  page shows them and each app's use. An app can never cause Your Space's own services to be stopped
  for lack of memory.
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

### Docker Adapter

What is specific to the first runtime adapter. The research behind it is
[research R1](research.md#r1-how-your-space-runs-app-containers).

- **FR-D01**: The runtime connection is a Docker engine connection in Docker's standard forms: a
  local socket, `ssh://`, or `tcp://` with TLS. Any Docker-compatible engine of version 28 or newer
  works; Docker Desktop is not required.
- **FR-D02**: Each app is one Compose project with its own network and named volumes, named so that
  two apps with the same service names can't collide.
- **FR-D03**: The adapter checks an app's fully resolved Compose file (after `include`, `extends`,
  anchors and placeholders) against an allowlist of settings, never the raw file.
- **FR-D04**: Rules that apply to every app: published host ports are replaced by Your Space's
  routing (and, since 2026-11-19, by a Caddy of Your Space's when the owner publishes the app), networks are assigned by the adapter, images are pinned by digest, services behind
  profiles are left out, and host folders, devices, privileged mode, host namespaces and engine
  access are refused.
- **FR-D05**: Each app's network is internal, with no route to the host (Docker 28's isolated gateway
  mode); outbound access goes only through an allowlisting proxy on the app's behalf.
- **FR-D06**: Memory and CPU limits are applied to each service, and Your Space's own containers are
  the last the kernel stops when memory runs out (their out-of-memory priority is set accordingly).

### Key Entities

- **Installed app**: an app on this installation: its name, source link, commit, the adapted Compose
  file, its services, its state, and who installed it.
- **Source**: the GitHub link and the exact commit read, or, from the server command, the digest of
  a Compose file given on this machine.
- **Service**: one container of an app, with its pinned image and state.
- **Adaptation**: a change Your Space made to the app's file, or a part it left out, with the reason.
- **Setting**: a value the app's file reads; secrets are settings that are never shown.
- **App origin**: the address an app's interface is served on.
- **App endpoint**: how Your Space reaches an app's interface; in this journey, a container on its own
  engine.
- **Runtime connection**: the one runtime Your Space runs apps on; for the Docker adapter, a Docker
  engine.
- **Installation kit**: the adjustments that make a particular app fit Your Space, kept outside Your
  Space and referring to the app's own files. Since 2026-11-23, the app's complete definition in Your
  Space: what installs it and how it is shown.
- **Outbound approval**: an internet host an app may reach, from its kit's starter hosts or approved
  by the owner.
- **Access request**: an attempt by an app to reach a host it isn't allowed, waiting for the owner.
- **Workspace resources**: the CPU and memory a space runs in, shared by Your Space and its apps.
- **Retained data**: an app's named volumes kept after removal.

## Success Criteria

- **SC-001**: An owner installs the finance app from the link to its own Compose file, unchanged,
  and uses it in a pane, with no command line after journey 001's setup. (2026-11-23: from the link
  to the app's kit, which names its own Compose file, still unchanged.)
- **SC-002**: The finance app keeps its data across a restart and a `docker compose down` and `up`.
- **SC-003**: No generated secret appears in any output, log or review screen.
- **SC-004**: An installed app can't reach the platform, other apps, the host or unapproved internet
  hosts, shown by tests.
- **SC-005**: Someone not signed in to Your Space reaches no part of any app.
- **SC-006**: Two apps with the same service names run side by side without colliding.
- **SC-007**: Removing an app and installing it again brings back its data.

## Assumptions

- Your Space's own stack and its apps share one runtime in this journey, wherever it runs. An engine
  on another machine, and apps that someone already runs elsewhere, are later work.
- The owner is the only person in this journey; members arrive in journey 004.
- Only public GitHub repositories, or a Compose file the operator gives the server command on this
  machine; private repositories and catalogs come later.
- Apps run published images only; Your Space doesn't build images.
- Apps keep their own accounts in this journey; Your Space controls who reaches them.

## Changes to Shared Direction

These change the decision record's accepted app direction, and are recorded there in the first pull
request after agreement.

1. **Journeys are delivered in slices**: one specification for the journey, then a stack of pull
   requests, one per slice or pair of small slices, each ending with something working end to end.
2. **Apps install from their own files, with optional installation kits**: Your Space reads an app's
   own Compose file and applies rules that hold for every app, instead of requiring a Your
   Space-specific deployment file with an `x-your-space` section. Help a particular app needs comes
   from an installation kit supplied directly or found in the operator’s configured directory; the kit
   refers to the app's files without copying them. (2026-11-23: the kit is required, and the owner
   installs from its link; see the update at the top.)
3. **The first app is an existing open-source app**, a personal finance app, instead of a Tasks app
   written for Your Space.
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
7. **Apps keep their own sign-in**: in this journey Your Space only controls who reaches an app.
   Sign-in through Your Space (OpenID Connect, for apps that support it) and verified identity with
   app roles through the SDK come later, in levels. This moves the TypeScript SDK, app roles and the
   Tasks app out of journey 002.
8. **Processor types**: an app installs if its images run on the machine's processor type,
   superseding the requirement that app images exist for both ARM and Intel/AMD.
9. **A shared vocabulary**: Your Space is the home, apps are its appliances and furniture, providers
   such as LLM services are its utilities, and installation kits make an appliance fit. Recorded in
   `docs/glossary.md` for future names.
10. **No moving workspaces**: Your Space provides backup and restore, easy to script, and doesn't
    move workspaces between installations itself; that's for the person or their agent. Recorded in
    the decision record's backup section; it changes journey 006, not this journey.
11. **Your Space's local address becomes `space.localhost`**: journey 001 serves this machine's
    setup at `localhost`. Slice 4 moves it to `space.localhost` (keeping `localhost` as a redirect),
    so apps can be same-site subdomains, and makes Your Space's session cookie a `__Host-` cookie.
    Over HTTPS the cookie is a `__Host-` cookie. On the plain-HTTP local setup it is host-only
    without the prefix, because WebKit refuses `__Host-` over HTTP even on `*.localhost` (tested;
    Chromium and Firefox accept it). On that setup WebKit also blocks apps' cookies in panes, so apps
    open in their own tab there (FR-016). Safari on macOS is still to check.

## Decisions and Open Questions

1. **Q1, Docker access (decided 2026-11-12)**: a runtime manager in Your Space's stack alone holds the
   engine connection (FR-001, FR-001a). It runs only files whose fully resolved form
   (`docker compose config`, after `include` and `extends`) passes an allowlist; each app gets its own
   sealed network (Docker 28's isolated gateway mode), outbound access goes through an allowlisting
   proxy, and limits are set per app. Nothing is configured by the owner. Kubernetes (k3s) was
   considered and not chosen for the default: on macOS it runs inside the same kind of VM, adds about
   1 to 1.5 GB of memory, and loses Compose features the finance app relies on; TrueNAS moved from
   k3s to Compose for similar reasons. It stays possible later behind the engine-connection concept.
   Socket proxies, Docker-in-Docker, gVisor, Kata and Docker Desktop's Enhanced Container Isolation
   were considered; optional hardening for servers (Sysbox, rootless Docker) is later work. The
   research behind this goes in `research.md`.
2. **Q2, the app's files (decided 2026-11-14)**: Your Space reads the app's own Compose file and
   applies rules that hold for every app. Help a particular app needs comes from an installation kit
   in a separate repository, never from logic in Your Space or changes to the app's files.
3. **Q3, secrets (decided 2026-11-14)**: published secret defaults are never used, and a kit says
   which values to generate, which to work out (such as the app's own address) and which plain
   values to set from the app's own example settings. Without a kit, any setting whose name says it
   holds a secret and that has a published default gets a generated value (2026-11-23: every app has
   a kit, and this applies to the settings its kit doesn't generate, derive or set; a reinstall that
   reuses a removed app's data keeps each setting's kept value instead, even an unset one, since the
   data was written with it). The review shows each setting; secrets show only as set or generated,
   never their values, and the owner can give a value for any setting before installing. How to keep
   less experienced owners safe with apps that have no kit (for example, clearer warnings, or
   installing only apps with kits by default) is left for later. (Decided 2026-11-23: Your Space
   installs only apps with kits.) (Superseded 2026-11-23, later: the kit's `env` names the app's
   whole environment, each variable a value, generated, worked out or asked of the owner, and only
   those are settings. No setting is secret or generated because of its name: the kit says which
   values to generate and which values the owner gives are secret. A variable the app's file needs,
   with no default, that the kit doesn't define is refused in the review. See the
   [kit format](contracts/kit-format.md).)
4. **Q4, processor types (decided 2026-11-14)**: an app installs if its images run on the runtime's
   processor type; nothing more is required.
5. **Q5, app addresses (decided 2026-11-14)**: every app is at `<app>.<Your Space's address>` in
   every setup (FR-013): `space.localhost` with `finance.space.localhost` on this machine, a wildcard
   DNS record on your own domain, Tailscale Services on Tailscale, a forwarded wildcard behind your
   own proxy. Ports and paths share cookies between apps, as Umbrel, CasaOS, Runtipi and Home
   Assistant's add-ons show; a host name per app is what Codespaces, Gitpod, Coder, OrbStack and
   JupyterHub use. Still to check on a running version: Safari on macOS with `*.localhost`, and
   whether Your Space can create Tailscale Services itself. See research R2. (2026-11-19: on
   Tailscale, the owner publishes an app on a port and creates its Tailscale Service.)
6. **Q6, panes and cookies (decided 2026-11-14)**: the proxy replaces framing headers so only Your
   Space can frame an app, keeps Your Space's cookies away from apps and apps' cookies away from
   Your Space and each other (FR-014, FR-014a, FR-017), and leaves apps' own cookies alone. Tested
   with the finance app in Chromium, Firefox and WebKit; rewriting apps' cookies to `SameSite=None;
   Partitioned` was tested and rejected (it splits the pane's session from the app's own tab and
   weakens the app's CSRF protection). See research R2.
7. **Q7, outbound hosts (decided 2026-11-14)**: the installation kit opens the starter hosts an app
   needs to work, shown in the install review; every other host an app tries is blocked and shown to
   the owner as an access request to approve or dismiss (FR-019). Owners widen access as they use
   more features, instead of exposing everything at install. The finance app integrates with more
   than a hundred providers (bank sync, market data, AI, and optional usage feedback to an analytics
   service), so a fixed list at install wouldn't fit. An "all internet" option for apps such as feed
   readers is left for later.
8. **Q8, test apps (decided 2026-11-12)**: `traefik/whoami` (MIT) as the small web app for fast
   checks, and `alpine` or `busybox` as the app that probes the isolation boundaries, each pinned to
   an exact version; the finance app for the full journey test. Tests serve fixture Compose files from
   a local stand-in for GitHub, plus one real check against the finance app's public repository.
9. **Q9, limits (decided 2026-11-14)**: fixed default limits per service, which an installation kit
   can override and the owner can change behind an advanced control (FR-021). Resources belong to
   the whole space first: they are whatever the engine's machine provides, so a managed tier's VM, a
   local VM and a server are the same thing to Your Space (FR-021a). Limits that scale with the
   workspace's resources are worth exploring; the default numbers are set in the plan after
   measuring the finance app.
10. **Q10, the second app (decided 2026-11-14)**: an existing open-source CRM. Its Compose file has
    `server`, `worker`, `db` (`postgres:16`) and `redis`, published for ARM and Intel/AMD, so with the
    finance app it shows two apps with the same service names kept apart. Its kit has to generate two
    secrets and set a setting to the app's own address. It is AGPL-3.0, except its single sign-on
    code, which is under a commercial license, so level 1 sign-in would need its enterprise license.
11. **Q11, deeper integration (decided 2026-11-14)**: journey 002 is gate only (level 0). Your Space
    as an OpenID Connect provider (level 1, likely through Better Auth's OAuth provider plugin) and
    the SDK (level 2) come later, placed with journeys 004, 005 and 007.
12. **Q12, stopping Your Space (decided 2026-11-12)**: stopping Your Space on purpose stops the apps
    it manages, as one unit; restarting or updating it leaves them running, so updates don't take
    apps down (FR-008). Clients never change app state (FR-008a).
