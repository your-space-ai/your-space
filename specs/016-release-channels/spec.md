# Feature Specification: Release Channels

**Feature Branch**: `016-release-channels`

**Created**: 2026-11-25

**Status**: Draft. The decisions below need the owner before anything is built.

**Input**: The owner, on 2026-11-25: "in the desktop app, should be a setting to choose which
release channel to follow for updates, and yes you can add the flag in the cli."

**Related**: [decision record](../../docs/architecture/decisions.md#your-space-updates-backup-and-restore)
(the 2026-11-24 `upgrade` entry, the 2026-11-25 canary and release channels entries, and the
2026-11-23 Mac updater entry), journeys [003](../003-install-with-the-cli/spec.md) (`upgrade`) and
[008](../008-desktop-entry/spec.md) (the Mac app), [Run the canary build](../../docs/install/canary.md)
and the [release guide](../../docs/maintainers/releasing.md).

## At a Glance

- **Who:** an owner who wants builds sooner than the releases they get today, or later ones only.
- **Done when:** the Mac app has a setting for the channel its updates follow, Canary included; the
  app and its local workspace stay on one build whatever the channel; `your-space upgrade
  --channel <name>` moves a CLI installation to the newest build of that channel; and leaving
  Canary for a release is documented and safe for the data.
- **Not covered:** Windows and Linux desktop apps, npm canaries, a separate side-by-side "Your Space
  Canary" app, and going back to an older version (Your Space only moves forward; see
  decision 7).

## Decisions Needed

Each has options and trade-offs below. The recommendations fit together; changing one may change
others, as noted.

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | Is the channel remembered or chosen each time? | The app remembers it in its settings; the CLI takes it per run and stores nothing |
| 2 | Which channels, under what names, and what is the default? | Stable, Beta, Alpha, Canary, each also getting everything more stable; the default is the channel of the installed version |
| 3 | How often is a Mac canary built, signed and notarized? | Once a day, from the newest Linux canary, only when there is a newer canary or release; update ZIPs only |
| 4 | How is an unattended Mac canary signed? | A second Developer ID certificate in its own `macos-canary` environment, with no approval step |
| 5 | Where does a Mac canary app find its updates? | `canary-mac.yml` on the rolling `canary` prerelease, read with electron-updater's generic provider |
| 6 | What does `upgrade --channel` run? | It hands over to the newest build's own CLI, so an installation still moves to the version of the CLI that runs it |
| 7 | How does an installation leave Canary for a release? | Forward only: it moves at the first release newer than its build; going back now stays a manual restore |
| 8 | Do migrations on `main` stay as they were merged? | Yes: a check refuses a change to a merged migration and a new one not stamped after every earlier one |
| 9 | Which backups does `upgrade` keep when it runs often? | The newest 5, plus the newest backup taken from a release |
| 10 | Which release carries this? | alpha.2, with the owner installing the first Mac canary by hand |

## What Exists Today

- **Mac app.** electron-updater 6.8.11 reads this repository's GitHub releases. Since the app's
  version is an alpha, the library offers it later alphas, betas and stable releases; a beta is
  offered betas and stable releases, and a stable app stable releases only (2026-11-23). It checks
  shortly after launch and then daily, sends no installation ID, and asks before downloading.
  Settings live in `updates.json` in the app's data folder. After the app changes version, its next
  start of the local workspace runs the bundled CLI's `upgrade` with the release files inside the
  app; a workspace newer than the app isn't started. This stays as it is on every channel, so the
  app's channel also decides its local workspace's build (FR-006).
- **Canary.** Every push to `main` publishes Linux images, CLI downloads and the Compose bundle,
  versioned like `0.1.0-alpha.1.canary.20261125.42`, on one rolling `canary` prerelease that holds
  only the newest build. No Mac app, nothing on npm (2026-11-25).
- **CLI.** `upgrade` moves an installation to the version of the CLI that runs it and refuses a
  newer installation (2026-11-24). Each run first writes a full `pg_dump` to `backups/`, and nothing
  deletes old ones.

## 1. Remembered or Chosen Each Time

The app has to remember its channel: its daily check runs with nobody there to choose. Stored in
`updates.json` beside **Check for Updates Automatically**. The open part is the CLI, which never
checks by itself.

| Option | For the CLI | Trade-offs |
| --- | --- | --- |
| **A. Per run** | `upgrade --channel canary` each time; plain `upgrade` keeps its 2026-11-24 meaning | Nothing hidden; scripts say what they want. Typing the flag every time |
| B. Stored in the installation folder | `--channel` writes it (in `.env`, say), and plain `upgrade` follows it from then on | One flag once. But hidden state changes what plain `upgrade` does, and a setting in `.env` that decides the version is close to the `YS_VERSION` override the alpha removed ([Alpha scope](../../docs/architecture/decisions.md#alpha-scope)) |
| C. Inferred from the installed version | A canary follows Canary, an alpha follows Alpha; `--channel` only switches | Nothing stored. But it can't remember "take me off Canary" while it waits for the next release (decision 7), so a plain `upgrade` in the meantime moves to the next canary |

**Recommendation: A** for the CLI. The CLI runs only when someone runs it, so there is nothing to
remember between runs, and one source of truth stays: the version `stack.yaml` pins.

## 2. Channels, Names and Default

| Option | Channels | Trade-offs |
| --- | --- | --- |
| **A. Stable, Beta, Alpha, Canary** | Each also gets everything more stable: Beta gets betas and stable releases, Alpha gets alphas, betas and stable, Canary gets canaries and any release newer than the newest canary | The release tags and electron-updater's own channels already work this way ([release channels](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/website/docs/tutorials/release-using-channels.md)), so no mapping. Stable and Beta have no build yet during the alpha |
| B. Releases and Canary | Releases follows the version's own track, as today; Canary as in A | Two choices. An alpha app can't ask for stable releases only |
| C. Stable, Preview, Canary | Preview is alphas and betas together | Three choices. A name the tags and the library don't use |

**Recommendation: A.**

- **Default:** the channel of the installed version: an alpha app is on Alpha, a stable app on
  Stable, a canary app on Canary. Nothing is stored until the owner chooses, so nobody's updates
  change: an alpha app that updates to `0.1.0` then follows Stable, as today. The one exception is a
  canary app, which stores Canary at its first check, so a release it installs from the Canary
  feed (decision 5) leaves it on Canary.
- **What a Stable user sees:** only `x.y.z` releases, as today. Choosing a channel that has nothing
  newer, such as Stable during the alpha, says so ("No Stable release yet") rather than failing.
- **Where:** a **Your Space › Update Channel** submenu with the four as radio items, beside
  **Check for Updates Automatically**, so it stays out of the way. Choosing Canary first says that
  canaries are unsupported and may change the data in ways the next release doesn't expect.
- **Canary and releases:** a release is tagged at the tip of `main`, so the next canary is built
  from it or later and sorts after it. Until that canary exists, or while canaries stop for a while,
  a newer release is offered instead (decisions 5 and 6).
- **Mac Canary is daily** (decision 3), while the Linux canary is every push; the name stays
  Canary, as the CLI and the docs call it.

## 3. How Often a Mac Canary Is Built

Cost is time, not money. Standard GitHub-hosted runners, the `macos-15` and `macos-15-intel` ones
the release uses included, are "free and unlimited on public repositories"
([runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners); only larger
runners are billed, [billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).
GitHub's timing API reported 0 billable milliseconds for the five macOS jobs of the alpha.1 Release
draft. The limits are 5 macOS jobs at once on the Free, Pro and Team plans, shared with pull
requests' Mac builds, and 6 hours a job ([limits](https://docs.github.com/en/actions/reference/limits)).

Measured on alpha.1 (2026-11-24): packaging took under 2.5 minutes for each architecture, in
parallel, and the notarize job 48 minutes for four submissions one after another (each app, then
its DMG), from a new Apple team. Apple says notarization "completes for most software within 5
minutes, and for 98 percent of software within 15 minutes"
([Apple](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)).
A canary needs neither DMG, since the app updates from ZIPs and the notarized app in a ZIP can be
installed by hand. Submitting the two app ZIPs together leaves about one submission's wait. Each
update is a full download: alpha.1's ZIPs are 166 MB (Apple Silicon) and 173 MB (Intel).

| Option | Builds | Trade-offs |
| --- | --- | --- |
| A. Every push to `main` | Several a day | Freshest. But the app checks daily, so most are never installed; one held macOS slot per build; inside the Canary workflow, whose builds run one at a time, it would hold up the Linux canary |
| B. Pushes that change `desktop/` or what it bundles | Fewer | But the app bundles the CLI and the release files that pin the server images, so a server-only change either rebuilds the app anyway or leaves Mac canary workspaces on old server code |
| **C. Once a day, when there is a newer Linux canary, and by hand** | At most one a day | Matches the daily check, never holds up the Linux canary. Up to a day behind `main` |

**Recommendation: C**, in a workflow of its own. It packages the newest published Linux canary:
that commit (the prerelease's notes name it) and that version, whose images are pushed and whose
install test passed. A Mac build
with a version of its own would need images of its own, and Canary's newest-build-only rule skips
commits, so the Mac build can't pick its own commit either. It signs and notarizes the two app
ZIPs, not the DMGs. When a published release is newer than that canary, it builds nothing and points
the feed at the release (decision 5).

## 4. Signing an Unattended Build

Release signing waits for the owner's approval in the `macos-release` environment, which holds the
Developer ID certificate. A daily canary can't wait for a click. Squirrel.Mac installs an update only
if it meets the running app's designated requirement, which for Developer ID names the team ID and
the app's identifier, not one certificate
([TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)).
So a second certificate from the same team keeps canaries and releases able to update each other.
A team can have five Developer ID Application certificates, and only the Account Holder creates them
([Apple](https://developer.apple.com/help/account/create-certificates/create-developer-id-certificates)).

| Option | How | Trade-offs |
| --- | --- | --- |
| **A. A second certificate, in a `macos-canary` environment** | Main only, no required reviewer, its own certificate and its own App Store Connect API key | Unattended. A leak is revoked without touching the release's secrets; revoking the release certificate would stop installed releases from opening ([release guide](../../docs/maintainers/releasing.md#sign-the-mac-app)). Anything merged to `main` gets signed without a click |
| B. The `macos-release` environment, approved each time | One click a day | No new secret, a person sees every signing. A missed click means no canary that day |
| C. The release certificate, in an environment without approval | Copy the secrets | Simplest. A leak during unattended signing means revoking the release certificate |

**Recommendation: A.** As in releases, the signing job runs no npm packages and only signs what a
job without secrets built.

## 5. The Mac Canary's Update Feed

electron-updater 6.8.11's GitHub provider can't serve Canary
([source](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/providers/GitHubProvider.ts)):

- For an app on Alpha or Beta it reads the releases feed and takes the first release whose tag is a
  semantic version that is stable, an alpha or a beta (Beta skips alphas), so the `canary` tag,
  which isn't a version, is skipped (lines 81–108).
- A canary's version is an alpha to it: the channel is the first prerelease identifier, and
  `0.1.0-alpha.1.canary.20261125.42` starts with `alpha`. After a stable release, a canary such as
  `0.1.1-0.canary.20261125.42` starts with the number 0, so the provider takes the first release in
  the feed without checking that its tag is a version, which can be `canary` (lines 73–79).
- Setting the updater's `channel` also turns on `allowDowngrade`
  ([AppUpdater.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/AppUpdater.ts),
  lines 152–163), after which an older version counts as an update.

| Option | Feed | Trade-offs |
| --- | --- | --- |
| **A. `canary-mac.yml` on the rolling `canary` prerelease** | The generic provider at `https://github.com/your-space-ai/your-space/releases/download/canary/` with channel `canary` reads `canary-mac.yml` there, and the ZIPs it lists beside it ([GenericProvider.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/providers/GenericProvider.ts), [Provider.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/providers/Provider.ts)) | Same place as the Linux canary, no new host. Not `latest-mac.yml`, so a release-channel app that ever lands on the `canary` tag finds no feed and installs nothing. The prerelease holds one build, so a download that races a replacement fails and the next check succeeds |
| B. A semver-tagged prerelease per build | The GitHub provider, as for releases | Alpha apps would be offered every canary as an alpha; Releases fills up and notifies watchers |
| C. Another host, such as a second repository or GitHub Pages | The generic or GitHub provider there | Keeps Releases to releases, but adds a token across repositories or a site to deploy |

**Recommendation: A.** With it:

- The app sets the feed from its channel (decision 2) and never leaves electron-updater to infer
  one from the version: Canary uses the generic feed; Alpha and Beta use the GitHub provider with
  that `channel` and prereleases allowed; Stable uses it with prereleases off and the channel `latest`, the default, so it reads
  `latest-mac.yml` from GitHub's latest release, "the most recent non-prerelease, non-draft
  release" ([GitHub](https://docs.github.com/en/rest/releases/releases)). Stable is never sent as
  `stable`: that asks for `stable-mac.yml`, which no release has, and with prereleases off the
  provider doesn't fall back to `latest-mac.yml` (lines 157–170). The app sets `latest` rather than
  clearing the channel, which the updater refuses once one is set (AppUpdater.ts, lines 152–160).
  After setting `channel`, the app sets `allowDowngrade` back to `false`.
- When the newest published release, of any kind, is newer than the newest canary, the daily job
  writes `canary-mac.yml` for that release instead, listing its ZIPs by their full download links,
  so a Canary app gets it through the one feed.
- Each workflow replaces only its own files on the prerelease. The Linux canary's cleanup, which
  today deletes every file not in its own list, leaves `canary-mac.yml` and the `your-space-macos-*`
  ZIPs; the Mac job leaves the Linux files and `SHA256SUMS`, which lists only the Linux build. The
  Mac ZIPs are checked against the SHA-512 digests in `canary-mac.yml`.
- The Mac canary workflow uploads the new ZIPs, then `canary-mac.yml`, and deletes the old ZIPs last.
  The generic provider adds a `noCache` query to the feed's address; a GitHub download link with
  one still redirects to the file (checked on alpha.1's `latest-mac.yml`, 2026-11-25).
- electron-updater 7's prereleases change how the GitHub provider picks a release: it takes the
  highest eligible version rather than the first in the feed
  ([7.0.0-alpha.14](https://github.com/electron-userland/electron-builder/blob/electron-updater%407.0.0-alpha.14/packages/electron-updater/src/providers/GitHubProvider.ts)).
  Implementation pins electron-updater and tests each channel's choice against a recorded feed.

## 6. What `upgrade --channel` Runs

A CLI is one version, and since 2026-11-24 an installation moves to the version of the CLI that
runs `upgrade`. The newest build is found with one request to GitHub, started by the owner: GitHub's
latest release for Stable, the newest release by version for Alpha and Beta, and for Canary the
newer of the `canary` prerelease's build (the npm package's file name carries its version) and the
newest release of any kind. No npm canary is needed.

| Option | How | Trade-offs |
| --- | --- | --- |
| **A. Hand over** | Download the newest build's CLI for this machine (the Linux executable or the npm package, as the running one is), check it against that release's `SHA256SUMS`, run its `upgrade` | The 2026-11-24 rule holds, so new versions' own upgrade steps run. One more download. The owner's `your-space` command stays as it was; the result says so |
| B. The running CLI installs the newer files itself | Download the newer Compose bundle, as `upgrade` does for its own version | One download less. An older CLI would run upgrade steps for a release it doesn't know |
| C. Print only | Resolve the build and print the commands to run | Least code, changes nothing. Not the flag the owner asked for |

**Recommendation: A**, for `upgrade` only; `init` and `setup` keep taking the CLI's own version. The
alpha.1 CLI has no flag, so the first CLI with it is a canary, then alpha.2.

## 7. Leaving Canary

An installation never goes to an older version: the older CLI refuses a newer installation, and an
older server refuses a database a newer one migrated. A canary sorts after the release it follows,
so that release is older.

| Option | How | Trade-offs |
| --- | --- | --- |
| **A. Forward only** | Choosing a release channel moves at the first release newer than the build, usually the next one. Until then the app says "You'll move to Alpha with the next alpha", and `upgrade --channel alpha` says nothing is newer and changes nothing | No new code, and safe for the data once migrations stay as merged (decision 8). A canary user waits for the next release |
| B. Go back now | Install the release the canary followed and restore the backup taken before the first canary, discarding everything since | Immediate. Needs restore into an installation, which is 006's open work, and loses data by design |
| C. Lock Canary until a newer release exists | The other channels are greyed out | Nothing to explain later. Confusing, and a choice that can't be undone until then |

**Recommendation: A.** Going back now stays the manual restore on the
[canary page](../../docs/install/canary.md#go-back-to-releases). In the app this needs
`allowDowngrade` off (decision 5); otherwise Canary to Stable would offer an older app whose CLI
refuses the newer workspace.

## 8. Migrations on `main`

A database that follows Canary applies `main`'s migrations one merge at a time, where a release
applies them together. The server's Drizzle 0.45.4 runs only migrations stamped later than the
newest the database records, and never reads one again once applied
([migrator](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/dialect.ts),
lines 73–111). So a migration changed after a canary applied it, or merged after one stamped later,
is skipped there without an error, and the next release runs on a schema it doesn't expect; one
removed can make that release refuse the database. Nothing checks this today. It already applies
to CLI canaries (2026-11-25); the app's setting puts it one click away.

| Option | How | Trade-offs |
| --- | --- | --- |
| **A. Merged migrations stay as merged** | A pull request check refuses a change to a migration already on `main`, and a new one not stamped strictly after every earlier one | Leaving Canary stays safe for the data. Also protects upgrades between releases from an out-of-order stamp. A mistake is fixed with a new migration |
| B. Accept it | The Canary warning and the canary page say the next release may not upgrade a canary's database | Nothing to build. A skipped migration shows only when something breaks |
| C. Detect at start | The server compares the recorded migrations' hashes with its own and refuses a database that differs | Catches it. The installation is then stuck until a manual restore |

**Recommendation: A.** A small check, and the only option that keeps decision 7 safe.

## 9. Backups When Following Canary

Each `upgrade` writes a full `pg_dump` to `backups/`, and nothing deletes them. A Mac on Canary that
installs each day's build adds one a day.

| Option | Keeps | Trade-offs |
| --- | --- | --- |
| A. All of them | Everything, as today | Never deletes anything. The disk fills by the database's size per update |
| **B. The newest 5, plus the newest taken from a release** | The recent ones and the way back from Canary | Bounded. Deletes backups by itself, and says which |
| C. Those taken from releases, plus the newest | The ways back from each release | Fewer files. A bad canary migration noticed two builds later has no backup from just before it |

**Recommendation: B**, after a successful upgrade only.

## 10. Which Release Carries It

The alpha.1 app has no setting, so it is only ever offered releases; the setting reaches people with
the first release that has it.

| Option | When | Trade-offs |
| --- | --- | --- |
| **A. alpha.2** | Build the setting, Mac canaries and the flag before alpha.2; the owner installs the first Mac canary by hand from the canary prerelease's ZIP | The owner runs `main` on the Mac within days. Adds to alpha.2's parked scope |
| B. The flag now, the Mac parts after alpha.2 | The next canary CLI has the flag | Smaller now. The owner's Mac stays on releases |
| C. After the first packaged release | Later | No scope added. The request waits |

**Recommendation: A.** The Account Holder creates the second certificate first (decision 4).

## Requirements Once Decided

Written for the recommendations; each changes with its decision.

- **FR-001**: The Mac app offers Stable, Beta, Alpha and Canary under **Your Space › Update
  Channel**. Until the owner chooses, it follows the installed version's channel; only a choice is
  stored, in `updates.json`, except that a canary app stores Canary at its first check.
- **FR-002**: Every check, automatic or manual, uses the channel's feed, with downgrades off.
  A channel with nothing newer says so.
- **FR-003**: Choosing Canary first says that canaries are unsupported. Leaving it waits for a newer
  release and says which.
- **FR-004**: Once a day, and when started by hand, a workflow packages the newest Linux canary for
  Apple Silicon and Intel, signs it with the canary certificate, notarizes and staples both apps,
  checks their update ZIPs, and publishes them and `canary-mac.yml` on the `canary` prerelease in
  that order. When a published release is newer, `canary-mac.yml` points at that release's ZIPs
  instead. It never delays the Linux canary, and neither workflow removes the other's files.
- **FR-005**: `your-space upgrade --channel stable|beta|alpha|canary` finds the newest build of that
  channel (for Canary, the newer of the newest canary and the newest release), checks and runs its
  CLI's `upgrade`, and changes nothing when the installation is already
  that new or newer. Plain `upgrade` is unchanged.
- **FR-006**: The app's local workspace follows the app on every channel, as today; `upgrade
  --channel` is for CLI installations. A workspace newer than the app is neither started nor
  upgraded: the app names a channel with a build at least that new, or says no Mac build is that
  new yet. A failed workspace upgrade is handled as `upgrade` handles it (2026-11-23): when the
  previous version is back, the app says so and tries again at its next start; when the rollback
  stopped for the owner to finish by hand, the app says so and doesn't start the workspace.
- **FR-007**: A pull request check refuses a change to a migration already on `main`, and a new
  migration not stamped strictly after every migration before it, since Drizzle skips one stamped
  at or before the newest it recorded. The rule holds against `main` as it is at merge, not only
  when the check last ran, so a pull request overtaken by a newer migration is updated first.
- **FR-008**: After a successful upgrade, `upgrade` keeps the newest five backups and the newest
  taken from a release, and lists what it deleted.
- **FR-009**: The canary page, the Mac guide, the release guide and the decision record describe
  the channels when they ship.

## Sources

- electron-updater 6.8.11, the version in `desktop/package.json`:
  [GitHubProvider.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/providers/GitHubProvider.ts),
  [AppUpdater.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/AppUpdater.ts),
  [GenericProvider.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/providers/GenericProvider.ts),
  [Provider.ts](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/providers/Provider.ts),
  [release channels](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/website/docs/tutorials/release-using-channels.md).
- Drizzle ORM 0.45.4, the server's:
  [migrator](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/dialect.ts).
- GitHub: [hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
  [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
  [Actions limits](https://docs.github.com/en/actions/reference/limits),
  [latest release](https://docs.github.com/en/rest/releases/releases).
- Apple: [notarization timing](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow),
  [designated requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements),
  [Developer ID certificates](https://developer.apple.com/help/account/create-certificates/create-developer-id-certificates).
- This repository: the alpha.1 Release draft run's job times and billing (2026-11-24) and release
  assets, `desktop/src/updates.mjs`, `desktop/src/local-setup.mjs`, `cli/src/commands/upgrade.ts`,
  `cli/src/release.ts`, `server/src/migrate.ts` and `.github/workflows/canary.yml`.
