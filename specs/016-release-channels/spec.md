# Feature Specification: Release Channels

**Feature Branch**: `016-release-channels`

**Created**: 2026-11-25

**Status**: Decided. The owner settled all ten decisions on 2026-11-25. Nothing is built yet; it
ships in alpha.2.

**Input**: The owner, on 2026-11-25: "in the desktop app, should be a setting to choose which
release channel to follow for updates, and yes you can add the flag in the cli."

**Related**: [decision record](../../docs/architecture/decisions.md#your-space-updates-backup-and-restore)
(the 2026-11-24 `upgrade` entry, the 2026-11-25 canary and release channels entries, and the
2026-11-23 Mac updater entry), journeys [003](../003-install-with-the-cli/spec.md) (`upgrade`) and
[008](../008-desktop-entry/spec.md) (the Mac app), [Run the canary build](../../docs/install/canary.md)
and the [release guide](../../docs/maintainers/releasing.md).

## At a Glance

- **Who:** an owner who wants builds of `main` before they are released, on a Mac or with the CLI.
- **Done when:** the Mac app has a setting for the channel its updates follow, Alpha or Canary;
  every canary build has a prerelease of its own that is kept, and the rolling `canary` prerelease
  points at the newest; `your-space upgrade --channel <name>` moves a CLI installation to that
  channel's newest build, or with `--version` to a build it names; a client only ever gets its own
  channel's builds, and an Alpha client never selects a canary; the app and its local workspace
  stay on one build.
- **Not covered:** other channels (they come later under new names, and the default can change
  then), Windows and Linux desktop apps, npm canaries, a separate "Your Space Canary" app, and an
  automatic way back to an older build: going back is restoring a backup (decision 7).

## Decisions

All settled by the owner on 2026-11-25. Each section below says what was decided, and, where the
owner chose differently from the recommendation, what was considered.

| # | Question | Decision | Owner |
| --- | --- | --- | --- |
| 1 | Is the channel remembered or chosen each time? | The app stores it in its settings; the CLI takes `--channel` on each run and stores nothing | "Each run (--channel)" |
| 2 | Which channels? | Two for now: Alpha, the default, and Canary | "right now its just alpha (default and --channel alpha), and canary. in the future we'll have other names and can change the default." |
| 3 | How often is a Mac canary built? | Once a day and on demand, from the newest Linux canary, signing only the update ZIPs | "this is fine" |
| 4 | How is an unattended Mac canary signed? | A second Developer ID certificate and its own App Store Connect API key, in a `macos-canary` environment with no approval step | "A second certificate" |
| 5 | How are canaries published and found? | Every build gets its own prerelease, `canary-<date>.<run>`, kept with its files; the rolling `canary` prerelease is the shortcut to the newest. Clients choose builds by tag prefix | "this is what i was tryign to do from the beginning"; "keep them all for now, ensure they are labeled pre-release" |
| 6 | What does `upgrade --channel` run? | The target build's own CLI, checked against that build's `SHA256SUMS`. Migrations are append-only and install files are replaced whole, so no version needs code for each older one | "yes, go with that" |
| 7 | How does an installation move between channels? | It follows one channel and is offered only that channel's builds. Leaving Canary waits for the next alpha; going back now is restoring a backup | "client can subscribe to a channel, default, alpha, canary, etc.. and they only get those builds as updates." |
| 8 | Do migrations on `main` stay as they were merged? | Yes: a pull request check refuses a change to a merged migration and a new one not stamped after every earlier one | "A PR check" |
| 9 | Which backups does `upgrade` keep? | All of them | "keep all forn ow" |
| 10 | Which release carries this? | alpha.2, all of it; the owner installs the first Mac canary by hand | "all of it at once so i can install canary locally and start using that" |

## What Exists Today

- **Mac app.** electron-updater 6.8.11 reads this repository's GitHub releases with its GitHub
  provider. An alpha app is offered later alphas, betas and stable releases (2026-11-23). It checks
  shortly after launch and then daily, sends no installation ID, and asks before downloading.
  Settings live in `updates.json` in the app's data folder. After the app changes version, its next
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
  stops working once a newer build replaces them. Each run first writes a full `pg_dump` to
  `backups/`, and nothing deletes them.

## 1. Remembered or Chosen Each Time

**Decided:** the app stores its channel in `updates.json`, beside **Check for Updates
Automatically**, since its daily check runs with nobody there to choose. The CLI takes
`--channel` on each run and stores nothing. Plain `upgrade`, with no flag, keeps its 2026-11-24
meaning: it moves an installation to the CLI's own version. Scripts say what they want, and the
version `stack.yaml` pins stays the one record of what is installed.

**Considered:** storing the CLI's channel in the installation folder, hidden state close to the
`YS_VERSION` override the alpha removed; inferring it from the installed version, which can't
remember leaving Canary.

## 2. Channels

**Decided:** two channels, each a set of release tags (decision 5):

- **Alpha**, the default: the published releases, tagged `v` and a version. They are alphas now;
  betas and stable releases, when there are any, are tagged the same way.
- **Canary**: the canary builds, tagged `canary-<date>.<run>`.

Every app follows Alpha until the owner picks a channel, a canary build included, so the owner
chooses Canary once in the first Mac canary, installed by hand (decision 10). The CLI names a
channel with `--channel alpha` or `--channel canary`. The app's setting is a **Your Space › Update
Channel** submenu with the two as radio items, beside **Check for Updates Automatically**. Choosing Canary
first says that canaries are unsupported and may change the data in ways the next alpha doesn't
expect. The Mac canary is daily (decision 3) while the Linux canary follows every push; both are
called Canary. Channels added later get names of their own, and the default can change then.

**Considered:** Stable, Beta, Alpha and Canary, each also getting the more stable ones, with the
installed version's channel as the default (the recommendation); Releases and Canary; Stable,
Preview and Canary.

## 3. How Often a Mac Canary Is Built

**Decided:** once a day and when started by hand, in a workflow of its own. It packages the newest
Linux canary, the build the `canary` prerelease holds, at that build's commit and version, whose
images are pushed and whose install test passed. A Mac build with a version of its own would need
images of its own. It signs and notarizes the two app ZIPs, which the app updates from and which
can be installed by hand, not the DMGs. It builds nothing when that build already has Mac files.

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

## 5. Canary Releases and How Clients Find Builds

**Decided:** every canary build gets its own prerelease, tagged `canary-<date>.<run>` from its
version's last two parts: `0.1.0-alpha.1.canary.20261125.3` is `canary-20261125.3`. It keeps its
files. The rolling `canary` prerelease stays, as the shortcut to the newest build. All are kept,
with no cleanup, and each is marked prerelease, which GitHub never makes the latest release
([GitHub](https://docs.github.com/en/rest/releases/releases)). A build's version-tagged images are
never deleted either, so every kept build stays installable. Kept builds fill Releases, and each new
one notifies people who watch the repository's releases, since GitHub has no setting that leaves
prereleases out ([discussion](https://github.com/orgs/community/discussions/10776)). The
repository's immutable releases setting stays off, since the rolling prerelease and the Mac files
change after publishing.

### Publishing

`canary.yml` publishes both in one run, in [PR #128](https://github.com/your-space-ai/your-space/pull/128)'s
way: every GitHub call is retried on a server error, each step looks at what an earlier attempt
left before it changes anything, and a re-run finishes what a failed run started. Since every
build is kept, the list of releases grows with each one, so a step finds a published release by
its tag rather than by reading the whole list.

1. **The build's own prerelease.** Found by its tag before one is created; a draft an attempt
   left is published as it is. It is a prerelease on the build's commit, titled and described as
   that build. Its files are uploaded with `SHA256SUMS` last, and the step checks that its Linux
   files are exactly this build's and that its `SHA256SUMS` matches. A build that is not the newest,
   such as a re-run, still finishes its own prerelease.
2. **The rolling `canary` prerelease**, as today: the newest-build guard, then the files with
   `SHA256SUMS` last, the check, and the `canary` git tag. A build older than the one it holds
   stops here.
3. **The images' `canary` tag**, last.

So the shortcut never names a build whose own prerelease isn't complete, and the images never run
ahead of either. A build's own prerelease isn't changed after its check, except for the Mac files
the daily job adds, and its tag never moves. Each workflow's checks and cleanup look only at its
own file names: the Linux canary's at the Linux files and `SHA256SUMS`, the Mac canary's at
`canary-mac.yml` and the `your-space-macos-*` ZIPs. A file outside them is neither checked nor
deleted, even half uploaded. A client treats a build's prerelease without `SHA256SUMS` as not there
yet.

The Mac canary workflow uploads the two ZIPs and `canary-mac.yml`, which lists them with their
SHA-512 digests, to the build's own prerelease. Then it replaces `canary-mac.yml` on the rolling
prerelease with one that lists the same ZIPs by their full links into the build's prerelease,
which electron-updater follows as given. Like the Linux canary, it never moves the shortcut back:
a run for a build older than the one the shortcut's `canary-mac.yml` names stops after the build's
own prerelease. No canary prerelease ever carries `latest-mac.yml`, the file releases carry.

### Choosing a Build

The CLI and the Mac app follow one rule, by tag prefix, and never by a version's prerelease
identifiers:

- **Alpha** looks only at tags that are a release tag, as Release draft requires (`v0.1.0`,
  `v0.1.0-alpha.2`, `v0.1.0-beta.1`). The newest is the highest version whose release is
  published: Release draft needs the tag before it makes the draft, so a tag alone doesn't count.
  The tags come from GitHub's matching-refs API for `tags/v`, all in one response
  ([matching references](https://docs.github.com/en/rest/git/refs#list-matching-references)),
  and each release by its tag ([by tag](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name)),
  which GitHub shows only once it is published.
- **Canary** looks only at `canary-<date>.<run>` tags. The newest is the build the `canary`
  prerelease holds; for the Mac app, the newest with Mac files, which the shortcut's
  `canary-mac.yml` names and which can be up to a day behind (decision 3). Any kept build can be
  chosen instead: `your-space upgrade --channel canary --version canary-20261125.3` (the build's
  tag or its full version), and the Mac app lists the kept builds that have Mac files, newest
  first.

`--version` needs `--channel` and names a build of that channel: a canary under Alpha, or a `v`
release under Canary, is refused with nothing changed.

A lookup that fails, such as one GitHub rate-limits, says it couldn't check: it never reads as
nothing newer and never picks another build. A build older than the installation is a downgrade:
`upgrade` refuses it, and the way back is a backup (decision 7).

### The Mac App's Feed

The app no longer uses electron-updater's GitHub provider. For an alpha app that provider reads
only the repository's releases Atom feed, which lists the newest 10 releases (checked on
2026-11-25), and skips every tag that isn't a version, as `canary-20261125.3` isn't
([GitHubProvider.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/providers/GitHubProvider.ts),
lines 81–137). So it would never install a canary, but once ten canaries follow the newest alpha
it would find no release at all. Instead, at every check the app chooses its channel's build by
the rule above and points electron-updater's generic provider at it
([GenericProvider.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/providers/GenericProvider.ts)):

- **Alpha:** `https://github.com/your-space-ai/your-space/releases/download/<tag>/` with the
  channel `latest`, which reads that release's `latest-mac.yml`.
- **Canary:** `https://github.com/your-space-ai/your-space/releases/download/canary/` with the
  channel `canary`, which reads the shortcut's `canary-mac.yml`. Its ZIPs are on the build's own
  prerelease, so a download never races a newer build. A build chosen from the list is read from
  its own prerelease the same way.

The channel goes in the feed's options. The app never sets the updater's `channel` property,
which turns on `allowDowngrade` and can't be cleared once set
([AppUpdater.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/AppUpdater.ts),
lines 152–163), and downgrades stay off. Two guards keep canaries from Alpha apps: an Alpha app
reads only a `v` release's feed, and no canary prerelease has `latest-mac.yml`. A canary's version
contains `-alpha.` and sorts after the alpha it follows, so without them electron-updater would
take it as a newer alpha. The implementation pins electron-updater; version 7 changes how the
GitHub provider picks a release
([7.0.0-alpha.14](https://github.com/electron-userland/electron-builder/blob/electron-updater%407.0.0-alpha.14/packages/electron-updater/src/providers/GitHubProvider.ts)).

**Considered:** one rolling prerelease holding only the newest build, with `canary-mac.yml` read
through the generic provider (the recommendation); a prerelease per build tagged with its version,
which the GitHub provider would offer Alpha apps as an alpha; another host, such as a second
repository or GitHub Pages.

## 6. What `upgrade --channel` Runs

**Decided:** `upgrade --channel <name>` finds the channel's newest build, or the one `--version`
names, and downloads that build's CLI for this machine (the Linux executable or the npm package, as
the running one is) from that build's own release. It checks it against that release's
`SHA256SUMS` and runs its `upgrade`. The 2026-11-24 rule holds: an installation moves to the version
of the CLI that runs `upgrade`, so each version's own upgrade steps run. A canary's CLI reads its
files from its own build's prerelease, so it keeps working after newer builds. `init` and `setup`
keep taking the CLI's own version. The alpha.1 CLI has no flag, so the first CLI with it is a
canary, then alpha.2.

A version upgrades any older installation with no code for each older version:

- **Migrations are sequential and append-only** (decision 8). A new version runs every migration the
  database doesn't have, in order, however far behind it is.
- **Install files are replaced whole, not patched.** `upgrade` puts the target's release files from
  its Compose bundle in place of the old ones, and keeps `.env`, the data and the apps, as today.
- **A minimum upgrade-from version, only when needed.** If a change ever can't work that way, the
  version that makes it declares the oldest version it upgrades from, and its `upgrade` refuses an
  older installation with `Upgrade to <version> first`, as GitLab's required upgrade stops do
  ([upgrade paths](https://docs.gitlab.com/update/upgrade_paths/)). `--version` reaches that
  version first. No version declares one now.

**Considered:** the running CLI installing the newer files itself, which would run upgrade steps
for a release it doesn't know; printing the commands only.

## 7. Moving Between Channels

**Decided:** an installation follows one channel and is offered only that channel's builds; nothing
offers a build of another channel.

- **Leaving Canary** is choosing Alpha. The installation stays on its canary build and moves
  forward at the first alpha newer than it, usually the next one, since a canary sorts before the
  next release. Until then the app says "You'll move to Alpha with the next alpha", and `upgrade
  --channel alpha` says nothing is newer and changes nothing. A release is tagged at the tip of
  `main`, so the canaries after it are built from it and sort after it: Canary gets each release's
  changes as a canary.
- **Going back now**, to the release a canary followed or to any older build, is a downgrade:
  restore the backup `upgrade` took when the installation left that build (named with that build's
  version) over that build's files, losing what changed since. Every backup is kept (decision 9),
  so there is one for each build. Until 006 brings restore into an installation, that is the manual
  restore on the [canary page](../../docs/install/canary.md#go-back-to-releases). `upgrade` never
  moves an installation backward: the older CLI refuses a newer installation, and an older server
  refuses a database a newer one migrated.
- Leaving forward is safe for the data because migrations on `main` stay as merged (decision 8).

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
none, as today, so every build an installation left can be restored (decision 7). A Mac on Canary
that installs each day's build adds one a day, each the size of the database.

**Considered:** the newest 5 plus the newest taken from a release (the recommendation); only those
taken from releases, plus the newest.

## 10. Which Release Carries It

**Decided:** alpha.2 carries all of it: the two channels and the app's setting, `upgrade --channel`
and `--version`, a prerelease for every canary build, and daily Mac canaries. The alpha.1 app has no
setting, so the setting reaches people with alpha.2. Before the first Mac canary the Account Holder
creates the second certificate and its API key (decision 4). The owner then installs the first Mac
canary by hand from the ZIP on its build's prerelease and chooses Canary in it once, since every
app follows Alpha until then (decision 2). The choice is stored, so later canaries keep following
Canary.

The alpha.1 app keeps the GitHub provider. It finds alpha.2 only while alpha.2 is among the newest
10 entries of the releases feed, which later canary builds push it out of. After that the provider
finds no release: the daily check shows nothing, **Check for Updates…** says it couldn't check, and
an alpha.1 app gets alpha.2 from its DMG.

**Considered:** the flag first and the Mac parts after alpha.2; all of it after the first packaged
release.

## Requirements

- **FR-001**: The Mac app offers Alpha and Canary under **Your Space › Update Channel**. Every
  build, a canary included, follows Alpha until the owner chooses; only a choice is stored, in
  `updates.json`. Choosing Canary first says that canaries are unsupported.
- **FR-002**: Every check, automatic or manual, takes the channel's newest build by the rule in
  decision 5 and reads it with electron-updater's generic provider, with the channel in the feed's
  options and downgrades off. The app is offered only its channel's builds, and says so when
  nothing is newer. A lookup that fails says the app couldn't check, and offers nothing.
- **FR-003**: The Mac app lists the kept canary builds that have Mac files, newest first. A newer
  one installs as an update; an older one is a downgrade, which the app explains (FR-008) and
  doesn't install.
- **FR-004**: Every canary build publishes its own prerelease, `canary-<date>.<run>`, then the
  rolling `canary` prerelease, then the images' `canary` tag, each step retried and safe to re-run.
  A build's prerelease is on its commit, never the latest release, unchanged after its check except
  for the Mac files, and kept, as are its images. Each canary workflow checks and deletes only its
  own files.
- **FR-005**: Once a day and when started by hand, a workflow packages the newest Linux canary for
  Apple Silicon and Intel, signs it with the canary certificate, notarizes and staples both apps,
  checks their update ZIPs, and uploads them and `canary-mac.yml` to the build's prerelease; then
  the rolling prerelease's `canary-mac.yml` lists them by full link, unless it already names a
  newer build. No canary prerelease carries `latest-mac.yml`. It never delays the Linux canary.
- **FR-006**: `your-space upgrade --channel alpha|canary`, with an optional `--version <build>`,
  takes that build, downloads its CLI from its own release, checks it against that release's
  `SHA256SUMS`, and runs its `upgrade`. It changes nothing when the installation is already that
  build, refuses an older one (FR-008), refuses a `--version` that isn't a build of the named
  channel, and stops with nothing changed when a lookup fails. Plain `upgrade` is unchanged.
- **FR-007**: A required test proves that Alpha clients never select a canary. Its fixture is the
  recorded GitHub responses the rule reads, with the newest published `v` release followed by more
  than ten canary builds, whose versions contain `-alpha.` and sort after it: the matching-refs
  response for `tags/v`, each release by its tag, including the "not found" for a higher `v` tag
  whose release is still a draft, the rolling `canary` prerelease, the newest `v` release's
  `latest-mac.yml`, the shortcut's `canary-mac.yml`, and the releases Atom feed. With the pinned electron-updater:
  - `upgrade --channel alpha` and the Mac app on Alpha select the newest published `v` release, and
    offer nothing to a client already on it or on a later canary.
  - Canary selects only `canary-` builds.
  - A `--version` naming the other channel's build is refused.
  - The alpha.1 app's GitHub provider, reading that Atom feed, never resolves to a canary's files.
  - A failed lookup selects nothing and says so.

  A second check confirms that no canary workflow uploads `latest-mac.yml`. Both run on every pull
  request that changes the selection, the updater or the canary workflows.
- **FR-008**: Leaving Canary waits for the first newer alpha. An older build is reached only by
  restoring the backup taken when the installation left it, and `upgrade` never moves an
  installation backward.
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
  [Provider.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/providers/Provider.ts).
- Drizzle ORM 0.45.4, the server's:
  [migrator](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/dialect.ts).
- GitHub: [releases](https://docs.github.com/en/rest/releases/releases),
  [matching references](https://docs.github.com/en/rest/git/refs#list-matching-references),
  [hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
  [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
  [Actions limits](https://docs.github.com/en/actions/reference/limits),
  [prerelease notifications](https://github.com/orgs/community/discussions/10776). The releases Atom feed's
  10 entries were counted on 2026-11-25 on a repository with many releases.
- Apple: [designated requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements),
  [Developer ID certificates](https://developer.apple.com/help/account/create-certificates/create-developer-id-certificates).
- GitLab: [required upgrade stops](https://docs.gitlab.com/update/upgrade_paths/).
- This repository: the alpha.1 Release draft run's job times (2026-11-24) and release assets,
  `desktop/src/updates.mjs`, `desktop/src/local-setup.mjs`, `cli/src/commands/upgrade.ts`,
  `cli/src/release.ts`, `server/src/migrate.ts`, `deploy/canary-version.sh` and
  `.github/workflows/canary.yml`.
