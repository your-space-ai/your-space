# Your Space

Your Space is a personal dashboard you run with Docker on your own computer or server.
Open the dashboard in a browser or the Mac app to install self-hosted apps and use them side by side.

You can give an AI agent its own identity and key. Each app's installation kit defines the
roles you can grant, such as read access. You choose the roles for each agent and decide which
actions need your approval. Your Space keeps the app credential on the server and records which
agent acted.

## Try it from source

Your Space is in development. There is no tagged release yet.

- On macOS, open the desktop launcher from source or build a private preview. Choose a local Docker engine or connect to an existing server. [Mac setup and preview guide](docs/install/macos-desktop.md)
- To try the dashboard, build the Docker Compose test stack from a checkout, create its owner,
  and install a sample app in the browser. [Dashboard quickstart](specs/002-install-an-app/quickstart.md)
- To try the command-line setup, use Node.js 26 or later and Docker. The CLI walkthrough builds
  the command and exercises it against locally built images. [CLI quickstart](specs/003-install-with-the-cli/quickstart.md)

The installation guide describes how to use matching release artifacts once a release is
available. It covers localhost, a server behind your own proxy, and a domain with HTTPS.
[Installation guide](docs/install/README.md)

## Current limits

An external agent has completed an owner-approved read from an independently installed app.
Creating and editing records have been tested with a synthetic app. Those writes still need
verification against an independent app, including replay after an interrupted request and
rejection of a stale edit. [Agent verification](specs/005-owner-agent/tasks.md)

## Feedback

For bugs or feature requests, open an issue with what you tried, what you expected, and what
happened. Use a synthetic example and omit keys, sign-in links, and private app data.
[Open an issue](https://github.com/your-space-ai/your-space/issues/new)

## Project guides

- [Roadmap](docs/roadmap.md)
- [Spec map](docs/spec-map.md): the journey specifications that deliver the roadmap
- [Public open-source readiness](docs/public-release-readiness.md)
- [Architecture overview](docs/architecture/overview.md)
- [Architecture and product decisions](docs/architecture/decisions.md)
- [Project constitution](.specify/memory/constitution.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions are signed off under the
[Developer Certificate of Origin](https://developercertificate.org/). Report security issues
privately as described in [SECURITY.md](SECURITY.md). Everyone taking part follows the
[code of conduct](CODE_OF_CONDUCT.md).

## License

Copyright (c) 2026 Chen Stanilovsky and contributors.

Your Space (server, runtime, web client, CLI and desktop app) is licensed under the
[GNU Affero General Public License v3.0 only](LICENSE). The SDKs, once published from this
repository, are licensed under the MIT License, so apps that use them can choose any license.
