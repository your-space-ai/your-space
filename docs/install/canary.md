---
title: "Run the canary build"
---

Every push to `main` is published as a canary build, so it can be tried before a release. A canary
isn't a release: nobody has reviewed it for one, it isn't supported, and a later build may change
the database again in a way the next release doesn't expect. Run it only on an installation you
can lose, or whose data you can do without until the next release. Bug reports about a canary are
welcome; say which build in the report.

## What a Canary Is

A canary's version names the release it follows, the day it was built and a build number, such as
`0.1.0-alpha.1.canary.20261125.42`. It sorts after that release and before the next one, so
`your-space upgrade` moves an installation from the release onto a canary, from one canary onto a
later one, and from a canary on to the next release, the same way it moves between releases.

| What | Where |
| --- | --- |
| Server, web and runtime images, tagged with the canary's version | GHCR, for Linux AMD64 and ARM64. The `canary` tag points at the newest build; `latest` stays on the newest release |
| `your-space-linux-x64` and `your-space-linux-arm64`, the npm package as `your-space-ai-cli-<version>.tgz`, the Compose bundle `your-space.tar.gz`, and `SHA256SUMS` | The [canary prerelease](https://github.com/your-space-ai/your-space/releases/tag/canary) on GitHub, which each build replaces |

There is no canary of the Mac app, and none on npm. Leave the Mac app's own local workspace on its
release: the app doesn't start a workspace newer than itself.

## Move an Installation onto the Canary

Get the newest canary's `your-space` command, checked against the prerelease's `SHA256SUMS`, as
[step 1](index.md#1-get-the-your-space-command) of the installation guide does for a release. On
Intel/AMD, for example (use `arm64` on ARM):

```sh
asset=your-space-linux-x64
canary=https://github.com/your-space-ai/your-space/releases/download/canary
curl -fL -O "$canary/$asset" -O "$canary/SHA256SUMS"
awk -v name="$asset" '$2 == name { print }' SHA256SUMS | sha256sum -c - &&
  mkdir -p ~/.local/bin &&
  install -m 755 "$asset" ~/.local/bin/your-space
your-space --version
```

Proceed only when it prints `OK` and `your-space --version` prints the same canary version as
`~/.local/bin/your-space --version`, such as `0.1.0-alpha.1.canary.20261125.42`. If it doesn't,
another `your-space`, such as one installed earlier with npm, comes first on your `PATH`, and its
`upgrade` would leave the installation where it is: run `~/.local/bin/your-space` by its full
path, or put `~/.local/bin` first on your `PATH`.

With Node 22.12 or newer, install the prerelease's npm package instead: download the
`your-space-ai-cli-<version>.tgz` file that `SHA256SUMS` lists, check it the same way (`shasum -a 256 -c -`
on a Mac) and run `npm install -g ./your-space-ai-cli-<version>.tgz`.

Then upgrade in the installation's folder, as for a release:

```sh
your-space upgrade --workdir ~/my-your-space
```

`upgrade` downloads the canary's Compose bundle and checks it against the same `SHA256SUMS`, backs
up the database to `backups/<time>-<old version>.sql`, and keeps `.env`, your apps and their data,
as [Update Your Space](../operate/index.md#update-your-space) describes. Keep the backup it takes
from the release: it is the way back to that release. `your-space setup` and `your-space init` with
a canary's command set up a new installation on that canary.

For a later canary, get the newest canary's command again and run `upgrade`. A canary's command
reads its files from the one prerelease, which holds only the newest build: when a newer one has
replaced it, the command says so and changes nothing. Get the newest command and run it again.

## Go Back to Releases

Once a release newer than your canary is out, install that release's command as the
[installation guide](index.md#1-get-the-your-space-command) says and run `your-space upgrade`.
That is an ordinary upgrade, because a canary sorts before the next release.

An installation doesn't go back to the release the canary followed: that release's command refuses
a newer installation, and its server refuses a database a newer version changed. To return to it
anyway, losing what changed since, unpack that release's `your-space.tar.gz` over the installation's
files as the [manual installation](manual.md) does, then restore the backup `upgrade` took before
the canary, as [Restore the Backup by Hand](../operate/index.md#restore-the-backup-by-hand) says.
