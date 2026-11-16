# Feature Specification: Install and Run With the CLI

**Feature Branch**: `003-install-with-the-cli`

**Created**: 2026-11-16

**Status**: Draft for review. Two questions are open; see
[Decisions and Open Questions](#decisions-and-open-questions). Nothing in it is delivered yet.

**Journey**: 003 "Install and run with the CLI", the third of eight journeys in the
[spec map](../../docs/spec-map.md)

**Input**: A person installs Your Space on a server or on their own computer with one guided
command, chooses how it is reached, and gets a working space with the owner created, without
writing Compose commands or editing `.env` themselves.

## At a Glance

- **Who:** a person installing Your Space on a Linux server or on their own Mac or Linux computer,
  comfortable running a command in a terminal and with a Docker engine available.
- **Done when:** they get the CLI with one command, run `your-space install`, answer a few
  questions (or none, on their own computer), and open their space in a browser through a
  set-password link, over HTTPS when they gave a domain. Afterwards `your-space` starts, stops,
  reports on and recovers the installation.
- **Covers:** getting the CLI, the guided install for this machine, your own domain, and your own
  proxy or tunnel; start, stop, status and logs; owner recovery and secrets; changing the setup
  after installing; managing an installation that was set up by hand; the installation guide with
  the CLI first and manual Compose as the advanced option.
- **Not covered:** updating Your Space, backup, restore and uninstall (journey 006); agent commands
  (journey 005); Your Space's own virtual machine for the engine, and Windows (journey 008, if the
  [open question](#decisions-and-open-questions) is settled as proposed); installing apps from the
  CLI, which the server's `install-app` already does.
- **Next:** journey 004, invite my team.

## Objective and Scope

Journey 001 made Your Space installable by hand: download the release files, write a line in
`.env`, run Compose, run the owner command. Journey 002 added apps, each at
`<app>.<Your Space's address>`, so the address setup now matters for every app too. This journey
wraps those steps in one CLI that does the same thing the guide does, in the same files, so that a
person never writes a Compose command or a settings line, and the desktop app (journey 008) can
drive the same CLI without changing it.

The CLI doesn't add a second way of running Your Space. It writes the same release files and the
same `.env` lines as the manual install, runs the same Compose commands and the same server
commands, and reports what they report. A space installed with the CLI can be run by hand, and a
space installed by hand can be managed with the CLI.

Your Space knows how it is reached, not which product reaches it: the owner's domain, or the
address of a proxy or tunnel they run. It never contains code for a particular proxy or tunnel,
such as Tailscale. For a proxy or tunnel it says exactly which names to forward and where, and the
installation guide shows how to do that with common ones, Tailscale included.

The journey is delivered as a stack of pull requests, one per slice, each ending with something a
person can see working and tested end to end. The
[constitution](../../.specify/memory/constitution.md), the
[decision record](../../docs/architecture/decisions.md) and the spec map's shared rules apply.
Where this spec changes shared direction, it says so in
[Changes to Shared Direction](#changes-to-shared-direction), and the decision record changes in the
first pull request.

## Concepts and Adapters

| Concept | What the CLI knows | First adapter | Later adapters |
| --- | --- | --- | --- |
| **Installation** | Where an installation lives, its version, its setup, and how to start, stop, report on and log it | A folder with the release files and `.env`, run with Docker Compose | Your Space's own virtual machine (journey 008) |
| **Engine connection** | Which engine the installation runs on, whether it is reachable, its version and processor type | The engine Docker's own client uses (its current context or `DOCKER_HOST`) | Your Space's own virtual machine |
| **Setup** | How the space is reached: this machine, your own domain, or your own proxy or tunnel | The `.env` lines from journey 001 (`YS_DOMAIN`, `YS_PROXY_URL`, `YS_PORT`) | |
| **Server commands** | Owner creation, recovery links, secrets, app listing, with their exit statuses and JSON output | `docker compose exec server <command> --json` | The server's API, once the CLI can sign in remotely (journey 006) |

Only an adapter knows its technology. The CLI's commands, questions and output are written in terms
of the concepts, so a person sees "Your Space is running" and "the engine isn't reachable", not
Compose's or Docker's own messages, unless they ask for detail.

## Slices and Their Dependencies

| Pull request | Slice | What a person can see |
| --- | --- | --- |
| Base | Spec and plan | This specification, its plan and research, and the decision record and roadmap changes |
| 1 | 1. Install on this machine | One command gets the CLI on Linux; `your-space install` starts Your Space on this machine, creates the owner and opens the set-password link |
| 2 | 2. Run it | `start`, `stop`, `status` and `logs`, for Your Space and its apps |
| 3 | 3. Recover the owner and manage secrets | `owner reset-link`, `secrets show` and `secrets replace` |
| 4 | 4. Your own domain | Install asks for a domain, checks the names, opens HTTPS, and `configure` changes the setup later |
| 5 | 5. Your own proxy or tunnel | Install with a proxy address; the CLI lists the names the proxy must forward, apps included |
| 6 | 6. macOS, and an installation set up by hand | The CLI on a Mac with an engine the person runs; adopting a folder installed by hand |
| 7 | 7. The guide | The installation guide leads with the CLI; manual Compose becomes the advanced option |

Slice 1 brings the CLI, its packaging and the installation concept; every later slice adds commands
or setups to it without changing what slice 1 built. Slices 4 and 5 need slice 2's `status`, since
that is where the space's address and its apps' addresses are shown.

## User Scenarios & Testing

### User Story 1 - Install on This Machine (Priority: P1)

As a person with a Linux computer or server and Docker, I can get the CLI with one command and
install Your Space for this machine without answering anything but my name and username, so that I
have a working space in a few minutes.

**Why this priority**: It is the shortest path to a working space and the base every other command
builds on.

**Independent Test**: On a Linux machine with Docker Engine and Compose and nothing else, run the
documented command to get the CLI, then `your-space install`, give a name and username, open the
printed link, set a password and sign in at `http://space.localhost`.

**Acceptance Scenarios**:

1. **Given** a Linux machine with a supported Docker Engine and Compose, **When** the person runs
   the documented one-line command, **Then** the `your-space` command is installed for them, its
   download is checked before it is installed, and `your-space --version` prints the version.
2. **Given** the CLI, **When** the person runs `your-space install` and accepts the defaults,
   **Then** the CLI checks the engine, makes the installation folder, downloads the release files
   for its own version and checks them, writes no settings line, starts Your Space, waits until it
   is healthy, asks for the owner's name and username, creates the owner, and prints the
   set-password link and opens it in the browser when there is one.
3. **Given** the engine isn't running, Compose is missing or too old, or Docker Engine is older
   than the supported version, **When** the person runs `install`, **Then** nothing is downloaded
   or started, and the CLI says what is missing and how to fix it.
4. **Given** port 80 is in use on this machine, **When** the person installs, **Then** the CLI
   says so before starting and offers another port, which it writes as `YS_PORT`.
5. **Given** an installation is interrupted (the connection drops, the person presses Ctrl-C, the
   engine stops), **When** they run `install` again, **Then** it continues from where it stopped,
   without a second owner and without regenerating secrets.
6. **Given** a script or the desktop app, **When** it runs
   `your-space install --name "…" --username … --yes --json`, **Then** no question is asked, the
   output is one JSON object per step, and the exit status says what happened.

### User Story 2 - Run It (Priority: P1)

As the owner, I can start, stop and check my space and read its logs with one command each, so I
never need to know which Compose commands keep my apps running or stop them.

**Independent Test**: After installing and installing an app, run `your-space stop`, check that
Your Space and the app are stopped, run `your-space start`, and check that both come back and
`your-space status` says so.

**Acceptance Scenarios**:

1. **Given** a running space with apps, **When** the owner runs `your-space status`, **Then** it
   shows the version, the setup and address, whether each Your Space service is healthy, the engine
   and its reachability, and each app with its state and address.
2. **Given** a running space with apps, **When** they run `your-space stop`, **Then** the apps
   stop first, then Your Space, and nothing is deleted.
3. **Given** a stopped space, **When** they run `your-space start`, **Then** Your Space starts and
   brings its apps back, and the command returns once the space is healthy, or says what isn't.
4. **Given** a running space, **When** they run `your-space logs`, **Then** they see Your Space's
   recent logs, and can follow them or choose one service.
5. **Given** the CLI can't find an installation, **When** any of these commands runs, **Then** it
   says so and how to point it at one (`--dir`), and changes nothing.

### User Story 3 - Recover the Owner and Manage Secrets (Priority: P2)

As the owner who lost their password, I can get a new set-password link with one command, and I can
see where my space's secrets come from and replace one, without `docker compose exec`.

**Acceptance Scenarios**:

1. **Given** an installation with an owner, **When** they run `your-space owner reset-link`,
   **Then** they get the same link and the same rules as the server's `reset-link` (it works once,
   for 30 minutes, and cancels earlier links).
2. **Given** an installation without an owner, **When** they run `your-space owner create`, **Then**
   it creates one as install would; running it again says the owner already exists.
3. **Given** an installation, **When** they run `your-space secrets show`, **Then** they see each
   secret's source (generated or `.env`) as the server's `show-secrets` reports it; values are shown
   only when they ask for them.
4. **Given** an installation, **When** they run `your-space secrets replace <name>` and confirm,
   **Then** the CLI runs every step the guide lists for it: the secrets step's `--new`, giving
   PostgreSQL the new database password, and restarting the server. It says beforehand what the
   replacement changes (replacing the auth secret signs every device out). A secret set in `.env` is
   left alone, and the CLI says to change it there.
5. **Given** the `ys-secrets` volume is lost but the database is kept, **When** the owner runs
   `your-space start`, **Then** the CLI explains the
   [lost secrets](../../docs/install/README.md#lost-secrets) choices and offers to start with new
   secrets, running the same steps.

### User Story 4 - Your Own Domain (Priority: P1)

As a person installing on a server, I can give my domain during install and get HTTPS for my space
and every app, with the CLI checking what it can before it opens ports and explaining any failure
in plain words.

**Independent Test**: In CI, with a domain that resolves to the test machine and a test certificate
authority, run `your-space install --domain …`, and check that the space and an app answer over
HTTPS with valid certificates. On a real server, the same with a real domain (verification task).

**Acceptance Scenarios**:

1. **Given** the person chooses "your own domain" and gives `space.example.com`, **When** the CLI
   checks it, **Then** it resolves `space.example.com` and a random name under it (the wildcard apps
   need), says which records are missing or point elsewhere, and asks before going on when a check
   fails.
2. **Given** ports 80 or 443 are in use, **When** they install with a domain, **Then** the CLI says
   which program has them where it can tell, and offers the own-proxy setup instead.
3. **Given** the checks pass, **When** Your Space starts, **Then** the CLI writes `YS_DOMAIN`, waits
   for the certificate, and reports success with the HTTPS address, or reports why the certificate
   failed (the name doesn't reach this machine, a firewall blocks port 80 or 443, the certificate
   authority's rate limit) using what the built-in proxy logged.
4. **Given** an installed space, **When** the owner runs `your-space configure` and chooses another
   setup or domain, **Then** the CLI changes the `.env` lines, restarts Your Space, and runs the same
   checks; their account, sessions' data and apps are kept.

### User Story 5 - Your Own Proxy or Tunnel (Priority: P2)

As a person who already runs a reverse proxy, or a tunnel such as Tailscale, I can install Your
Space behind it, and the CLI tells me exactly what to forward, including each app's name.

**Acceptance Scenarios**:

1. **Given** the person chooses "your own proxy or tunnel" and gives its address,
   **When** they install, **Then** the CLI writes `YS_PROXY_URL`, starts Your Space, and prints where
   to forward (`http://127.0.0.1:<port>`, or the `your-space_edge` network for a proxy in a
   container), and that the proxy must pass the original host name.
2. **Given** an installation behind a proxy, **When** the owner runs `your-space status`, **Then**
   it lists the names the proxy must forward: Your Space's own and each app's
   (`<app>.<proxy's host>`), and says a wildcard name covers every app.
3. **Given** a tunnel that can't forward a wildcard name, **When** the owner installs another app,
   **Then** they can see the new name to add in `status`, and the installation guide shows how to
   add it in common proxies and tunnels, Tailscale included. Your Space itself contains no code for
   any of them.
4. **Given** the proxy's address isn't reachable from this machine, **When** they install, **Then**
   the CLI still installs (the proxy may be set up afterwards) and says it couldn't reach the
   address yet.

### User Story 6 - macOS, and an Installation Set Up by Hand (Priority: P2)

As a person on a Mac with Docker Desktop, Colima or OrbStack, I can use the same CLI, and as a person
who installed Your Space by hand, I can manage that installation with the CLI without reinstalling.

**Acceptance Scenarios**:

1. **Given** a Mac with a running engine, **When** they run the same install command, **Then** the
   CLI uses that engine, including its socket path for the runtime manager (`YS_ENGINE_SOCKET`), and
   installs as on Linux.
2. **Given** a Mac with no running engine, **When** they run `install`, **Then** the CLI says Your
   Space needs a Docker-compatible engine, names the options (Docker Desktop, Colima, OrbStack), and
   starts nothing. Your Space providing its own engine comes with the desktop app
   ([open question 1](#decisions-and-open-questions)).
3. **Given** a folder installed by hand, **When** they run `your-space install --dir <folder>` or
   any command with `--dir`, **Then** the CLI recognises the installation, keeps its `.env` lines
   and data, remembers the folder, and manages it from then on.

### User Story 7 - The Guide (Priority: P2)

As a person reading the installation guide, I see the CLI first, and manual Compose as an advanced
option that is still complete.

**Acceptance Scenarios**:

1. **Given** the installation guide, **When** a person follows its CLI section, **Then** every
   command in it works as written; a browser test follows it.
2. **Given** the guide's manual section, **When** a person follows it, **Then** it still installs
   Your Space as journey 001's guide did, and says which CLI command does each step.

### Edge Cases

- `install` in a folder that already has an installation: it doesn't reinstall; it offers
  `configure`, or does nothing with `--yes`.
- Two installations on one machine: each in its own folder and Compose project; `--dir` chooses one.
  Both can't use port 80; the second is offered another port.
- The CLI's version differs from the installation's: the CLI says so and changes nothing except
  `status` and `logs`. Updating is journey 006.
- The person isn't allowed to use the engine (not in the `docker` group, no root): the CLI says so
  and how to fix it, and never runs `sudo` itself.
- A release download fails its check: nothing is unpacked; the CLI says the download was damaged or
  changed and stops.
- No browser on the machine, or a remote shell: the link is printed, not opened.
- A question is needed but there is no terminal (a script without `--yes`): the CLI stops with the
  flag that answers it.
- Stopping while an app install is running: `stop` says an install is in progress and asks, since
  the install job would be cut off.

## Requirements

### Functional Requirements

**Getting the CLI**

- **FR-001**: The CLI is one executable per supported system and processor (Linux and macOS, ARM
  and Intel), published with each release. It needs no language runtime installed on the machine.
- **FR-002**: A documented one-line command installs it for the current user, checks the download
  against the release's published checksums before installing it, and tells the person how to add
  it to their path if needed. The command can also be downloaded and read before running it.
- **FR-003**: The CLI and Your Space share one version. `install` downloads the release files of
  the CLI's own version and checks them the same way.

**Installing**

- **FR-004**: `install` asks only what has no safe default: the setup (default this machine), the
  domain or proxy address for those setups, the owner's name and username. Each question has a flag;
  `--yes` accepts every default, and a question without an answer and without a terminal is an
  error naming the flag.
- **FR-005**: Before downloading or starting anything, `install` checks the engine connection
  (reachable, version, processor type), Compose's version, and the ports the chosen setup needs,
  with the same minimum versions as the installation guide.
- **FR-006**: `install` writes only the `.env` lines the person's answers require, as the guide
  documents them, and never writes a secret into `.env`: secrets are generated by Your Space as in
  journey 001.
- **FR-007**: `install` creates the owner through the server's `create-owner` command and shows its
  set-password link, opening it in the browser when the machine has one.
- **FR-008**: Running `install` again after an interruption continues it: it reuses the folder,
  files and generated secrets, and `create-owner`'s own retry rule prevents a second owner.
- **FR-009**: The default folder is `your-space` in the person's home folder; `--dir` chooses
  another. The CLI remembers the folders it installed or adopted, in the person's own configuration
  folder, so later commands find them from anywhere.

**Running**

- **FR-010**: `start` starts Your Space, waits until it is healthy, and Your Space brings its apps
  back. `stop` stops the apps through the runtime manager first, then Your Space. Neither deletes
  anything.
- **FR-011**: `status` shows the version, setup and address, each service's state and health, the
  engine, and each app's state and address (from the server's `list-apps --json`). With a proxy or
  tunnel it lists the names to forward.
- **FR-012**: `logs` shows Your Space's logs, for one service or all, and can follow them.
- **FR-013**: `owner create`, `owner reset-link`, `secrets show` and `secrets replace` wrap the
  server's commands, with their rules, exit statuses and JSON output.
- **FR-014**: `configure` changes the setup, domain, proxy address or port after installing, with
  the same questions and checks as `install`, and restarts Your Space. It keeps data, the owner and
  apps.

**Setups**

- **FR-015**: With a domain, the CLI checks that the domain and a random name under it resolve, and
  where they point, before opening ports; after starting, it waits for the built-in proxy's
  certificate and explains a failure from the proxy's log.
- **FR-016**: With a proxy or tunnel, the CLI says where to forward, which names (Your Space's and
  each app's, or a wildcard), and that the original host name must be passed. Your Space contains no
  code specific to any proxy or tunnel product; the guide shows common ones.

**Every command**

- **FR-017**: Every command has `--json` output for scripts and the desktop app, and documented exit
  statuses, following the server commands' pattern (0 done, 1 invalid input, 2 a state that stops
  it, 3 the engine or database unreachable, 4 unexpected).
- **FR-018**: The CLI never prints a secret or a set-password token unless the command exists to
  show it, and never logs them.
- **FR-019**: The CLI makes no network request except to download releases from GitHub and to reach
  the installation itself. No telemetry.
- **FR-020**: The CLI never runs `sudo` or changes system settings (the firewall, DNS, the engine's
  configuration); when one needs changing it says what and how.
- **FR-021**: Errors say what happened and what to do, in Your Space's terms; Compose's and the
  engine's own output is available with `--verbose`.

### Key Entities

- **Installation**: a folder with the release files and `.env`, its Compose project name, version
  and setup. The CLI keeps only a list of known folders; everything else is read from the folder
  and the running space.
- **Release files**: `compose.yaml`, `stack.yaml`, `modes/` and `env.example` for one version, with
  their checksums.
- **CLI configuration**: the known installations and which is the default, in the person's own
  configuration folder. It holds no secrets.

## Success Criteria

- **SC-001**: On a clean Linux machine with Docker, a person goes from nothing to signed in at
  `http://space.localhost` with two commands and two answers, in under five minutes on a normal
  connection.
- **SC-002**: With a domain that resolves to the server, the space and a newly installed app answer
  over HTTPS with valid certificates, with no `.env` edited by hand.
- **SC-003**: Every failure in the install's checks names the problem and the fix; no Compose or
  engine error reaches the person without an explanation unless `--verbose` is set.
- **SC-004**: A space installed with the CLI and one installed by hand have the same files, the same
  `.env` lines for the same choices, and the same data, so either can be managed the other way.
- **SC-005**: Every command's JSON output and exit statuses are documented and covered by tests.

## Assumptions

- The person has a Docker-compatible engine, or can install one: Docker Engine on Linux; Docker
  Desktop, Colima or OrbStack on macOS until Your Space provides its own.
- Servers run Linux; macOS is supported for this machine and for a server, as in journey 001.
- The CLI runs on the machine Your Space runs on. Managing a remote installation from another
  machine needs remote sign-in for the CLI, which journey 006 specifies with backup.

## Changes to Shared Direction

1. **Your Space has no code for a particular proxy or tunnel.** It knows its own address and, behind
   a proxy or tunnel, the names to forward. Setting up Tailscale Services for apps is documented,
   not automated; this closes journey 002's task T035 that way. The decision record's "documented
   guidance for a private tunnel such as Tailscale" stays as written.
2. **The CLI's name is `your-space`, with no short alias.** `ys` is already the command of
   YAMLScript, a widely installed tool.
3. **The engine Your Space provides itself on macOS comes with the desktop app (journey 008)**, if
   [open question 1](#decisions-and-open-questions) is settled as proposed. Until then the CLI uses
   an engine the person runs, on macOS too. This settles the "journey 003 or 008" left open on
   2026-11-14.
4. **Windows moves with the desktop app (journey 008)**, if
   [open question 2](#decisions-and-open-questions) is settled as proposed. Windows is not a server
   host, so it matters only for a local workspace, which the desktop app provides.
5. **Remote management waits for journey 006.** The CLI manages installations on its own machine;
   the decision record's remote CLI authentication stays with backup and restore.

## Decisions and Open Questions

Decided on 2026-11-16:

- **TypeScript, built into one executable with Node's single-executable feature**, published on each
  release. Command parsing and questions use well-known libraries rather than custom code; the plan
  names them (the candidates are Commander for commands and Inquirer's prompts for questions).
- **The name `your-space`, with no alias** (Change 2).
- **No proxy- or tunnel-specific code** (Change 1).

Open:

1. **The engine on macOS.** Proposed: the CLI uses an engine the person already runs, and Your
   Space's own virtual machine comes with the desktop app in journey 008, since CI can't run a
   virtual machine on macOS to test it and 008 already holds the macOS-specific work. The
   alternative is that the CLI creates and runs a Lima virtual machine in this journey.
2. **Windows.** Proposed: move it to journey 008 with the local workspace. The alternative is a Low
   slice at the end of this journey.
