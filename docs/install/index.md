---
title: "Install Your Space"
---

For the current source preview, start with [Try Your Space from source](from-source.md). It walks through creating an owner and opening a sample app. The [Mac guide](macos-desktop.md) covers building the launcher from source and using a published DMG when one is available.

The steps below cover the `your-space` command for a tagged release. Creating the owner requires shell access
to that machine. The [manual Docker Compose steps](manual.md)
cover the same setup.

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

## 1. Get the `your-space` Command

The source preview has no published CLI. To run the dashboard today, use the
[Docker source walkthrough](from-source.md). To exercise the CLI with locally built artifacts,
follow the [source candidate instructions](agent-setup.md#test-from-reviewed-source).

Once a tagged [Your Space release](https://github.com/your-space-ai/your-space/releases) includes the
CLI and server images, select that version and get the CLI one of these ways:

| Machine | How to get `your-space` |
| --- | --- |
| Any Mac or Linux machine with Node 22.12 or newer | The npm package [`@your-space-ai/cli`](https://www.npmjs.com/package/@your-space-ai/cli): `npx @your-space-ai/cli@<version>`, or `npm install -g @your-space-ai/cli@<version>` to get the `your-space` command |
| Linux Intel/AMD or ARM64 without Node | The standalone executable `your-space-linux-x64` or `your-space-linux-arm64` |
| Mac with the desktop app | The CLI bundled in the app, at `Your Space.app/Contents/Resources/bin/your-space` |

For a standalone executable, download it and `SHA256SUMS` from the same release into an empty
folder, then verify and install it. On Intel/AMD, for example (use `arm64` on ARM):

```sh
asset=your-space-linux-x64
awk -v name="$asset" '$2 == name { print }' SHA256SUMS | sha256sum -c - &&
  mkdir -p ~/.local/bin &&
  install -m 755 "$asset" ~/.local/bin/your-space
```

Proceed only when it prints `OK`, and make sure `~/.local/bin` is on your `PATH`. Check that
`your-space --version` matches the release you selected. For a quick local installation, use
`your-space setup`. For a domain or existing reverse proxy, continue below.

## 2. Make a Folder for Your Space

```sh
mkdir your-space && cd your-space
your-space init
```

`init` asks how you'll reach Your Space; press Enter for **This machine**, the default. It downloads
the release that matches the `your-space` command's version, checks it against the release's
checksums, and writes `.env`. With this machine, `.env` has no settings at all.

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

## Next

- [Use Your Space from other devices](other-devices.md): your own domain, your own reverse proxy, or Tailscale.
- [Install and publish apps](../apps/install-apps.md), and [give an agent access to one app](../apps/agent-access.md).
- [Run Your Space](../operate/index.md): everyday commands, sessions, restarts and your data, and what Your Space encrypts.
- [Recover secrets and the owner account](../operate/recovery.md).
- [Install by hand](manual.md) with Docker Compose instead of the `your-space` command.
