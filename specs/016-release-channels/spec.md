# Feature Specification: Release Channels

**Feature Branch**: `016-release-channels`

**Created**: 2026-11-25

**Status**: Decided. The owner settled all ten decisions on 2026-11-25. The pull request check on
migrations (decision 8, FR-011) delivered 2026-11-25 in
[PR #132](https://github.com/your-space-ai/your-space/pull/132). Built in PRs
[#135](https://github.com/your-space-ai/your-space/pull/135) (Canary's `channel.json`, FR-004),
[#136](https://github.com/your-space-ai/your-space/pull/136) (the `alpha` feed, FR-003),
[#137](https://github.com/your-space-ai/your-space/pull/137) (the daily Mac canary, FR-005),
[#138](https://github.com/your-space-ai/your-space/pull/138) (`upgrade --channel`, FR-006) and
[#139](https://github.com/your-space-ai/your-space/pull/139) (the Mac app's setting, FR-001, FR-002
and FR-009), all for alpha.2; live checks pending.

**Input**: The owner, on 2026-11-25: "in the desktop app, should be a setting to choose which
release channel to follow for updates, and yes you can add the flag in the cli."

**Related**: [decision record](../../docs/architecture/decisions.md#your-space-updates-backup-and-restore)
(the 2026-11-24 `upgrade` entry, the 2026-11-25 canary and release channels entries, and the
2026-11-23 Mac updater entry), journeys [003](../003-install-with-the-cli/spec.md) (`upgrade`) and
[008](../008-desktop-entry/spec.md) (the Mac app), [Run the canary build](../../docs/install/canary.md)
and the [release guide](../../docs/maintainers/releasing.md).

## At a Glance

- **Who:** an owner who wants builds of `main` before they are released, on a Mac or with the CLI.
- **Done when:** the Mac app has a setting for the channel its updates follow, Alpha or Canary,
  kept across updates; each channel has a feed at a fixed address, on a rolling GitHub release
  tagged `alpha` or `canary`, that the Mac app and `your-space upgrade --channel <name>` read; a
  client only ever gets its own channel's builds, and an Alpha client never gets a canary; the app
  and its local workspace stay on one build.
- **Not covered:** other channels (they come later under new names, and the default can change
  then), Windows and Linux desktop apps, npm canaries, a separate "Your Space Canary" app, and going
  back to an older build, which for now is restoring a backup by hand (decision 7).

## Decisions

All settled by the owner on 2026-11-25. Each section below says what was decided, and, where the
owner chose differently from the recommendation, what was considered.

| # | Question | Decision | Owner |
| --- | --- | --- | --- |
| 1 | Is the channel remembered or chosen each time? | The app's setting decides, stored in the installation and kept across updates; the CLI takes `--channel` on each run and stores nothing | "Each run (--channel)"; "whatever the setting is in the users installation, if its set to canary, then stays on canary, user sets it basck to alpah, then alpha" |
| 2 | Which channels? | Two for now: Alpha and Canary. A release build starts on Alpha (decision 1) | "right now its just alpha (default and --channel alpha), and canary. in the future we'll have other names and can change the default." |
| 3 | How often is a Mac canary built? | Once a day and on demand, from the newest Linux canary, signing only the update ZIPs | "this is fine" |
| 4 | How is an unattended Mac canary signed? | A second Developer ID certificate and its own App Store Connect API key, in a `macos-canary` environment with no approval step | "A second certificate" |
| 5 | How are builds published and found? | Each channel has a feed at a fixed address on a rolling release: a new `alpha` release, and the `canary` prerelease, which still holds only the newest build. Clients read their channel's feed | "we'll just go with this for now to keep it simple" |
| 6 | What does `upgrade --channel` run? | The target build's own CLI, checked against that build's `SHA256SUMS`. Migrations are append-only and install files are replaced whole, so no version needs code for each older one | "yes, go with that" |
| 7 | How does an installation move between channels? | It follows one channel and gets only that channel's builds. Leaving Canary waits for the next alpha. Going back to an older build isn't handled for now | "client can subscribe to a channel, default, alpha, canary, etc.. and they only get those builds as updates."; "i dont think we should handle this at this time" |
| 8 | Do migrations on `main` stay as they were merged? | Yes: a pull request check refuses a change to a merged migration and a new one not stamped after every earlier one | "A PR check" |
| 9 | Which backups does `upgrade` keep? | All of them | "keep all forn ow" |
| 10 | Which release carries this? | alpha.2, all of it; the owner installs the first Mac canary by hand | "all of it at once so i can install canary locally and start using that" |

## What Exists Today

- **Mac app.** electron-updater 6.8.11 reads this repository's GitHub releases with its GitHub
  provider. An alpha app is offered later alphas, betas and stable releases (2026-11-23). It checks
  shortly after launch and then daily, sends no installation ID, and asks before downloading.
  Settings live in `updates.json` in the app's data folder, which holds only **Check for Updates
  Automatically**, and only once the owner has changed it. After the app changes version, its next
  start of the local workspace runs the bundled CLI's `upgrade` with the release files inside the
  app; a workspace newer than the app isn't started.
- **Canary.** Every push to `main` publishes Linux images, CLI downloads and the Compose bundle,
  versioned like `0.1.0-alpha.1.canary.20261125.42`, on one rolling `canary` prerelease that holds
  only the newest build. Its publish job retries GitHub's server errors and looks at what an
  earlier attempt left before each change; it uploads `SHA256SUMS` last, checks the published
  files, then moves the `canary` git tag and, last, the images' `canary` tag
  ([PR #128](https://github.com/your-space-ai/your-space/pull/128)). No Mac app, nothing on npm.
- **CLI.** `upgrade` moves an installation to the version of the CLI that runs it and refuses a
  newer installation (2026-11-24). A canary's CLI reads its files from the rolling prerelease, so it
  stops, changing nothing, once a newer build replaces them. Each run first writes a full `pg_dump`
  to `backups/`, and nothing deletes them.

## 1. Remembered or Chosen Each Time

**Decided:** the app's channel is a setting of the installation, stored in `updates.json` beside
**Check for Updates Automatically**, since its daily check runs with nobody there to choose. The
stored setting alone decides which feed the app reads, and updates keep it: an app set to Canary
stays on Canary through every update, and one set back to Alpha follows Alpha. When no channel is
stored yet, in a new installation or one updated from alpha.1, which stores none, the app stores its
own build's channel at its first start: Alpha for a release, Canary for a canary build. After that
only the owner changes it, so a canary installed by hand over an app set to Alpha stays on Alpha
until the owner chooses Canary.

The CLI takes `--channel` on each run and stores nothing. Plain `upgrade`, with no flag, keeps its
2026-11-24 meaning: it moves an installation to the CLI's own version. Scripts say what they want,
and the version `stack.yaml` pins stays the one record of what is installed.

**Considered:** storing the CLI's channel in the installation folder, hidden state close to the
`YS_VERSION` override the alpha removed; inferring it from the installed version, which can't
remember leaving Canary.

## 2. Channels

**Decided:** two channels, each with its own feed (decision 5):

- **Alpha**: the published releases, tagged `v` and a version. They are alphas now; betas and
  stable releases, when there are any, are tagged the same way. A release build starts on Alpha
  (decision 1).
- **Canary**: the canary builds of `main`.

The CLI names a channel with `--channel alpha` or `--channel canary`. The app's setting is a **Your
Space › Update Channel** submenu with the two as radio items, beside **Check for Updates
Automatically**. Choosing Canary first says that canaries are unsupported and may change the data in
ways the next alpha doesn't expect. The Mac canary is daily (decision 3) while the Linux canary
follows every push; both are called Canary. Channels added later get names of their own, and the
default can change then.

**Considered:** Stable, Beta, Alpha and Canary, each also getting the more stable ones, with the
installed version's channel as the default (the recommendation); Releases and Canary; Stable,
Preview and Canary.

## 3. How Often a Mac Canary Is Built

**Decided:** once a day and when started by hand, in a workflow of its own. It packages the newest
Linux canary, the build the `canary` prerelease holds, at that build's commit and version, whose
images are pushed and whose install test passed. A Mac build with a version of its own would need
images of its own. It signs and notarizes the two app ZIPs, which the app updates from and which
can be installed by hand, not the DMGs. It builds nothing when the prerelease's Mac files are
already that build's.

**Narrowed (2026-11-26, PR #137, accepted by the owner: "thats fine"):** the build must be of the
run's own commit, the `main` commit the run was started on, and every job checks out only that
commit, as Release draft does, so a run on `main` runs no other commit's code. On a day when that
commit has no Linux canary yet, because its Canary run is still going or failed, the run builds
nothing rather than packaging the build before it. A later run catches up once its own commit has
a Linux canary; while the Linux canary keeps failing, every run builds nothing. A run that waited
behind an earlier one packages its own commit only while the `canary` prerelease still holds that
commit's Linux canary, which is on `main` and newer than the Mac canary before it. Once a newer
commit's Linux canary has replaced it, the waiting run builds nothing, and the next run started on
a commit whose Linux canary is there packages that one.

Standard GitHub-hosted runners, the `macos-15` and `macos-15-intel` ones the release uses included,
are free on public repositories
([runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)); the limit is
5 macOS jobs at once, shared with pull requests
([limits](https://docs.github.com/en/actions/reference/limits)). On alpha.1, packaging took under
2.5 minutes for each architecture, and notarizing four submissions one after another took 48
minutes; submitting the two ZIPs together leaves about one submission's wait. Each update is a full
download of about 170 MB.

**Considered:** every push to `main`, which holds a macOS slot per build that the daily check
mostly never installs; only pushes that change `desktop/`, which leaves Mac canary workspaces on
old server code, since the app bundles the release files.

## 4. Signing an Unattended Build

**Decided:** a second Developer ID Application certificate from the same team, with its own App
Store Connect API key, in a `macos-canary` environment limited to `main` with no required
reviewer. Squirrel.Mac installs an update only if it meets the running app's designated
requirement, which for Developer ID names the team ID and the app's identifier, not one
certificate ([TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)),
so canaries and releases still update each other. A leak is revoked without touching the
release's secrets; revoking the release certificate would stop installed releases from opening
([release guide](../../docs/maintainers/releasing.md#sign-the-mac-app)). Only the Account Holder
creates the certificate ([Apple](https://developer.apple.com/help/account/create-certificates/create-developer-id-certificates)).
As in releases, the signing job runs no npm packages and signs only what a job without secrets
built.

**Considered:** the `macos-release` environment, approved each time; the release certificate in an
environment without approval.

## 5. Feeds at Fixed Addresses

**Decided:** each channel has a feed at a fixed address, on a rolling GitHub release that is edited
in place. Ghostty does the same: its Mac app follows the `tip` release, signed and notarized builds
of the newest commit on `main`, when its `auto-update-channel` setting is `tip`
([Ghostty](https://ghostty.org/docs/install/pre)). The Mac feed files are named for their channel,
as electron-builder names a channel's update file
([channels](https://www.electron.build/tutorials/release-using-channels)). Nothing looks up tags or
lists releases. Both releases are prereleases, which GitHub never makes the latest release
([GitHub](https://docs.github.com/en/rest/releases/releases)), and editing one notifies nobody.

- **Alpha:** a new rolling prerelease tagged `alpha`, holding two small files: `latest-mac.yml`
  for the Mac app, and `channel.json`, which names the release's version, for the CLI. Only Release
  publish writes them, once a published release has passed its check, and never for a version
  older than the one they name. Its `latest-mac.yml` lists the release's two update ZIPs, with
  their SHA-512 digests, by their full links into the `v` release, which electron-updater follows
  as given ([Provider.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/providers/Provider.ts),
  lines 152–163). Each `v` release keeps its own `latest-mac.yml`, which the alpha.1 app reads
  (decision 10). Release publish runs only for `v` tags, so the `alpha` release starts nothing.
- **Canary:** the rolling `canary` prerelease, which still holds only the newest build and is
  replaced by each build, as today. The Linux canary uploads `channel.json` last, once the build's
  files have passed their check. The Mac canary uploads the build's two update ZIPs, then
  `canary-mac.yml`, which lists them with their SHA-512 digests, then deletes the older Mac ZIPs;
  a run for a build older than the one `canary-mac.yml` names stops. A Mac app that read the older
  `canary-mac.yml` just before finds its ZIP gone, and its next check gets the newer build. Each
  canary workflow checks and deletes only its own files: the Linux canary its Linux files,
  `SHA256SUMS` and `channel.json`, the Mac canary `canary-mac.yml` and the `your-space-macos-*`
  ZIPs.

Each `channel.json` is one line of JSON and a newline, as `deploy/channel-json.sh` writes it:
`{"channel":"canary","version":"0.1.0-alpha.1.canary.20261125.5","commit":"69525a9569f68a39b76598af86662a04b6fb2886"}`.
`channel` is `alpha` or `canary`, `version` is the build's version in Semantic Versioning, a canary
in Canary's file and never one in Alpha's, and `commit` is the full 40-character commit the build
was made from.

### The Mac App's Feed

The app reads its channel's feed with electron-updater's generic provider
([GenericProvider.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/providers/GenericProvider.ts),
lines 18–25), not its GitHub provider:

- **Alpha:** `https://github.com/your-space-ai/your-space/releases/download/alpha/` with no
  channel, so it reads `latest-mac.yml`.
- **Canary:** `https://github.com/your-space-ai/your-space/releases/download/canary/` with the
  channel `canary`, so it reads `canary-mac.yml`.

The channel goes in the feed's options, whose `channel` defaults to `latest`
([publishOptions.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/builder-util-runtime/src/publishOptions.ts),
lines 215–231). electron-builder's channels tutorial sets the updater's `channel` property instead,
but setting that property turns on `allowDowngrade`, and the property can't be unset again
([AppUpdater.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/AppUpdater.ts),
lines 152–163); downgrades stay off. Alpha's file keeps the name `latest-mac.yml`, the one the
generic provider reads with no channel and every release already carries. A feed the app can't
read means it couldn't check: it says so after **Check for Updates…** and offers nothing.

### The Guard

An Alpha app never gets a canary. A canary's version contains `-alpha.` and sorts after the alpha
it follows, so electron-updater would take one as a newer alpha if it reached an Alpha feed. Three
rules keep it out: an Alpha app reads only the `alpha` feed, only Release publish writes to the
`alpha` release, and no canary release ever carries `latest-mac.yml`. FR-007's required test checks
all three.

**Considered:** finding each channel's newest build through GitHub's API, by tag, which costs
requests on every check and needs handling when GitHub limits them; a prerelease kept for every
canary build now, which decision 7 records as the later direction; electron-updater's GitHub
provider, which skips every tag that isn't a version and so can't read either rolling release
(decision 10); a feed on another host, such as Cloudflare, which is new infrastructure.

## 6. What `upgrade --channel` Runs

**Decided:** `upgrade --channel <name>` reads the channel's `channel.json` with one request, then
downloads that build's CLI for this machine (the Linux executable or the npm package, as the running
one is) from that build's release: the `v` release for Alpha, the `canary` prerelease for Canary. It
checks it against that release's `SHA256SUMS` and that it is the version `channel.json` names, and
runs its `upgrade`. The 2026-11-24 rule holds: an installation moves to the version of the CLI that
runs `upgrade`, so each version's own upgrade steps run. A canary's CLI reads its files from the
`canary` prerelease, as today, so if a newer build replaces them during the run, it stops with
nothing changed, and running the command again takes the newer build. `init` and `setup` keep taking
the CLI's own version. The alpha.1 CLI has no flag, so the first CLI with it is a canary, then
alpha.2.

A version upgrades any older installation with no code for each older version:

- **Migrations are sequential and append-only** (decision 8). A new version runs every migration the
  database doesn't have, in order, however far behind it is.
- **Install files are replaced whole, not patched.** `upgrade` puts the target's release files from
  its Compose bundle in place of the old ones, and keeps `.env`, the data and the apps, as today.
- **A minimum upgrade-from version, only when needed.** If a change ever can't work that way, the
  version that makes it declares the oldest version it upgrades from, and its `upgrade` refuses an
  older installation with `Upgrade to <version> first`, as GitLab's required upgrade stops do
  ([upgrade paths](https://docs.gitlab.com/update/upgrade_paths/)). That version's own CLI reaches
  it first. No version declares one now.

**Considered:** the running CLI installing the newer files itself, which would run upgrade steps
for a release it doesn't know; printing the commands only.

## 7. Moving Between Channels

**Decided:** an installation follows one channel and gets only that channel's builds; nothing
offers a build of another channel.

- **Leaving Canary** is choosing Alpha. The installation stays on its canary build and moves
  forward at the first alpha newer than it, usually the next one, since a canary sorts before the
  next release. Until then the app says "You'll move to Alpha with the next alpha", and `upgrade
  --channel alpha` says nothing is newer and changes nothing. Ghostty's switch back to stable
  likewise "will only take effect when a later stable release is available". A release is tagged
  at the tip of `main`, so the canaries after it are built from it and sort after it: Canary gets
  each release's changes as a canary.
- **Going back to an older build isn't handled for now.** `upgrade` never moves an installation
  backward: the older CLI refuses a newer installation, and an older server refuses a database a
  newer one migrated. To return to the release a canary followed, losing what changed since, the
  owner restores by hand, as the [canary page](../../docs/install/canary.md#go-back-to-releases)
  says: that release's files, then the backup `upgrade` took when the installation left it. An
  older canary build's files are gone once a newer build replaces them.
- Leaving forward is safe for the data because migrations on `main` stay as merged (decision 8).

**Later direction:** a prerelease of its own for every canary build, kept with its files, and
restoring an installation to a build it left from the backup taken then. Home Assistant keeps a
backup from before an app update "so you can go back to the previous version of the app if needed"
([Home Assistant](https://www.home-assistant.io/common-tasks/general/backups/#app-update-backups)).

**Considered:** offering a Canary installation any release newer than the newest canary (the
recommendation); locking Canary until a newer release exists.

## 8. Migrations on `main`

**Decided:** a pull request check refuses a change to a migration already on `main`, and a new
migration not stamped strictly after every earlier one. A database that follows Canary applies
`main`'s migrations one merge at a time, where a release applies them together. The server's
Drizzle 0.45.4 runs only migrations stamped later than the newest the database records, and never
reads one again once applied
([migrator](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/dialect.ts),
lines 73–111). So a migration changed after a canary applied it, or merged after one stamped later,
would be skipped there without an error. The check keeps leaving Canary, and upgrades between
releases, safe for the data; a mistake is fixed with a new migration.

**Considered:** accepting it, with a warning; the server refusing a database whose recorded
migrations differ from its own, which leaves it stuck until a manual restore.

## 9. Backups

**Decided:** keep all of them. Each `upgrade` writes a full `pg_dump` to `backups/` and deletes
none, as today, so the backup from before each build an installation left is still there (decision
7). A Mac on Canary that installs each day's build adds one a day, each the size of the database.

**Considered:** the newest 5 plus the newest taken from a release (the recommendation); only those
taken from releases, plus the newest.

## 10. Which Release Carries It

**Decided:** alpha.2 carries all of it: the two channels and the app's setting, the `alpha` feed,
`upgrade --channel`, and daily Mac canaries. The alpha.1 app has no setting, so the setting reaches
people with alpha.2. Before the first Mac canary the Account Holder creates the second certificate
and its API key (decision 4). The owner then installs the first Mac canary by hand from the ZIP on
the `canary` prerelease. With no channel stored yet, it stores Canary and follows it from then on;
installed over an app already set to Alpha, it stays on Alpha until the owner chooses Canary
(decision 1).

The alpha.1 app keeps electron-updater's GitHub provider. It reads the releases Atom feed, which
lists the newest 10 of the repository's tags, with or without a published release, and takes the
first whose tag is a version, so it skips `alpha` and `canary`
([GitHubProvider.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/providers/GitHubProvider.ts),
lines 81–113). With only the two rolling releases beside the `v` tags, those two take at most two of
the 10 places, wherever the feed lists them. The feed doesn't order entries by when a release was
published: Ghostty's `tip`, published in 2022 and edited in place since, is listed first because its
tag moves to each new build. Every release here is tagged at the tip of `main`, as the
[release steps](../../docs/maintainers/releasing.md#release-steps) require, so the first version in
the feed is the release tagged last, the newest. So the newest release is always in the feed, and
alpha.2 stays there until eight to ten later releases follow it. An alpha.1 app that checks at any
time finds the newest release and updates to it from that release's `latest-mac.yml`. One likely
gap, inferred from other repositories' feeds, which list tags that have no published release: a
release's `v` tag is pushed before Release draft runs, so while the release is still a draft the
alpha.1 app would pick that tag, find no `latest-mac.yml`, and fail its check until the release is
published. An automatic check stays quiet, and **Check for Updates…** says it couldn't check.

**Considered:** the flag first and the Mac parts after alpha.2; all of it after the first packaged
release.

## Requirements

- **FR-001**: The Mac app offers Alpha and Canary under **Your Space › Update Channel**. The
  channel is stored in `updates.json`, kept across updates, and alone decides which feed the app
  reads. With none stored, the app stores its own build's channel at its first start, Alpha for a
  release and Canary for a canary build; after that only the owner's choice changes it. An
  `updates.json` that can't be read is left as it is, and until the owner chooses again the app
  follows Alpha. Choosing Canary first says that canaries are unsupported.
- **FR-002**: Every check, automatic or manual, reads the stored channel's feed at its fixed
  address with electron-updater's generic provider, with the channel in the feed's options and
  downgrades off. The app is offered only its channel's builds, and says so when nothing is newer.
  A feed it can't read means it couldn't check, and it offers nothing. Changing the channel drops
  any check in progress and any update found or downloaded from the other channel's feed, which is
  then neither offered nor installed, not even when the app quits. Once the owner chooses **Restart
  Now**, which hands the update to macOS to install, the channel can't change until the app
  restarts, unless macOS refuses the update.
- **FR-003**: Once a published release passes Release publish's check, Release publish writes the
  `alpha` prerelease's `latest-mac.yml`, listing that release's update ZIPs by full link, and its
  `channel.json`, unless they already name a newer version. Nothing else writes to the `alpha`
  release. Each `v` release keeps its own `latest-mac.yml`.
- **FR-004**: Every canary build replaces the rolling `canary` prerelease's files as today, each
  step retried and safe to re-run, and uploads `channel.json` last, once its files pass their
  check. Each canary workflow checks and deletes only its own files.
- **FR-005**: Once a day and when started by hand, a workflow packages the newest Linux canary, when
  it is of the `main` commit the run was started on, for Apple Silicon and Intel, signs it with
  the canary certificate, notarizes and staples both apps, checks their update ZIPs, and uploads them, then `canary-mac.yml`, to the `canary` prerelease,
  then deletes the older Mac ZIPs, unless `canary-mac.yml` already names a newer build. No canary
  release carries `latest-mac.yml`. When that commit has no Linux canary yet, the run builds
  nothing. It checks out no other commit. It never delays the Linux canary.
- **FR-006**: `your-space upgrade --channel alpha|canary` reads that channel's `channel.json`,
  downloads the build's CLI from its release, checks it against that release's `SHA256SUMS` and that
  it is the version `channel.json` names, and runs its `upgrade`. It changes nothing when the
  installation is already that build or a newer one, since `upgrade` never moves an installation
  backward (FR-008), and stops with nothing changed when a file can't be read or no longer matches.
  Plain `upgrade` is unchanged.
- **FR-007**: A required test proves that Alpha clients never get a canary. Its fixture is
  recorded files: the `alpha` release's `latest-mac.yml` and `channel.json`; the `canary`
  release's `canary-mac.yml` and `channel.json`, for a canary whose version contains `-alpha.` and
  sorts after that release; and the releases Atom feed, with the `alpha` and `canary` entries
  listed before the newest `v` release. With the pinned electron-updater:
  - A release build with nothing stored stores Alpha. On Alpha, the Mac app reads only the
    `alpha` feed's `latest-mac.yml`, and offers its release only when it is newer, so nothing to
    an app already on it or on a later canary.
  - `upgrade --channel alpha` takes the version the `alpha` release's `channel.json` names.
  - Canary reads only the `canary` feed.
  - A Canary check that finishes, or a canary update that was found or downloaded, after the app
    switched to Alpha is neither offered nor installed.
  - The alpha.1 app's GitHub provider, reading that Atom feed, resolves to the newest `v` release,
    never to a canary's files.
  - A feed that can't be read selects nothing and says so.

  A second check confirms that only Release publish writes to the `alpha` release and that no
  canary workflow uploads `latest-mac.yml`. Both run on every pull request that changes the
  updater, the CLI's channel code, or the release or canary workflows.
- **FR-008**: Leaving Canary waits for the first newer alpha. `upgrade` never moves an installation
  backward; going back is restoring a backup by hand.
- **FR-009**: The app's local workspace follows the app on every channel, as today; `upgrade
  --channel` is for CLI installations. A workspace newer than the app is neither started nor
  upgraded: the app says so, and starts it once its own channel has a build at least that new. A
  failed workspace upgrade is handled as `upgrade` handles it (2026-11-23): when the previous
  version is back, the app says so and tries again at its next start; when the rollback stopped
  for the owner to finish by hand, the app says so and doesn't start the workspace.
- **FR-010**: A version upgrades any older installation with no code for each older version:
  migrations run in order, and release files are replaced whole. A version whose change can't work
  that way declares the oldest version it upgrades from, and its `upgrade` refuses an older
  installation with `Upgrade to <version> first`. None is declared until a change needs one.
- **FR-011**: A pull request check refuses a change to a migration already on `main`, and a new
  migration not stamped strictly after every migration before it, since Drizzle skips one stamped
  at or before the newest it recorded. The rule holds against `main` as it is at merge, not only
  when the check last ran, so a pull request overtaken by a newer migration is updated first.
- **FR-012**: `upgrade` keeps every backup.
- **FR-013**: The canary page, the Mac guide, the release guide and the decision record describe
  the channels when they ship.

## Sources

- electron-updater 6.8.11, the version in `desktop/package.json`:
  [GitHubProvider.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/providers/GitHubProvider.ts),
  [GenericProvider.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/providers/GenericProvider.ts),
  [AppUpdater.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/AppUpdater.ts),
  [Provider.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/providers/Provider.ts),
  and builder-util-runtime 9.7.0's
  [publishOptions.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/builder-util-runtime/src/publishOptions.ts).
- electron-builder: [release using channels](https://www.electron.build/tutorials/release-using-channels).
- Ghostty: [prerelease builds](https://ghostty.org/docs/install/pre).
- Drizzle ORM 0.45.4, the server's:
  [migrator](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/dialect.ts).
- GitHub: [releases](https://docs.github.com/en/rest/releases/releases),
  [hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
  [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
  [Actions limits](https://docs.github.com/en/actions/reference/limits). The releases Atom feed was
  read on 2026-11-25 for this repository and others: 10 entries, tags without a published release
  included.
- Apple: [designated requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements),
  [Developer ID certificates](https://developer.apple.com/help/account/create-certificates/create-developer-id-certificates).
- GitLab: [required upgrade stops](https://docs.gitlab.com/update/upgrade_paths/).
- Home Assistant: [app update backups](https://www.home-assistant.io/common-tasks/general/backups/#app-update-backups).
- This repository: the alpha.1 Release draft run's job times (2026-11-24) and release assets,
  `desktop/src/updates.mjs`, `desktop/src/local-setup.mjs`, `cli/src/commands/upgrade.ts`,
  `cli/src/release.ts`, `server/src/migrate.ts`, `deploy/canary-version.sh`,
  `.github/workflows/canary.yml` and `.github/workflows/release-publish.yml`.
