---
title: "Your Space Architecture and Product Decisions"
---

**Status**: Accepted direction with implementation choices explicitly left open

**Recorded**: 2026-10-28

**Last updated**: 2026-11-25

**Scope**: Project-wide direction, independent of any feature specification

**Delivery view**: [Roadmap](../roadmap.md), derived from this record, and the [spec map](https://github.com/your-space-ai/your-space/blob/main/specs/README.md)

**Related features**: [Workspace Setup and Owner Access specification](https://github.com/your-space-ai/your-space/blob/main/specs/001-workspace-owner-access/spec.md) and [Install an App and Use It specification](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/spec.md)

**Governing document**: [Your Space Constitution](https://github.com/your-space-ai/your-space/blob/main/.specify/memory/constitution.md)

## Personal dashboard release boundary

**Initial boundary (2026-11-21).** The first public release serves one owner with Docker already available locally or on a server. The browser is the dashboard. It works on localhost, through the owner's proxy, or at a domain with HTTPS. Its AI capability is an external agent acting through the gateway with a separate identity and explicit app-scoped roles the owner manages in the web UI.

One useful action in a real connected app, with attribution, denial, and revocation, is the finish for journey 005. That requires a small working app integration. Team administration, general-purpose SDKs, desktop distribution and automated lifecycle management can each ship independently after this personal workflow works. Preserve their journey numbers and the detailed decisions below as future direction. This boundary supersedes earlier release timing and the eight-journey pre-public sequence throughout this record. The [roadmap](../roadmap.md) defines current sequencing.

**Owner update (2026-11-21).** The first public release also requires a downloadable macOS Electron app. On first launch the owner chooses between setting up a local workspace and connecting to an existing server by URL. Local setup detects a Docker engine, lets the owner override that choice, guides them through installation or startup if needed, and drives the existing Your Space CLI and owner setup. Connecting to a server works on a Mac without Docker. Both paths open the selected server's dashboard, where the owner can review and apply installation kits. The headless Docker and browser paths still ship. Journey [008](https://github.com/your-space-ai/your-space/blob/main/specs/008-desktop-entry/spec.md) owns desktop entry and packaging. Journey 005 still owns agent identity, grants and approvals. Windows and Linux desktop downloads, a bundled engine or VM, and the remaining desktop lifecycle features follow publication.

**Source preview (2026-11-21).** Prepare a quiet source preview with a Docker quickstart before the first tagged product release. The owner reviews exposure before changing repository visibility. The Mac download, clean-install checks and marketing launch follow separately. Public pull requests use ordinary CI without the maintainer’s subscription-backed reviewer.

**Workspace redesign (2026-11-23).** The first packaged release includes journey [013](https://github.com/your-space-ai/your-space/blob/main/specs/013-workspace-redesign/spec.md), the workspace redesign. Every packaged release, the alpha prerelease included, waits for its delivery: theme format version 2 through the copy pass, in the order the spec gives. 013 supersedes the presentation of journey 010 and the view behavior of 012; their storage, sharing and permission rules still apply. This decision doesn't place the two features the spec leaves to their own specifications: moving owner creation into first run, and agents requesting more access. (Superseded in part 2026-11-23, owner decision: the first alpha ships with only theme format version 2 from 013, to get feedback from users and from the owner's own use sooner. The rest of 013, from the component kit through the copy pass, is parked for alpha.2.)

### Alpha scope

**Owner decisions, 2026-11-23.** The first alpha ships a slimmed scope: "rather start getting feedback from users and from my own use than build more features." In it: `main` as it is (installs from a kit's link, pinned to exact commits), theme format version 2 from 013, the Mac app's updater with close versus quit, `your-space upgrade`, and the kit's `env` map. Parked for alpha.2, not built or merged before it: the rest of 013 (the component kit, shell and tabs, Home, Apps, Agents, Settings, sign-in and first run, and the copy pass), tracking a kit's branch with an update option, display fields in the kit, and the store view. Cut from the product: the creator workflow (managed repositories, the GitHub connection, custom Home and app authoring; see [Creator workflow deferred](#creator-workflow-deferred)), agent writes, and the items below from the scope audit. Each was cut for one of three reasons: nobody uses it, it promises more than the alpha can keep, or a parked or updated design replaces it.

- **Kit review records and the kit directory.** Agents no longer shows "No verified review for this kit revision." No review records and no public directory exist, so the line suggested vetting that isn't there; the review lookup goes with it. The Apps section that listed kits from `YS_KITS_REPOSITORY` goes too, with the setting and `GET /api/kits/catalog`: every owner saw "No kit directory is set up", and its titles were repository names. A store, when it comes, decides its own source. A `.env` that still sets `YS_KITS_REPOSITORY` is refused by name.
- **The Mac launcher's Appearance dialog.** It kept a second, per-device theme store for the one screen shown before connecting. The launcher shows the default theme and keeps none of its own; each workspace keeps its theme on its server.
- **Agent writes.** (Superseded 2026-11-26: writes come back with [journey 017](https://github.com/your-space-ai/your-space/blob/main/specs/017-agent-writes/spec.md); see [Agent writes](#agent-writes).) Agents only read, with Ask or Allow approvals. Writes had run only against a fixture, and most app APIs ignore `Idempotency-Key` and `If-Match`, so the alpha claims reads alone. A kit route must be a GET with `effect: read`; a write route, a body, an operation ID, an expected revision or a `receipt:` lookup is refused. Ask for all writes, operation-ID replay and the CLI's `--operation-id` and `--expected-revision` go. A kit stored before keeps its write routes on record, and the gateway leaves them out of every role.
- **`your-space app upgrade-agent-kit`.** A one-off migration for local installs from version 1 kits or from before labelled interfaces, with `--inspect`, `--expect-*` and `--refresh`. To add agent routes, the owner removes the app, keeping its data, and installs it again from its version 2 kit.
- **The `YS_VERSION` override.** It overrode the release's own image pin without being documented. The release stamps its images with its version and no variable, and a `.env` that sets `YS_VERSION` is refused by name. `your-space upgrade` therefore has no pinned-version case.
- **The 012 pane extras.** The layout preset choice, **Copy layout link** with its `layout` and `sizes` parameters, and divider sizes remembered in the browser. 013's views replace them, and saved views already serve one owner. Apps opened together are laid out by count, and saved views keep their layout and sizes.
- **Settings from before the data key.** The server no longer reads app settings with a key derived from the auth secret on every start: no release wrote any.
- **`install-app --compose`.** A Compose file given on this machine was recorded only by its digest, had no update path, and broke the rule that the kit is the app's full definition. `install-app --kit -` stays as the CLI's way to install a private kit, whose Compose file is on GitHub. Apps installed from a local Compose file before keep running from the stored file.
- **"Show inside Your Space" and `--frame`/`--no-frame`.** Framing stays on: Your Space shows a published app at its link in its pane wherever a browser can, and its detection of a kit that can't run in a pane, or a plain-HTTP link inside HTTPS, still opens the app in its own tab. An app the owner had turned the switch off for is applied once, the next time the server checks its apps, so its Caddy lets Your Space frame it.
- **The sidebar's Reorder.** The 013 sidebar has none, and the drag and arrow controls would need rebuilding for it. An order saved before still applies.
- **The optional owner email.** The address was unverified and nothing sends email. `--email`, `--owner-email` and Home's Email row go, and create-owner's JSON has no `email` field.
- **013, before any of it was built.** Agents requesting more access, Home's two extra layouts, pinning views with an All views page, and edge drop zones for panes leave the [013 spec](https://github.com/your-space-ai/your-space/blob/main/specs/013-workspace-redesign/spec.md).
- **Kept as it is.** Agent access is still retired on every kit, kit source or commit change, so an update means binding the app credential and granting agents again. Keeping grants when `agentAccess` is unchanged needs a new trigger in a migration, which isn't a small change while other migrations are in flight, so it waits. Until updates come with journey 006, the only update is removing and installing again, which retires access anyway. The audit's note on 013's Apps details waits with the parked Apps screen.

No migration drops what the cuts leave in the database: grants' `ask_all_writes`, requests' `operation_id`, apps' `frame` and a stored sidebar order stay, unread or as before. This supersedes, where they differ, the 2026-11-21 [agent approvals](#kit-defined-roles-server-held-credentials-and-approvals) and their all-writes setting and vetted community kits, the 2026-11-23 [Kits define apps](#kits-define-apps) choices on the kit directory and Compose files given on this machine, the 2026-11-23 [Creator workflow deferred](#creator-workflow-deferred) notes that the kit directory stays and that a Compose file that isn't public is given on this machine, the 2026-11-20 decisions on [local Compose files](#accepted-future-app-distribution-direction) and ["Show inside Your Space"](#running-apps-and-reaching-them), the 2026-11-11 optional owner email, the 2026-11-17 move of settings onto the data key, the launcher's device preference in [Portable workspace appearance](#portable-workspace-appearance), and the [012 views](#named-multi-app-views-and-sidebar-order).

### Portable workspace appearance

The owner chooses from three starters, customizes colors and local font families, and imports or exports versioned theme files. The dashboard uses its selected server’s appearance. The disconnected Mac launcher stores its own device preference and reads the same file format (superseded 2026-11-23: it shows the default theme and keeps none of its own; see [Alpha scope](#alpha-scope)). Theme data controls visual presentation. The server keeps roles, approvals, installed apps and their permissions independent of theme selection. [Journey 010](https://github.com/your-space-ai/your-space/blob/main/specs/010-personal-themes/spec.md)

**Theme format version 2 (2026-11-23).** A theme has a light and a dark palette, a component style (Crisp, Soft or Bold) and a heading, body and monospace font. The workspace stores a mode beside its selected theme: Match my device, Light or Dark. The built-in Cerulean, Cinder and Fern replace the three starters, and their fonts ship with the dashboard under the SIL Open Font License, so no theme loads remote fonts. Themes have one format: no packaged release shipped version 1, so version 1 files don't import, and a workspace's saved version 1 themes and starter choice don't carry over; it starts on Cerulean. Until the rest of 013 arrives, only the theme previews show the component style. Storage, sharing and permissions stay as above. [Journey 013](https://github.com/your-space-ai/your-space/blob/main/specs/013-workspace-redesign/spec.md)

### Kits define apps

**Owner decision, 2026-11-23.** A kit is an app's complete definition in Your Space: everything needed to install an open-source app and to show it properly. For installing, it names the app's source Compose file by repository and path, its interface, the settings Your Space generates, derives or sets and the ones it requires, the internet hosts the app needs and its limits. For showing it, it gives the app's name and title, and later its description, icon and links. A kit isn't tied to any store. An app store, when it comes, is a page that shows a chosen group of kits; it adds no format of its own.

For now Your Space installs only from a link to a kit, so every installed app has one. A bare Compose link is no longer accepted for review or install; the kit's `source`, its repository, path and exact commit, names the Compose file, which Your Space reads at that commit and records. In the web client, a kit in a private repository installs through the owner's GitHub connection with private access. (Superseded 2026-11-23: the GitHub connection is out of the alpha; the web client reads public GitHub only, and a kit in a private repository installs with the server command, `install-app --kit -`. See [Creator workflow deferred](#creator-workflow-deferred). 2026-11-25: the connection returns, read only, for private kits and the Compose files they pin; see [Private GitHub sources](#private-github-sources).)

The earlier direction let an app with no kit install when its own files were enough: Your Space picked the interface from the one service that published a port and generated values for settings whose names look secret. With a kit for every app, each install says what runs and how the app is shown. This supersedes the 2026-11-14 statement that an app with no kit installs if its own files are enough, and the owner pasting the link to the app's Compose file. Drafting a kit from a bare Compose file during the review, an app store, and display fields in the kit (description, icon, links) are future work on the [roadmap](../roadmap.md#custom-apps-and-sources). [Kit format](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/contracts/kit-format.md)

**Owner decisions on the implementation, 2026-11-23.** The pull request that builds it listed its own choices for confirmation. The owner decided:

- **Exact commits, no drift.** Everything is pinned to an exact commit. A kit's link, even one to a branch such as `blob/main/kit.yaml`, resolves to the kit's commit when the owner reviews the install, and that commit is recorded; the review and the install use exactly that kit. The kit names its Compose file's exact commit: `source.repo`, `source.path` and `source.commit`, the full 40-character commit, are all required, and Your Space reads the Compose file at exactly `source.commit`. Nothing is read at the latest commit or the default branch when installing. A kit without `source.commit` is refused, in either kit format, with a message that names the field. A newer kit commit reaches an installed app only as an update the owner chooses to install; showing that one exists is on the [roadmap](../roadmap.md#backups-and-updates). This replaces the proposed choice to read the Compose file at the kit's own commit, or else at the head of the source repository's default branch.
- **`source` is required.** Kits can live anywhere, apart from the app's repository or in it, so a kit names its Compose file and never defaults to the `compose.yaml` beside it. This replaces the proposed choice that a linked kit without `source` names that file. A kit in the same repository as its Compose file names an earlier commit than its own, since a file can't contain the commit it is in. Only a kit given with a Compose file on this machine (`install-app --compose`, or the files an app's starter installs from) leaves out `source`, since that file is the app's Compose file. An install from a repository the owner manages also reads the Compose file the kit names, at its pinned commit. (Superseded 2026-11-23: managed repositories and the app starter are out of the alpha, so `install-app --compose` is the only kit without `source`; see [Creator workflow deferred](#creator-workflow-deferred). Superseded again the same day: `install-app --compose` is gone too, so every kit given now names its `source`; see [Alpha scope](#alpha-scope).)
- **Confirmed as proposed.** The server command takes a kit's link, or a kit file on this machine (`--kit`) for one Your Space can't read from GitHub, which must name its source; a Compose file given on this machine still installs, only with a kit given with it, and `--kit <folder>` and a Compose link with `--kit` are gone (superseded 2026-11-23: a Compose file given on this machine no longer installs; see [Alpha scope](#alpha-scope)). An install from a repository the owner manages uses a kit in that repository: `kit.yaml`, unless the owner names another path. (Superseded 2026-11-23: managed repositories are out of the alpha; see [Creator workflow deferred](#creator-workflow-deferred).) The safety rule for secrets applies with a kit: a setting the kit doesn't generate, derive or set, whose name says it holds a secret and that has a published default, gets a generated value (superseded the same day: see [the kit defines the environment](#the-kit-defines-the-environment)). A reinstall that reuses a removed app's data keeps each kept setting, even an unset one, rather than one the kit installed now generates or sets. Display fields in the kit (description, icon, links) come in a separate change.
- **Kit directory.** The directory in `YS_KITS_REPOSITORY` stays for listing kits and for review evidence; it no longer finds a kit from a Compose link. Its listing and evidence are read at the commit its default branch resolves to then, and pinned to that commit. (Superseded 2026-11-23: the directory, its review evidence and `YS_KITS_REPOSITORY` are gone; see [Alpha scope](#alpha-scope).)
- **No example link yet.** The kit repository stays private for now, so the documentation's install example gives no kit link until it is public.

#### The kit defines the environment

**Owner decision, 2026-11-23, later.** With a kit for every install, the kit's `env` is the app's whole environment, in one map: each variable with a value, or with where its value comes from: generated (`generate`), worked out from the app's address or a template (`derive`), or given by the owner (`ask: true`, which the install needs, or `ask: optional`). Your Space gives exactly that map to the app's Compose file, for every `${VARIABLE}` in it, and to every service whose `env_file` is `.env` (`./.env` counts), under the environment that service's file sets itself, as Compose puts `.env` under it. Many apps' own Compose files load their settings that way, from a `.env` self-hosters fill in from an example. Your Space generates the values, encrypts and stores them, shows secrets only as set, and writes no settings file. A variable the Compose file needs, with no default, that the kit doesn't define is refused in the review: "The kit doesn't define X". The kit also says what is secret: generated values, values the owner gives unless the entry says `secret: false`, and templates that use either.

This replaces the kit's `generate`, `derive`, `set` and `secrets` fields, and the separate `required` list proposed with the `.env` change, with one map. It removes what existed only for apps without kits: the variables an app's file reads are no longer settings by themselves, and no setting is secret, or generated, because its name looks secret. It supersedes the 2026-11-14 decision that settings are the variables an app's file reads, and the safety rule for secrets confirmed above: a variable the kit leaves out gets the file's own default, and the kit says which values to generate instead. Compose reads no other file an app's file names: every other `env_file` and every `label_file` is refused, and while reviewing, Compose first reads the file as written, then is told to read none of them. (2026-11-24: Compose reads the files an `include` or an `extends: { file }` names, and an include's `env_file`, even as written, so the server refuses an app's file that has either before Compose sees it. The app's file is alone in its folder, so such a file could only be one on the machine.) Resolving a file inlines those files and drops the key, so a check of the resolved file alone could never refuse them. Writing a `.env` was considered and rejected: it would put the values on disk, in a second place, and Compose would still read any other file an app's file names. Older Your Space versions refuse `env` as an unknown field, so kits keep `kit: 1` and `kit: 2`. A kit with the old fields is refused with a message that names `env`, and an installed app's stored kit is read as `env`, so it keeps working. A reinstall that reuses a removed app's data is refused when the data was written with a value for a variable the file uses that the kit no longer defines, rather than let that value give way to the file's default. [Kit format](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/contracts/kit-format.md)

### Creator workflow deferred

<a name="managed-repositories-deferred"></a>

**Owner decisions, 2026-11-23.** The alpha ships a smaller scope, so that feedback from users and from the owner's own use comes before more features. Journey 011's creator features leave the product: managed repositories, the GitHub connection, a custom Home with `app new`, `app pack` and `app install-local`, and deploying an installed app from a repository commit. They are deferred until after the alpha; this record and journey 011 keep their history for when they return. Agent setup from a shell, kit links and the kit directory stay (superseded 2026-11-23: the kit directory is gone too; see [Alpha scope](#alpha-scope)).

- **Managed repositories.** Your Space no longer creates, imports or forks repositories, has a Repositories screen, lets an agent read or commit repository files through its key, or deploys an installed app from a repository commit. The in-place replacement engine goes with them: only those deployments used it, and nothing that stays depends on it. Until owner-chosen updates come with journey 006 ([roadmap](../roadmap.md#backups-and-updates)), a newer kit or Compose file reaches an installed app only by removing the app and installing it again, reusing its kept data.
- **GitHub connection.** The web client reads public GitHub only, as the server command does. A kit in a private repository installs from this machine with the server command, `install-app --kit -`, and names a Compose file in a public repository; a Compose file that isn't public is given on this machine too, with `install-app --compose` (superseded 2026-11-23: `install-app --compose` is gone, so the kit's Compose file is always in a public repository; see [Alpha scope](#alpha-scope)). Every operator had to register an OAuth app of their own, the connection had never run against real GitHub, and rotating the data key left its stored token unreadable, which broke kit reviews in the web client until the owner disconnected. A kit directory in `YS_KITS_REPOSITORY` must be a public repository (superseded 2026-11-23: the directory is gone; see [Alpha scope](#alpha-scope)). (Superseded in part 2026-11-25: the connection returns, read only, for installing private kits and the Compose files they pin, and must answer each of these reasons; see [Private GitHub sources](#private-github-sources).)
- **Custom Home.** The built-in Home is the only Home. Home settings, choosing an installed app as Home with read roles of other apps, `app new`, `app pack`, `app install-local` and `install-app --files-stdin` are gone. With no update path, each edit to a Home app meant removing it, installing it again, choosing it as Home and granting its reads again.
- **Stored state.** One forward migration drops these features' tables: managed repositories, agents' repository grants, replacement previews, the GitHub token and pending device authorization, and the chosen Home with its grants and read times, with the trigger that cleared the chosen Home when its app changed. They held no app data, settings or credentials, so apps keep running, and a workspace that had chosen a Home opens the built-in one. The migration deletes the GitHub token but can't revoke it: the owner revokes the authorization at GitHub. A deployment from a repository that never finished can't be resumed any more, so its app goes back to the version before it, which only the replacement kept, and waits failed until the owner starts it.

This supersedes, in the [creator workflow](#kit-defined-roles-server-held-credentials-and-approvals) decision of 2026-11-21, portable app scaffolding, the selectable Home, managed public and private repos, agent forks and edits, the server-held GitHub credential, private installs and owner-confirmed replacement; the 2026-11-23 implementation choices above for installs from a managed repository or a starter's files; and the [distribution direction](#accepted-future-app-distribution-direction) that the owner connects GitHub to install private repositories. [Journey 011](https://github.com/your-space-ai/your-space/blob/main/specs/011-agent-workspace/spec.md)

### Private GitHub sources

**Owner request, 2026-11-25.** The GitHub connection comes back, read only, for installs: "Lets bring back the ability to specify a kit from a private repo by having the user connect their github account in the setting, then installing the kit tries to use that connection to pull the kit if its not public. it should also support installing apps that are private repos as well, as long as the signed in owner's github accuont has access to both." The owner connects GitHub in the dashboard or with a server command. A kit's link is read from public GitHub first, and through the connection only when the kit, or the Compose file it pins, isn't public. This replaces making a kits repository public or bringing back `install-app --compose` as the way to install a private kit. It supersedes, in [Creator workflow deferred](#creator-workflow-deferred), the statement that the web client reads public GitHub only, and in [Kits define apps](#kits-define-apps) and the [distribution direction](#accepted-future-app-distribution-direction), the deferral of private installs through a connected account. Managed repositories, agents reading or writing repositories, and the rest of journey 011's creator workflow stay deferred.

The return must answer the three reasons the connection was cut: no operator registers an OAuth app of their own, the connection runs against real GitHub before it counts as delivered, and a data-key rotation moves the stored token with everything else. The connection only reads, and public installs never depend on it.

**Owner decisions, 2026-11-25.** The owner settled the choices [journey 015](https://github.com/your-space-ai/your-space/blob/main/specs/015-private-sources/spec.md) listed:

- **A fine-grained token the owner pastes.** It has Contents read only, on the repositories the owner chooses. Nobody registers an app. A GitHub App the project publishes, and an OAuth app, were considered: the first would be a public app in the project's name, installed on each account, and no OAuth scope reads private code without write access.
- **An optional second token for private images.** GHCR takes only classic tokens, and fine-grained ones can't reach packages, so the connection can also hold a classic token with only `read:packages`. It is used for nothing but signing the engine in to `ghcr.io` for a pull. It is a slot of its own, so it becomes a token swap if fine-grained tokens gain packages. Its limits are stated where it is added: it reads every package the account can see, organizations can block classic tokens, and an organization with SAML single sign-on must authorize it. Other registries stay public-only. This changes the recommendation to leave private images out.
- **Stored under the data key.** Both tokens are encrypted under the data key and moved when it rotates, with a test; that gap is what broke the removed connection. A token no key can read shows Reconnect.
- **Disconnect forgets the tokens here.** The owner deletes them at GitHub, as the screen tells them. Installed apps keep running. A token GitHub refuses shows Reconnect, and a private install fails with a clear message.
- **One connection, managed from either place.** The web client and the server commands use the same connection, and a `github` server command has the same actions as the dashboard's GitHub page: connect, status, add or replace the image token, and disconnect. The owner: "shouldn't matter where i set it up, i should be able to manage from cli as well ui is like a cli wrapper on behalf of the user". Tokens come from a hidden prompt or standard input, never from the command line.
- **The review labels private sources.** It shows a Private label, naming the account, on each file read through the connection, a line when the kit pins a Compose file from another private repository, and a Private image label on each image pulled with the image token. There is no prompt before reading; nothing installs until the owner confirms. The owner: "if i added my credentials, and i pasted in a private repo link, it should be fine."
- **Ships in alpha.2.**

### Agent writes

**Owner request, 2026-11-26.** Agent writes come back: an agent should do real work in an app through Your Space, never holding the app's own credential. The first case is onboarding records into a CRM: creating companies, opportunities and records of a custom object, linking them, and updating them later. Accepted as direction in [journey 017](https://github.com/your-space-ai/your-space/blob/main/specs/017-agent-writes/spec.md), which must run against a real app before it counts as delivered, since writes were cut on 2026-11-23 for having run only against a fixture. Until it ships, the [Alpha scope](#alpha-scope) cut stands: agents only read.

**Owner decisions, 2026-11-26.** The rule for agent writes: "agent just has access to the api route at a verb, we are not adding more machinery past that without a reaason." A role grants an agent a route at an HTTP method, with approvals, and the gateway sends the request with the route's app credential and returns the app's response. Under it:

- **Setup roles.** Schema and setup operations are in, through roles of their own: "should be separate roles that give separate access. could also have a role that give permission over the setup itself and control thingsl ike the data model." A kit names its app credentials, each route names the one it is sent with, and a role's routes all use one, so a setup role uses an admin credential that a record role never carries. The owner binds each credential separately. This extends the single credential binding per installation in [kit-defined roles](#kit-defined-roles-server-held-credentials-and-approvals).
- **Deletes.** In, in roles of their own: "there are some reasonable deletions". Whether one asks first is set like any route's: "this should be defined in the role permissions, it shouldn't always require an approval tho".
- **Bodies.** A kit doesn't describe a body: "lets not get granular like this, the role allows an agent access to a specific route + http verb, nothing more granular." The body passes through for the app to validate, as JSON of at most 32 KiB. A body can create linked records through a route granted for one object, as Twenty's nested `create` does; the app credential's own role limits what it can do. Query fields stay declared, as for reads, so an option such as Twenty's `upsert` passes only through a route that declares it.
- **No retry machinery.** "what no please none of this machinery, no made up operation ids." Your Space keeps no operation IDs and doesn't match repeats; retries, duplicates and stale edits are the agent's and the app's, as for any API client. This supersedes the operation-ID replay, expected revisions and receipts of [journey 005](https://github.com/your-space-ai/your-space/blob/main/specs/005-owner-agent/spec.md)'s FR-07, and the 2026-11-23 reason that an app must honor `Idempotency-Key` and `If-Match`. Keeping a copy of what a write sent was dropped by the same rule.
- **Approval default.** A write route that neither the kit nor the owner set asks first; a read nobody set defaults to Allow: "default to ask."
- **The first real kit.** The Twenty kit with write routes lives in a private kits repository in the project's GitHub organization: "twenty kit, put it in a private kit repo on the your space ai org". It installs through the GitHub connection, whose fine-grained token must be owned by that organization.

**Owner decisions, 2026-11-27.** After the first live run, 017's per-route model is too granular to start with, so access starts broad and gains granularity only when it's needed. Access is per app: "access is per app, and we can define the api key used by that agent for that app in the config, and your space applies the actual api key, agent never sees the api key." A kit says where the app's API lives and how its key is sent, and lists no roles or routes; a grant gives an agent the app's API with the bound app key the owner picks for it, and that key's role in the app is the limit. Nothing asks first by default: "start with a blank list by default, allow all routes and api key determines access. and if usr wants they can define specific route that triggers approval request." A kit change keeps app keys and grants, since a grant is to the app. The agent's own key, Your Space attaching the app's key, the response check, revocation and Activity stay. This supersedes, from journey 017, kit roles and routes, per-route Ask and Allow, a write's default Ask, and the retirement of agent access on a kit, source or commit change in [Alpha scope](#alpha-scope); the details are open in [journey 018](https://github.com/your-space-ai/your-space/blob/main/specs/018-app-access/spec.md). The owner settled the first the same day: a route that asks is a method and a path, with `*` for one path segment, such as `DELETE /rest/people/*` ("thats fine"). Each agent keeps its own list, per app, beside the app key it uses ("per agent per app is ok"). 017's grants carry over working, with their keys and their routes that asked, and reach the whole API on that key; told that a read-only grant on a key that can also write would gain those writes, the owner said "thats fine". Removing an app, even keeping its data, ends its grants and app keys ("removing an app should remove the agent access yeah"). Kits that list roles and routes are refused, and Your Space infers nothing from them ("we'll rewrite them, they shouldn't work any more"). An installed app whose stored kit is in that format keeps it, with its agent access unavailable until it runs a rewritten kit, and its keys and grants kept ("Leave them broken"). Replacing a bound key keeps the grants that use it, on the new key ("Grants stay").

### Kit-defined roles, server-held credentials and approvals

**Owner decision, 2026-11-21.** Extend installation kits to define app roles as sets of allowed HTTP method/route pairs. An agent may hold any number of roles per installation. The delegable subset is drawn from kit roles the owner enables in Your Space for that installation. The bound credential’s native app scope is an independent ceiling. Your Space checks the union of current grants and injects the bound app credential server-side. The agent uses only its Your Space key. Owners choose when to approve requests, with route-level controls, an all-writes setting and recommended defaults from vetted community kits (superseded 2026-11-23: agents only read, so the all-writes setting is gone, and no community review vets a kit; see [Alpha scope](#alpha-scope)). This settles the gateway’s route-level responsibility left open below. Native app authorization still applies. [Journey 005](https://github.com/your-space-ai/your-space/blob/main/specs/005-owner-agent/spec.md) specifies the exact-request approval flow. The owner confirmed that Ask for all writes overrides any per-route Allow.

**Creator workflow (2026-11-21).** The first release includes host-authorized agent setup, portable app scaffolding and a selectable Home with owner-chosen app read roles. GitHub is the first source provider for managed public and private repos, agent forks and edits, and the kit directory. The server retains the GitHub credential. A workspace agent can edit only explicitly delegated sources or its own authorized creations. Only the owner confirms a replacement of a running installation at a specific commit with compatible storage. This brings the kit directory, private installs and compatible manual replacement ahead of the broader publishing, SDK and lifecycle work. [Journey 011](https://github.com/your-space-ai/your-space/blob/main/specs/011-agent-workspace/spec.md) (Superseded in part 2026-11-23: portable app scaffolding, the selectable Home, managed public and private repos, agent forks and edits, the GitHub credential and owner-confirmed replacement are deferred until after the alpha; host-authorized agent setup stays, and GitHub stays the public source for kit links. See [Creator workflow deferred](#creator-workflow-deferred). The kit directory left with the [alpha scope](#alpha-scope).)

**Decision update (2026-11-24):** At the owner's decision, an agent's read passes the app's JSON response through unchanged, and kits no longer declare `outputFields`. The field listed the top-level scalar fields the gateway returned from a record or a list of records. Real REST APIs don't fit it: Twenty, for example, wraps a list as `{data: {companies: [...]}, pageInfo, totalCount}` and nests fields such as `name.firstName`, so the gateway returned empty rows or refused the response. The gateway keeps its safety checks: the response must be JSON of at most 256 KiB, and one that contains the app credential, raw or JSON-escaped, anywhere in it is refused with a generic outcome and nothing saved. A kit that declares `outputFields` is refused with a message saying the response is passed through; a kit stored before keeps it on record, and the gateway ignores it. What a granted route returns is now limited by the app credential's own scope, not by the kit. This supersedes the "allowed output" of each route in [journey 005](https://github.com/your-space-ai/your-space/blob/main/specs/005-owner-agent/spec.md) and its [kit contract](https://github.com/your-space-ai/your-space/blob/main/specs/005-owner-agent/contracts/kit-agent-access.md#supported-declarations).

## Purpose and Scope

This is the canonical project-wide record of accepted architecture and product direction, including decisions for future work.
It remains relevant across feature specifications and must not be archived or replaced when an individual feature is completed.
The constitution establishes governing principles; this record captures shared decisions and open choices; individual specifications define delivery scope and acceptance criteria.
Open proposals remain candidates, even when they have been discussed in detail.
The [architecture overview](overview.md) diagrams the resulting system layer by layer.

The first feature establishes manual Docker Compose installation, owner setup, authentication, an empty workspace, persistence, and recovery.
It does not install independent apps or implement app roles, agents, a marketplace, or an agent execution runtime.
Later specifications must turn those directions into concrete contracts and acceptance criteria.
Recording an accepted future direction here does not add it to the first feature or claim that it has been implemented.

## How to Use and Maintain This Record

- Consult this record and the constitution before creating or changing specifications, technical plans, or public integration contracts.
- Keep cross-feature decisions here and link to them from feature documents rather than creating competing copies of project direction.
- Update this record in the relevant pull request when a shared decision is agreed or changed. Keep accepted decisions, open proposals, and superseded decisions distinguishable.
- When replacing an accepted decision, record the date, rationale, and what it supersedes; retain its rationale or link to the change that preserves that history.
- Reflect changes to agreed direction and sequencing in the [roadmap](../roadmap.md) in the same PR. The roadmap is a derived delivery view, not a competing source of decisions or acceptance criteria.
- Resolve conflicts with the constitution explicitly through its governance process. A feature plan must not silently override shared decisions.

The repository README and agent guidance link here so future planning can find this record without knowing which feature originally prompted a decision.

## Accepted Foundation Decisions

### Installation and Hosting

**Current scope (2026-11-21).** The headless install uses existing Docker on a personal machine or server. The macOS desktop can set up a local workspace on an owner-selected engine or connect to an existing server without local Docker. A bundled engine follows publication. Earlier release dates and requirements below are superseded where they differ from the [personal dashboard decision](#personal-dashboard-release-boundary).

- Begin with a documented, manual Docker Compose installation. The owner is created with a server command and sets their password in the browser.
- Initially support macOS and Linux server hosts. Users on other operating systems can access a supported server through the web client.
- The desktop app can also run a local workspace on the same machine on macOS, Windows, and Linux, through the Your Space CLI. The CLI therefore runs on all three.
- On Windows, people can use the desktop app and run a local workspace through Docker Desktop. Windows is not a supported server host. (Docker Desktop superseded 2026-11-14: Your Space needs a Docker-compatible engine and provides one itself; see below.)
- Begin with a web client in the owner-access feature. Web, desktop, and PWA clients are part of the first public-release target; the desktop app uses Electron.
- Keep client and server as independent components that can run on the same machine or different machines.
- Store authoritative account and workspace state on the server, rather than relying on a particular browser.
- Use persistent storage so supported restarts retain identity, ownership, and workspace state.
- Document prerequisites, setup, storage, restart, remote client access, and owner recovery.
- Keep Kubernetes and kind outside the initial installation requirements.
- Your Space publishes its images for both ARM (including Apple Silicon) and Intel/AMD machines.
- Remote access uses HTTPS. The Compose stack includes a reverse proxy that obtains and renews a certificate automatically when the owner provides a domain during installation; this needs the domain and inbound ports 80 and 443.
- Owners who already run their own reverse proxy or tunnel can turn off the built-in proxy and terminate HTTPS themselves.
- Owners without a domain get documented guidance for a private tunnel such as Tailscale. Plain HTTP is supported only on the same machine (localhost), because browsers require HTTPS for PWA installation and secure session cookies. (Since 2026-11-14 this machine's address is `space.localhost`; see below.)

Docker Compose provides a concrete first installation target without requiring Kubernetes administration.
This choice does not commit every future deployment to Compose or promise identical deployment configuration everywhere.
Exact supported OS versions, prerequisites, networking, and proxy configuration require an implementation plan.

**Decision update (2026-11-01):** Windows is supported for the desktop app and for a local workspace run through Docker Desktop, but not as a server host. Server hosts remain macOS and Linux.

**Decision update (2026-11-02):** HTTPS for remote access is built in rather than left to the owner: a reverse proxy in the Compose stack provides automatic certificates for a domain, with a bring-your-own-proxy option and documented tunnel guidance for owners without a domain. The proxy implementation (for example, Caddy) is chosen in the CLI specification.

**Decision update (2026-11-03):** The built-in proxy moves from the CLI specification into the
owner-access feature (spec 001), and Caddy is selected. Caddy obtains and renews certificates
natively, so HTTPS needs configuration rather than custom code ([constitution principle VII](https://github.com/your-space-ai/your-space/blob/main/.specify/memory/constitution.md#vii-reuse-before-building-with-few-trusted-dependencies)).
Shipping it with the first Compose stack means remote access is HTTPS from the first install instead
of relying only on the owner's own proxy or tunnel. Spec 002 adds app routing to the same proxy,
and the CLI asks for the domain during installation. This supersedes the 2026-11-02 note that the
proxy is chosen in the CLI specification.

**Decision update (2026-11-08):** In the manual Compose install, the settings line the owner
writes picks the setup, and the setup decides which ports open. With no line, Your Space runs on
this machine only, at `http://localhost`, published on `127.0.0.1`. `YS_DOMAIN=<name>` publishes
ports 80 and 443 to the network and turns on automatic HTTPS. `YS_PROXY_URL=https://<address>`
publishes plain HTTP on `127.0.0.1:8080` for the owner's own proxy or Tailscale, and offers a
Docker network for proxies that run in containers. With `YS_PROXY_URL` the built-in proxy is not
removed: it still serves the web client and forwards `/api` behind the owner's proxy, which
terminates HTTPS, so only Caddy's certificate handling is off. This refines the bullet above about
turning off the built-in proxy. `YS_PORT` moves the local port when another program has it. Compose
selects one file per setup by which key is set, so every port address is written out in a file
rather than computed or left to Docker's defaults, and the server refuses a wrong value or a
misspelled setting before any port opens. The alternative most projects use, one address setting
with ports open on every interface, was rejected because a fresh local install on a Linux server
would put its sign-in page on the network. The research and the designs
considered are summarized in [research R9](https://github.com/your-space-ai/your-space/blob/main/specs/001-workspace-owner-access/research.md#r9-https-and-the-caddy-configuration).
The CLI (spec 003) writes the same lines.

**Decision update (2026-11-08):** Your Space generates its own platform secrets. A secret the owner
sets in `.env` is used as given and never copied, so owners can supply secrets from their own
store. Otherwise each secret is generated once, as random bytes, into a dedicated `ys-secrets`
volume kept apart from the database, and never regenerated on its own: if the database exists but
a secret is missing, start-up stops with recovery steps. The owner can replace a generated secret
on request with the secrets step's `--new` option. No sample or default secret ever runs. A
dedicated secret manager was rejected for now, because on one machine its unseal key sits on the
same disk and it adds a container and bootstrap secrets of its own; OpenBao (MPL-2.0) is the
upgrade path.
The research and alternatives are summarized in
[research R16](https://github.com/your-space-ai/your-space/blob/main/specs/001-workspace-owner-access/research.md#r16-platform-secrets).

**Decision update (2026-11-14):** Your Space needs a Docker-compatible engine, not Docker Desktop.
On Linux servers the host's Docker Engine is the default. On macOS, and later Windows, Your Space
provides its own virtual machine with Docker Engine by default, and an engine the owner already runs
is an advanced option. How Your Space provides the engine is settled in journey 003 or 008 (settled on 2026-11-17: journey 008, with the desktop app). Docker
Engine and Compose are open source (Apache-2.0); Docker Desktop is a separately licensed app, free
only for personal use, education, non-commercial open source and small businesses, and open-source
tools such as Colima and Lima run the same engine in a VM on macOS. This supersedes the statements
that the local audience installs Docker Desktop and that a Windows local workspace runs through
Docker Desktop. See the
[002 research](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/research.md#docker-desktop-is-not-a-dependency).

**Decision update (2026-11-14):** On this machine Your Space's address is `http://space.localhost`,
and `http://localhost` redirects to it. This supersedes `http://localhost` in the 2026-11-08 update
above. Apps are at `<app>.<Your Space's address>` (see [UI integration](#ui-integration)), and
browsers treat `localhost` and `notes.localhost` as different sites, so an app in a pane under bare
`localhost` can't keep its own session. `space.localhost` and `notes.space.localhost` are one site in
Chromium and Firefox, and every `*.localhost` name reaches the machine itself with no setup
(RFC 6761). Plain HTTP is still supported only on this machine. See
[research R2](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/research.md#r2-apps-in-panes-framing-cookies-and-app-addresses).

### CLI Delivery Sequence

**Current scope (2026-11-21).** The install and operator commands in 003 serve the personal release. Guided updates, backup, restore and uninstall move to 006 (2026-11-23: upgrading an installation moved back to 003; see [Your Space updates, backup, and restore](#your-space-updates-backup-and-restore)). The first 008 macOS download must be able to drive the supported CLI on the Mac. Since 2026-11-22 each release offers the CLI as the npm package `@your-space-ai/cli`, published by the `your-space-ai` npm organization so the name stays with the project rather than a personal account (the command it installs is still `your-space`), and as standalone Linux executables for ARM and Intel; on macOS the CLI comes from npm or inside the signed desktop app. The unscoped npm names `your-space` and `your-space-ai` are for two packages whose commands run nothing and only point to the organization and the pinned `npx @your-space-ai/cli@<version>` install, so nobody else can put code behind `npx your-space` or `npx your-space-ai`. Both were published on 2026-11-23 at version 0.0.1 and only need republishing if that message changes. An unscoped name can't belong to the organization's scope, so a maintainer publishes them by hand from their own npm account (see the [release guide](../maintainers/releasing.md#the-unscoped-your-space-and-your-space-ai-packages)). `.deb` and `.rpm` packages, standalone macOS downloads and Homebrew are not part of a release, which keeps the set of files to build, sign and support small; they can be added later without changing existing download names. Earlier release dates and requirements below are superseded where they differ from the [personal dashboard decision](#personal-dashboard-release-boundary).

**Decision update (2026-10-29)**: Establish and verify the Compose deployment with the owner-access feature first.
A separate specification and implementation PR will add a Your Space CLI for installation and management of that deployment (sequence updated 2026-11-02 below: the app UI and sign-in specification comes first, and is now part of journey 002; the CLI is journey 003, and since 2026-11-08 it is delivered, like every journey, as a stack of pull requests; see [journey-based specifications](#journey-based-specifications)).
This replaces the earlier proposed CLI-first ordering: the CLI needs a working deployment to manage.

- The first feature must be installable and operable through documented manual Compose procedures without a standalone Your Space CLI.
- Owner creation and owner recovery remain part of the first feature, with documented operator commands available through the deployment.
- The CLI drives Docker Compose on the user's behalf for both local and server installations, so installation and management are a managed experience rather than users running Compose themselves.
- The desktop app's local mode drives the CLI for the user. People can also run the CLI themselves to set up a local workspace.
- There is one installation and setup behavior. The CLI behaves the same for local and server installations, and wrappers such as the desktop app simplify the experience without changing the CLI or setup behavior.
- The manual Compose procedures stay documented as an advanced alternative; the CLI is the supported way to install.
- Before publication the CLI provides at least these operations: install, start, stop, status, logs, update Your Space, owner password recovery, backup, restore, and uninstall.
- Uninstall removes Your Space and every app container it manages, not only the main Compose stack. It keeps data by default; deleting data requires explicit confirmation and offers a backup first. The desktop app uses the same command for local workspaces.
- Updating Your Space through the CLI rolls back automatically if the update fails; see [Your Space updates, backup, and restore](#your-space-updates-backup-and-restore).
- The CLI also gives agents their first-release way to use apps: agent commands call app actions through Your Space with the agent's own credential. See [Agent access through Your Space](#agent-access-through-your-space).
- CLI command names, packaging, prerequisite automation, and the rest of its management scope belong in its separate specification.

Guided installation remains the product direction. The initial guide and browser setup establish the working pathway that the CLI will automate. (Browser setup was replaced by the owner command 2026-11-03; see [authentication and initial claim](#authentication-and-initial-claim).)

**Decision update (2026-10-31):** The CLI is the managed installation and management path for both local and server installations, driving Docker Compose for the user. The desktop app's local mode drives the CLI rather than managing Docker itself, and people can run the CLI themselves for a local install. This supersedes the 2026-10-31 position that the CLI is only the server deployment path.

**Decision update (2026-11-01):** The owner-access feature (spec 001) and its manual Compose procedure come first, then the CLI. The minimum CLI operations before publication are install, start, stop, status, logs, update Your Space, and owner password recovery. Backup and restore are not part of the first release (superseded 2026-11-02: backup, restore, and uninstall are required before publication); see [Your Space updates, backup, and restore](#your-space-updates-backup-and-restore).

**Decision update (2026-11-02):** The app UI and sign-in specification (now part of journey 002 "install an app and use it"; see [journey-based specifications](#journey-based-specifications)) comes between the owner-access feature (spec 001) and the CLI specification. It decides app origins and routing, which set the DNS, certificates, and proxy configuration the CLI installs, and clients, apps, SDKs, and agent access all build on it. Settling it before the CLI avoids reworking the CLI's HTTPS setup. The resulting order is spec 001, then the app UI and sign-in specification, then the CLI specification, then the remaining pre-public items.

**Decision update (2026-11-02):** The CLI provides an uninstall command before publication instead of documented manual removal. Apps run in containers Your Space starts outside the main Compose file, so `docker compose down` alone would leave app containers and data behind; only Your Space knows what it started.

**Decision update (2026-11-17):** Journey 003 specifies the CLI
([spec 003](https://github.com/your-space-ai/your-space/blob/main/specs/003-install-with-the-cli/spec.md)). At the owner's request it follows the
Supabase CLI's shape: the `your-space` command comes from package managers (an npm package, `.deb`
and `.rpm` packages built with the distributions' own tools, and standalone executables built with
Node's own single-executable feature), works on the installation in the current folder, and
installs with `init` then `start`, which prints a summary of what is running. It writes the same
release files and `.env` lines as the manual install and runs the same Compose and server commands,
so a space can be managed either way, and it keeps no state of its own. It is written in TypeScript
with Commander and Clack. The name is `your-space` with no short alias, since `ys` is YAMLScript's
command. This replaces "install" in the minimum operations above with `init` and `start`.

**Decision update (2026-11-17):** People sign in only through the client (web, then desktop). The
CLI runs the installation on its own machine, through the engine and the server's operator commands,
never the HTTP API, with the authority of access to that machine, as `create-owner` and `reset-link`
already have. Agents (journey 005) will use the CLI with a credential a person issued in the client;
identity never comes from the CLI, which stores no credential and has no sign-in. How a credential
reaches an agent is left to journey 005, which must keep it manageable for people who aren't
technical. The desktop app drives the CLI only for a space on the same computer; managing one on
another machine is possible later but not planned. This replaces "remote CLI authentication" for
backup and restore: journey 006 chooses between the client and an issued credential.

**Decision update (2026-11-17):** Your Space contains no code for a particular proxy or tunnel. It
knows its own address and, behind a proxy or tunnel, the names to forward, which `your-space status`
lists. Tailscale's names can't hold a name under a machine's name, so apps can't get their
`<app>.<Your Space's address>` names over Tailscale; that stays unsupported until the release gate's
hosting review settles a way. (Superseded for apps 2026-11-19: an app is published on a port of
this machine and reached at the owner's link; see
[running apps and reaching them](#running-apps-and-reaching-them).)

**Decision update (2026-11-17):** Functionality is built and tested on Linux first, in every
journey. Packaging and checks for macOS and Windows (macOS executables, a Homebrew formula with its
`your-space-ai/homebrew-tap` repository, checks on a real Mac, and Windows) are gathered into one
pass before release, after the journeys, so they aren't repeated after each one.

**Decision update (2026-11-17):** Your Space encrypts the secrets it stores, today installed apps'
settings, with a data key of its own: a third platform secret generated into `ys-secrets`, or set in
`.env` as `YS_DATA_KEY` ([spec 009](https://github.com/your-space-ai/your-space/blob/main/specs/009-encrypt-stored-data/spec.md)). It replaces the key
derived from the auth secret, which tied the two together, and existing installations move onto it
when the server starts. (2026-11-23: no release wrote values with the old key, so the server no
longer reads them; see [Alpha scope](#alpha-scope).) Standard PostgreSQL doesn't encrypt what it stores, and the only
whole-database option, Percona's `pg_tde`, needs Percona's own PostgreSQL build rather than the
official image, so encrypting the whole database or its disk stays the owner's responsibility for
now, with the guide recommending disk encryption on the host. Session tokens stay as Better Auth keeps
them: encrypting them would break sign-in, and the cookie signature already protects them.

### Server and Database

- Use Node.js and Express for the platform server.
- Use PostgreSQL as the initially supported platform database.
- Use Drizzle for database access and schema tooling.
- Do not require a second platform database implementation for local installations.

Express is the accepted server framework; future capacity decisions should use measured workloads.
PostgreSQL provides one persistence foundation across local and hosted server deployments.
This choice does not require every independently developed app to use PostgreSQL.
Exact runtime and database versions, migration execution and recovery strategy, and connection configuration remain open.

**Decision update (2026-11-03):** The [001 technical plan](https://github.com/your-space-ai/your-space/blob/main/specs/001-workspace-owner-access/plan.md) selects Node.js 26 LTS and PostgreSQL 18, with Drizzle and `pg`, and applies Drizzle Kit migrations at server startup. Recovery from a failed migration belongs with update rollback in spec 006.

**Decision update (2026-11-23):** The server refuses to start when the database records a migration later than the newest it has, logging `db.migrate.newer_schema` and exiting with status 2. Drizzle would otherwise skip every migration and run an older build on a schema it doesn't know, for example when an upgrade's previous files are put back without its database. `your-space start` explains the refusal.

### Web Client

- Use React, TypeScript, and Vite for the initial web client.
- Router, query/state tooling, styling, and component library remain implementation planning choices.

**Decision update (2026-11-03):** The [001 technical plan](https://github.com/your-space-ai/your-space/blob/main/specs/001-workspace-owner-access/plan.md) selects TanStack Router and TanStack Query, with Better Auth's React client for session calls, plain CSS, native form validation, and no component library. Caddy serves the built web client as static files and forwards `/api` to the Express server, so the client and API share one origin. A server-rendered frontend was considered and deferred until a spec needs public, logged-out pages.

### Owner and Workspace Model

**Current scope (2026-11-21).** The personal release has one owner. Invitations, additional human members and their roles follow in 004. Earlier release dates and requirements below are superseded where they differ from the [personal dashboard decision](#personal-dashboard-release-boundary).

- Support one human owner and one workspace in the first feature.
- Keep account identity, workspace identity, membership, and ownership as distinct concepts.
- Establish those relationships explicitly so later membership support does not require replacing existing identities.
- Do not expose invitations, additional human accounts, role administration, or ownership transfer in this feature.

Owner-only scope limits the first user journey; it is not a permanent single-user constraint on the product.
These concepts do not prescribe a specific database schema.

### Authentication and Initial Claim

- Your Space defines and operates one server-managed authentication system across deployment modes.
- Use Better Auth as the authentication library within that system.
- Authentication must not depend on an external identity provider.
- Initial account creation collects a name and a username, and optionally an email address; the owner then sets a password.
- The username is the login identifier. An email address never signs in, and is not treated as verified without mailbox verification.
- Initial self-hosted setup does not require SMTP or another email-delivery service.
- A server command run by the operator creates the owner account and workspace and prints a short-lived, single-use set-password link. Access to the server is the authority to create the owner.
- Network access alone can never create an account or the owner: before an owner exists there is no setup page, and sign-up is always off.
- After setup, sign-up stays closed: new people join only when the owner invites them. Open sign-up
  may be offered later as an optional feature.
- Concurrent runs or reruns of the owner command must not create duplicate owners or replace an existing owner.

Server access proves installation authority. It does not prove control of a supplied email address.
Every installation uses the same owner command. In desktop local mode, the desktop app asks for the name, username, and password, runs the command through the CLI, and sets the password through the printed link on the user's behalf; the flow itself does not change.

**Decision update (2026-11-03):** The owner is created by a server command that prints a set-password link, replacing the setup code and browser claim form. Bots watch public certificate logs and complete the setup pages of new sites within minutes, so a fresh install must not be claimable over the network. A server command closes that hole with the fewest parts: no setup code, no claim endpoint, and no setup page. The set-password link reuses Better Auth's password-reset flow, so no temporary password exists. Better Auth has no "change password on first sign-in" feature, so a temporary password would need custom code. Sign-up stays off on the running server; the command creates the owner from its own process. This supersedes the earlier setup-code decisions: browser-guided owner setup, in which a temporary, single-use setup code from the operator-only installation procedure established the authority to claim an installation and successful setup then closed initial registration; initial account creation that also collected the password; and, in desktop local mode, the desktop app obtaining the setup code through the CLI and submitting it for the user. Server access now proves installation authority, as the setup code did; neither proves control of the email address.
The same account model serves local and remote installations; deployment configuration may govern email delivery and verification policy.
Separate local-only and hosted authentication implementations are not part of the direction.

**Decision update (2026-11-03):** The [001 technical plan](https://github.com/your-space-ai/your-space/blob/main/specs/001-workspace-owner-access/plan.md) uses Better Auth's organization plugin for the workspace, membership, and owner role, and settles password rules, session and link lifetimes, and sign-in limits in its [settled values](https://github.com/your-space-ai/your-space/blob/main/specs/001-workspace-owner-access/plan.md#settled-values).

**Decision update (2026-11-11):** The owner signs in with a username instead of an email address, superseding email as the login identifier. An email address is optional at owner creation and only for verification and recovery links once owner-configured email delivery exists (still post-open-source); it never signs in. (Superseded 2026-11-23: the owner gives no email at all until email delivery exists; see [Alpha scope](#alpha-scope).) Most self-hosted installations have no email delivery, so an address the owner can't verify adds a field without a use, and a username is shorter to type on every device. Better Auth's username plugin provides the sign-in; email sign-in and the username-availability check are turned off, so the network can't use either to probe for accounts. Better Auth's user table requires an email, so an owner who gives none holds a reserved `@users.invalid` address (RFC 2606), which can't receive mail and is never shown. Usernames are 3 to 30 letters, digits, `_` or `.` (each `.` between other characters), compared without case. Whether invited members (spec 004) sign in the same way is settled in the members specification.

### Sessions, Persistence, and Recovery

- The owner can sign in, reach the empty workspace, and sign out.
- Protected server operations enforce authentication independently of what the UI displays.
- Expired or invalidated sessions cannot continue accessing protected resources.
- Restarts preserve account identity, workspace identity, and ownership.
- Storage unavailability must not make a claimed installation appear unclaimed.
- An operator recovery command on the server issues a short-lived, single-use password-reset link for the existing owner.
- Completing recovery changes the password, revokes old sessions, and requires normal sign-in.
- Recovery preserves existing identities and ownership; it does not reopen setup or create a replacement owner.

Future email delivery can send reset links to verified addresses through the same recovery mechanism.
A managed service can provide that delivery without introducing a second authentication system.
Token lifetimes, operator command mechanics, session storage, and revocation implementation remain technical planning choices.

Invited members recover their passwords without email in the first release:

- A member receives a recovery code at signup and can use it to reset their own password.
- As a fallback, the owner can reset a member's password and give them a temporary password. The member must replace it the next time they sign in.
- Like owner recovery, a member password reset preserves identity and revokes existing sessions.

**Decision update (2026-11-02):** Member recovery uses a recovery code issued at signup, with an owner-issued temporary password as the fallback. Requiring an email service, or requiring the owner for every reset, were both rejected for the first release. How many codes are issued, whether a used code is replaced, and temporary-password lifetime belong in the members specification.

**Decision update (2026-11-02):** Optional owner-configured email is post-open-source work. The owner can add their own email (SMTP) settings to enable verified email addresses and email password resets through the existing recovery mechanism. No installation requires email, so the first release still needs a recovery path that works without it.

### Your Space Updates, Backup, and Restore

**Current scope (2026-11-21).** Guided updates, rollback, backup, restore and migration move to 006. The personal release documents storage and the recovery paths it verifies. Earlier release dates and requirements below are superseded where they differ from the [personal dashboard decision](#personal-dashboard-release-boundary).

- Updating Your Space has the same safety net as app updates. Before an update, Your Space records its current versions and takes a snapshot of its data. If the update fails, it rolls back automatically to those versions and restores the snapshot.
- Releases are not expected to break on update; automatic rollback is protection, not a substitute for release testing.
- One pre-update snapshot mechanism serves both app updates and Your Space updates, and is built before publication.
- Backup and restore are built before publication, with a single implementation for every installation. The CLI asks a Your Space server to produce a backup, and the server returns it through its API, so the behavior is the same whether the server runs locally or remotely. Wrappers such as the desktop app use the same operation.
- Backup and restore build on the pre-update snapshot mechanism rather than a separate implementation.
- A backup contains everything in the workspace, including credentials and app data, so producing or restoring one requires owner authority.
- Moving a workspace between installations, such as from a local machine to a server, is a backup from one and a restore into the other rather than a separate feature.
- The data model and storage layout are designed from the start so that the whole workspace can be captured and restored consistently, keeping backup a small addition rather than a retrofit.

**Decision update (2026-11-01):** Failed Your Space updates roll back automatically, matching app updates. Backup and restore move to post-open-source work (superseded 2026-11-02 below) and have one server-produced, CLI-driven implementation for local and server installations, superseding the earlier local-only framing of deferred backup and migration.

**Decision update (2026-11-02):** Backup, restore, and moving a workspace between installations are required before publication, superseding their deferral. Without them, a lost disk or a bad change loses the workspace, including members' accounts and app data, and early users will put real data in the first release. A documented manual procedure, such as copying Docker volumes, was rejected in favor of the built-in implementation. Designing the data model and storage for consistent capture from the start keeps the work small.

**Decision update (2026-11-14):** Your Space does not move workspaces for people. It provides backup and restore, made easy for a person or their agent to script, and a person who wants to move a workspace, for example from a laptop to a server, backs up one installation and restores into another themselves. Your Space doesn't perform or verify moves, and whether the target setup suits the workspace (its processor type, or whether its apps run there) is the person's to judge. This supersedes moving a workspace as a feature required before publication; backup and restore stay required. Moves cross too many differences between setups for Your Space to handle well, and the backup and restore they rely on are needed anyway.

**Decision update (2026-11-23):** At the owner's request, `your-space upgrade` ([journey 003](https://github.com/your-space-ai/your-space/blob/main/specs/003-install-with-the-cli/spec.md)) upgrades an installation in place before 006, so owners stop reinstalling Your Space for each alpha release. It moves an installation to the CLI's own version and refuses a newer one. Before it replaces anything, it stops the server and Caddy and writes a `pg_dump` of Your Space's database into the installation folder (`backups/`, readable only by its owner); apps keep running. If the new version's server doesn't become ready, it puts the previous release files and `.env` back and, when the database is no longer the same as the backup (a second dump is compared with it, since a new version may change data as it starts, not only its schema), restores the backup before starting the previous version. Restoring automatically discards none of the owner's changes: the server was stopped before the backup, and Caddy, the only way in, starts only after the new server is ready, at which point the upgrade counts as done and is never rolled back (a Caddy that then fails to start is reported, to fix and start again). The database the new version left is kept beside the restored one rather than deleted. Without the restore the previous version couldn't start, since the server refuses a database a newer version migrated (see [Server and Database](#server-and-database)). The rollback stops short, for the owner to finish by hand, when the new server can't be stopped or the database can't be checked or restored. Commands that start, stop, change or upgrade an installation hold one lock in its folder, `.your-space.lock`, so none runs while another does; and from the first file an upgrade moves until it knows the files and the database match, `.upgrade-restore` in the folder keeps `start` from running a previous release on a database a newer one may have migrated, until a person has restored the backup. SIGINT or SIGTERM before the new server starts stops an upgrade at its next step and puts the previous version back; once the new server is starting, the upgrade runs to its result. The backup holds the database only; the secrets, Caddy's certificates and apps' volumes stay where they are. It is a local stop-gap, not the snapshot mechanism above: the server-produced backup and restore, the one snapshot mechanism shared with app updates, and the open questions below stay with 006.

**Decision update (2026-11-24):** `upgrade` ships in 0.1.0-alpha.1. It moves an installation to the version of the CLI that runs it, not to the newest release, so updating takes two steps, as `kubeadm upgrade` does: get the new release's CLI, then run its `upgrade` in the installation's folder. `npx @your-space-ai/cli@latest upgrade` does both at once, and the [guide](../operate/index.md#update-your-space) leads with it. The installed version is the one `stack.yaml` pins Your Space's images to; no setting holds an installation at another version (see [Alpha scope](#alpha-scope)), so `upgrade` has nothing of the kind to refuse. Revisit if owners find the two steps confusing. (2026-11-25: `upgrade --channel` keeps this rule, since it runs the target build's own CLI; see the next entry.)

**Decision update (2026-11-25):** Release channels. The owner asked: "in the desktop app, should be a setting to choose which release channel to follow for updates, and yes you can add the flag in the cli." The owner settled the details the same day; [spec 016](https://github.com/your-space-ai/your-space/blob/main/specs/016-release-channels/spec.md) has each decision, what was considered and the requirements. All of it ships in alpha.2 ("all of it at once so i can install canary locally and start using that"). Built in PRs [#132](https://github.com/your-space-ai/your-space/pull/132), [#135](https://github.com/your-space-ai/your-space/pull/135) to [#138](https://github.com/your-space-ai/your-space/pull/138) and [#139](https://github.com/your-space-ai/your-space/pull/139); live checks pending. Each bullet says what has shipped, and the canary page, the release guide and the Mac app describe what runs today.

- Two channels for now: Alpha and Canary ("right now its just alpha (default and --channel alpha), and canary. in the future we'll have other names and can change the default."). The Mac app's channel is a setting stored in the installation and kept across updates, and it alone decides which builds the app is offered ("whatever the setting is in the users installation, if its set to canary, then stays on canary, user sets it basck to alpah, then alpha"). With none stored, the app stores its own build's channel at its first start: Alpha for a release, Canary for a canary build. The CLI takes `--channel alpha` or `--channel canary` on each run and stores nothing; plain `upgrade` keeps its 2026-11-24 meaning. (2026-11-26: the Mac app's setting built in [PR #139](https://github.com/your-space-ai/your-space/pull/139). **Your Space › Update Channel** has Alpha and Canary as radio items; choosing Canary first warns that canaries are unsupported, with Cancel the default, and choosing Alpha on a canary build says the app moves with the next alpha. The channel is stored in `updates.json` beside automatic checks, and the first start stores the build's own when none is, a canary being a version with a `canary` prerelease identifier. An `updates.json` that is there but can't be read, or names a channel the build doesn't know, doesn't count as none stored: the app leaves it as it is and follows Alpha, which offers no canary, until the owner's next choice in the menu replaces it, and if the file couldn't be read at all, it doesn't check by itself meanwhile.)
- Each channel has a feed at a fixed address on a rolling GitHub prerelease, edited in place, as Ghostty publishes its `tip` builds ("we'll just go with this for now to keep it simple"). A new `alpha` prerelease holds `latest-mac.yml`, which lists the release's update ZIPs by full link, and a small `channel.json` for the CLI; only Release publish writes them, once a published release passes its check. The `canary` prerelease still holds only the newest build, and gains `channel.json` and, from the daily Mac canary, `canary-mac.yml` and the Mac ZIPs. The Mac app reads its channel's feed with electron-updater's generic provider, the channel in the feed's options rather than the updater's `channel` property, which would allow downgrades; `upgrade --channel` reads `channel.json` with one request. Nothing looks up tags or lists releases. A required test proves that an Alpha client never gets a canary, whose version contains `-alpha.`: an Alpha app reads only the `alpha` feed, only Release publish writes to it, and no canary release carries `latest-mac.yml`. (2026-11-25: Canary's `channel.json` built in [PR #135](https://github.com/your-space-ai/your-space/pull/135); see the [canary decision](#journey-based-specifications).) (2026-11-25: the `alpha` feed built in [PR #136](https://github.com/your-space-ai/your-space/pull/136). Release publish's `alpha-feed` job runs `deploy/alpha-feed.sh` from the release's tag once the stranger check passes. It checks the release's `latest-mac.yml` against its `SHA256SUMS`, then uploads a copy that lists the update ZIPs by their full links, then `channel.json`, unless the feed already names this release or a newer one, or a run for a newer one began to move it, which the prerelease's notes record before either file changes. A test in `npm test`, which the Contribution checks run on every pull request that changes more than documentation, confirms that only it writes to the `alpha` release and that nothing a canary workflow runs uploads `latest-mac.yml`. It first runs when alpha.2 is published.) (2026-11-26: the Mac app's side built in [PR #139](https://github.com/your-space-ai/your-space/pull/139). Every check first points electron-updater at the stored channel's feed with the generic provider, the channel in the feed's options, and never sets the updater's `channel`; the packaged `app-update.yml` names the `alpha` feed as the default, so nothing reads the releases Atom feed. Changing the channel drops a check in progress, an update found and a download, which is cancelled; a check started after the change first waits out the library's call from before it, which electron-updater would otherwise hand back. The app also refuses a feed that names another channel's build, or a version that isn't plain SemVer, such as one with a leading `v`, which electron-updater would still read. Tests in `npm test` run the pinned electron-updater, its MacUpdater included, against the recorded feeds. A real switch, and an update downloaded from the channel left that isn't installed at quit, are checked on a Mac with two signed canaries.)
- An installation follows one channel and gets only that channel's builds. Leaving Canary is choosing Alpha: the installation moves at the first alpha newer than its canary build. Going back to an older build isn't handled for now ("i dont think we should handle this at this time"): the manual restore on the [canary page](../install/canary.md#go-back-to-releases) still returns an installation to a release, and `upgrade` keeps every backup. A prerelease kept for every canary build, and restoring an installation to a build it left, are the later direction.
- The alpha.1 app keeps the GitHub provider, which reads the newest 10 entries of the releases feed, tags without a published release included, and skips the two rolling ones, so it keeps finding the newest release. Since the feed also lists tags with no published release, the alpha.1 app's check most likely fails while a release is still a draft, until it is published.
- Mac canaries are built once a day and on demand from the newest Linux canary, signing and notarizing only the update ZIPs. They are signed with a second Developer ID certificate and its own App Store Connect API key, in a `macos-canary` environment with no approval step; the Account Holder creates both, and the owner installs the first Mac canary by hand. (2026-11-25: built in [PR #137](https://github.com/your-space-ai/your-space/pull/137), not yet run. The Mac canary workflow packages the build the `canary` prerelease's `channel.json` names, with its version, unless `canary-mac.yml` already lists it or a newer one. Its signing job alone uses `macos-canary`, runs no npm packages, and submits both architectures' apps before waiting for either. The build must be of the run's own commit, the `main` commit the run was started on, which every job checks out, so a run on main runs no other commit's code; while the run's own commit has no Linux canary on the `canary` prerelease, the run builds nothing rather than packaging another, a narrowing the owner accepted on 2026-11-26 ("thats fine"). Its publish job uploads the two update ZIPs, then `canary-mac.yml`, each checked once it is there, then deletes only the older Mac ZIPs, and never touches the Linux canary's files or uploads `latest-mac.yml`. It runs once the Mac app's Update Channel setting is on main and the owner adds the certificate and sets the `MACOS_CANARY_ENABLED` repository variable.)
- `upgrade --channel` downloads the target build's own CLI, checks it against that build's `SHA256SUMS` and runs its `upgrade`, so the 2026-11-24 rule holds. Any older installation upgrades with no code for each older version, because migrations are sequential and append-only and install files are replaced whole. A version whose change can't work that way declares the oldest version it upgrades from and refuses older installations, saying which version to upgrade to first, as GitLab's required upgrade stops do; one is added only when a change needs it. A pull request check refuses a change to a merged migration and a new one not stamped strictly after every earlier one. (2026-11-25: built in [PR #132](https://github.com/your-space-ai/your-space/pull/132) as **Migration order**, part of Contribution checks. It compares a pull request with `main` as it is when the check runs, not the base the event names, so a stacked or re-run pull request is checked against what it would merge into; one that doesn't change the migrations passes however far behind `main` it is. At merge, two pull requests that each add a migration both append to `meta/_journal.json` and add the same `meta/NNNN_snapshot.json`, so they conflict, GitHub won't squash the second until it is updated from `main`, and the update runs the check again against `main`.) (2026-11-25: `upgrade --channel alpha|canary` built in [PR #138](https://github.com/your-space-ai/your-space/pull/138). It reads the channel's `channel.json` with one request and refuses one that isn't in the channel's form, such as an Alpha feed naming a canary. It changes nothing when the installation already runs that build or a newer one, so leaving Canary waits for the next alpha. Otherwise it upgrades itself when the build is its own version, or downloads the build's CLI like itself, the Linux executable or the npm package, from that build's release into an owner-only temporary folder, checks it against that release's `SHA256SUMS` and that its `--version` is the version `channel.json` names, and runs its `upgrade`. The CLI inside the Mac app refuses the flag, since the app moves its own workspace. No version declares a minimum upgrade-from version yet; the [release guide](../maintainers/releasing.md#upgrades-from-older-versions) says how one would.)
- This supersedes, in the [canary decision](#journey-based-specifications) of the same day, "there is no channel setting or flag" and that the Mac app only ever offers releases; and in the 2026-11-23 [Mac updater decision](#first-public-release-audience-and-clients), that the app's own version decides which prereleases it is offered, through the GitHub provider. Unchanged, whatever the channel: the app's local workspace follows the app, and Canary keeps one rolling prerelease.

What counts as a failed Your Space update, snapshot contents and storage, how the CLI authenticates to a remote server, how a restore reaches a broken or fresh installation, and backup format and protection remain open.

### Reuse Before Building

Governed by [constitution principle VII](https://github.com/your-space-ai/your-space/blob/main/.specify/memory/constitution.md#vii-reuse-before-building-with-few-trusted-dependencies).

- Prefer established open-source libraries and tools over custom code. Before building something,
  check whether a selected library already provides it.
- Use selected libraries' native features as intended rather than wrapping or reimplementing them.
  Custom code fills only the gaps they leave.
- Use each library only for the purpose it was built for. Don't stretch an available feature into
  a general system for the app; pick a library made for that job.
- Keep dependencies few and trusted. Not every small need gets a dependency: add one only when it
  replaces substantial custom code, and prefer one library that covers several needs over several
  narrow ones. Keep integrations thin.
- Technical plans name the library feature each requirement relies on and justify each new
  dependency and any custom code.

**Decision update (2026-11-03):** Reuse before building is a project-wide principle, balanced
against keeping as few trusted dependencies as possible. Custom code must be maintained, secured,
and documented by the project, and mature libraries already solve most of it; every dependency also
adds supply-chain and upgrade cost. Dependencies still follow the licensing rule in
[deployment boundaries and licensing](#deployment-boundaries-and-licensing). Added to the
constitution as principle VII (version 1.1.0).

**Decision update (2026-11-03):** Reuse means using libraries for what they were built for. Better
Auth's rate limiter protects Better Auth's own routes, so it is not the app's rate limiter. The
owner-access feature adds no rate limiting of its own and keeps Better Auth's defaults on its own
routes. When a spec needs app-wide or per-account limits, it adds a dedicated rate-limiting library.
Clarified in constitution principle VII (version 1.1.1). Simplicity also governs: libraries and
custom code are added only when a requirement needs them.

### Concepts and Adapters

Governed by [constitution principle VIII](https://github.com/your-space-ai/your-space/blob/main/.specify/memory/constitution.md#viii-build-around-concepts-not-technologies).

- Your Space implements against concepts, such as an engine connection, an app endpoint or a secret
  store, that different technologies can sit behind. It never implements against one specific tool.
- Only an adapter knows its technology. Swapping a technology means adding an adapter, not changing
  Your Space.
- A technical plan names the concept and its first adapter.

**Decision update (2026-11-14):** Building around concepts is a project-wide principle, added to the
constitution as principle VIII (version 1.4.0). Running apps ties Your Space to a runtime for the
first time, and later runtimes are already in view: k3s or another orchestrator, an engine on
another machine, and apps someone already runs elsewhere. Written against the concepts, each of
those is a new adapter rather than a change through Your Space. Journey 002's concepts are the app
description, the runtime, the runtime connection, the app endpoint and the installation kit; its
first adapters are the Compose importer and the Docker adapter, which is the runtime manager. See
[concepts and adapters](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/spec.md#concepts-and-adapters) in spec 002.

## Accepted Product and Repository Direction

### Platform and Independent Apps

**Current scope (2026-11-21).** One app must support the owner’s agent in 005. Public SDKs and the general developer contract move to 007. Earlier release dates and requirements below are superseded where they differ from the [personal dashboard decision](#personal-dashboard-release-boundary).

- The platform is self-hostable first, with a managed offering planned later.
- Guided installation remains part of the product direction.
- This repository contains the platform server, web client, CLI, desktop app, SDKs, and public integration contracts.
- Installable apps, including first-party apps, live in separate repositories with their own builds and releases.
- Apps run independently and integrate through documented, versioned public contracts.
- Installing a compatible app does not require rebuilding the platform or including app source in its build.
- The SDKs are developed in this repository and published for use by independent app projects.
- First-party apps use the same public integration surface as other apps.
- The first public release publishes TypeScript and Python SDKs. SDKs for other languages are post-open-source work.
- An app can be managed or external. Your Space deploys and runs a managed app from its deployment file. An external app is hosted anywhere; the owner adds it to the workspace by pointing Your Space at the running instance. (2026-11-14: a managed app is installed from its own Compose file, and an external app is added through a connector; see below.) Both use the same public integration contract, so the contract must not assume Your Space runs the app.
- External apps are outside Your Space's container isolation, outbound network limits, resource limits, and backups; whoever hosts them is responsible for those. They still integrate through Your Space identity and the gateway, and accept only requests that carry identity verified by Your Space.

**Decision update (2026-10-31):** TypeScript and Python SDKs are required before publication. Together they cover two common stacks: a TypeScript frontend with a Python backend, and TypeScript on both frontend and backend. Developers using other languages can still integrate through the documented public contracts.

**Decision update (2026-11-02):** Apps can be external as well as managed. Your Space managing deployment makes self-hosting apps quick, while power users and larger deployments can host an app elsewhere and add it to the workspace by pointing Your Space at it. The integration surface between Your Space and apps is designed for both from the start.

**Decision update (2026-11-02):** Deferring the Python SDK to reduce first-release size was considered and rejected; both SDKs remain required.

**Decision update (2026-11-14):** Apps are not written for Your Space. An app keeps its own
interface, its own accounts and its own data; Your Space runs it, protects the platform and other
apps from it, and controls who can reach it. Deeper integration comes in levels that an app opts
into:

| Level | What the owner gets | What the app needs |
| --- | --- | --- |
| 0. Gate only | Only people signed in to Your Space reach the app; the app's own sign-in still appears | Nothing |
| 1. Your Space as an identity provider | Opening an app signs the person in as themselves | OpenID Connect support, set through the app's own settings by its installation kit |
| 2. Built for Your Space | Verified identity and app roles from Your Space, and agents through the gateway | The TypeScript or Python SDK |

Journey 002 delivers level 0. Level 1 matters most once there are members (journey 004); level 2
is for developers' own apps (journey 007) and for agents (journey 005). Where each lands is settled
with those journeys. Requiring integration before install would leave almost no existing app
installable, while level 0 lets any app with a published image and a Compose file run unchanged.
This refines the intended developer experience below: adapting an app is needed only for levels 1
and 2. The TypeScript SDK, app roles and verified identity for apps move out of journey 002; both
SDKs remain required before publication. See
[later: deeper integration](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/spec.md#later---deeper-integration).

**Decision update (2026-11-14):** An app someone already runs elsewhere is added through a connector
that runs next to it and connects out to Your Space, so the app needs no open port and its authors
change nothing. Your Space gives it routing, the access gate and panes through an app endpoint,
the same concept that reaches a container on Your Space's own engine, and doesn't manage or police
the rest of its setup. This replaces pointing Your Space at the running instance as the way an
external app is added. It is later work; journey 002 builds the app endpoint it plugs into. Whether
an external app must still accept only requests that carry identity verified by Your Space, as the
bullet above says, or whether the connector's gate is enough until the app opts into level 1 or 2,
is open.

The intended developer experience is to adapt an existing app for installation and platform identity integration.
An app should remain independently runnable rather than requiring a replacement frontend networking layer.
Existing app authorization should be reusable where it has a suitable integration boundary.

### First Public-Release Audience and Clients

**Current scope (2026-11-21).** Launch clients are the web dashboard and the downloadable macOS Electron app. The Mac build is signed with an Apple Developer ID and notarized. Local setup and remote connection use the same workspace dashboard and kit installation flow. The rest of desktop 008, including other operating systems, a bundled engine and the installable PWA, follows publication. (2026-11-23: the Mac app's self-update is no longer part of that rest; see the decision update on updating and quitting below.) Earlier release dates and requirements below are superseded where they differ from the [personal dashboard decision](#personal-dashboard-release-boundary).

- The first public release targets two groups: people who can install Docker Desktop and the Your Space desktop app to run a local workspace, and people who can install Docker and follow a guided CLI to deploy a server or a local workspace, both without one-on-one assistance. (Docker Desktop superseded 2026-11-14: the local group installs the desktop app, and Your Space provides the engine; see below.)
- The web, desktop, and PWA clients provide the same core workspace and installed-app experience while connected to a Your Space server; a local network connection is sufficient.
- The desktop app uses Electron and ships for macOS, Windows, and Linux.
- The desktop app is the intended primary way people use Your Space. The web client and PWA stay full clients with the same core experience, so the workspace also works in a browser and on phones.
- Desktop releases are signed before publication. macOS builds are signed with an Apple Developer ID and notarized, so people see the standard "downloaded from the Internet" prompt rather than a block, and the app can update itself. Windows builds are signed through the SignPath Foundation's free open-source program, with Microsoft Artifact Signing as the fallback. Linux builds need no signing.
- Signing runs in CI with keys held as CI secrets, never on a personal machine.
- When setting up the desktop app, the user either connects to an existing server by URL or runs Your Space locally. In local mode, the desktop app uses the Your Space CLI to set up and run the Docker Compose stack on that machine, then connects to it.
- The CLI is part of the first public release for setting up Your Space on a server or locally; desktop, web, and PWA clients can connect to a server it sets up.
- Before publication, local mode detects Docker and links to the Docker Desktop download when it is missing, sets up the Your Space stack, starts it when the desktop app opens, and updates Your Space when the owner chooses. (Detection with a Docker Desktop link superseded 2026-11-14: local mode provides Your Space's own engine by default; see below.)
- Every installation, local or server, uses one setup flow: the owner command. In local mode the desktop app runs it through the CLI and sets the password for the user, so the user only fills in one form. Streamlined local setup in the desktop app gets its own specification and implementation PR, separate from the owner-access feature (superseded: part of journey 008 since 2026-11-02, and since 2026-11-08 delivered, like every journey, as a stack of pull requests; see [journey-based specifications](#journey-based-specifications)).
- Before publication, the owner can back up and restore local and server installations alike, and move a local workspace to a server, through the CLI; the desktop app uses the same operation in local mode. (Moving superseded 2026-11-14: it is a backup and a restore the person does themselves; see [Your Space updates, backup, and restore](#your-space-updates-backup-and-restore).) Owner-triggered Your Space updates in local mode go through the CLI and roll back automatically if they fail.
- A local workspace is unavailable to other people and remote agents while its machine is asleep or off. Install documentation must state this and the Docker Desktop license terms. (2026-11-14: Docker Desktop is no longer required, so its license terms matter only to owners who choose it as their engine.)
- PWA offline support remains open. The first owner-access feature remains web-only.
- The desktop app updates itself. Its update check goes to GitHub, consistent with the no-telemetry rule.
- Your Space defines which desktop app, CLI, and server versions work together. On a mismatch, clients show a clear message saying whether to update the app or the server.
- Windows support (the desktop app, the CLI, local workspaces, and Windows signing) and PWA installation are low priority: built last, and the first work to move to post-open-source if the timeline slips. The [roadmap](../roadmap.md) assigns a priority to every pre-public item.

**Decision update (2026-10-31):** Desktop clients move from the first public release to post-open-source work. They need a separate build for each operating system, code signing including Apple notarization, and their own update mechanism, while the installable PWA already opens in its own app window on macOS, Windows, and Linux. (Superseded below: desktop clients return to the first public release.)

**Decision update (2026-10-31):** Desktop clients return to the first public release, superseding the deferral above, so that less technical users can run their own workspace. The desktop app can connect to an existing server or set up and run a local Docker Compose stack. The CLI stays for server deployment (superseded by the [CLI delivery sequence](#cli-delivery-sequence): the CLI handles local and server installations). Electron is selected, shipping for macOS, Windows, and Linux, which accepts the per-OS build, signing, and update costs.

**Decision update (2026-10-31):** Local mode's first-release scope is Docker detection with a download link, stack setup, starting the stack with the app, and owner-triggered Your Space updates. Local backup and restore, and moving a local workspace to a server, are deferred (superseded 2026-11-02: required before publication).

**Decision update (2026-10-31):** Local mode skips the setup code: the desktop app sets up the stack and supplies setup authority itself, so network access alone still cannot claim a local workspace. Server installations keep the setup code from the owner-access feature. Streamlined local setup is specified and implemented in its own PR, separate from the owner-access feature. (Superseded below: one setup flow for every installation.)

**Decision update (2026-10-31):** (The setup code was later replaced by the owner command; see [authentication and initial claim](#authentication-and-initial-claim).) Supersedes the setup-code exception above. There is one setup flow for every installation, and the CLI behaves the same for local and server installations. The desktop app wraps the CLI and handles the setup code on the user's behalf; it does not skip or replace setup authority.

**Decision update (2026-11-02):** Pre-public roadmap items carry High, Medium, or Low priority. Windows support and PWA installation are Low: they remain first-release goals, built last, and are the first to move to post-open-source work if the timeline slips.

**Decision update (2026-11-02):** Signed desktop releases are required before publication. An unsigned macOS app is blocked with a malware-verification warning and cannot update itself, which is too rough for the less technical audience. The Apple Developer Program ($99/year) covers macOS. Windows uses SignPath's free open-source signing, which needs a public repository and an OSI-approved license and lists SignPath Foundation as the publisher; Microsoft Artifact Signing (about $10/month) is the fallback if approval timing or the publisher name is a problem. New Windows apps may still show a SmartScreen warning until they build download reputation.

**Decision update (2026-11-23):** The Mac app updates itself before publication, and quitting it stops its local workspace.

- It updates from this repository's GitHub Releases with electron-updater, which reads GitHub's release feed. update.electronjs.org, Electron's hosted service, was ruled out: it skips prereleases, and the first releases are alphas. An app on an alpha is offered later alphas, betas and stable releases, an app on a beta later betas and stable releases, and a stable app only stable releases, so prereleases are tagged only as alphas or betas. (Superseded 2026-11-25, from alpha.2: the app follows the channel stored in its settings, Alpha or Canary, and reads that channel's feed at a fixed address with electron-updater's generic provider, still with no identifier; see [Your Space updates, backup, and restore](#your-space-updates-backup-and-restore).)
- Each release carries a ZIP of each notarized, stapled app and `latest-mac.yml`, which lists them with their SHA-512 digests. Squirrel.Mac, inside Electron, installs an update only if it meets the running app's Developer ID designated requirement.
- **Check for Updates…** works at any time. An automatic check, shortly after launch and then daily, is on by default and turned off with **Check for Updates Automatically**. It is the only automatic request; downloading and installing wait for the owner. Requests carry no installation identifier: electron-updater's staging ID is removed. (2026-11-26, from alpha.2, in [PR #139](https://github.com/your-space-ai/your-space/pull/139): a downloaded update goes to Squirrel.Mac only when the owner chooses **Restart Now**, which stages it before stopping the local workspace, so an update Squirrel refuses still stops nothing, or quits, which stages it while the workspace stops, within the quit's bound; electron-updater's `autoInstallOnAppQuit` is off. Squirrel.Mac can't take back a staged update, so this is what lets a change of channel drop a downloaded one ([spec 016](https://github.com/your-space-ai/your-space/blob/main/specs/016-release-channels/spec.md), FR-002). Before, the update was staged as soon as it downloaded and the restart offered only once it was; **Later** still installs it at quit. The Dock icon shows a progress bar while Squirrel.Mac stages. Once staging starts, the channel can't change until the app restarts, unless Squirrel.Mac refuses the update; staging that runs out of time keeps it, since Squirrel.Mac may still stage the update and install it at quit.)
- After the app changes version, the next start of the local workspace first runs the bundled CLI's `upgrade --json` with the release files bundled in the app, so the workspace matches the app. If the installation is newer than the app, the app says so and doesn't start it.
- Closing the window keeps the app and a local workspace running, as on any Mac. Quitting stops the local workspace the app started, with the bundled CLI's `stop`; the app shows that it is stopping and quits anyway after 2 minutes or a failure, saying the workspace may still be running. During logout, restart or shutdown it waits at most 20 seconds and shows nothing. A workspace opened with **Connect to a server** is never stopped. This replaces the earlier [008 slice](https://github.com/your-space-ai/your-space/blob/main/specs/008-desktop-entry/spec.md) statement that a quit app leaves the server to run the workspace.

**Decision update (2026-11-24):** The Mac app saves a connection for each workspace it opens, and a saved connection is a name and an address only. The app knows nothing about how a server is reached: no SSH, VPN or tunnel settings, and no code for them. Reaching a server is the network's job, so a workspace set up for its own machine on a computer reachable only over SSH works when the owner forwards its port to the same port on the Mac themselves and saves `http://space.localhost:<port>`; the app accepts any port at that address. This Mac, the installation the app manages, is the one special connection: opening it starts that installation as before. Each workspace opens in its own window with its own session, and several can be open at once. The launcher lists the saved connections and is where they are renamed or removed; removing only forgets a connection. The Connections menu switches between them with ⌘1 to ⌘9. This replaces the single last address the app kept, which the 008 journey offered on relaunch and in the Workspace menu.

**Decision update (2026-11-03):** The desktop app is the intended primary client. It can show installed apps in native views instead of iframes (see [UI integration](#ui-integration)), which gives the best in-app experience. The web client and PWA remain full clients, so people can use Your Space from a browser or phone. This does not change the build order: the desktop app is still built in journey 008.

**Decision update (2026-11-14):** The local audience no longer installs Docker Desktop. On macOS,
and later Windows, local mode provides Your Space's own virtual machine with Docker Engine by
default, and an engine the owner already runs is an advanced option; journey 003 or 008 settles how
(see [installation and hosting](#installation-and-hosting)). This supersedes Docker detection with
a link to the Docker Desktop download in local mode's first-release scope (2026-10-31), because
Docker Desktop's license limits who may use it for free while the open-source engine has no such
limit.

### Deployment Boundaries and Licensing

- Keep core behavior independent of a particular cloud provider.
- Provide platform-specific installation guides and deployment adapters for supported environments.
- Keep provider-specific storage, networking, and provisioning details within those deployment boundaries.
- Preserve compatible, versioned app contracts between self-hosted and managed installations.
- Dependencies must permit the intended commercial distribution and managed hosting, and be compatible with the project licenses below. Prefer permissive open-source licenses.

A future Cloudflare, VPS, or other cloud pathway must demonstrate persistence and lifecycle behavior in that environment.
Provider neutrality does not mean every runtime already supports the same executable or deployment configuration.
Dependency selection must consider actual licenses, including bundled components and distribution-specific terms.

### Project License and Business Model

- The business maintains the open-source core and offers a managed service for people who don't want to self-host.
- Your Space itself (server, web client, CLI, and desktop app) is licensed under AGPL-3.0 (`AGPL-3.0-only`). Anyone may self-host and modify it; anyone who runs a modified version as a network service must publish their changes.
- The SDKs are licensed under MIT, so apps can use any license. Apps are separate programs that integrate through APIs and are not covered by the core's license. (Apache-2.0 superseded 2026-11-16; see below.)
- SDK code never imports or copies code from the AGPL parts of the repository; SDKs reach Your Space only through its public APIs and contracts. Each SDK package states its own MIT license.
- The project uses the name Your Space and the domain getyourspace.ai. Trademark filing and a policy for forks remain open.
- Outside contributions are accepted under the Developer Certificate of Origin (DCO): contributors sign off each commit and keep their copyright, and the code they contribute is licensed under the license of the part it changes. (Contributor license agreement superseded 2026-11-16; see below.)
- Code specific to the managed service, such as billing, provisioning, and multi-tenant operations, lives in a separate private repository and integrates with the core through its APIs.
- The license, trademark, and contributor agreement are in place before publication, after review by a lawyer. (Lawyer review superseded: the source preview went without one on 2026-11-21, and since 2026-11-23 no release requires one; see below.)

**Decision update (2026-11-02):** AGPL-3.0 for Your Space and Apache-2.0 for the SDKs replace the earlier MIT preference. AGPL keeps the core open source while preventing closed hosted forks; the trademark and maintainership protect the managed offering. Source-available licenses such as FSL were considered and rejected because the business depends on an open-source core.

**Decision update (2026-11-16):** The owner revisited the licensing and contributor terms before publication.

- **SDKs: MIT, replacing Apache-2.0.** Apps that use an SDK can have any license, including GPLv2-only, which Apache-2.0 can't be combined with. Installing existing open-source apps is the first release's focus, so compatibility outweighs Apache-2.0's explicit patent grant; the project holds no patents.
- **Contributions: DCO, replacing the contributor license agreement.** Revenue comes from the managed service, not from selling licenses, and self-hosters trust a project more when no single party can relicense it. The accepted consequence: once outside contributions land, the core can't be relicensed or offered under commercial terms, and the managed service must publish any changes it makes to the core. Keeping managed-service code in a separate private repository that integrates through the core's APIs, as decided above, keeps that workable.
- **`AGPL-3.0-only`, not "or later".** The project decides on any future license version itself; under the DCO this can't easily be changed later.
- **Copyright holder.** Code is published under the owner's name; the owner assigns it to the company when it is incorporated. Incorporation isn't required for publication.
- **Trademark: open.** A 2026-11-16 screening found no live US registration for YOUR SPACE in software classes, but the name is descriptive and may be hard to register, and MYSPACE registrations exist in related classes. Whether and when to file, and the trademark policy for forks, are open.
- **Lawyer review before publication remains as stated above** and now covers the DCO in place of a contributor agreement. (Superseded: the source preview went without one on 2026-11-21, and since 2026-11-23 no release requires one; see below.)

**Decision update (2026-11-21, quiet source preview).** The owner chose to publish the developer
preview under AGPL-3.0-only and accept outside contributions under the DCO without a counsel
review for this milestone. Trademark filing and the policy for forks remain open. The separately
packaged product release follows the [maintainer release guide](../maintainers/releasing.md).

**Decision update (2026-11-23, packaged prereleases).** Packaged prereleases, starting with the
alpha, also ship without a counsel review, because the project can't afford one before the alpha.
This extends the 2026-11-21 decision from the source preview to the packaged prereleases that the
[maintainer release guide](../maintainers/releasing.md) produces, under the same AGPL-3.0-only
license and DCO. It supersedes the lawyer review before publication above: the guide no longer
asks for one for any release. Maintainers still confirm distribution rights and notices for
everything that ships, as the guide describes. Trademark filing, the policy for forks, and whether
counsel reviews the license, contributor and trademark terms before a later release remain open.

### Product Experience Principles

- Simple by default. Show people only what they need to see, and avoid filling the interface with settings and configuration that can overwhelm beginners.
- Deeper controls are available for power users, but they stay out of the default experience.
- Configuration works like editor settings: the defaults live in Your Space, the owner's file starts empty, and each line in it overrides one default. Every setting needs a safe default that suits most installations; a value that follows from other settings is derived, not asked for; secrets are generated when the owner doesn't supply them.

**Decision update (2026-11-02):** Simplicity by default is a product principle for every client and feature. New settings, logs, and configuration go behind advanced controls unless most users need them.

**Decision update (2026-11-08):** Configuration is optional, part of [constitution principle II](https://github.com/your-space-ai/your-space/blob/main/.specify/memory/constitution.md#ii-preserve-user-control-and-hosting-choice) since version 1.2.0 (2026-11-07). Required settings are each a chance to get an install wrong, and they freeze today's choice into every owner's file, so a better default later reaches nobody. Plans name each setting's default and how it is derived, and the documentation lists the defaults so an owner can see what a line would change. Where a tool can't derive a value, the setting stays and the CLI (spec 003) derives it; in the manual Compose install, the one line the owner writes picks the port bindings (see [Installation and Hosting](#installation-and-hosting)).

**Decision update (2026-11-14):** Names follow one picture: Your Space is the home, apps are its
appliances and furniture, providers such as LLM services are its utilities, and installation kits
make an appliance fit. New names should fit it, so the product reads as one place rather than a set
of technical parts. The [glossary](../glossary.md) records the terms.

### Telemetry and Outbound Connections

- Your Space collects no telemetry. Neither the server, the CLI, nor the desktop app reports usage, errors, or any other data to the project.
- The only automatic outbound requests are update checks that ask GitHub for the newest build of the app's update channel. The owner can turn them off. Actions the owner starts, such as installing or updating an app, contact the sources they name.
- Opt-in reporting, off until the owner turns it on, is the only acceptable future extension. Opt-out telemetry is prohibited.

**Decision update (2026-11-02):** No telemetry in the first release. Any future reporting must be opt-in; opt-out collection is an anti-pattern and is ruled out permanently.

**Decision update (2026-11-03):** Certificate requests the built-in proxy makes for an owner-configured domain are part of HTTPS setup, not reporting. This qualifies the bullet above on automatic outbound requests: with a domain configured, these certificate requests are the only automatic outbound requests besides update checks. (2026-11-23: the Mac app's update check is the only one so far, and **Check for Updates Automatically** turns it off; the server and CLI have none.)

### Documentation

**Decision (2026-11-23).** The repository maintains a reference set of documents: installation and operation guides, app-building guides, maintainer guides, this decision record, the roadmap, the architecture overview, the glossary and the specifications. In-depth explanations of how the code works come from the generated [DeepWiki](https://deepwiki.com/your-space-ai/your-space), steered by its page plan and notes in `.devin/wiki.json`, instead of hand-written walkthroughs. Generated pages can lag the code or paraphrase it, so the reference set stays authoritative wherever exact steps, versions or commitments matter, and DeepWiki is told to cite it. The reference set is the only written source: it lives in `docs/` and is published as a website with Mintlify (free plan) from `docs/docs.json`; DeepWiki is a generated view of the repository, not a second source.

## Accepted Future App Distribution Direction

**Current scope (2026-11-21).** Journey 011 includes direct kit URLs, an optional operator-selected GitHub kit directory, private GitHub sources, and owner-confirmed compatible replacements. (2026-11-23: apps install only from a kit's link; see [Kits define apps](#kits-define-apps). Private GitHub sources and owner-confirmed replacements are deferred until after the alpha; see [Creator workflow deferred](#creator-workflow-deferred). 2026-11-25: private GitHub sources return, read only, in journey 015; see [Private GitHub sources](#private-github-sources).) Journey 006 covers broader updates and backup-based data rollback after publication. Earlier release dates and requirements below are superseded where they differ from the [personal dashboard decision](#personal-dashboard-release-boundary).

- For the first public release, an owner installs a compatible app by pasting the GitHub URL of the app's deployment file in a public repository into Your Space. (Since 2026-11-14 that file is the app's own Compose file; see below. Superseded 2026-11-23: the owner pastes the link to the app's kit, which names the Compose file; see [Kits define apps](#kits-define-apps).)
- The owner can connect GitHub to install authorized private repositories in 011. (Superseded 2026-11-23: the GitHub connection is deferred until after the alpha, and a kit in a private repository installs with the server command, `install-app --kit -`; see [Creator workflow deferred](#creator-workflow-deferred). 2026-11-25: the connection returns, read only, in journey 015; see [Private GitHub sources](#private-github-sources).)
- Curated app listings provide discovery and use the same installation contract as direct repository installation.
- The official curated listing is optional, rather than a prerequisite for installing compatible apps.
- Preserve each installation's app identity, exact source version, provenance, and approved update policy or source.
- Changing or disconnecting a discovery source must not silently redirect updates, replace an app, uninstall it, or delete its data.
- App updates must not silently expand granted access.
- The first public release supports owner-triggered updates of installed apps, preserving app data and requiring explicit approval for any additional access.
- Automatic app updates are post-open-source work.
- Before each app update, Your Space records the app's current image versions and backs up its data.
- If an update fails, Your Space automatically rolls the app back to the recorded image versions and restores the pre-update data backup.
- Keep failed-update rollback minimal: only the backup needed to restore the pre-update state is required. Backup history and owner-initiated rollback of a successful update are post-open-source work.

**Decision update (2026-10-30):** Owner-triggered app updates are required before publication so owners can keep installed apps current. Automatic updates are deferred. Update selection, compatibility checks, and failed-update recovery still need definition in the app contract.

**Decision update (2026-10-31):** A failed update rolls back automatically from a pre-update backup instead of relying on a manual recovery procedure. Data is backed up because an update can change app data in ways the previous version cannot read. The mechanism stays simple; the app contract defines what counts as a failed update.

**Decision update (2026-11-14):** The owner pastes the GitHub link to the app's own Compose file,
written by its authors for people to run, instead of a Your Space-specific deployment file (see
[app deployment](#accepted-future-app-deployment-direction)). Your Space records the exact commit
the link resolves to, the commit of the installation kit it applied, if any, and each image's
digest, which Your Space resolves itself rather than reading from the app's files. (Superseded
2026-11-23: the owner pastes the link to the app's kit, and Your Space records the commits of both
the kit and the Compose file it names; see [Kits define apps](#kits-define-apps).)

**Decision update (2026-11-20):** When an app's own Compose file doesn't fit Your Space's rules, for
example because it builds its images, mounts host folders or adds capabilities, the operator can
install the app from a Compose file they write and give the server command on this machine, with a
kit given the same way. Your Space checks and adapts it like a file from GitHub, records its digest
in place of a link and commit, keeps its text, and reads nothing from GitHub for it. The web client
still installs from a GitHub link only. (2026-11-23: a kit given with the file is now required; see
[Kits define apps](#kits-define-apps). Superseded the same day: `install-app --compose` is gone, so
the owner no longer installs a Compose file given on this machine, and apps installed that way keep
running from their stored file; `install-app --files-stdin`, which journey 011's
`app install-local` used, left with 011's creator features. See [Alpha scope](#alpha-scope) and
[Creator workflow deferred](#creator-workflow-deferred).)

Public, community, and private discovery experiences can coexist without redefining installed app ownership or update routing.
No catalog federation protocol or marketplace implementation is selected here.
Repository access authorizes retrieval of code; it does not grant that code access to workspace resources.
Deployment-file contents, packaging, release verification, installation execution, storage, upgrades, and rollback need a separate app contract.

## Accepted Future App Deployment Direction

- Independent apps run in their own container or containers and integrate with Your Space through APIs. They do not run inside a Your Space-specific application environment.
- Your Space starts and manages installed app containers. For the first public release, it supports Docker on the same machine as the Your Space server. Other machines and deployment backends are future work. (Refined 2026-11-14: one Docker-compatible engine, shared by Your Space and its apps wherever it runs, reached only by the runtime manager; see below.)
- An app can declare and use its own database service, which Your Space runs alongside it; apps are not required to use the platform's database.
- Apps have isolated environments and app-specific durable storage. They do not receive direct access to host folders, devices, or Docker controls. The enforcement mechanism and precise isolation guarantees require design and verification.
- Uninstalling an app retains its data by default. The owner can explicitly delete retained app data from an administration UI.
- The app developer supplies a separate deployment file in the app's existing repository. The owner installs the app by pasting that file's GitHub URL; Your Space reads the file at that URL and records the exact commit used. Updates re-read the file from the same URL. (Separate deployment file superseded 2026-11-14: the app's own Compose file, with an optional installation kit; see below.)
- The first public release installs published container images only. The app's integration files must declare the exact image and version to install for each container, including any declared database service. (Refined 2026-11-14: Your Space pins each image to its digest itself, since apps' own files often name moving tags; see below.)
- Building apps from source during installation is post-open-source work.
- The deployment file is a Docker Compose file. Your Space accepts only Compose settings on an approved list and rejects all others, including settings that would break app isolation, such as host folder mounts, devices, privileged mode, or host networking.
- The approved list is not defined in advance. It starts with the settings the first app needs when that app is implemented, and grows as later apps need more. (Refined 2026-11-14: the 002 plan sets it for every app; see below.)
- The app describes itself to Your Space, such as its name and the access it needs, in a dedicated `x-your-space` section of the same Compose file. (Superseded 2026-11-14 by installation kits; see below.)
- Alternative deployment-file formats are post-open-source work, explored only if a real need surfaces, such as app details the Compose file cannot express.
- The owner provides app settings and secrets, such as API keys, at installation and can change them later. A component in the Your Space Compose stack stores and supplies them; the mechanism is decided in the app specification. (Decided 2026-11-14: the server stores them encrypted; see below.)
- App images must be published for both ARM and Intel/AMD machines. Installation fails with a clear message if no image matches the machine. (Superseded 2026-11-14: an app installs if its images run on the engine's processor type; see below.)
- Apps have no outbound network access by default. Each app declares the outbound access it needs in its `x-your-space` section, and the owner approves it at installation; an update that asks for more needs new approval. (Declaring in `x-your-space` superseded 2026-11-14: starter hosts from the installation kit, then access requests; see below.)
- Each managed app runs with memory and CPU limits so one app cannot take down the host. The owner can see each app's status and logs.

**Decision update (2026-11-02):** App settings and secrets, multi-architecture images, declared and limited outbound network access, and resource limits with app status and logs are required before publication. The settings and secrets mechanism, how outbound access is declared and enforced, and default limits are decided in the app specification. (Decided 2026-11-14 below; multi-architecture images are no longer required of apps.)

**Decision update (2026-10-30):** Published images with exact declared image versions are required for the first release. This resolves the previously open image-pull-versus-source-build choice. Developers publish their images; Your Space downloads and runs the declared versions. Deferring source builds keeps build execution and its operation outside the initial installation scope.

**Decision update (2026-10-31):** The deployment file uses Docker Compose, resolving the previously open format choice. App developers already know Compose, and it can declare the app and its database service with exact image versions. A new Your Space format would be easier to validate but would require every developer to learn it; it is deferred until a real need surfaces.

**Decision update (2026-10-31):** The owner pastes the URL of the deployment file itself, superseding the earlier choice to paste the repository URL and read the file from the default branch. Because the URL names the exact file, Your Space needs no file-naming or discovery convention, and one repository can hold more than one app.

**Decision update (2026-10-31):** App details for Your Space go in a dedicated `x-your-space` section of the Compose file. Compose permits extension sections and ignores them, so installation stays one file and one URL. A separate details file would need a second URL or file-finding logic. If the Compose section proves too limited, a custom format can be explored later. (Superseded 2026-11-14 by installation kits; see below.)

**Decision update (2026-10-31):** Your Space accepts only Compose settings on an approved list rather than blocking known-dangerous ones. An approved list fails safe: an unlisted setting is rejected until it is reviewed and added, while a blocked list lets through any setting nobody thought to block. The list is derived from what the first app needs during its implementation instead of being guessed up front.

The deployment file is intended to describe how Your Space launches the app without coupling deployment configuration to application code. It uses Docker Compose. The initial approved list of Compose settings, set when the first app (Tasks) is implemented, the contents of the `x-your-space` section, supported operations, and backend interpretation remain open. (2026-11-14: the app's own Compose file replaces the deployment file, the 002 plan sets the approved list, installation kits replace the `x-your-space` section, and an existing open-source app replaces Tasks; see below.) The app contract must define how exact image identity is validated and retained alongside the repository commit. Trust verification, owner-triggered update mechanics, and how a failed update is detected still need decisions.

App role authorization controls what users and agents may do within an app. Host isolation is a separate boundary and must not rely on those roles or the SDK alone. The runtime manager's privileges and deployment-file processing must be designed so app-provided configuration cannot bypass the agreed host-access boundary.

**Decision update (2026-11-14):** Apps install from their own files, with optional installation
kits. Your Space reads an app's own Compose file and applies rules that hold for every app, instead
of requiring a Your Space-specific deployment file with an `x-your-space` section. This supersedes
the 2026-10-31 decision to put app details in an `x-your-space` section and the bullets above that
the developer supplies a separate deployment file. Help a particular app needs comes from an
installation kit supplied by the owner or discovered in their optional `YS_KITS_REPOSITORY`
GitHub directory. Each fresh installation starts without a directory. Kits declare which service
is the interface, which values to generate rather than
take from published defaults, values Your Space works out itself such as the app's own address,
which outbound hosts it needs, its limits, and whether it can run in a pane. A kit refers to the
app's files by link and exact commit and never copies them, so the app's license is untouched. Your
Space contains no logic for a particular app, and an app with no kit installs if its own files are
enough. App authors can't be expected to add a section for Your Space, and requiring one would leave
almost no existing app installable. (Superseded in part 2026-11-23: every installed app has a kit,
installed from the kit's link, and the directory no longer finds a kit from a Compose link. A kit
can still live outside the app's repository, so its authors needn't change anything, or beside the
app's Compose file in its own repository. See [Kits define apps](#kits-define-apps).) The format
is in the [kit contract](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/contracts/kit-format.md).

**Decision update (2026-11-14):** The [002 plan](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/plan.md#runtime-manager-docker-adapter)
sets the approved list of Compose settings for every app, checked against the first two apps'
files, refining the plan to grow it from the first app alone. It is checked against the fully
resolved file (`docker compose config`, after `include`, `extends`, anchors and placeholders), never
the raw text, and an unknown key is refused so a new Compose feature can't slip through. Rules that
apply to every app adapt a few settings and report each change: published ports are replaced by Your
Space's routing, networks are assigned, images are pinned by digest, services behind profiles are
left out, and Your Space sets DNS, logging and limits. Host folders, devices, privileged mode, host
namespaces and engine access are refused with the reason. (Refined 2026-11-23: before that check,
Compose reads the file as written, so that every `env_file` and `label_file` can be checked before
Compose would read one; see [the kit defines the environment](#the-kit-defines-the-environment).)

**Decision update (2026-11-14):** An app installs if its images run on the engine's processor type
(ARM or Intel/AMD); nothing more is required. This supersedes the requirement that app images be
published for both. Requiring both would refuse apps that run on the owner's machine, and the
install still stops with a clear message when no image matches. Your Space's own images still ship
for both.

**Decision update (2026-11-14):** A runtime manager in Your Space's stack is the only part that holds
the engine connection. It is the Docker adapter: a service with no network (`network_mode: none`)
that mounts the engine socket and serves its API on a Unix socket in the `ys-runtime` volume, which
the server mounts. The server talks to it in Your Space's terms (apps, services, endpoints, outbound
hosts) and never holds the engine connection, since engine access controls the host. The runtime
manager runs `docker compose` to resolve, pull, start, stop and log apps, as their authors tested
them, and calls the engine API for image platforms and digests, engine details, network connections
and use. The engine is any Docker-compatible engine of version 28 or newer, found without
configuration and overridable with one setting (`YS_ENGINE_SOCKET`). Kubernetes (k3s) was
considered and not chosen as the default: on macOS it runs inside the same kind of VM, adds about 1
to 1.5 GB of memory, and loses Compose features apps rely on; it stays possible later as another
adapter. Socket proxies, Docker-in-Docker, gVisor, Kata and Docker Desktop's Enhanced Container
Isolation were also considered; optional hardening for servers (Sysbox, rootless Docker) is later
work. Engines reached over `ssh://` or `tcp://` wait until an engine on another machine is in scope.
See [research R1](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/research.md#r1-how-your-space-runs-app-containers).

**Decision update (2026-11-14):** Each app is one Compose project with its own named volumes and its
own sealed network: `internal`, in Docker 28's isolated gateway mode, so it has no route to the host
or out. Each app also gets its own egress proxy, Squid (`ubuntu/squid`, maintained by Canonical and
run unmodified), which is on the app network and an egress network. App services reach the internet
only through it: it allows the approved host names, denies private and link-local addresses and
everything else, and its log of denials becomes access requests. An app that ignores proxy settings
has no route out at all. Smokescreen was rejected because it publishes no image and identifies
clients by TLS certificate, and a custom proxy because it is security code to maintain. Squid uses
about 16 MB of memory per app. See [research R3](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/research.md#r3-what-building-the-journey-showed).

**Decision update (2026-11-14):** An app reaches only the internet hosts approved for it. Its
installation kit names starter hosts, the ones it needs to work at all; the install review lists
them, and confirming the install approves exactly those. An app without a kit starts with none
(2026-11-23: every app now installs with a kit; one that names no hosts starts with none). Any
other host an app tries is blocked and shown to the owner as an access request naming the app and
the host and when and how often it was tried; the owner approves or dismisses it, and can remove an
approval later. There is no "all internet" option yet. This supersedes declaring outbound access in
an `x-your-space` section for approval at installation. The first app integrates with more than a
hundred providers, so a fixed list at install would either expose everything or break features;
owners widen access as they use more of an app. App updates still must not widen access silently;
how a kit's new starter hosts are approved on update is settled in journey 006.

**Decision update (2026-11-14):** Settings are the variables an app's file reads. The server stores
them in its database, encrypted with AES-256-GCM under a key derived from the auth secret, and hands
them only to the runtime manager over its local socket. This decides the mechanism the bullet above
left to the app specification. Published defaults for secrets are never used: an installation kit
says which values to generate, and without a kit a variable whose name suggests a secret and has a
published default is generated. (2026-11-23: every app now has a kit, and this rule applies to the
variables its kit doesn't generate, derive or set; see [Kits define apps](#kits-define-apps).) (Superseded 2026-11-23, later: the kit's `env` is the app's whole environment and its only settings, and no name makes a setting secret or generated; see [the kit defines the environment](#the-kit-defines-the-environment).) Generated values never appear in output, logs or the review. What
the owner sees and sets for them in the review is still open and is designed with the review screen.

**Decision update (2026-11-14):** Each app service runs with a fixed default memory and CPU limit,
which an installation kit can override and the owner can change behind an advanced control; the
numbers are in the 002 plan. Your Space's own containers are the last the kernel stops when memory
runs out. Resources belong to the whole space: whatever the engine's machine provides, so a server,
a laptop, a local VM and a managed tier's VM are the same to Your Space. Limits that scale with those
resources are left to explore.

**Decision update (2026-11-14):** Stopping Your Space on purpose stops the apps it manages, as one
unit. Restarting or updating it, or a crash, leaves them running, and when it returns it takes them
back over without restarting them and corrects recorded state, so updates don't take apps down.
Clients never change app state. Containers on the engine that Your Space doesn't manage are never
touched. Removing an app keeps its named volumes, its record and its settings as retained data, so
installing it again gets back the same data and database password; deleting retained data is a
separate, confirmed step.

## Accepted Future App UI and Authorization Direction

### UI Integration

**Current scope (2026-11-21).** Web panes serve the personal release. Native views and installable PWA support follow in 008. Earlier release dates and requirements below are superseded where they differ from the [personal dashboard decision](#personal-dashboard-release-boundary).

- Users open installed apps inside the Your Space interface while platform navigation remains available.
- Existing app frontends should continue calling their normal app backend operations.
- UI integration must not require replacing every frontend request with a Your Space-specific SDK call.
- UI and programmatic access must reach equivalent backend authorization checks.
- The platform session stays confined to the platform's own host (host-only cookies), so it is never sent to app origins. The owner-access implementation follows this so it does not need rework once app origins are decided. (Since 2026-11-14 a `__Host-` cookie over HTTPS; see below.)
- Apps open in panes inside the Your Space interface. Several apps can be open side by side in one layout on larger screens; phones show one app at a time.
- Each app's interface runs on its own origin, separate from Your Space and from other apps, so the browser isolates them from each other. A subdomain per app is the default; a port per app is the fallback where wildcard DNS is unavailable. Spec 002 settles the mechanism. (Port fallback superseded 2026-11-14: every app is at `<app>.<Your Space's address>`; see below.)
- In the web client and PWA, each pane is a cross-origin iframe. In the desktop app, each pane is a native view (for example, Electron's `WebContentsView`), not an iframe.
- Any app can also open in its own browser tab or window, for apps that cannot run in a pane.
- The app UI and sign-in specification comes right after the owner-access feature and before the CLI specification; see the [CLI delivery sequence](#cli-delivery-sequence). It is part of journey 002; see [journey-based specifications](#journey-based-specifications).

**Decision update (2026-11-03):** Selects cross-origin panes for app interfaces: iframes in the web client and PWA, and native views in the desktop app. This supersedes the earlier statement that no iframe, reverse proxy, or UI extension system was selected. Rationale:

- Only cross-origin panes run existing apps from any stack unchanged while keeping them isolated from Your Space and from each other. That keeps apps stack-agnostic.
- Serving apps under paths on the Your Space origin was rejected. App code would share the origin, so it could call the Your Space API as the user, read platform storage, and reach other panes. Many frameworks also assume they own the root path.
- Micro-frontends (apps shipping components that load into the Your Space page) were rejected. They run app code with the user's Your Space session and require apps to be built as JavaScript components.
- Declarative UI (apps describe their interface and Your Space draws it) was rejected for full apps, because every app would have to rewrite its interface. Server-side composition of app HTML was rejected because it breaks most apps' scripts and routing.
- The desktop app uses native views instead of iframes because it is the intended primary client and native views give each app its own process.

Spec 002 still defines framing permission, the optional messages between Your Space and an app (such as navigation, deep links, and theme), sign-in inside a pane, and the fallback for hosts without wildcard DNS, such as Tailscale `ts.net` names. Small native pieces drawn by Your Space from app-provided descriptions (such as dashboard cards) were discussed as a possible later developer-kit contract and are not decided. (2026-11-14: spec 002 settles framing, sign-in inside a pane and Tailscale below; the optional messages are not part of it and remain open.)

**Decision update (2026-11-14):** Every app is at `<app>.<Your Space's address>` in every setup:
`notes.space.localhost` on this machine with no setup, `notes.space.example.com` on the owner's own
domain after one wildcard DNS record (with certificates obtained on demand, only for installed
apps' names), a Tailscale Service per app on Tailscale, and the forwarded wildcard name behind the
owner's own proxy. Ports and paths are not used, because browsers don't keep cookies apart by
either: an app on another port of Your Space's host receives the platform session, as Umbrel,
CasaOS and Runtipi show, while a host name per app is what Codespaces, Gitpod, Coder, OrbStack and
JupyterHub use. This supersedes the port-per-app fallback for hosts without wildcard DNS. The owner
creates Tailscale Services for now; whether Your Space can create them is left for journey 003. See
[research R2](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/research.md#r2-apps-in-panes-framing-cookies-and-app-addresses).
(2026-11-19: Tailscale names can't hold `<app>.<Your Space's address>`; on Tailscale an app is
published on a port and gets a Tailscale Service of its own; see
[running apps and reaching them](#running-apps-and-reaching-them).)

**Decision update (2026-11-14):** Only people signed in to Your Space reach an app's origin. Caddy's
app site (`*.space.localhost`, or `*.<domain>`) asks the server's gate with `forward_auth` before
each request. The gate is a second server listener, on port 3001, that only Caddy reaches. Without a
pass, the gate sends the browser to Your Space, which checks the session and the owner and redirects
back with a one-time code valid for 60 seconds; the gate exchanges the code for a pass cookie on the
app's own host (`HttpOnly`, `SameSite=Lax`, no `Domain`), valid for 12 hours, signed with the auth
secret and naming the app and the session. The gate checks that the session still exists, so
signing out of Your Space closes every app. Caddy removes the pass from requests to the app (Your
Space's own cookies are host-only, so browsers don't send them to an app's host), removes any
`Domain` attribute from cookies the app sets, and replaces the app's framing headers so only Your
Space can frame it, then proxies to the upstream the gate names on the app's network. It changes
nothing else: an app's own cookies and sign-in are left alone.
Rewriting apps' cookies to `SameSite=None; Partitioned` was tested and rejected, because it splits
the pane's session from the app's own tab and weakens the app's CSRF protection. Caddy's built-ins
do the gating and rewriting, so the custom code is the gate's checks.

**Decision update (2026-11-14):** Over HTTPS, Your Space's session cookie is a `__Host-` cookie,
which no app on a subdomain can set or overwrite. On the plain-HTTP local setup it stays a host-only
cookie without the prefix, because WebKit refuses `__Host-` cookies over HTTP even on `*.localhost`
(Chromium and Firefox accept them). There an app's script could set a cookie with the same name for
Your Space's host; it holds no valid session to set, so the worst it can do is sign the owner out.
This refines the host-only cookie bullet above. Spec 002 first planned `__Host-` on every setup;
building the journey showed WebKit's refusal.

**Decision update (2026-11-14):** On the plain-HTTP local setup, WebKit treats each `*.localhost`
name as its own site and blocks cookies in a pane from another site, so an app in a pane never keeps
its pass and the gate's redirects loop. Your Space detects the loop and offers the app in its own
tab, behind the same gate. Chromium and Firefox run apps in panes on that setup, and with HTTPS on a
real domain, Your Space and its apps are one site in WebKit too. Safari on macOS uses a different
cookie stack and is still to check. See
[research R3](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/research.md#cookies-and-panes-on-the-local-setup).

#### Running Apps and Reaching Them

**Decision update (2026-11-19):** Your Space runs apps; the owner's network setup reaches them. Your
Space installs, runs and manages apps (settings, logs, limits, sealed networks) and later the agent
gateway. How people reach an app belongs to whatever network setup the owner uses: `tailscale
serve`, a tunnel, a reverse proxy, or the managed platform's edge. The built-in addressing above
(`<app>.<Your Space's address>`, the access gate, the handoff and panes) stays the default and is
unchanged: on this machine it works with no setup through `*.localhost`, and on the owner's own
domain with one wildcard DNS record. Where it can't work, as on Tailscale, the owner publishes the
app:

- Publishing is opt-in per app. Your Space publishes only the app's interface, on a port of this
  machine: by default the port the app's own Compose file publishes for it, else the interface's
  own port, listening on `127.0.0.1` unless the owner chooses another address. A port in use is
  refused when the owner saves: another published app's with that app's name, a container's with
  the container's name, and anything else's as another program's, found by a short-lived container
  that tries to publish the port as the app's Caddy would. Something that takes the port after that
  makes the app's start fail with the port named. The owner then chooses another port; Your Space
  never looks for or suggests one.
- The app's own services stay on its sealed network, where Docker publishes no port. A Caddy of
  Your Space's, `ys-publish`, joins that network and one of its own, listens on the port, and
  proxies every request to the interface. It passes on the original `Host`, WebSockets, uploads of
  any size and streamed responses, and passes the app's responses back as the app sent them, its
  framing headers included: a published app is proxied, never re-framed. (2026-11-20: unless the
  owner shows it inside Your Space, the default; then only its framing headers change. See below.)
  The owner's proxy's
  `X-Forwarded-*` headers reach the app as that proxy sent them when it connects from this machine,
  a private network or Tailscale's addresses (Caddy adds the connecting address to
  `X-Forwarded-For`, and the others only when the proxy sent none); from any other address, Caddy
  sets them itself.
- The owner gives the link they reach the app at. The settings a kit derives from the app's address
  (`app_origin`, `app_host`) use the link instead of `<app>.<Your Space's address>`, and follow a
  changed link when the app next starts. The owner can't set those settings by hand, so nothing they
  set changes. Your Space opens a published app at its link, in its own tab. (Superseded
  2026-11-20: Your Space shows it at its link in its pane, unless the owner turns that off; see
  below.)
- A published port is outside Your Space's access gate: whoever reaches it reaches the app, and only
  the app's own sign-in protects it. That is why it listens on this machine only by default.
- On Tailscale, each published app needs its own Tailscale Service (`svc:notes` for
  `https://notes.<tailnet>.ts.net`), because each app needs its own origin and Tailscale gives
  one-level names only. The owner creates them; Your Space has no Tailscale code.
- An app already running elsewhere, such as a self-hosted instance on another machine, will be an
  app with a link that Your Space didn't install: the same record, without running it. The agent
  gateway will treat both alike. This is later work.

Rationale: Your Space should care which local ports it runs apps on, and leave the rest to tools that
already do it. This supersedes, for apps, the 2026-11-17 statement that apps over Tailscale stay
unsupported, and narrows journey 002's FR-015: apps still publish no ports of their own, and only
the owner can publish an app's interface. Constitution 1.5.0 amends principle II to match.

**Decision update (2026-11-20):** A Caddy of Your Space's serves a published app's port, in place of
the first choice, a plain TCP forwarder. The forwarder's queue held a single waiting connection:
when a browser's first visit through the owner's proxy asked for a couple of hundred files at once,
most of the requests failed. And when the app closed an idle kept-alive connection, the visitor's
next request on it could fail. Caddy accepts every connection, keeps the visitor's open, and opens
its own to the app as it needs them.

- Each published app gets a Caddy of its own rather than a port on Your Space's Caddy. Docker can't
  add a port to a running container, so the shared Caddy would be recreated, interrupting Your
  Space and every app, each time an app's publishing changed, and its ports would have to be written
  into Your Space's own Compose setup.
- The app's Caddy runs Your Space's own web image, which the runtime manager takes from Your Space's
  Caddy, so nothing new is downloaded. It is hardened: user 65534, a read-only root, no
  capabilities, no new privileges, and its own memory and CPU limits.
- It changes nothing in the app's responses. Your Space's own Caddy replaces an app's framing
  headers only at the app's built-in address, behind the access gate. Replacing an app's protection
  against being framed on a port outside the gate is too much to do for every published app, so a
  published app still opens at its link, in its own tab. Letting the owner choose, per app, that Your
  Space frames a published app is possible later work. (Superseded 2026-11-20: the owner chooses it
  per app, on by default; see the next update.)
- It trusts forwarded headers only from loopback and private addresses (`127.0.0.0/8`, `::1`,
  `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`) and from Tailscale's
  (`100.64.0.0/10`, the shared address space). A proxy on this machine reaches the port through
  Docker's bridge, so from a private address; one on the local network or the tailnet connects from
  its own. A visitor who reaches the port from anywhere else can't choose the address and scheme
  the app sees. A proxy that connects from a public address isn't trusted either: the app then sees
  the proxy's address and `http`.
- When Your Space is updated, and for an app the forwarder published, the server recreates the
  app's `ys-publish` once, and only that container. The port check, the start-time error and the
  owner's choice of port stay as they were.

**Decision update (2026-11-20):** Your Space is the owner's own dashboard, so a published app opens
inside Your Space's pane, at its link, rather than in a tab of its own. Many apps forbid being
framed; some send `X-Frame-Options: DENY`. Each published app therefore has a setting,
"Show inside Your Space", on by default, for new and already published apps alike (superseded
2026-11-23: the setting is gone and framing is always on, as below for "On"; see
[Alpha scope](#alpha-scope)):

- On, for an app with a link whose kit lets it run in a pane, the app's `ys-publish` applies the
  rule Your Space's own Caddy applies at an app's built-in address: it removes `X-Frame-Options`, and sets the `frame-ancestors` of the app's
  `Content-Security-Policy`, or of a policy of its own when the app sends none, to Your Space's
  origin alone, as Your Space's Caddy has it (`YS_ORIGIN`). Not `'self'`, and not `*`: no other
  site, and not the app itself, can frame it. Everything else passes through unchanged: the rest of
  the app's policy, its cookies, its other headers and its bodies.
- Off, `ys-publish` passes the app's responses on untouched, and the pane offers the app at its link,
  in its own tab, as before. So it does for an app without a link, which the pane shows at its
  built-in address, and for one whose kit says it can't run in a pane.
- The pane frames the link only when the setting is on, the app's kit doesn't say it can't run in a
  pane, and the browser can show the link inside Your Space's page: a plain-HTTP link inside an HTTPS
  Your Space opens in its own tab, apart from one on this machine. The server decides this once, for
  both the pane and `ys-publish`, so `ys-publish` replaces the framing rules exactly where the pane
  frames the app.
- The pane frames the link only once `ys-publish` actually lets Your Space frame the app, and at an
  address that names that `ys-publish`, so a refusal the browser cached before, as while the change
  was being applied, is never shown. `ys-publish` keeps passing the app's caching headers on
  unchanged.
- Changing the setting applies the app again, which recreates only its `ys-publish`, like any other
  change to how it is published. When Your Space moves to another address, the server renews every
  `ys-publish` that lets the old origin frame its app, as it does after an update. Like the port and
  the link, the setting goes back to its default when publishing stops.
- The app's cookies are its own: in a pane at a link on another site than Your Space's, a browser
  that blocks third-party cookies may not keep the owner signed in to the app there. The pane's "Open
  in its own tab" always works, and turning the setting off makes that the default.

Rationale: this is the trade-off the 2026-11-14 decision already makes for every app at its built-in
address, now made per published app and in the owner's hands. An app's protection against being
framed guards against clickjacking: another site showing the app invisibly and steering the owner's
clicks. Only Your Space's origin can frame the app, so the risk left is a compromised Your Space page,
which can already control the app through the owner's session. An app the owner doesn't want shown
inside Your Space keeps its own rules with the setting off. This supersedes, for published apps, the
2026-11-19 and earlier 2026-11-20 statements that a published app opens at its link in its own tab.

Embedding and routing are separate decisions from how an app interprets authenticated identity and roles.
Frontend controls may reflect granted access, but hiding a control is not authorization enforcement.

### Identity and App-Owned Roles

**Current scope (2026-11-21).** 005 delivers verified identity and agent grants for one owner and an integrated app. Human member assignment and team single sign-on move to 004. Earlier release dates and requirements below are superseded where they differ from the [personal dashboard decision](#personal-dashboard-release-boundary).

- Your Space manages identities and app role assignments.
- Apps expose a supported role catalog with stable role identifiers and retain their existing role semantics and domain-specific authorization rules.
- In the first public release, the owner assigns app roles to human members. Workspace roles, such as an administrator, may be added later.
- Both humans and agents can hold multiple roles for an app installation.
- Role assignments are scoped to the specific app installation and workspace.
- Apps receive verified identity and role information through an integration with their authentication and authorization boundary.
- Human access resembles “Sign in with Your Space”; agents use non-interactive credentials from the same platform identity model.
- Agents have their own identities, remain distinguishable from humans, and retain their delegating-user relationship.
- App activity identifies the actual actor rather than making an agent appear to be its human owner.

For apps with centralized authorization, the SDK should adapt platform identity and grants into that existing system.
Apps without an authorization boundary will need additional integration; universal zero-change compatibility is not promised.
The protocol, credential types, role catalog format, and mapping APIs remain open.

**Decision update (2026-11-14):** Verified identity, app roles and delegation reach apps that opt
into level 2, built for Your Space with an SDK (see
[platform and independent apps](#platform-and-independent-apps)). Journey 002 delivers level 0 only:
apps keep their own accounts and sign-in, and Your Space controls who reaches them. Level 1, Your
Space as an OpenID Connect provider, likely through Better Auth's OAuth provider plugin, and level 2
are placed with journeys 004, 005 and 007. Some apps keep single sign-on under a commercial license
(the second app, a CRM, does), so level 1 isn't available for every app. This moves app roles and
verified identity for apps out of journey 002.

### Delegation by Exact Role Subsets

A user may assign an agent any subset of the roles currently assigned to that user for the same app installation and workspace.
Your Space compares role identifiers, not inferred permission equivalence or an ordering of “higher” and “lower” roles.
Multiple roles are supported for both the delegating user and the agent.

For example, a user assigned `viewer` and `contributor` can delegate either role, both roles, or neither.
That user cannot delegate `administrator` unless that exact role is assigned to the user.
No role hierarchy is required or implied.

- Removing a role from a user also removes that role from agents receiving delegated access through that user.
- Removing access must affect existing app sessions and credentials, not only future sign-ins.
- Giving a user an additional role does not automatically grant that role to the user's agents.
- Restoring a user's removed role does not define a restoration policy for prior agent grants in this record.
- Restoration, regrant behavior, propagation guarantees, and credential refresh mechanics require a later specification.

The subset rule is about assigned role identifiers; it is not a general proof of semantic permission containment.
Some app authorization systems use deny roles, role combinations, or contextual rules where removing a role can increase effective access.
Compatibility with those semantics remains unresolved and must be addressed in the app contract before claiming bounded effective authority.
The app remains authoritative for resource-level rules, including workspace ownership of its records.

### Member and Agent Removal

**Current scope (2026-11-21).** Agent revocation is part of 005. Member removal and its effects on their agents are deferred to 004 under the [personal dashboard decision](#personal-dashboard-release-boundary).

- Removing a member signs them out everywhere and revokes their app roles, including existing app sessions and credentials.
- Removing a member also revokes access for agents that act on their behalf.
- The member's agents are disabled, not deleted. The owner can delete them later.
- Deleting an agent never makes past app activity untraceable. Your Space keeps a minimal record of the deleted agent, including its name and the member it acted for, and never reuses its identifier.
- A removed member's data in apps stays with the app. Your Space keeps the member's identity as a former member so history still shows who did what; apps decide what happens to their own records.

**Decision update (2026-11-02):** Member removal is part of the first release. It revokes the member's and their agents' access immediately, disables rather than deletes their agents, and preserves attribution for past activity even after agents are deleted. Removal flow, the retained record's contents, and whether a removed member can be re-invited under the same identity belong in the members specification.

### Responsibility and Trust Boundary

Your Space supplies verified identities, role assignments, delegation rules, and revocation state.
The app enforces its role and domain rules for protected operations, regardless of whether a human UI or an agent initiated the request.
The SDK connects those responsibilities without imposing a replacement permission system on every application.

A gateway can support deployment and access control, but mandatory endpoint-to-permission manifests are not the selected integration model.
Installing an app still trusts its implementation with data under that app's control.
Platform isolation must protect platform services and other apps; SDK checks alone do not constrain malicious app code.

- Security and flexibility are the two cornerstones of the app foundation.
- The first public release states plainly, in the documentation and when an owner installs an app, that installing an app trusts it with its own data. Your Space protects itself and other apps from an installed app, but is not a sandbox for hostile code.
- Before publication, a security hardening pass reviews the boundaries between apps and the workspace, enforces them, and protects users as far as Your Space reasonably can.

**Decision update (2026-11-01):** Add install-time warnings, documentation disclaimers, and a pre-publication security hardening pass on app and workspace boundaries, so the isolation work is not mistaken for a sandbox for untrusted code.

**Decision update (2026-11-23):** Every app is on a name under Your Space's, so the browser treats
an app's page as the same site as Your Space and sends the owner's session with its requests. Two
rules keep that from reaching Your Space as the owner. Every route of Your Space's own API that
changes something for the owner, the apps API included, takes the request only when its `Origin`
header is Your Space's exact origin; a request without one is refused, because browsers always send
it from Your Space's own pages, and agents and the CLI don't use the owner's session. The sign-in
and session routes keep Better Auth's own check of the request's origin. And only Your Space can
frame its own pages: its Caddy sends `Content-Security-Policy: frame-ancestors 'self'` and
`X-Frame-Options: SAMEORIGIN` with them, so an app's page can't show Your Space in a frame and steer
the owner's clicks. `'self'`, not `'none'`, keeps the page a pane shows when the browser blocks an
app's cookies, which Your Space frames itself. Apps' own framing rules are unchanged.

### Agent Access Through Your Space

- Agents never call apps directly. Your Space is the API gateway between agents and apps, so every agent request passes its permission checks.
- App containers are reachable only through Your Space and do not publish their own network ports. External apps keep the same guarantee by accepting only requests that carry identity verified by Your Space. (2026-11-19: an app the owner publishes on a port is also reachable through the owner's own network setup; see [running apps and reaching them](#running-apps-and-reaching-them). How agents reach a published app is settled with the gateway in journey 005.)
- People create, view, revoke, and rotate their agents' credentials in the app. Revoking one leaked credential does not change the agent's roles.
- For each agent request, Your Space verifies the agent's credential, confirms the agent holds an active delegation for that app installation, applies revocation immediately, and forwards the request with the verified identity and delegated roles. The app still enforces its own role and domain rules.
- In the first public release, agents use apps through the Your Space CLI with their own credentials. The CLI talks to the gateway, wherever the server runs.
- A workspace MCP endpoint is post-open-source work. It uses the same gateway and permission checks, so off-the-shelf agents can connect with a URL and sign-in.

**Decision update (2026-11-02):** Your Space is the gateway for all agent access to apps, selecting the gateway that the trust boundary above left optional. Agents use the CLI before publication; MCP follows after publication on the same gateway. Whether the gateway also enforces per-action role requirements declared by apps, beyond identity, delegation, and revocation, is decided in the app integration specification; mandatory endpoint-to-permission manifests remain unselected until then.

### Activity Log

**Current scope (2026-11-21).** The owner can review agent requests and attribution in 005. Team and lifecycle events follow with the corresponding journeys. Earlier release dates and requirements below are superseded where they differ from the [personal dashboard decision](#personal-dashboard-release-boundary).

- Your Space records workspace activity: app installs, removals, and updates; role changes and delegations; member changes; and every agent request through the gateway, with the actual actor.
- The owner can review the log. It stays available but out of the way, following the [simple-by-default principle](#product-experience-principles).

**Decision update (2026-11-02):** An activity log is part of the first release, so the owner can see what happened in the workspace and what agents did. Retention, detail level, and who besides the owner can view entries are decided in a specification.

## Later Candidate Journeys

After the owner-access feature and an agreed app contract, a small Tasks app is the first app and the end-to-end integration slice.
That journey would install the independent app, create and view a task, retain it after restart, and expose permitted operations to an agent.
Verification would cover identity attribution, denied operations, and revocation across UI and programmatic access.
It follows the app UI and sign-in specification, the CLI, and an agreed app contract, and is not an app implementation included in the current feature.

**Decision update (2026-10-31):** The small Tasks app is selected as the first app, replacing its candidate status. It is small, needs a database, and exercises roles (viewing and editing tasks) and agent access (an agent creating tasks), covering each part of the first-release app journey. Its needs set the initial approved list of Compose settings. (Superseded 2026-11-14 by an existing open-source app; see below.)

**Decision update (2026-11-14):** The first app is an existing open-source personal finance app,
installed unchanged from its own example Compose file. This supersedes the Tasks app written for
Your Space as the first app. Real apps' Compose files are written for people, not for Your Space,
and running one unchanged is the point of journey 002. The first app has web, worker, database and
Redis services and plain-text secret defaults, so it exercises start order, volumes and generated
secrets. The second app is an existing open-source CRM, whose Compose file uses the same service
names as the first app's, so the two show apps kept apart. The Tasks app moves out of journey 002
with app roles and the TypeScript SDK; whether a later journey still builds it, for example to show
roles and agent access in journey 005, is open.

External agents come before platform-hosted agent execution.
Later hosted agents could run workflows such as daily triage through the same identity and authorization contracts.
Identity and permissions remain independent of any model provider or execution runtime.
No hosted workflow engine or model-provider integration is selected here.

## First Public-Release Direction

**Current scope (2026-11-21).** The release includes the browser dashboard, the two macOS desktop entry paths, an independent app installed from a kit and a real external agent completing authorized work. The older audience and scope below are historical. Earlier release dates and requirements below are superseded where they differ from the [personal dashboard decision](#personal-dashboard-release-boundary).

**Decision update (2026-10-29)**: Plan the roadmap in pre-public and post-public sections. The pre-public section covers the core experience and a working first version; post-public covers capabilities that are not crucial to that release. The owner prefers an installable, usable product before making the repository public rather than publishing only plans.

The intended pre-public experience includes owner setup; additional members signing up through invitation links created and shared by the owner; the installation CLI for servers and local workspaces; a desktop app that can also run a local workspace; web, desktop, and PWA workspace clients; at least one installed independent app; a way for developers to create, integrate, and install more apps; and access for external agents through the Your Space gateway and CLI. It also includes built-in backup, restore, and moving a workspace between installations (since 2026-11-14 a backup and restore the person does themselves); owner-triggered Your Space and app updates that roll back automatically if they fail; app roles; member removal; an activity log; built-in HTTPS; uninstall; and signed desktop releases. Only the owner installs or removes apps in the first public release. The first release targets users who can install Docker Desktop and the Your Space desktop app for a local workspace, or install Docker and follow a guided CLI for a server or a local workspace. (Since 2026-11-14 the local group needs no Docker Desktop; see [installation and hosting](#installation-and-hosting).)

This is a developing release roadmap, not a complete acceptance specification or a claim of implementation. Additional requirements may emerge during specification. These future capabilities do not expand the owner-only first feature. The agreed sequence is manual Compose and owner access (spec 001) first, then the app UI and sign-in specification, then the CLI specification and implementation; the remaining pre-public items have no set order beyond their priorities.

### Journey-Based Specifications

**Current scope (2026-11-21).** 001–003 supply the foundation. Both 005 agent access and 008 macOS desktop entry must pass before release. (2026-11-23: so must 013, the workspace redesign; see the [personal dashboard decision](#personal-dashboard-release-boundary). Superseded in part the same day: the first alpha needs only 013's theme format version 2, and the rest of 013 follows in alpha.2.) Journeys 004, 006, 007 and the rest of 008 follow publication. Earlier release dates and requirements below are superseded where they differ from the [personal dashboard decision](#personal-dashboard-release-boundary).

**Decision update (2026-11-02):** Pre-public work is specified as eight user journeys rather than one specification per roadmap capability. Each journey follows a person from where they start to a result they can see, so one specification covers many roadmap items and is tested the way people will use it. The [spec map](https://github.com/your-space-ai/your-space/blob/main/specs/README.md) lists the journeys, what each covers, and the build order.

- The build order is 001 set up my space ([spec](https://github.com/your-space-ai/your-space/blob/main/specs/001-workspace-owner-access/spec.md)), 002 install an app and use it, 003 install and run with the CLI, 004 invite my team, 005 let my agent work for me, 006 keep my space safe over time, then 007 build my own app and 008 use Your Space as an app on my computer in parallel.
- The app UI and sign-in specification becomes part of 002, which ends with the Tasks app working inside Your Space. It still comes before the CLI, so app origins are settled before the CLI sets up HTTPS. If 002 proves too large, it can split into opening an app inside Your Space and installing an app from a URL. (2026-11-14: 002 ends with an existing open-source app working inside Your Space, and is delivered in slices instead of split; see below.)
- The app contract defines app roles in 002, although only the owner exists then, so 004 adds role assignment without changing the contract. (Superseded 2026-11-14: app roles come with level 2 integration in a later journey; see [identity and app-owned roles](#identity-and-app-owned-roles).)
- The activity log arrives with agents in 005, since reviewing what agents did is its main purpose. App installs and member changes are logged from then on.
- The app database moves from Medium to High, because the Tasks app in 002 needs one. (2026-11-14: the existing app that replaces Tasks needs one too, so it stays High.)
- Maintainers review security, privacy and legal requirements across the finished journeys using the [packaged release guide](../maintainers/releasing.md). (2026-11-23: the legal part is the guide's distribution-rights and notices check, without a counsel review; see [project license and business model](#project-license-and-business-model).)
- Every specification follows shared rules from the start: simple by default, no telemetry, ARM and Intel images, all durable state in the database or named volumes, the actual actor credited from the first schema, and its own docs and security tests. (2026-11-14: ARM and Intel applies to Your Space's own images; apps need only the engine's processor type.)

This refines the sequence above without changing scope: it groups existing pre-public items into journeys and orders the work after the CLI.

**Decision update (2026-11-08):** A journey is delivered as a stack of pull requests into `main`. The first carries the specification and its supporting documents (plan, research, contracts, and the task list) with no task checked. Each later one adds one layer that passes its own checks, checks only the tasks it verifies, and checks roadmap items only for what it delivers. A spec on `main` describes agreed design; only checked tasks, checked roadmap items, and the verification record claim delivered work, so a spec never claims work that doesn't exist yet. This supersedes the earlier wording that the CLI or streamlined local setup gets its own implementation PR; each is specified in its journey (2026-11-02) and delivered the same way.

**Decision update (2026-11-10):** In a stack, code lands with its first use: each file, top-level function or component, script, and configuration entry arrives in the first pull request where something runs it (code that runs, a test, CI, or the deployment) or where a developer first needs it to run, develop, or test the app. Code inside a function is not split across pull requests, so error paths and event handlers land with their function. Anything that would land earlier moves up. Code that lands before it runs can't be checked by its own pull request, and reviewers end up judging it without seeing it work. Added to the constitution's Development Workflow (version 1.3.0).

**Decision update (2026-11-10):** Claude reviews each pull request through the Claude Code GitHub Action when it is opened or marked ready, and again when someone with write access comments `@claude review`, such as after a fix round. It reports bugs, security and data-integrity problems, and breaks of the project's rules, checked against the constitution, this record, and the journey's spec and plan, and skips style; its guide is `.github/code-review.md`. Its findings are review comments, resolved before the pull request merges, and it changes no code. While the repository is private it runs on the owner's Claude subscription, so reviews add no cost and draw on that subscription's usage limits. The alternatives cost more for how often this project pushes: Greptile charges a credit per review beyond a small free allowance, Copilot code review spends credits on each review, and CodeRabbit adds a monthly seat price with hourly limits. Claude also writes much of this code, so its review is a weaker second opinion than an independent reviewer's, and GitHub doesn't give the subscription token to workflows for pull requests from forks. Before the repository is public, review therefore moves to the free open-source plan of Greptile or CodeRabbit, which reviews contributors' pull requests too. (Superseded 2026-11-22: [PR #81](https://github.com/your-space-ai/your-space/pull/81) removed the Claude Code review workflow from this repository, so neither it nor `@claude review` runs on its pull requests.)

**Decision update (2026-11-18):** Claude's review runs when a pull request is opened, drafts included, and no longer again when a draft is marked ready. A draft runs only the GitHub Actions checks; CircleCI's browser tests, Arm checks and Argos screenshots start when it is marked ready, through CircleCI's "PR marked ready for review" trigger. Reviewing the draft lets its findings be fixed before those runs, which cost CircleCI credits and Argos's screenshot allowance. A pull request stays a draft until its reviewer is ready for it, and `@claude review` asks for another review after a fix round. (The parts about Claude's review are superseded 2026-11-22; see the 2026-11-10 review entry above.) (Refined 2026-11-26: a pull request stays a draft until it is complete and its review is clean; see the 2026-11-26 entry below.)

**Decision update (2026-11-10):** Pull request descriptions follow one template (`.github/pull_request_template.md`) that shows a reviewer only what they need first: a summary, where to look, and the decisions they must make; the results of CI, code review and visual evidence stay in the pull request's checks rather than being copied into the text. Everything else, such as the stack, spec links, file-by-file contents, task ticks, check commands and review fixes, sits in collapsed sections. Journey 001's stack descriptions grew past 20,000 characters each, so the few decisions a reviewer had to make were buried in detail; the detail stays available but collapsed. The template and `AGENTS.md` guide this; no check enforces it.

**Decision update (2026-11-10):** CircleCI runs the checks on Linux on Arm (aarch64), the second architecture Your Space ships images for, while GitHub Actions covers x86_64: the server's checks from the first code layer, and the whole Compose stack with the browser journeys in Chromium once the stack exists. Its macOS and Windows machines are left for the desktop app, since they can't run the Docker stack. CircleCI's free plan covers this while the repository is private (30,000 credits a month); it builds pull requests from forks without the project's secrets, and the jobs need none.

**Decision update (2026-11-10):** CI produces the visual evidence for every pull request, so neither contributors nor maintainers take screenshots or keep evidence branches. The browser tests screenshot each user-story step, and CI uploads the screenshots to Argos, a hosted visual-testing service whose code is open source (MIT). Argos compares them with the screenshots from `main` and posts a check and a comment on the pull request, where a person approves or rejects each visual change. Uploads authenticate with GitHub's OIDC token, and pull requests from forks, which get no token or secrets, fall back to Argos's tokenless check of the running workflow, so contributors' pull requests get the same evidence and no secret is exposed. Each run also keeps the Playwright report with a video of every journey as a CI artifact for 7 days. (Superseded 2026-11-21: CI keeps no report or video artifacts; see the public source preview entry below.) Argos takes uploads from GitHub Actions only, so every screenshot it compares comes from the same x86_64 runners; the Arm journeys on CircleCI check behaviour, not looks. Screenshots hold only test data. Workflows never use `pull_request_target`, and the Argos check is not required to merge at first, so an Argos outage blocks nothing. Argos's hosted service is used rather than self-hosting it, which needs AWS, PostgreSQL, RabbitMQ, Redis, S3, and DynamoDB; self-hosting stays the fallback because the code is open. Alternatives considered: Playwright's own screenshot comparison with baselines committed to the repository (no service, but images in history and no review step); Percy and Happo (no fork-safe upload without a secret); and Chromatic (its free open-source plan covers only UI libraries and design systems).

**Decision update (2026-11-10):** While the repository is private, CI spends its limited GitHub Actions minutes once per stack of pull requests instead of once per pull request. Only the pull request based on `main` runs the browser tests and the Compose setups checks; the ones above it run the typecheck, server tests and build, and get the browser tests when they reach `main`. Pushes to `main` run only the check job, since the pull request they merge has just run the rest on the same code. Every job has a time limit, so a stuck run can't use up minutes, and the browser tests' reports are kept 7 days, which covers a review and stays within the plan's artifact storage. A newer push to a pull request cancels its running CI, and pull requests that change only docs or specs skip CI, except the installation guide, which a browser test checks. Restacking a journey's stack reran the full suite on every pull request in it and used a month's minutes in a day; the browser tests are most of each run. Contributors run the checks locally before pushing. Once the repository is public, Actions minutes are free and every pull request runs the browser tests again. (Superseded 2026-11-21 in part: no reports are kept, and a pull request that changes only Markdown files, `docs/`, `specs/` or `.specify/`, the installation guide included, still runs Contribution checks and verifies sign-offs but skips the code checks.)

**Decision update (2026-11-10):** The image workflow builds and publishes the server and web images on a release, or when started by hand, not on every push to `main`. Building the ARM image through emulation is slow, and every merge would rebuild both images while Actions minutes are limited. So there are no `edge` images from `main` between releases; nothing uses them, since the installation guide downloads releases. (Superseded 2026-11-22: since [PR #83](https://github.com/your-space-ai/your-space/pull/83), Release images builds and pushes the server, web and runtime images only when the hand-started Release draft workflow calls it, before the release is published.) (Superseded 2026-11-25: every push to `main` publishes a canary build, with its images; see the next entry.)

**Decision update (2026-11-25):** Canary builds. At the owner's request, every push to `main` publishes a canary build, so the owner can run `main` before a release, as Next.js publishes `next@canary` and Gitea `gitea/gitea:nightly`. This supersedes the 2026-11-10 choice above to publish no images from `main`. Its reasons no longer hold: GitHub-hosted Arm runners build the ARM images natively instead of through emulation, and standard GitHub-hosted runners, Arm included, are free in public repositories ([runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)). Until now the only way to run `main` was to build it locally ("Test from reviewed source" in the operator setup guide).

- The Canary workflow reuses the release workflows: Release images, now building each processor's image on a runner of that architecture for releases and canaries alike, Release CLI, and Release install test. Only after the install test passes does it replace the files of one rolling GitHub prerelease, tagged `canary` (the CLI downloads, the npm package's tarball, the Compose bundle and `SHA256SUMS`), and only once they are published does it point the images' moving `canary` tag at the build. It never moves `latest`, publishes nothing to npm and builds no Mac app. (2026-11-25: from alpha.2 it also uploads Canary's `channel.json`, and a daily workflow adds Mac canaries to the same prerelease; see [Your Space updates, backup, and restore](#your-space-updates-backup-and-restore).) (2026-11-25: built in [PR #135](https://github.com/your-space-ai/your-space/pull/135). `channel.json`, from `deploy/channel-json.sh`, names the build's version and commit. It is deleted with `SHA256SUMS` before any upload and uploaded last, once the published files and `SHA256SUMS` pass their check, and only then do the tags move. The workflow checks and deletes only its own files on the prerelease, so a Mac canary's stay, and it stops before changing any if the prerelease holds `latest-mac.yml`, which no canary release may carry. A run that fails in between leaves the prerelease without either file, so installs and upgrades from it stop with nothing changed until **Re-run failed jobs** finishes it.)
- A canary's version is the release it follows, then `canary`, the build's UTC date and a build number: `0.1.0-alpha.1.canary.20261125.42`, or after a stable `0.1.0`, `0.1.1-0.canary.20261125.42`. It sorts after that release and before any later one, since a release's prerelease is always a numbered alpha or beta, such as `alpha.2`; Release draft refuses others, such as `alpha` or `alpha.2.1`. `upgrade` keeps moving an installation to its CLI's own version, as decided on 2026-11-24, so moving onto a canary is getting a canary's CLI and running its `upgrade`; going back to releases is the next release's `upgrade`, an ordinary one. No release's CLI ever moves an installation onto a canary, and there is no channel setting or flag. (Superseded in part 2026-11-25: the Mac app gets a channel setting and `upgrade` a `--channel` flag; see [Your Space updates, backup, and restore](#your-space-updates-backup-and-restore).) The suggested `0.1.0-canary.<date>.<n>` was not used: it sorts after every `0.1.0` alpha and beta, so no alpha or beta could upgrade an installation that had run one.
- One rolling prerelease rather than one per build, so Releases holds one canary entry, updated in place without notifying watchers; its tag follows the build where GitHub lets the workflow's token move it. Its tag isn't a version, so the alpha.1 Mac app's updater (electron-updater) skips it, and GitHub never treats a prerelease as the latest release. Release publish runs only for `v` tags, Release draft leaves Canary's check runs out of its gate, and the generated release notes start at the previous version tag. The rolling prerelease needs its files and tag replaced, so the repository's immutable releases setting must stay off while it exists; turning it on would need canaries to move elsewhere, such as GHCR.
- Canaries are unreleased and unsupported, and nothing offers one in place of a release: the installation guide, `upgrade` with a release's CLI and the Mac app only ever offer releases. (2026-11-25: from alpha.2, the Mac app and `upgrade --channel` offer canaries to an owner who chooses Canary; canaries stay unsupported.) The [canary page](../install/canary.md), listed with the installation pages and linked from "Test from reviewed source" in the operator setup guide, says how to move an installation onto one and back.

**Decision update (2026-11-11):** Pushes to `main` run the browser tests again, superseding the part of the 2026-11-10 decision that ran only the check job there. Argos compares a pull request's screenshots with the closest approved build in `main`'s history, and builds on `main` are approved automatically. Pull requests are squash-merged, so a pull request's own build is not in that history, and with no build on `main` every pull request showed all its screenshots as new instead of only the ones it changed. Pushes to `main` still skip the Compose setups checks, which the merged pull request has just run on the same code.

**Decision update (2026-11-11):** The browser tests run on CircleCI instead of GitHub Actions, superseding where they ran in the decisions above. CircleCI's plan allows far more build time than the private repository's Actions minutes, and the browser tests were most of each GitHub run; as journeys add tests, they would have used up the minutes after a few more journeys. The stack rule stays: the job runs on pushes to `main` and on the pull request based on `main`, and stops after its first step on the ones above it, so a restack runs the browser tests once. GitHub's webhook names `main` as the base of every pull request in a stack, so the job reads the pull request's own base from GitHub's API with a read-only token kept in CircleCI's settings (`GITHUB_PR_READ_TOKEN`), and CircleCI's "auto-cancel redundant workflows" stops a run when a newer push replaces it. The job runs on CircleCI's x86_64 Linux machine, the only job that uploads to Argos (`YS_ARGOS_UPLOAD`), authenticated with a project `ARGOS_TOKEN` kept in CircleCI's settings, so Argos still compares one environment's renderings. CircleCI keeps the Playwright report and videos as job artifacts (superseded 2026-11-21: it keeps none; see the next entry). The browser install step stops after 10 minutes, after an unreachable package mirror held it for 25 minutes on GitHub. GitHub Actions keeps the typecheck, server tests and build on every pull request, and the Compose setups checks on the pull request based on `main`. CircleCI doesn't pass secrets to pull requests from forks. At the time of this decision, visual comparison for forks remained open.

**Public source preview (2026-11-21).** GitHub Actions reports one required contribution check for
all pull requests, including documentation. Code changes run the workspace checks and Compose
checks. In a public repository they also exercise owner setup, kit grants and approvals in
Chromium on a GitHub-hosted runner. This gives forks a browser check without CircleCI or Argos
credentials. CircleCI retains the broader browser matrix for first-party development. Hosted
checks report test results in job logs. CircleCI omits automatic HTML reports, raw test-result
artifacts and videos. Its configured Argos project receives the selected synthetic screenshots.
(Superseded in part 2026-11-23: CircleCI keeps a failed journey's screenshot and error context;
see the next entry.)

**Decision update (2026-11-23):** CircleCI keeps what explains a failed browser journey. A failure
that shows only on CircleCI, such as one in WebKit on `main`, otherwise left only the error in the
job log: the job kept neither the screenshot Playwright took at the failure nor its error context.
Both browser jobs now store, for each failed test, that screenshot and Playwright's error context
(`error-context.md`: the error, the page's accessibility snapshot and the test's source) as job
artifacts. They hold only the test stack's synthetic data and this repository's test code. Passing
tests store nothing, and CircleCI still keeps no HTML report, no videos and no other test results.
Playwright traces stay off, because recording one adds work around every action and can hide
timing races in the app: the WebKit theme import failure that showed in 3 of 29 untraced runs passed
all 68 traced ones.


**Decision update (2026-11-19):** CircleCI's browser tests take less time on pull requests, superseding the stack rule of the decision above for them. A pull request runs the journeys, and installs the browser, in Chromium only, whose screenshots Argos compares; pushes to `main` run them in Chromium, Firefox and WebKit, so a bug only Firefox or WebKit shows can surface after the merge, which is accepted for quicker pull request runs. Every pull request in a stack runs the browser tests once it is ready for review, not only the one based on `main`, so its results come before the ones below it merge; drafts still skip them. A pull request whose commit has the same git tree as an earlier passing run of the job in the same browsers doesn't run them again: a passing run leaves a marker in CircleCI's cache, keyed by the tree, and a later run that finds it stops successfully after checkout. So a pull request rebased onto `main` after the one below it merged unchanged, or given a new sign-off, doesn't rerun them, while a change to any file does; `main` always runs them in full. A skipped run uploads nothing to Argos, so its commit gets no Argos check rather than a failed one: the Argos check isn't required to merge, and the earlier run's build has the same screenshots, though compared with `main` as it was then, so after the pull request below merges, the skipped one has no build compared with the new `main`. Argos's `skip` command, which marks a commit's check as passed, isn't used, since it would show a pass while that earlier build may still wait for a decision. CircleCI's free plan stays: the job keeps its machine size and runs without parallelism. GitHub Actions keeps the Compose setups checks on the pull request based on `main`.

**Decision update (2026-11-26):** At the owner's request, a pull request goes through review as a draft, and a ready pull request runs the browser tests only once. A pull request is opened as a draft and stays one until it is complete, code and implementation, and every CodeRabbit finding is fixed or answered with its thread resolved; only then is it marked ready, which starts CircleCI's browser tests. On a ready pull request only browser test failures are fixed; a new review finding, a design change or more implementation turns it back into a draft until it is done, then it is marked ready again. This refines the 2026-11-18 rule that a pull request stays a draft until its reviewer is ready for it. Each round of fixes on a ready pull request cost another 30 to 45 minute run, and agents and maintainers waited for it after every fix. CodeRabbit now reviews drafts, and pull requests based on branches other than `main`, such as the ones in a stack, through `.coderabbit.yaml`; it reviewed neither by default. Agents follow the [pr-review-flow skill](https://github.com/your-space-ai/your-space/blob/main/.agents/skills/pr-review-flow/SKILL.md).

- CircleCI's browser tests and Arm checks on a branch other than `main` also stop, as passed, when only CI configuration or documentation (`.github/`, `.circleci/`, `*.md`, `docs/`, `specs/`, `.specify/`) changed since the job last passed on that branch, refining the 2026-11-19 same-code rule above. A passing run saves its commit in CircleCI's cache under a key for the job and branch, and the next run restores the newest one. It stops only when that commit is in the new commit's history and nothing else changed since; a rebase onto a moved `main`, a force push, or a change to any other file runs the job as before. A run skipped because its code already passed saves no commit, so a documentation change right after such a run, such as after a rebase, runs the job in full. `main` always runs both. Test-relevance filtering and splitting the browser tests across machines were not adopted.

**Decision update (2026-11-14):** Journeys are delivered in slices: one specification for the
journey, then one pull request per slice in a stack, each ending with something the owner can see
working, tested end to end in the browser, and later slices build on it without reworking it. The
spec orders its slices by what each needs. This refines the 2026-11-08 stack rule, whose later pull
requests each added a layer that passed its own checks, so that a reviewer sees each piece
working. Journey 002's ten slices are listed in its
[spec](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/spec.md#slices-and-their-dependencies).

**Decision update (2026-11-14):** At the owner's request on 2026-11-14, a journey is built end to end
on one branch first, then split into its stack of pull requests in slice order. This refines the
slices decision above for how the stack is produced; each pull request in the stack still follows
the slice and code-lands-with-first-use rules. The request gave no further rationale; journey 002
is the first built this way.

**Decision update (2026-11-14):** Journey 002 ends with an existing open-source personal finance app
working inside Your Space: installed from its own Compose file, opened in a pane on its own origin
behind the access gate, with a second app, a CRM, beside it. It covers running apps' containers,
installing from a GitHub link with installation kits, settings and secrets, outbound access
requests, isolation, limits, status and logs, removal with retained data, and an Engine page showing
the engine connection and its resources. App roles, verified identity for apps and the TypeScript
SDK move to the journeys that bring levels 1 and 2 (004, 005 and 007). This supersedes the bullets
above that 002 ends with the Tasks app and defines
app roles. The [spec map](https://github.com/your-space-ai/your-space/blob/main/specs/README.md) and [roadmap](../roadmap.md) follow it.

## Choices Still Open

| Area | Current status |
| --- | --- |
| Client supporting libraries | TanStack Router, TanStack Query, plain CSS, and no component library are selected in the [001 plan](https://github.com/your-space-ai/your-space/blob/main/specs/001-workspace-owner-access/plan.md). A design system is open for the later interface design spec. |
| Database configuration | PostgreSQL 18 with Drizzle and `pg`; Drizzle Kit migrations applied at server startup. Settled in the [001 plan](https://github.com/your-space-ai/your-space/blob/main/specs/001-workspace-owner-access/plan.md). Recovery from a failed migration belongs with update rollback in spec 006. |
| Authentication configuration | Better Auth with its organization plugin; password rules, lifetimes, attempt limits, and adapter configuration are settled in the [001 plan](https://github.com/your-space-ai/your-space/blob/main/specs/001-workspace-owner-access/plan.md). |
| Initial deployment details | macOS and Linux with manual Docker Compose are selected. HTTPS comes from a Caddy reverse proxy in the Compose stack, delivered in the owner-access feature, with automatic certificates for an owner-provided domain, a bring-your-own-proxy option, and documented tunnel guidance; plain HTTP is supported only on this machine, at `space.localhost` since 2026-11-14. Host versions (Docker Engine 28.3.3 and Compose 2.26.0 or newer), the one-line setups, and generated platform secrets are settled in the [001 plan](https://github.com/your-space-ai/your-space/blob/main/specs/001-workspace-owner-access/plan.md); support claims wait for verification on real hosts. |
| Desktop app | [008](https://github.com/your-space-ai/your-space/blob/main/specs/008-desktop-entry/spec.md) ships signed, notarized Electron disk images for Apple Silicon and Intel on GitHub Releases. Owners drag the app into Applications. Private previews use ZIP archives. For a local workspace it drives the CLI with the chosen Docker engine. For an existing server it opens the dashboard at the owner's URL. It updates itself from GitHub Releases, and quitting it stops its local workspace (2026-11-23). The later desktop scope covers Windows and Linux, the bundled VM, version compatibility and lifecycle tools. |
| CLI delivery | Specified in [spec 003](https://github.com/your-space-ai/your-space/blob/main/specs/003-install-with-the-cli/spec.md) (2026-11-17): the `your-space` command, `init` then `start` in a folder, from npm and standalone Linux executables (Linux packages are not part of a release since 2026-11-22; see the [CLI delivery sequence](#cli-delivery-sequence)); Linux first, the CLI used by the Mac desktop in 008, standalone macOS packaging after publication, and Windows with the later desktop work. Update, backup, restore and uninstall come with journey 006; uninstall removes managed app containers and keeps data unless the owner confirms deletion. Agent commands come with journey 005. |
| Your Space updates and backup | Failed Your Space updates roll back automatically using the pre-update snapshot mechanism shared with app updates. Failed-update detection and snapshot details need definition. Backup and restore are scheduled after publication, and moving between installations is a backup and restore the person does (2026-11-14); whether a remote backup goes through the client or a credential issued there (2026-11-17), restore into a broken or fresh installation, and backup format and protection remain open. |
| Member and agent removal | Removal revokes the member's and their agents' access, disables their agents, and keeps former members and deleted agents traceable in past activity. Removal flow, retained record contents, and re-invitation need definition in the members specification. |
| Member password recovery | A recovery code at signup, with an owner-issued temporary password as the fallback, is selected. Code count and replacement, and temporary-password lifetime, need definition in the members specification. Optional owner-configured email resets are post-open-source. |
| Public launch scope | The [personal dashboard decision](#personal-dashboard-release-boundary) sets the scope. The [packaged release guide](../maintainers/releasing.md) lists the evidence required. |
| App UI execution | Apps open in panes, side by side on larger screens: cross-origin iframes in the web client and PWA, native views in the desktop app. Each app is at `<app>.<Your Space's address>` behind Caddy's `forward_auth` gate, with no port fallback; Caddy replaces framing headers, and apps keep their own sign-in (2026-11-14). The platform session is a `__Host-` cookie over HTTPS and host-only on the plain-HTTP local setup, where WebKit opens apps in their own tab. An app can also be published on a port of this machine for the owner's own proxy or tunnel, and is then reached at the owner's link, outside the gate (2026-11-19); Your Space shows it there in its pane, where the app's own Caddy lets only Your Space frame it, unless the owner turns that off for the app (2026-11-20). On Tailscale the owner creates one Tailscale Service per published app. Shell-to-app messages remain open; Safari on macOS is still to check. |
| Project license | AGPL-3.0-only for the platform and MIT for future SDKs, with outside contributions under the DCO. The quiet source preview (2026-11-21) and packaged prereleases, starting with the alpha (2026-11-23), ship without counsel review. Trademark filing, the policy for forks, and counsel review before a later release remain open. |
| Telemetry | None. Update checks to GitHub, which the owner can turn off, are the only automatic outbound requests planned apart from the built-in proxy's certificate requests for an owner-configured domain, which are part of HTTPS setup (2026-11-03); the Mac app's is the only update check so far (2026-11-23). Future reporting must be opt-in; opt-out is prohibited. |
| External apps | Apps can be managed or hosted elsewhere. An app someone already runs is added through a connector that connects out to Your Space and plugs into the app endpoint (2026-11-14). The connector, and whether such an app must also verify Your Space identity, need definition in a later specification. |
| App settings, egress, and limits | Settled in the [002 plan](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/plan.md) (2026-11-14): settings encrypted in the server's database; outbound access through a Squid proxy per app, with kits' starter hosts and owner-approved access requests; fixed default limits a kit or the owner can change. What the owner sees and sets for generated secrets in the review, limits that scale with the space's resources, and an "all internet" option remain open. |
| Activity log | Records installs, role and member changes, delegations, and agent requests. Retention, detail, and viewers need definition. |
| Version compatibility | Supported desktop app, CLI, and server version combinations and the mismatch message need definition. |
| Agent access | Agents reach apps only through the Your Space gateway, using the CLI in the first release; a workspace MCP endpoint is post-open-source. Journey 005 defines [gateway requests](https://github.com/your-space-ai/your-space/blob/main/specs/005-owner-agent/contracts/gateway.md) and [kit-declared routes and roles](https://github.com/your-space-ai/your-space/blob/main/specs/005-owner-agent/contracts/kit-agent-access.md). |
| App identity protocol | Apps keep their own sign-in in journey 002 (level 0). Level 1 is OpenID Connect with Your Space as the provider, likely through Better Auth's OAuth provider plugin; the protocol for level 2 and where each level lands are settled with journeys 004, 005 and 007. |
| App integration | TypeScript and Python SDKs are planned for post-public journey 007, for apps that opt into level 2; other languages are post-open-source. Neither is part of journey 002 (2026-11-14). Role registration, authorization compatibility, and revocation mechanics need a later specification. |
| App deployment file | The app's own Compose file, with an optional installation kit from a separate repository, replaces a Your Space-specific file with an `x-your-space` section (2026-11-14). The owner installs by pasting the file's GitHub URL. Since 2026-11-23 the kit is required: it is the app's definition, and the owner installs by pasting the kit's link ([Kits define apps](#kits-define-apps)). The approved settings list and the kit format are set in the [002 plan](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/plan.md) and its contracts. Source builds and alternative formats are post-open-source. |
| App runtime and data | Designed in the [002 plan](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/plan.md) (2026-11-14): a runtime manager with no network alone holds the engine socket; each app is a Compose project on a sealed network with its own egress proxy and named volumes; removal keeps data until the owner deletes it. Verification is journey 002's delivery. Engines on other machines, apps someone already runs, and server hardening (Sysbox, rootless Docker) are later work. Found in journey 003 (2026-11-17), and settled by [spec 009](https://github.com/your-space-ai/your-space/blob/main/specs/009-encrypt-stored-data/spec.md): apps' settings are encrypted with a data key of their own, a third generated secret, so replacing the auth secret only signs people out. Encrypting the whole database or its disk stays the owner's responsibility for now; the guide recommends disk encryption on the host. |
| App distribution | Installation from the app's own Compose file's GitHub URL, exact commit recording (with the kit's commit), and images pinned by digest are accepted for initial installation. Since 2026-11-23 the owner installs from the kit's link, and the kit names the Compose file ([Kits define apps](#kits-define-apps)). 011 pins compatible owner-confirmed replacements, retains the existing volumes and restores previous artifacts on startup failure (deferred 2026-11-23 until after the alpha; see [Creator workflow deferred](#creator-workflow-deferred)). General upstream and automatic updates, backup-based data recovery, and multiple catalogs remain future work. |

These open choices do not erase the accepted requirements above.
Resolve implementation-critical choices in the relevant technical plan and future app-contract decisions in their own specifications.


## Named multi-app views and sidebar order

On November 21, 2026 the owner selected columns, rows, a grid and a main app with companions. The dashboard accepts pointer, touch and keyboard input on the interior dividers. Resizing preserves the embedded app documents. Narrow screens show one member of the open composition at a time.

The workspace server owns named views and the owner's app shortcut order. A saved view identifies its apps in order and includes the arrangement and the proportions along both axes. Updating its contents is an explicit action. A composition URL may carry those same values directly. (Superseded 2026-11-23: the preset choice, composition URLs with a layout and sizes, sizes remembered in the browser and reordering shortcuts are gone; apps opened together are laid out by count, and saved views keep theirs. See [Alpha scope](#alpha-scope).) The dashboard resolves app names against the selected server's installed apps and uses their current pane or link rules. [Layout journey](https://github.com/your-space-ai/your-space/blob/main/specs/012-multi-app-layouts/spec.md)
