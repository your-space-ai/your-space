# Research: Install and Run With the CLI

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

## R1. The Supabase CLI's shape

The owner asked for a Supabase-like experience. From the
[Supabase CLI's getting started guide](https://supabase.com/docs/guides/local-development/cli/getting-started)
(updated 2026-11-02):

- **Getting it**: package managers only. npm (`npx supabase`, or a project dependency), a Homebrew
  tap, Scoop, and `.apk`, `.deb` and `.rpm` packages on GitHub releases. No `curl | sh` script.
- **Two commands**: `supabase init` writes a `supabase` folder with a `config.toml` in the current
  folder; `supabase start` pulls the images on the first run, starts everything and prints boxed
  tables of URLs and keys. `status` prints them again; `stop` keeps the data.
- **Project-scoped**: commands act on the current folder (`--workdir` names another). There is no
  list of projects. With the default ports, one project runs per machine.
- **Engine**: any Docker-compatible engine. On macOS it recommends OrbStack; Rancher Desktop,
  Podman and Colima also work.
- **Telemetry**: on by default, with an opt-out. Your Space has none (spec map rule).

Taken: package managers, `init` then `start`, the summary, folder scope, any engine. Not taken:
telemetry, and a configuration file of its own; Your Space's settings stay in `.env`, so the CLI
and the manual install share one format.

## R2. Command and question libraries

Constitution VII asks for few dependencies, an existing one where it handles the need well, and no custom layers on top. The CLI needs subcommands with options and
help, questions with defaults, and progress for slow steps.

| Need | Chosen | Considered |
| --- | --- | --- |
| Commands | **Commander** 15 (MIT, no dependencies, the most-used Node CLI parser). Subcommands, typed options, help, `--version`, and `exitOverride` for our exit statuses are built in. | Node's `util.parseArgs` (the server's commands use it): no subcommands or help, which we would have to write. yargs: larger. oclif: a framework with plugins and generators. citty: smaller community. |
| Questions and progress | **@clack/prompts** (MIT; it brings `@clack/core` and four small packages of its own: `sisteransi`, `fast-wrap-ansi`, `fast-string-width`, `fast-string-truncated-width`): `text`, `select`, `confirm`, `spinner`, `log`, `note`, `intro`, `outro` and cancellation in one package. | Inquirer's prompts: questions only, so a spinner library would be a third dependency. ora plus readline: two pieces for what Clack does. |

Both are bundled into the published CLI, so installing it adds nothing to a person's machine. The
summary box uses Clack's `note`; the CLI adds no output layer of its own beyond `--json`.

## R3. Packaging

**Standalone executable.** Node 25.5 added `node --build-sea <config>`, which writes the executable
in one step ([Node.js docs](https://nodejs.org/api/single-executable-applications.html)). The
config's `executable` field names the Node binary to inject into, which must be the same version as
the Node that builds it; for another processor, `useCodeCache` and `useSnapshot` must stay off. So
one Intel runner builds both Linux executables: it downloads the official Node binary for ARM of
its own version, checks it against Node's `SHASUMS256.txt`, and builds with it. The main script is
one CommonJS bundle, since an ES module main needs the virtual file system option.

**npm.** The same bundle, with a `#!/usr/bin/env node` line, is the package's `bin`. Its
dependencies are inside it, so the package has none. It needs Node 22 or newer, which the bundle
targets.

**Linux packages.** The package holds one file, `/usr/bin/your-space`, with no dependencies, so the
distributions' own tools are enough: `dpkg-deb --build` with a five-line `control` file, and
`rpmbuild -bb` with a short spec file. nfpm (GoReleaser's packager) and fpm (Ruby) were considered;
the owner preferred the native tools over a smaller project, and they add nothing to install on the
runner but the `rpm` package.

**Homebrew and macOS executables** wait for the macOS and Windows pass (spec, Change 6).

## R4. Checking downloads

Each release publishes a `SHA256SUMS` file listing every file it holds: the tarball, executables
and packages. `init` downloads `SHA256SUMS` and the tarball from the same release, checks the
tarball's hash with `node:crypto`, and unpacks it only if it matches. A checksum file from the same
place guards against damaged and partial downloads and mismatched versions, not against someone who
can change the release; that needs signatures. GitHub's artifact attestations
(`gh attestation verify`) or Sigstore can be added in the release gate's security review without
changing the CLI's commands.

The tarball is unpacked with the system `tar` (`tar -xzf <file> -C <folder>`), present on every
Linux and macOS machine, rather than a dependency.

## R5. The engine connection

- **Which engine**: the one Docker's own client uses, so a person's existing setup just works. The
  CLI runs the Docker CLI, which follows `DOCKER_HOST` and the current context. The endpoint comes
  from `docker context inspect` (or `DOCKER_HOST`).
- **Its socket for the runtime manager**: the runtime manager mounts the engine's socket
  (`YS_ENGINE_SOCKET`, default `/var/run/docker.sock`). On Linux, when the endpoint is
  `unix://<path>` and the path isn't the default (rootless Docker's `/run/user/<uid>/docker.sock`, or
  another context), `init` and `start` write `YS_ENGINE_SOCKET=<path>`. On macOS the engine runs in
  a virtual machine where `/var/run/docker.sock` is the engine's own socket, whatever the client's
  path on the Mac, so nothing is written; this is checked in the macOS pass.
- **Remote engines** (`tcp://`, `ssh://`) are refused: Your Space publishes its ports on the
  engine's machine and serves `space.localhost` there, so it must be this machine's engine.
- **Versions**: `docker version --format json` gives the engine's version, OS and processor;
  `docker compose version --short` gives Compose's. The minimums are the guide's: Docker Engine
  28.3.3 on Linux (CVE-2025-54388) and Compose 2.26.0.

## R6. A domain: names and the certificate

- **Names**: `node:dns` `lookup` resolves the domain and a random name under it
  (`ys-check-<random>.<domain>`), which only a wildcard record answers. Both must resolve, and to
  the same addresses, since Caddy serves both. The CLI can't tell whether an address is this
  machine's public one without asking an outside service, which the no-telemetry rule rules out, so
  it reports the addresses rather than judging them.
- **The certificate**: after starting, the CLI connects to `127.0.0.1:443` with the domain as the
  TLS server name and reads the certificate Caddy presents. Connecting locally works whatever the
  DNS or the router does. It succeeds when the certificate names the domain and isn't Caddy's own
  temporary one. While waiting, it reads `docker compose logs caddy`: Caddy logs JSON, and a failed
  attempt carries the certificate authority's problem (`connection` or `timeout` for a blocked port,
  `dns` for a name that doesn't resolve, `rateLimited`), which the CLI turns into plain words.
- **Tests**: [Pebble](https://github.com/letsencrypt/pebble), Let's Encrypt's test authority, runs
  beside the stack with `PEBBLE_VA_ALWAYS_VALID=1`, so it issues without reaching the test machine
  from outside. The test points Caddy at it with a test-only copy of the Caddyfile that adds
  `acme_ca` and `acme_ca_root`, so the production Caddyfile is unchanged.

## R7. Ports

The CLI runs without root, and Docker publishes ports from its own daemon, so the CLI can't test a
port by binding it (ports below 1024 need root). It connects to the port on `127.0.0.1` instead: an
answer means something already listens there. `docker ps --filter publish=<port>` names the
container when it is one. Ports Your Space itself already holds (its own `caddy` is running) are
skipped. For this machine and the own-proxy setup, the CLI offers the first free port from 8081 and
writes it as `YS_PORT`; a domain needs 80 and 443, so it offers the own-proxy setup instead.

## R8. Whether there is an owner

`start` creates the owner only when there is none, so it must know without side effects.
`create-owner` needs the name and username first, and `reset-link` cancels an earlier link. A new
read-only server command, `show-owner [--json]`, answers from the installation record and the
owner's membership: whether there is an owner, and their username and name. Whether they have set
their password can't be told reliably (`create-owner` gives the account a random password the owner
never sees), so the summary always says how to get a new link. It follows the operator commands
contract.

## R9. One installation per engine

`compose.yaml` names the project `your-space`, so the volumes are `your-space_ys-postgres` and so on,
as the guide and its recovery steps say. Two folders on one engine would share those volumes. The
CLI keeps the fixed name, so a CLI installation and a manual one are the same, and finds an existing
installation from Compose's own labels (`com.docker.compose.project=your-space`,
`com.docker.compose.project.working_dir`). In another folder, `init` and `start` stop and name the
existing folder.

## R10. Opening the link

The CLI opens the set-password link with `xdg-open` on Linux and `open` on macOS, only when there is
a desktop session (`DISPLAY` or `WAYLAND_DISPLAY` on Linux) and not over SSH (`SSH_CONNECTION`). It
always prints the link. A few lines of code; the `open` package wasn't needed.

## R11. Proxies and tunnels

Your Space knows its own address and, behind a proxy, which names reach it: its own host and
`<app>.<host>` for each app, or a wildcard. The summary lists them with where to forward:
`http://127.0.0.1:<port>`, or `http://your-space:8080` on the `your-space_edge` network for a proxy in
a container. A proxy that can't forward a wildcard needs one name per app, which the summary lists.
Tailscale can't hold names under a machine's name (`sure.myserver.tail1234.ts.net`), and a Tailscale
Service's name sits beside the machine's, not under it, so apps over Tailscale stay unsupported
until the hosting review settles a way (journey 002's T035). Your Space has no code for any product
(spec, Change 2).

## R12. Verified in this journey, and not

Built and tested on Linux on Intel in CI and in the development container; the ARM executable is
built in CI and run on CircleCI's Arm machine. Not verified here: macOS (the npm package and,
later, the executables), a real domain with Let's Encrypt, Windows. They join the macOS and Windows
pass and the release gate's checks on real hosts.
