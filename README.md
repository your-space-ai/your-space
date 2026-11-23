# Your Space

Your Space is a personal dashboard you run with Docker on your own computer or server.
Open it in a browser or the Mac app to install self-hosted apps and use them side by side.
Save a layout to reopen it from the sidebar, pick a theme, or make your own.

You can give an AI agent its own key and choose what it can do in each app.
The app’s installation kit defines the roles. You decide which actions need approval.
Your Space keeps app credentials on the server and records which agent acted.

## Try it from source

[Start the dashboard with Docker](docs/install/from-source.md). The walkthrough takes you from a
clean checkout to signing in, installing a sample app, and opening it in the dashboard.
It uses a local demo environment and the sample kits included here.

The current preview runs from source. To try the Mac launcher, follow the
[Mac build instructions](docs/install/macos-desktop.md#build-and-verify-a-private-candidate).
Apple Silicon and Intel disk images will be published on [GitHub Releases](https://github.com/your-space-ai/your-space/releases).

## Explore Your Space

- [Give an agent access to an app](docs/apps/agent-access.md)
- [Build your own Home app](docs/apps/build-an-app.md)
- [Customize an installed app or bring your own kit](docs/apps/managed-repositories.md)
- [Create and share a theme](docs/appearance.md)

For setup on a server, contributor guides, and design decisions, browse the [documentation](docs/index.md).
The [roadmap](docs/roadmap.md) tracks what’s implemented and what’s planned.

## Current limits

An external agent has completed an owner-approved read from an independently installed app.
Creating and editing records have been tested with a synthetic app. Those writes still need
verification against an independent app, including replay after an interrupted request and
rejection of a stale edit. [Agent verification](specs/005-owner-agent/tasks.md)

## Feedback and contributions

For bugs or feature requests, [open an issue](https://github.com/your-space-ai/your-space/issues/new)
with what you tried and what happened. Use a synthetic example and omit keys, sign-in links, and
private app data. For a vulnerability, use the [private reporting instructions](SECURITY.md).

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
