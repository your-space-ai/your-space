---
title: "Your Space documentation"
---

These pages are the maintained reference: how to install and run Your Space, what each release ships, and what has been decided and planned. For an in-depth tour of the code, subsystem by subsystem, read the generated [DeepWiki](https://deepwiki.com/your-space-ai/your-space). It is built from this repository and steered by [`.devin/wiki.json`](https://github.com/your-space-ai/your-space/blob/main/.devin/wiki.json); where it differs from these pages, these pages are correct.

## Run a workspace

- [Try the dashboard from source](install/from-source.md) with Docker and a sample app.
- [Install Your Space](install/index.md) with the `your-space` command, or [by hand](install/manual.md) with Docker Compose.
- [Use it from other devices](install/other-devices.md): your own domain, your own reverse proxy, or Tailscale.
- [Run Your Space](operate/index.md): everyday commands, sessions, restarts and your data, and what it encrypts.
- [Recover secrets and the owner account](operate/recovery.md).
- [Run the Mac launcher](install/macos-desktop.md) to set up a local workspace or connect to a server.
- [Set up with an agent](install/agent-setup.md) from an authorized shell.
- [Customize the appearance](appearance.md) and share a theme file.

## Build and customize apps

- [Install and publish apps](apps/install-apps.md), and [give an agent access to one app](apps/agent-access.md).
- [Build a Home app](apps/build-an-app.md) that displays data from the apps and read roles you choose.
- [Connect GitHub](apps/github-connection.md) to make public or private repositories available to your workspace.
- [Manage repositories and installation kits](apps/managed-repositories.md) to customize a source, import kits, and review a deployment.

## Work on Your Space

- [Contributor guide and repository layout](https://github.com/your-space-ai/your-space/blob/main/CONTRIBUTING.md)
- [Roadmap](roadmap.md) and [feature specifications](https://github.com/your-space-ai/your-space/blob/main/specs/README.md)
- [Architecture overview](architecture/overview.md), [design decisions](architecture/decisions.md), and [glossary](glossary.md)
- [Project constitution](https://github.com/your-space-ai/your-space/blob/main/.specify/memory/constitution.md) and [pane library decision](dependency-decisions/resizable-panels.md)
- [Release checklist for maintainers](maintainers/releasing.md)
