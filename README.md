# Your Space

Your Space is a personal dashboard you run with Docker on your own computer or server.
Open it in a browser or the Mac app to install self-hosted apps and use them side by side.
Save a layout to reopen it from the sidebar, pick a theme, or make your own.

You can give an AI agent its own key and choose what it can do in each app.
The app’s installation kit defines the roles. You decide which actions need approval.
Your Space keeps app credentials on the server and records which agent acted.

## Install the alpha

Your Space 0.1.0-alpha.1 is an alpha, for trying Your Space out. On a Mac or Linux machine with a
running Docker engine and Node 22.12 or newer, run:

```sh
npx @your-space-ai/cli@0.1.0-alpha.1 setup
```

It asks where to keep the installation, starts Your Space for this machine only, by default at
`http://space.localhost`, and saves a private link for setting your password in that folder.
npx runs the command without installing it, so put `npx @your-space-ai/cli@0.1.0-alpha.1` in place
of `your-space` in every later command, or install the `your-space` command with
`npm install -g @your-space-ai/cli@0.1.0-alpha.1`.

On a Mac, you can instead download the Apple Silicon or Intel disk image from the
[0.1.0-alpha.1 release](https://github.com/your-space-ai/your-space/releases/tag/v0.1.0-alpha.1).
Linux machines without Node can use the standalone executable from the same release. The
[installation guide](docs/install/index.md) covers each of these, a server with your own domain,
and the [alpha limits](docs/install/index.md#alpha-limits).

## Try it from source

To work on Your Space, [start the dashboard from a checkout](docs/install/from-source.md) with
Docker. The walkthrough takes you from a clean checkout to signing in, installing a sample app, and
opening it in the dashboard. It uses a local demo environment and the sample kits included here.
To build the Mac launcher yourself, follow the [Mac build instructions](docs/install/macos-desktop.md#build-from-source).

## Explore Your Space

- [Give an agent access to an app](docs/apps/agent-access.md)
- [Install apps from their kits](docs/apps/install-apps.md)
- [Create and share a theme](docs/appearance.md)

For setup on a server, contributor guides, and design decisions, browse the [documentation](docs/index.md).
For an in-depth tour of how the code works, read the generated [DeepWiki](https://deepwiki.com/your-space-ai/your-space).
The [roadmap](docs/roadmap.md) tracks what’s implemented and what’s planned.

## Current limits

External agents have read and written records in an independently installed app through Your
Space. Agent access is per app: an agent granted an app calls its API with the app key the owner
picks, and that key's role in the app is the limit; Your Space checks the path, not the body.
[Agent verification](specs/005-owner-agent/tasks.md) · [Agent access per app](specs/018-app-access/spec.md)

## Feedback and contributions

For bugs or feature requests, [open an issue](https://github.com/your-space-ai/your-space/issues/new/choose).
The bug report form asks for your version, how you installed Your Space, your platform and Docker
versions, what you tried and what happened. Use a synthetic example and omit keys, sign-in links,
and private app data. For a vulnerability, use the [private reporting instructions](SECURITY.md).

The [contributor guide](CONTRIBUTING.md) covers the repository layout, local checks and commit
sign-off under the [Developer Certificate of Origin](https://developercertificate.org/).
Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## License

Copyright (c) 2026 Chen Stanilovsky and contributors.

Your Space (server, runtime, web client, CLI and desktop app) is licensed under the
[GNU Affero General Public License v3.0 only](LICENSE). The repository includes development
scripts, templates and agent skills from GitHub Spec Kit 1.2.5 under its [MIT license](.specify/LICENSE).
The SDKs, once published from this repository, are licensed under the MIT License, so apps that
use them can choose any license.
