# Feature Specification: Kit Updates

**Feature Branch**: `019-kit-updates`

**Created**: 2026-11-27

**Status**: Draft. Each decision below carries a recommendation and goes to the owner one at a time.

**Input**: The owner, on 2026-11-27: "id like a better updating system for the kits. we shouldnt have
to "reinstall" a new kit. kit points to a github repo, we should be able to pull the repo and see if
there is a new verssion and offer to install the update in the ui. cli can do this if an agent is
driving the process."

**Related**: journey [002](../002-install-an-app/spec.md) and its kit format, journey
[015](../015-private-sources/spec.md) (private kits through the GitHub connection), journey
[017](../017-agent-writes/spec.md) (agent writes), spec 018 (per-app grants, in progress), and
[Install and publish apps](../../docs/apps/install-apps.md).

## At a Glance

- **Who:** an owner whose installed app came from a kit link on GitHub, public or private, and whose
  kit has changed since.
- **Done when:** the owner checks an installed app for an update, from the dashboard or the CLI;
  sees what the update changes; applies it in place; and the app runs the new kit with its data,
  settings, publish settings, approved internet hosts, agent grants and app keys as they were. An
  update that doesn't start is rolled back to the kit that ran before.
- **Not covered:** kits given as a file on the machine (they have no link to check), a catalogue
  of kits, updating many apps at once, and undoing what an app's own new version did to its data.

## Decisions

| # | Question | Decision or recommendation |
| --- | --- | --- |
| 1 | What counts as a new version? | **Decided:** a newer commit that changes the installed kit file, on the branch the owner's link names. No version field, no tags. A link at a commit or a tag follows the repository's default branch for the same file. Owner: "i install from kit file at particular commit, if that commit on that file changes, its an update"; asked whether a link pinned to a commit follows main too: "Yes, follow main" |
| 2 | How does the owner review an update? | **Decided:** on the app's details page. An available update shows there, and **Preview changes** opens a plain-language summary of what changes, with the diff behind it. Applying approves new hosts, as at install. Owner: "it should show up in the app details page, and maybe a preview changes button that render a diff or some nice interpretation of it that clearly showsthe user what this changes." |
| 3 | What happens when an update doesn't start? | **Decided:** it is rolled back on its own, once: the kit, Compose file, image pins, settings and hosts it replaced are put back and the app is started again. The app's own data isn't restored. Owner: "recommended is fine" |
| 4 | Are checks run in the background or on demand? | **Decided:** when the owner uses the app in Your Space, now and then, and on demand. Opening the app's details page checks it when its last check is over 12 hours old; **Check for update**, there at any time, and the CLI check at once. Nothing runs on a timer. Owner: "periodic check can be triggered occasionally when the user interacts with the app."; on the interval: "at most 12 hours automatically, i should be able to trigger a manual check somewhere in the ui at any point tho" |
| 5 | What happens to settings the new kit adds or removes? | **Decided:** an added setting is filled as at install (generated, derived, the kit's value, or asked in the review); a removed one is deleted when the update applies, and put back by a rollback. Values of kept settings stay, except that a value the kit sets, which the owner never changed, follows the new kit. Owner: "this is fine" |
| 6 | Who can update from the CLI? | **Decided:** the operator, on the machine that runs Your Space: `your-space app check-update <app>` and `your-space app update <app>`, which an agent with a shell there can drive. An agent's Your Space key can't update apps. Owner: "yes" |
| 7 | Can an update move an app to a kit or Compose file in another repository? | **Decided:** an update never moves an app to another kit or kit location; it follows the installed kit at its own location. A change of the Compose file the kit pins, in its repository or path too, shows in the update's review like any change. Owner: "update wouldn't move to a different kit or kit location tho, it tracks the installed kit at its location as its updated. compose file changes would show up in the diff" |
| 8 | Is a CLI to remove an app part of this? | **Recommended:** no. Updating in place removes the need to remove and reinstall; removing from the CLI is a follow-up of its own. |

## What Exists Today

- **Install.** The owner pastes a kit's link, at any branch, tag or commit. Your Space reads the
  kit at the commit the link resolves to, then the Compose file the kit pins by `source.commit`,
  checks the file and its images, and shows a review. Installing stores the kit, the kit's pinned
  link (`kit_source`, `https://github.com/<repo>/blob/<commit>/<path>`), the Compose file and its
  commit, the image digests, settings, approved hosts and limits, then runs an install job. The
  branch the link named is not stored.
- **No update.** "Installed apps don't update"
  ([install guide](../../docs/install/index.md)). The only path is Remove, keeping data, then
  installing the kit again with `--reuse-data`, or Reuse in the review. That path:
  - deletes the app's stored settings and approved hosts and writes them again from the new kit, so
    a host the owner approved later is lost;
  - keeps publish settings only if they are given again;
  - retires agent access: the `retire_agent_binding` trigger
    (`server/drizzle/0018_agent_credentials.sql`) deletes the app's agent grants and bound app
    credentials and marks pending requests stale whenever `kit`, `kit_source`, `commit`, `compose`,
    `source_url` or `images` change, and `catalog()` (`server/src/agents/store.ts`) ignores bound
    credentials whose `kit_digest` doesn't match the current kit. After each kit change the owner
    pastes the app's key again and grants the roles again.
- **Jobs.** `apply` recreates an app from its stored row and is used for every settings, publish,
  limits and host change. Only `install` signs in to GHCR for private images (015 R9); an `apply`
  that has to pull a new private image fails.
- **Prior art.** Branch commit `9298aca` (and `c9e09b4`, the same change) added
  `upgrade-agent-kit`: an operator command that swapped a version 1 kit for a version 2 kit with
  `agentAccess`, refused any other change, and guarded the swap with the installed kit's digest. It
  never redeployed the app and never reached `main`. Its compare-and-swap on the installed kit is
  reused here (FR-006); its "only agentAccess may change" rule is not.

## 1. What Counts as a New Version

**Decided (2026-11-27):** a newer kit file on the link's branch. The owner: "i install from kit file
at particular commit, if that commit on that file changes, its an update".

Your Space stores the link the owner gave (`kit_link`) and the branch it named. A check resolves
the branch's latest commit and reads the kit there, through the GitHub connection when the
repository is private (015). It's an update when the kit file's content differs from the installed
kit's. A commit that changes other files in the repository isn't one: the kit pins its Compose file
by commit, so only a change to the kit changes what runs.

- A link at a commit or a tag follows the repository's default branch for the same file. The owner,
  asked whether an app installed from a link pinned to a commit shows updates when that kit file
  changes on the repository's main branch: "Yes, follow main".
- An app installed before this spec has no stored link; its check follows the default branch for
  the file its pinned kit link names. An app installed from a kit file given on this machine has no
  kit location, so it has nothing to check.
- The owner can't give another link: an update follows the installed kit at its own location
  (section 7).
- The new kit must name the same app (`name`) as the installed one, or none.

**Considered:** tags, newest semver tag wins (needs a release discipline kit authors don't have
yet); a `version` field in the kit (one more thing for authors to bump, and a kit edited without
bumping it would never update).

## 2. Reviewing an Update

**Decided (2026-11-27):** on the app's details page, as a summary of the changes with the diff
behind it. The owner: "it should show up in the app details page, and maybe a preview changes button
that render a diff or some nice interpretation of it that clearly showsthe user what this changes."

The app's details page has **Check for update**. An update it finds shows on that page, with
**Preview changes**, which opens a plain-language summary of what the update changes; the diff of
the kit file, and links to the commits on GitHub, are behind it. The page stays calm by default, and
the detail is there on demand. The summary is built from the same review as an install, made from
the new kit and its Compose file with the app's stored values, and shows only what differs from what
runs. The CLI prints the same summary:

- the kit's commit, and the Compose file's repository, path and commit, old to new, each linked to
  GitHub so the owner can open the diff there;
- each image whose reference or digest changes, and whether it is private;
- settings added, with the ones to fill in, and settings removed;
- internet hosts the kit adds, approved by applying the update, and hosts it no longer lists;
- limits for added or removed services, and a changed interface.

A review whose file Your Space refuses can't be applied, as at install. A review is made of one
candidate: the new kit at an exact commit, the Compose file it pins, and the image digests the
review showed, which become the app's pins as at install. Applying it applies that candidate, never
the branch's latest commit or an image resolved again at the time of applying, and is refused when
the app no longer runs the kit the review was made against; the owner then checks again.

**Considered:** a raw text diff of the two kit files (exact, but it shows nothing about images or
the Compose file it points at); applying without a review (the agent case can confirm with `--yes`
instead).

## 3. Rollback

**Decided (2026-11-27):** automatic, once. The owner: "recommended is fine".

Before an update applies, the server keeps what it replaces: the kit, `kit_source`, the Compose
file and its commit, image pins, settings and kit-listed hosts. If the update's job fails, or the
app isn't running when the job ends, the server restores them, starts the app again with them,
records the rollback with the reason, and the owner sees "Update failed and was rolled back:
\<reason\>". If the rollback doesn't start either, the app shows as failed, as any failed apply does.

What isn't undone: anything the new version of the app did to its own data, such as a database
migration. Your Space keeps no backup of an app's volumes, and the docs say so beside the button.

**Considered:** a manual "Roll back" button (keeps a previous version around, one more state to
show); no rollback (the owner re-pastes the old pinned link).

## 4. When Checks Run

**Decided (2026-11-27):** when the owner uses the app, now and then, and on demand. The owner:
"periodic check can be triggered occasionally when the user interacts with the app."

- **When the owner opens the app.** Opening an app's details page checks it when its last check is
  more than 12 hours old. The owner: "at most 12 hours automatically, i should be able to trigger a
  manual check somewhere in the ui at any point tho". The check runs in the background of that page; the page
  doesn't wait for it, and shows an update once it is found.
- **On demand.** **Check for update** on that page, which is there at any time, and `your-space app
  check-update` check at once, whenever the last check was.
- **Nothing else.** No timer, and no check while nobody uses Your Space. Opening the Apps list
  doesn't check every app; it shows what the last checks found.

The server keeps, per app, when it last checked and the update it found, if any, so the Apps list
and the details page can show "Update available" without checking again. A check that fails, such
as with GitHub unreachable, counts as a check, so the page doesn't try again on each visit.

These checks are owner-started, so the no-telemetry rule holds: no GitHub request leaves the server
unless the owner is using it. 015's R7 says the GitHub connection is used "only while the owner
reviews or installs"; this spec adds update checks to that list. Opening an app's page is the
owner's request.

**Considered:** on demand only (the recommendation); a daily background check with an "Update
available" badge.

## 5. Settings the New Kit Adds or Removes

**Decided (2026-11-27):** as below. The owner: "this is fine".

- **Added:** filled as at install: generated, derived or set from the kit, or asked in the review.
  An update with a required value missing can't be applied until the owner gives it. From the CLI,
  an update that needs an asked value says so and points to the dashboard, as `install-app` does.
- **Kept:** the stored value stays, including one the owner changed and generated secrets. A
  value the kit sets, that the owner left as the installed kit set it, follows the new kit, so a
  kit author's change reaches the app; one the owner changed stays. A setting whose kit entry
  changes kind, such as from a value to `generate`, keeps its stored value.
- **Removed:** shown in the review, and deleted when the update applies. A rollback restores it.

Approved hosts follow the same rule: a host the kit adds is approved with the update, a host the
kit drops is removed, and a host the owner approved stays. Limits the owner set for a service stay;
a new service gets the kit's limits or the defaults.

**Considered:** keeping removed settings' values for a later kit (data the app no longer reads,
stored encrypted, with no way to see it).

## 6. The CLI

**Decided (2026-11-27):** the owner: "yes". Operator commands, on the machine that runs Your Space, wrapping server commands
as `your-space owner reset-link` does:

```sh
your-space app check-update <app> [--json]
your-space app update <app> [--review <digest>] [--yes] [--json]
```

`check-update` prints the review of section 2, with the candidate's pinned kit link, or that the
app is up to date. `update` makes the review, prints it and asks before applying that candidate, or
applies it with `--yes`; it waits for the job and reports the result or the rollback.

Each review has a digest of everything it shows: the installed kit it was made against, the link
the app will be checked at from then on, the candidate's kit and Compose commits, and its image
digests. `check-update` prints it. An agent that
applies what it read later passes it as `--review`; `update` makes the review again and is refused,
so the agent checks again, when its digest differs, as when another update was applied, the branch
moved or an image tag now names another digest. The review shows the link the update stores as the
app's link: the app's own link, or the default branch's for one at a commit or a tag (decision 1). With `--json`,
both commands print the review as data, so an agent driving the CLI reads it and decides. An agent's Your Space key can't update apps: updating changes what code runs, which is the
owner's or the operator's to do.

**Considered:** an agent role that may update apps through the gateway (new authority over the
workspace, not over one app's API).

## 7. Moving to Another Repository

**Decided (2026-11-27):** an update never moves an app to another kit or kit location. The owner:
"update wouldn't move to a different kit or kit location tho, it tracks the installed kit at its
location as its updated. compose file changes would show up in the diff".

An app's updates come from the kit it was installed from, at that file, following its branch
(section 1). When the kit pins another Compose commit, or a Compose file at another path or in
another repository, the review shows it, old to new, with how each file was read, like any change.
Moving an app to another kit stays a removal and a new install. That install refuses to reuse data
kept from another repository (`name_taken`). The kept data isn't deleted: the owner can install the
app again from its original repository and reuse it, or delete it, which can't be undone.

**Considered:** Update from a link, which reviewed and applied a kit at any link the owner gave,
in another repository too (the recommendation).

## 8. Removing an App From the CLI

**Recommended:** not part of this spec. Updating in place covers what remove and reinstall were used
for, except moving to another kit (section 7). A `your-space app remove` command, keeping data by default
as Remove in the dashboard does, is a follow-up of its own.

**Considered:** adding `your-space app remove` here, beside `check-update` and `update`.

## Agent Access Across an Update

Spec 018 makes grants and app keys survive kit changes; this spec assumes it and changes nothing
in agent access. In 018 a grant is per app, so an update keeps every grant and every bound
credential. A credential the new kit no longer names stays stored, and a grant that uses it is
unavailable until the owner picks another; a later kit may name it again. An app whose stored kit
018 no longer reads for agent access, a 017-format kit, gets it back when an update installs a kit
in 018's format, with its grants and keys as they were. Pending requests go stale,
since they were approved under the previous kit. Removing an app still retires all of its agent
access. 018's migration rewrites `retire_agent_binding` and drops the `kit_digest` check; this
spec's migration follows it.

## User Scenarios

1. **Check and update.** The kit's author changes the kit on `main` to pin a newer Compose commit.
   The owner opens the app, clicks **Check for update**, sees the kit and image changes, and
   applies. The app restarts on the new images; its records, settings, link, hosts, agent grants and
   keys are as they were, and an agent's next request works without a new key.
2. **Private kit.** The same, for a kit in a private repository read through the GitHub connection,
   with a private image signed in to with the image token.
3. **Nothing new.** A commit on `main` changes only the README. The check says the app is up to
   date.
4. **A new setting.** The new kit asks for a value. The review asks for it; the update can't be
   applied without it.
5. **A bad update.** The new image exits on start. The update is rolled back and the app runs the
   previous kit; the owner sees why.
6. **An agent updates.** An agent with a shell on the server runs `your-space app check-update
   twenty --json`, reads the changes, and runs `your-space app update twenty --review <digest>
   --yes` with the digest it printed. Had the branch or an image moved in between, the update would
   be refused and the agent would check again.

## Requirements

- **FR-001**: Installing from a link stores the link as given. An app installed before has none,
  and is checked at its pinned kit link's file.
- **FR-002**: A check reads the kit at the latest commit of the app's link's branch, through the
  GitHub connection when the repository is private, and reports an update when the kit's content
  differs from the installed kit; a link at a commit or a tag, or none, follows the repository's
  default branch for the same file. A check never reads another kit or kit location. A check runs when the owner opens the app's details page and its last
  check is over 12 hours old, or when the owner asks for one; never on a timer. The last check's time
  and result are kept per app.
- **FR-003**: An update's review lists, against the installed app: kit and Compose commits with
  links, changed images, settings added and removed, hosts added and removed, changed limits and
  interface. A refused file can't be applied.
- **FR-004**: Applying an update changes the app's row in place and keeps the app's ID, volumes,
  kept settings, publish settings, owner-approved hosts, owner-set limits, agent grants and bound
  credentials; it deletes removed settings and kit hosts the kit dropped and adds the new ones.
- **FR-005**: An update's job signs in to GHCR for the app's private images, as an install does.
- **FR-006**: Applying applies the exact candidate the review was made of: its kit at a commit, the
  Compose file it pins and the image digests the review showed. It is refused, and the owner checks
  again, when the app no longer runs the kit the review was made against (`kit_source`) or another
  job is running for it. From the CLI, `--review` binds an apply to an earlier `check-update`'s
  review digest, and the apply is refused when the review it makes has another.
- **FR-007**: An update whose job fails, or whose app isn't running when it ends, is rolled back
  once to what it replaced, and the rollback is recorded and shown with its reason.
- **FR-008**: Events record each check that found an update, each update and each rollback, with
  the actor.
- **FR-009**: The dashboard's app page has **Check for update**, the review, and apply. The CLI has
  `your-space app check-update` and `your-space app update`, with `--review`, `--yes` and `--json`,
  over server commands.
- **FR-010**: Agent access across an update follows [Agent Access Across an Update](#agent-access-across-an-update).
- **FR-011**: Tests cover an update that changes the image, adds and removes a setting, adds a
  host, keeps an owner-approved host and publish settings, keeps an agent grant and key, a private
  kit, a check with nothing new, a stale review, and a failed start rolled back. The install guide
  replaces "Installed apps don't update" with how to update.
- **FR-012**: An update follows the installed kit at its location and never moves the app to
  another kit; a change of the Compose file the kit pins, its repository or path too, shows in the
  review.

## Sources

- This repository: `server/src/apps/service.ts` (preview, install, jobs), `server/src/apps/kits.ts`,
  `server/src/apps/github.ts`, `server/src/agents/store.ts`, `server/drizzle/0018_agent_credentials.sql`,
  `cli/src/commands/owner.ts`, and branch commit `9298aca`.
