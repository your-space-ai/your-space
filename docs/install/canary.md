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
| `your-space-linux-x64` and `your-space-linux-arm64`, the npm package as `your-space-ai-cli-<version>.tgz`, the Compose bundle `your-space.tar.gz`, `SHA256SUMS`, and `channel.json`, which names the build's version and commit | The [canary prerelease](https://github.com/your-space-ai/your-space/releases/tag/canary) on GitHub, which each build replaces |

The canary isn't published to npm. The Mac app has canaries of its own, which [The Mac App](#the-mac-app) describes.

## Move an Installation onto the Canary

With a `your-space` command that has the `--channel` flag, from 0.1.0-alpha.2 or a canary build made
since the flag was added, upgrade in the installation's folder:

```sh
your-space upgrade --channel canary --workdir ~/my-your-space
```

It reads the prerelease's `channel.json`, which names the newest canary, and downloads that build's
own `your-space` command, the Linux executable or the npm package as the one you ran is. It checks
the command against the prerelease's `SHA256SUMS`, and that it reports that build's version, then
runs its `upgrade`. That downloads the canary's Compose bundle and checks it against the same
`SHA256SUMS`, backs up the database to `backups/<time>-<old version>.sql`, and keeps `.env`, your
apps and their data, as [Update Your Space](../operate/index.md#update-your-space) describes. Keep
the backup it takes from the release: it is the way back to that release. Run the same command for
each later canary. If a newer build replaces the prerelease's files while it runs, it changes
nothing: run it again.

This is for an installation the CLI runs. For the Mac app's own local workspace, choose Canary in
the app instead, as [The Mac App](#the-mac-app) describes.

### Without the Flag

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

`upgrade` downloads the canary's Compose bundle and backs up the database, as above.
`your-space setup` and `your-space init` with a canary's command set up a new installation on that
canary.

For a later canary, get the newest canary's command again and run `upgrade`. A canary's command
reads its files from the one prerelease, which holds only the newest build: when a newer one has
replaced it, the command says so and changes nothing. Get the newest command and run it again.

## The Mac App

Once a day, the newest canary build is also packaged as the Mac app for Apple Silicon and Intel,
signed and notarized as a release is, and added to the canary prerelease as
`your-space-macos-arm64-<version>.zip` and `your-space-macos-x64-<version>.zip`, with
`canary-mac.yml`, the feed the app reads. A Mac canary can be a day behind the prerelease's other
files. Until the first Mac canary is published, the prerelease has no Mac app.

To follow Canary from 0.1.0-alpha.2 on, choose **Your Space › Update Channel › Canary**. The app
first warns that canaries aren't supported and may change your data in ways the next alpha doesn't
expect; then each check reads only the canary feed and offers the newest Mac canary, which installs
as any update does ([Mac app](macos-desktop.md)). The app's own local workspace follows the app,
so the next time it starts, the app upgrades it to the canary, backing up the database first. Don't
point `upgrade --channel` at that workspace: the app moves it.

Install the first Mac canary by hand: download the ZIP for your Mac from the
[canary prerelease](https://github.com/your-space-ai/your-space/releases/tag/canary), open it to
unpack `Your Space.app`, quit Your Space if it's open, and drag the new app to Applications in place
of the old one. Replace an app only with a newer canary: the version in the ZIP's name must be newer
than the one **Your Space › About Your Space** shows. The newest Mac canary can be older than the
app, such as in the day after a release, and an older app doesn't start a local workspace that a
newer one upgraded; wait for a later Mac canary then. From 0.1.0-alpha.2 on, choosing Canary in the
menu, as above, offers only a canary newer than the app. A canary with no channel stored yet, on a
new Mac or over 0.1.0-alpha.1, follows Canary from its first start; installed over an app already
set to Alpha, it stays on Alpha until you choose Canary. Later canaries come as updates.

To leave Canary, choose **Update Channel › Alpha**. The app stays on its canary build, says "You'll
move to Alpha with the next alpha", and moves to the first alpha newer than it, usually the next
one. An update it had found or downloaded from Canary is dropped and never installed, not even when
you quit. Like a CLI installation, the app doesn't go back to the release the canary followed.

## Go Back to Releases

Run `your-space upgrade --channel alpha` once a release newer than your canary is out. The command
stores no channel, so until then it says nothing is newer and changes nothing: run it again when the
next alpha is published. It then moves the installation to that release with an ordinary upgrade,
because a canary sorts before the next release. Without the flag, install that release's command as the
[installation guide](index.md#1-get-the-your-space-command) says and run `your-space upgrade`.

An installation doesn't go back to the release the canary followed: that release's command refuses
a newer installation, and its server refuses a database a newer version changed. To return to it
anyway, losing what changed since, unpack that release's `your-space.tar.gz` over the installation's
files as the [manual installation](manual.md) does, then restore the backup `upgrade` took before
the canary, as [Restore the Backup by Hand](../operate/index.md#restore-the-backup-by-hand) says.
