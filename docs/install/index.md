---
title: "Install Your Space"
---

Your Space 0.1.0-alpha.1 is an alpha, for trying Your Space out. Read the [alpha limits](#alpha-limits)
before you rely on it.

The [quick start](#quick-start) sets up Your Space for this machine only. The numbered steps after
it let you choose how you'll reach it, including from other devices with your own domain or proxy,
and the [manual Docker Compose steps](manual.md) cover the same setup by hand. Creating the owner requires shell access to that machine. On a Mac, you
can use the [desktop app](macos-desktop.md) instead. To work on Your Space itself, [try it from source](from-source.md).

Your Space runs as four containers, after a short step that runs first:

- **secrets** runs once on each start, before the others, and exits. It generates the auth secret
  and the database password on the first start (see [Secrets](manual.md#secrets)), so `docker compose ps -a`
  lists it as exited.
- **caddy** serves the web client and handles HTTPS, including getting certificates.
- **server** is the API. It also holds the operator commands `create-owner`, `reset-link`,
  `show-owner` and `show-secrets`, which the `your-space` command runs for you.
- **runtime** is the runtime manager, the only part of Your Space that uses the Docker engine. It
  runs the apps you install.
- **postgres** stores everything: your account, your workspace, and your sessions.

## Before You Start

You need:

- A Linux or Mac machine with a Docker-compatible engine:
  - Linux with [Docker Engine](https://docs.docker.com/engine/install/) 28.3.3 or newer and the
    Docker Compose plugin. Older Engine versions can open ports meant for this machine only to the
    network after a firewall reload (CVE-2025-54388).
  - macOS with an engine such as [OrbStack](https://orbstack.dev), [Colima](https://github.com/abiosoft/colima)
    or [Docker Desktop](https://docs.docker.com/desktop/). Your Space doesn't need Docker Desktop
    itself; Docker Desktop's license is free only for personal use, education, non-commercial open
    source and small businesses.
- Docker Compose 2.26.0 or newer: `docker compose version` prints `v2.26.0` or later.
- About 1 GB of free memory and 2 GB of disk.
- For access from other devices: a domain name pointing at the server, or [Tailscale](https://tailscale.com).
  See [Use Your Space From Other Devices](other-devices.md).

Windows is not supported as a server.

**Checked so far:** the `your-space` command, from a release built from this repository, and the
manual steps 2 to 5 and the later sections were checked only with locally built images on Linux on
Intel/AMD (x86_64) with Docker Engine 29 and Compose 5.6, in Chromium, Firefox, and WebKit. Each setup's published ports and the generated secrets were checked on Compose 5.6 and
2.26.0, and the this-machine and own-proxy setups also with a running stack. Downloading from
a release, the published images, macOS, ARM machines such as Apple Silicon, IPv6, and HTTPS with a
real domain or Tailscale have not been checked yet. [The verification record](https://github.com/your-space-ai/your-space/blob/main/specs/001-workspace-owner-access/verification.md) lists
exactly what was tested, with versions.

Check Docker before you go on:

```sh
docker version
docker compose version
```

If either command fails, install or start Docker first. On macOS, start your engine (for example,
open OrbStack, or run `colima start`) and wait until it is running. `your-space` checks all of this
too, and says what is missing.

## Quick Start

With Docker running and Node 22.12 or newer, run:

```sh
npx @your-space-ai/cli@0.1.0-alpha.1 setup
```

`setup` asks where to keep the installation (`~/my-your-space` unless you choose another folder),
and whether to keep its defaults, port 80 and the username `owner`, or choose your own. It downloads
the 0.1.0-alpha.1 release files, checks them against the release's checksums, and starts Your Space
for this machine only, at `http://space.localhost` (with the port added if you chose another one).
If the port is already in use, it offers a free one. The first start downloads the images, which
takes a minute or two.

Then it creates your account, saves a link for setting your password in a private file in the
installation folder, and prints that file's path. Open the link within 30 minutes, choose a password
of 12 to 128 characters, and sign in with your username. If the link expires,
`your-space owner reset-link --workdir ~/my-your-space` prints a new one.

npx runs the command without installing it. For every later command on these pages, either put
`npx @your-space-ai/cli@0.1.0-alpha.1` in place of `your-space`, or install the `your-space` command
once, as the next step describes. Run each command in the installation folder, or name the folder
with `--workdir`: for example, `your-space status --workdir ~/my-your-space` shows what is running
and how to reach it.

## 1. Get the `your-space` Command

Get version 0.1.0-alpha.1 of the command one of these ways:

| Machine | How to get `your-space` |
| --- | --- |
| Any Mac or Linux machine with Node 22.12 or newer | The npm package `@your-space-ai/cli`: `npm install -g @your-space-ai/cli@0.1.0-alpha.1`, or put `npx @your-space-ai/cli@0.1.0-alpha.1` in place of `your-space` in each command |
| Linux Intel/AMD or ARM64 without Node | The standalone executable `your-space-linux-x64` or `your-space-linux-arm64` from the [0.1.0-alpha.1 release](https://github.com/your-space-ai/your-space/releases/tag/v0.1.0-alpha.1) |
| Mac with the desktop app | The CLI bundled in the app, at `Your Space.app/Contents/Resources/bin/your-space` |

For a standalone executable, download it and `SHA256SUMS` from the same release into an empty
folder, then verify and install it. On Intel/AMD, for example (use `arm64` on ARM):

```sh
asset=your-space-linux-x64
release=https://github.com/your-space-ai/your-space/releases/download/v0.1.0-alpha.1
curl -fL -O "$release/$asset" -O "$release/SHA256SUMS"
awk -v name="$asset" '$2 == name { print }' SHA256SUMS | sha256sum -c - &&
  mkdir -p ~/.local/bin &&
  install -m 755 "$asset" ~/.local/bin/your-space
```

Proceed only when it prints `OK`, and make sure `~/.local/bin` is on your `PATH`. Check that
`your-space --version` matches the release you selected. For a quick local installation, use
`your-space setup`. For a domain or existing reverse proxy, continue below. The release's
`your-space-linux-licenses.txt` holds the licenses of Your Space and of the Node runtime and
packages inside the executable.

## 2. Make a Folder for Your Space

```sh
mkdir your-space && cd your-space
your-space init
```

`init` asks how you'll reach Your Space; press Enter for **This machine**, the default. It downloads
the release that matches the `your-space` command's version, checks it against the release's
checksums, and writes `.env`. With this machine, `.env` has no settings, unless Docker on Linux
uses a socket other than `/var/run/docker.sock`, such as rootless Docker's: then `init` adds it as
`YS_ENGINE_SOCKET`.

Run every later `your-space` command in this folder, or name it with `--workdir <folder>`.

## 3. Start It

```sh
your-space start
```

It checks Docker and the ports it needs, starts Your Space (the first start downloads the images,
which takes a minute or two), and asks your name and the username you'll sign in with. Then it
creates your account and prints a summary: your address, a link to set your password, and what is
running. On a computer with a browser, it opens the link for you.

If something is in the way, `start` says what and what to do. For example, when another program
already uses port 80, it offers the next free port and writes it to `.env` as `YS_PORT`.

## 4. Set Your Password and Sign In

Open the link within 30 minutes. Choose a password of 12 to 128 characters; a long passphrase is a
good choice. Then sign in with your username and that password.

The link works once. If it expires or you lose it, `your-space owner reset-link` prints a new one.

## Update to a Later Release

When a later release comes out, run `upgrade` in the installation folder, with the latest command:

```sh
npx @your-space-ai/cli@latest upgrade
```

If you installed the `your-space` command, get the new version first, then upgrade:

```sh
npm install -g @your-space-ai/cli@latest
your-space upgrade
```

With a standalone executable, download and install the new release's as in [step 1](#1-get-the-your-space-command),
then run `your-space upgrade`. From 0.1.0-alpha.2, `your-space upgrade --channel alpha` upgrades
without installing the new command: it downloads the newest release's command to a temporary
folder, checks it and runs its `upgrade` from there, as
[Follow a Release Channel](../operate/index.md#follow-a-release-channel) describes. The command you
installed stays at its version, and its plain `upgrade` refuses an installation newer than itself,
so install the new one too when you want to use it. `upgrade` names both versions and asks first. It backs up the
database before it changes anything, keeps `.env`, your apps and their data, and puts the previous
version back if the new one doesn't start. [Run Your Space](../operate/index.md) describes each
step. The [Mac app](macos-desktop.md) updates itself, and its local workspace with it.

## Alpha Limits

0.1.0-alpha.1 is the first release, and some of what a workspace you rely on needs isn't there yet:

- **No backup or restore.** `upgrade` backs up the database before it changes anything; nothing
  else backs up a workspace or restores one. Your account and workspace are kept in Docker volumes,
  and each app keeps its data in its own. [Restarts and your data](../operate/index.md#restarts-and-your-data)
  lists them, and which commands keep or delete them.
- **No uninstall.** No command removes Your Space yet. [Remove Your Space](../operate/index.md#remove-your-space)
  gives the steps, in the order that leaves none of your apps behind.
- **Apps install only from their kits.** In **Apps**, paste the link to a kit in a public GitHub
  repository. A kit in a private repository installs only from the machine that runs Your Space,
  with `docker compose exec -T server install-app --kit - < kit.yaml`, and the Compose file it names
  must still be in a public repository. Your Space doesn't connect to your GitHub account, manage
  repositories, list a directory of kits or let you make your own Home yet. See
  [Install and publish apps](../apps/install-apps.md).
- **A kit that asks for a value installs only from Apps.** `install-app` passes no values, so a kit
  whose `env` has a value with `ask: true` installs only from the review in **Apps**, where you give
  it. A kit in a private repository that needs such a value can't be installed yet.
- **Installed apps don't update.** A newer kit or Compose file reaches an installed app only when you
  remove the app, keeping its data, and install it again.
- **Agent writes are new.** A kit can give an agent routes that create, change or delete records.
  They have run against a test app only so far. See [Give an agent access to one app](../apps/agent-access.md).
- **One account.** Only the owner signs in; inviting other people isn't available yet.
- **No email.** Your Space sends no email. When you need a new set-password link, run
  `your-space owner reset-link` on the machine that runs Your Space ([recovery](../operate/recovery.md)).
- **Not every setup is tested.** [Checked so far](#before-you-start) lists what has been, and the
  [release notes](https://github.com/your-space-ai/your-space/releases/tag/v0.1.0-alpha.1) list the
  platforms tested for this release. Windows is not supported as a server.

### Report a Problem

[Open a bug report](https://github.com/your-space-ai/your-space/issues/new?template=bug_report.yml)
on GitHub. It asks for:

- the version: what `your-space --version` prints, or for the Mac app, what **Your Space › About
  Your Space** shows;
- how you installed Your Space, your operating system and architecture, and the output of
  `docker version` and `docker compose version`;
- what you did, what you expected and what happened, with any error message;
- the relevant lines of `your-space logs`, if Your Space started ([with the Mac app](macos-desktop.md#logs-and-recovery),
  the bundled CLI's `logs`).

Issues are public. Leave out set-password links, keys, secrets and private app data, and use an
example address in place of your own domain if you prefer. Report a security problem privately,
as the [security policy](https://github.com/your-space-ai/your-space/blob/main/SECURITY.md) describes.

## Next

- [Use Your Space from other devices](other-devices.md): your own domain, your own reverse proxy, or Tailscale.
- [Install and publish apps](../apps/install-apps.md), and [give an agent access to one app](../apps/agent-access.md).
- [Run Your Space](../operate/index.md): everyday commands, updating to a newer release, sessions, restarts and your data, and what Your Space encrypts.
- [Recover secrets and the owner account](../operate/recovery.md).
- [Install by hand](manual.md) with Docker Compose instead of the `your-space` command.
