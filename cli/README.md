# @your-space-ai/cli

The `your-space` command installs and runs [Your Space](https://github.com/your-space-ai/your-space),
a personal dashboard you run with Docker on your own computer or server. It sets up a workspace,
starts and stops it, and manages its owner, apps and agents.

Your Space is in alpha: expect rough edges and changes between versions.

## Get started

You need Node 22.12 or newer and a Docker engine with Docker Compose. Pick the version from
[GitHub Releases](https://github.com/your-space-ai/your-space/releases), then set up a local
workspace:

```sh
npx @your-space-ai/cli@<version> setup
```

To get the `your-space` command for later steps, install the package with
`npm install -g @your-space-ai/cli@<version>`. The
[installation guide](https://docs.getyourspace.ai/install) covers servers, domains and existing
reverse proxies, and the standalone executables for Linux machines without Node.

## License

AGPL-3.0-only. The source is at https://github.com/your-space-ai/your-space.
