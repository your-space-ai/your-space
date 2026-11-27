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
| 1 | What counts as a new version? | **Recommended:** the kit file at the latest commit of the branch the owner's link names differs from the installed kit. No version field, no tags. A link at a tag or a commit has no newer version; the owner updates it by giving a new link. |
| 2 | How does the owner review an update? | **Recommended:** the install review, showing only what changes: the kit and Compose commits, each image, settings added and removed, internet hosts added and removed, limits and the interface. A new host is approved by applying the update, as at install. |
| 3 | What happens when an update doesn't start? | **Recommended:** it is rolled back on its own: the kit, Compose file, image pins and settings it replaced are put back and the app is started again. The app's own data isn't restored. |
| 4 | Are checks run in the background or on demand? | **Recommended:** on demand, when the owner asks, from the app's page or the CLI. Nothing polls GitHub (015 R7, the no-telemetry rule). |
| 5 | What happens to settings the new kit adds or removes? | **Recommended:** an added setting is filled as at install (generated, derived, the kit's value, or asked in the review); a removed one is deleted when the update applies, and put back by a rollback. Values of kept settings stay. |
| 6 | Who can update from the CLI? | **Recommended:** the operator, on the machine that runs Your Space: `your-space app check-update <app>` and `your-space app update <app>`, which an agent with a shell there can drive. An agent's Your Space key can't update apps. |

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

**Recommended:** a newer kit file on the link's branch.

Your Space stores the link the owner gave (`kit_link`) and the branch it named. A check resolves
the branch's latest commit and reads the kit there, through the GitHub connection when the
repository is private (015). It's an update when the kit file's content differs from the installed
kit's. A commit that changes other files in the repository isn't one: the kit pins its Compose file
by commit, so only a change to the kit changes what runs.

- A link at a tag or a full commit is fixed: a check says it has no newer version. The owner
  updates it by giving another link ("Update from a link"), which then becomes the app's link.
- An app installed before this spec has no stored link. Its check asks for one, once; the
  dashboard fills the field with the kit's repository and path at its default branch.
- The new kit must name the same app (`name`) as the installed one, or none.

**Considered:** tags, newest semver tag wins (needs a release discipline kit authors don't have
yet); a `version` field in the kit (one more thing for authors to bump, and a kit edited without
bumping it would never update).

## 2. Reviewing an Update

**Recommended:** the install review, as a list of changes.

The check builds the same review as an install, from the new kit and its Compose file, with the
app's stored values, and the dashboard and CLI show only what differs from what runs:

- the kit's commit, and the Compose file's repository, path and commit, old to new, each linked to
  GitHub so the owner can open the diff there;
- each image whose reference or digest changes, and whether it is private;
- settings added, with the ones to fill in, and settings removed;
- internet hosts the kit adds, approved by applying the update, and hosts it no longer lists;
- limits for added or removed services, and a changed interface.

A review whose file Your Space refuses can't be applied, as at install. Applying an update the
owner reviewed checks that the app still runs the kit the review was made against; if it changed
meanwhile, the owner checks again.

**Considered:** a raw text diff of the two kit files (exact, but it shows nothing about images or
the Compose file it points at); applying without a review (the agent case can confirm with `--yes`
instead).

## 3. Rollback

**Recommended:** automatic, once.

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

**Recommended:** on demand.

A check runs when the owner clicks **Check for update** on the app or runs `your-space app
check-update`. Nothing checks in the background, so no GitHub request leaves the server without
the owner asking, and the GitHub connection's token is used only on request (015 R7).

**Considered:** a daily background check with an "Update available" badge (the no-telemetry rule
allows "GitHub update checks", but 015 R7 limits the connection's token to requests the owner makes,
so a private kit couldn't be checked unattended without changing it).

## 5. Settings the New Kit Adds or Removes

**Recommended:**

- **Added:** filled as at install: generated, derived or set from the kit, or asked in the review.
  An update with a required value missing can't be applied until the owner gives it. From the CLI,
  an update that needs an asked value says so and points to the dashboard, as `install-app` does.
- **Kept:** the stored value stays, including one the owner changed and generated secrets. A
  setting whose kit entry changes kind, such as from a value to `generate`, keeps its stored value.
- **Removed:** shown in the review, and deleted when the update applies. A rollback restores it.

Approved hosts follow the same rule: a host the kit adds is approved with the update, a host the
kit drops is removed, and a host the owner approved stays. Limits the owner set for a service stay;
a new service gets the kit's limits or the defaults.

**Considered:** keeping removed settings' values for a later kit (data the app no longer reads,
stored encrypted, with no way to see it).

## 6. The CLI

**Recommended:** operator commands, on the machine that runs Your Space, wrapping server commands
as `your-space owner reset-link` does:

```sh
your-space app check-update <app> [--link <kit-link>] [--json]
your-space app update <app> [--link <kit-link>] [--yes] [--json]
```

`check-update` prints the review of section 2, or that the app is up to date. `update` prints it
and asks before applying, or applies with `--yes`, waits for the job and reports the result or the
rollback. With `--json`, both print the review as data, so an agent driving the CLI reads it and
decides. An agent's Your Space key can't update apps: updating changes what code runs, which is the
owner's or the operator's to do.

**Considered:** an agent role that may update apps through the gateway (new authority over the
workspace, not over one app's API).

## Agent Access Across an Update

Spec 018 makes grants and app keys survive kit changes; this spec assumes it. An update keeps the
app's grants and bound credentials. It drops only a grant of a role the new kit no longer declares
and a credential it no longer names, and marks pending requests stale, since they were approved
under the previous kit. Removing an app still retires all of its agent access. The change to
`retire_agent_binding` and to the `kit_digest` check is made once, with spec 018.

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
   twenty --json`, reads the changes, and runs `your-space app update twenty --yes`.

## Requirements

- **FR-001**: Installing from a link stores the link as given and the branch it named. An app
  installed before has none until the owner gives one.
- **FR-002**: A check reads the kit at the latest commit of the link's branch, through the GitHub
  connection when the repository is private, and reports an update when the kit's content differs
  from the installed kit. A link at a tag or commit reports none. A check runs only on request.
- **FR-003**: An update's review lists, against the installed app: kit and Compose commits with
  links, changed images, settings added and removed, hosts added and removed, changed limits and
  interface. A refused file can't be applied.
- **FR-004**: Applying an update changes the app's row in place and keeps the app's ID, volumes,
  kept settings, publish settings, owner-approved hosts, owner-set limits, agent grants and bound
  credentials; it deletes removed settings and kit hosts the kit dropped and adds the new ones.
- **FR-005**: An update's job signs in to GHCR for the app's private images, as an install does.
- **FR-006**: Applying checks that the app still runs the kit the review was made against
  (`kit_source`), and that no other job is running for it; otherwise it is refused and the owner
  checks again.
- **FR-007**: An update whose job fails, or whose app isn't running when it ends, is rolled back
  once to what it replaced, and the rollback is recorded and shown with its reason.
- **FR-008**: Events record each check that found an update, each update and each rollback, with
  the actor.
- **FR-009**: The dashboard's app page has **Check for update**, the review, and apply. The CLI has
  `your-space app check-update` and `your-space app update`, with `--link`, `--yes` and `--json`,
  over server commands.
- **FR-010**: Agent access across an update follows [Agent Access Across an Update](#agent-access-across-an-update).
- **FR-011**: Tests cover an update that changes the image, adds and removes a setting, adds a
  host, keeps an owner-approved host and publish settings, keeps an agent grant and key, a private
  kit, a check with nothing new, a stale review, and a failed start rolled back. The install guide
  replaces "Installed apps don't update" with how to update.

## Sources

- This repository: `server/src/apps/service.ts` (preview, install, jobs), `server/src/apps/kits.ts`,
  `server/src/apps/github.ts`, `server/src/agents/store.ts`, `server/drizzle/0018_agent_credentials.sql`,
  `cli/src/commands/owner.ts`, and branch commit `9298aca`.
