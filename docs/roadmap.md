---
title: "Your Space roadmap"
---

The first packaged release is for one person running a personal dashboard. Set it up on your Mac or connect to a Docker server, install apps using kits, and choose what your AI agents can do in each app. You can try the [0.1.0-alpha.1 alpha](install/index.md) or [run it from source with Docker](install/from-source.md). The open items below, the release checks among them, are still to be done.

## Reading the roadmap

<a name="overview"></a>
<a name="what-is-already-on-main"></a>
<a name="core-experience-and-first-packaged-release"></a>
<a name="post-public-later-direction-and-enhancements"></a>
<a name="deferred-from-the-first-release"></a>
<a name="other-later-directions"></a>

Each branch puts the work on `main` beside the checks and plans for that part of the product.

- **Checked** means the feature was implemented and verified in the environment named in the item. The date and link point to the evidence.
- **First packaged release** marks the scope of the first packaged version. Open checkboxes identify the remaining work, including checks that need the signed downloads or an independent installation.
- **alpha.2** marks first-release work parked for the second alpha prerelease (owner decision, 2026-11-23). The first alpha ships without it.
- **Deferred journey** marks numbered work moved beyond that release. **Later direction** marks other future work, including ideas still under consideration. Their order and timing are open.

| Product area | Branches |
| --- | --- |
| [Dashboard and desktop](#dashboard-and-desktop) | [App panes and saved views](#app-panes-and-saved-views) · [Themes](#themes) · [Desktop clients](#desktop-clients) |
| [Apps and kits](#apps-and-kits) | [Installation and isolation](#installation-and-isolation) · [Custom apps and sources](#custom-apps-and-sources) · [Integration contracts and SDKs](#integration-contracts-and-sdks) |
| [AI agents](#ai-agents) | [Roles and approvals](#roles-and-approvals) · [Agent connections and workflows](#agent-connections-and-workflows) |
| [Workspace and hosting](#workspace-and-hosting) | [Local and server setup](#local-and-server-setup) · [Backups and updates](#backups-and-updates) · [Deployment options](#deployment-options) |
| [Accounts and access](#accounts-and-access) | [Owner access](#owner-access) · [Members and recovery](#members-and-recovery) |
| [Releases](#releases) | [Verification and publication](#verification-and-publication) |

## Dashboard and desktop

### App panes and saved views

- [x] **Arrange installed apps (012).** Resize columns, rows, grids and main-with-companion layouts. Share a composition link, reopen saved panes at their original sizes, reorder sidebar apps and switch between them on a phone-sized display. Chromium covered mouse, touch and keyboard input. (2026-11-21, [PR #71](https://github.com/your-space-ai/your-space/pull/71)) [Layout journey](https://github.com/your-space-ai/your-space/blob/main/specs/012-multi-app-layouts/spec.md) Journey 013 replaces this view behavior when it lands; 012's storage, sharing and permission rules still apply. **Removed (2026-11-23, [alpha scope](architecture/decisions.md#alpha-scope)):** the layout preset choice, the composition link with its layout and sizes, sizes remembered in the browser and reordering sidebar apps; apps opened together are laid out by count, and saved views keep their layout and sizes.
- [ ] **Sidebar, tabs, views and Home (013)** · *alpha.2*. A sidebar that collapses to an icon rail, apps that open as tabs beside Home, and views that merge tabs and lay out their apps by count. Swap, move and resize panes, act from each pane's menu, and save views. Home is a launcher that shows what needs the owner and each app's status, and Settings opens as a list of sections. [Workspace redesign journey](https://github.com/your-space-ai/your-space/blob/main/specs/013-workspace-redesign/spec.md)

<details>
<summary>Verified app panes and browser behavior (002)</summary>

- [x] Open installed apps within the Your Space interface while platform navigation remains available. (2026-11-17, [PR #27](https://github.com/your-space-ai/your-space/pull/27))
- [x] Preserve normal frontend requests to the app backend without requiring each request to be rewritten for Your Space. (2026-11-17, [PR #27](https://github.com/your-space-ai/your-space/pull/27))
- [x] Run each app's interface on its own origin, isolated from Your Space and other apps, at `<app>.<Your Space's address>` in every setup (`space.localhost` on this machine), in a cross-origin iframe in the web client. (2026-11-17, [PR #27](https://github.com/your-space-ai/your-space/pull/27))
- [x] Let only people signed in to Your Space reach an app's origin, through an access gate at the built-in proxy; Your Space's cookies never reach apps, and apps' cookies never reach Your Space or each other. (2026-11-17, [PR #27](https://github.com/your-space-ai/your-space/pull/27))
- [x] Open several apps side by side in one layout on larger screens; show one app at a time on phones. (2026-11-17, [PR #30](https://github.com/your-space-ai/your-space/pull/30))
- [x] Open any app in its own browser tab or window when it cannot run in a pane. (2026-11-17, [PR #27](https://github.com/your-space-ai/your-space/pull/27))

</details>

### Themes

- [x] **Personalize the dashboard (010).** Choose among three starters, edit fonts and colors, and export and import a theme file. The browser walkthrough reapplied an exported theme in the same workspace. A packaged Apple Silicon launcher also verified local theme preview and persistence across relaunch. (2026-11-21, [PR #69](https://github.com/your-space-ai/your-space/pull/69)) **Removed (2026-11-23, [alpha scope](architecture/decisions.md#alpha-scope)):** the launcher's own theme picker and import; it shows the default theme. [Appearance journey](https://github.com/your-space-ai/your-space/blob/main/specs/010-personal-themes/spec.md) Journey 013 replaces this presentation when it lands; 010's storage, sharing and permission rules still apply.
- [ ] **Light and dark themes (013)** · *First packaged release*. Choose among Cerulean, Cinder and Fern, each with a light and a dark palette, a component style and fonts that ship with the dashboard. The workspace keeps a mode that can match the device. Themes have one format, version 2. (In review, [PR #107](https://github.com/your-space-ai/your-space/pull/107)) [Workspace redesign journey](https://github.com/your-space-ai/your-space/blob/main/specs/013-workspace-redesign/spec.md)
- [ ] **First packaged release.** Export a theme from one workspace and apply it in a second, independent workspace. Recheck the dashboard and launcher on the packaged candidate.

### Desktop clients

- [x] **Mac launcher (008).** Detect Docker, allow an engine override, guide the owner if it is missing or stopped, and use the CLI for owner setup. Alternatively, connect to a server by URL without local Docker. The [Mac guide](install/macos-desktop.md) covers local availability and Docker Desktop licensing. (2026-11-21, [PR #68](https://github.com/your-space-ai/your-space/pull/68))
- [x] Build preview DMGs for Apple Silicon and Intel. Both copies launched after copying to Applications and ejecting the image. The Intel preview ran under Rosetta. With Docker stopped, a native Mac reached the remote HTTPS sign-in page. On disposable Linux, local setup created and resumed a workspace. The packaged Mac app connected to it, installed a fixture kit, and opened its app. (2026-11-21, [PR #68](https://github.com/your-space-ai/your-space/pull/68)) [Mac preview verification](https://github.com/your-space-ai/your-space/blob/main/specs/008-desktop-entry/verification.md)
- [ ] **First packaged release.** Download the signed and notarized DMGs from GitHub Releases. On clean Apple Silicon and native Intel Macs, verify the signature and notarization, drag the app to Applications, eject the image, and run the installed app and CLI.
- [ ] Set up Docker on the same Mac with the published images and sign in to a remote server on a Mac without Docker. Review, install and open an independent kit through each path on the candidate. [Desktop journey](https://github.com/your-space-ai/your-space/blob/main/specs/008-desktop-entry/spec.md)
- [ ] **First packaged release.** Close and quit like a Mac app: closing the window keeps the app and its local workspace running, and quitting stops the local workspace it started, without holding up logout or shutdown. Built in [PR #108](https://github.com/your-space-ai/your-space/pull/108); verify on Apple Silicon and Intel Macs. [Desktop journey](https://github.com/your-space-ai/your-space/blob/main/specs/008-desktop-entry/spec.md#what-the-owner-does)
- [ ] **First packaged release.** Saved connections: the launcher lists a connection for each workspace opened, by name and address, with rename and remove; the Connections menu switches between them with ⌘1 to ⌘9; several open at once, each in its own window. A saved connection is a name and an address only ([decision](architecture/decisions.md#first-public-release-audience-and-clients)). Built in [PR #122](https://github.com/your-space-ai/your-space/pull/122); verify on a Mac. [Desktop journey](https://github.com/your-space-ai/your-space/blob/main/specs/008-desktop-entry/spec.md)
- [ ] **First packaged release.** Update the Mac app from GitHub Releases, prereleases included: **Check for Updates…** and a daily automatic check the owner can turn off, then the local workspace upgraded to the app's version with the CLI. Built in [PR #108](https://github.com/your-space-ai/your-space/pull/108); verify by updating from one signed release to the next.
- [ ] **Choose the update channel in the Mac app (016)** · *alpha.2*. A setting for the channel the app's updates follow, Alpha or Canary, kept across updates, offering only that channel's builds from its feed, with the local workspace kept on the app's build. Leaving Canary moves at the next alpha. Decided 2026-11-25. [Release channels spec](https://github.com/your-space-ai/your-space/blob/main/specs/016-release-channels/spec.md)

- [ ] **008 · Extend desktop support beyond the first Mac release** · *Deferred journey*
  - **Platforms and distribution**
    - [ ] Bring the full desktop workspace and installed-app experience to the additional supported operating systems.
    - [ ] Provide an installable PWA client with the same experience.
    - [ ] Define which desktop app, CLI, and server versions work together, and show a clear "update the app" or "update the server" message on a mismatch.
    - [ ] Ship the desktop app for Linux.
    - [ ] On Windows, support the desktop app and a local workspace in an engine Your Space provides; Windows is not a supported server host.
    - [ ] Sign Windows builds through SignPath, with Microsoft Artifact Signing as fallback, in CI.
    - [ ] Qualify the CLI with the Linux desktop for local workspaces.
    - [ ] Run the CLI on Windows so the desktop app can drive it for local workspaces there.
    - [ ] Distribute `.deb` and `.rpm` packages, standalone macOS CLI downloads and a Homebrew formula.
  - **Desktop experience**
    - [ ] Show installed apps in native views, one per app, instead of iframes.
    - [ ] Update the desktop app itself, checking GitHub for new releases. *Moved to the first packaged release for the Mac app (2026-11-23); the other operating systems' apps follow their builds.*
    - [ ] Provide a Docker-compatible engine: Your Space's own virtual machine by default on macOS (and later Windows), or an engine the owner already runs as an advanced option.
    - [ ] Streamline local owner setup with one desktop form that drives the existing owner command and sets the password on the user's behalf.
  - **Local workspace operations**
    - [ ] Update a local Your Space installation when the owner chooses.
    - [ ] Back up and restore the local workspace through the CLI.
    - [ ] Uninstall the local workspace through the CLI's uninstall command.

## Apps and kits

### Installation and isolation

- [x] **Install and open apps (002).** Install a Compose file and kit, inspect the review, and open the app in its own pane. Local Compose installs, opt-in port publishing, framing for published apps, and explicit complete removal also shipped. (2026-11-20, [PR #48](https://github.com/your-space-ai/your-space/pull/48), [PR #54](https://github.com/your-space-ai/your-space/pull/54), [PR #56](https://github.com/your-space-ai/your-space/pull/56), [PR #57](https://github.com/your-space-ai/your-space/pull/57)) [App installation tasks](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/tasks.md) **Removed (2026-11-23, [alpha scope](architecture/decisions.md#alpha-scope)):** installing a Compose file given on this machine (`install-app --compose`) and the owner's "Show inside Your Space" switch; framing for published apps stays on.
- [x] Upgrade a running local installation’s kit in place to add agent routes while retaining its app ID and volume. (2026-11-21, [PR #66](https://github.com/your-space-ai/your-space/pull/66)) **Removed (2026-11-23, [alpha scope](architecture/decisions.md#alpha-scope)):** `your-space app upgrade-agent-kit` is gone; reinstall with kept data instead.
- [ ] **Apps screen (013)** · *alpha.2*. List installed apps with their status beside the selected app's details: update notice, version, address, agent access, internet access requests, and Open, Restart and Remove. [Workspace redesign journey](https://github.com/your-space-ai/your-space/blob/main/specs/013-workspace-redesign/spec.md)
- [x] Install an app only from the link to its kit, which pins the app's Compose file to an exact commit (`source.commit`), and explain kits when the owner pastes a bare Compose link. A kit's link resolves to the kit's commit at review, and nothing is read at a branch's latest commit. A Compose file given on this machine needs a kit too. (2026-11-23, [PR #112](https://github.com/your-space-ai/your-space/pull/112)) [Kits define apps](architecture/decisions.md#kits-define-apps) **Removed (2026-11-23, [alpha scope](architecture/decisions.md#alpha-scope)):** a Compose file given on this machine no longer installs; the kit's Compose file is always on GitHub.
- [ ] Give an app exactly the environment its kit defines, in one `env` map: each variable a value, generated, worked out or asked of the owner, for the Compose file's variables and for every service that loads `.env`. Refuse a file that needs a variable the kit doesn't define, and read no other settings or label file an app's file names. (In review, [PR #117](https://github.com/your-space-ai/your-space/pull/117)) [The kit defines the environment](architecture/decisions.md#the-kit-defines-the-environment)
- [ ] **First packaged release.** Follow the documented install from a live upstream GitHub source through the server, open the independent app in each supported browser, and identify its supported agent actions. Include native Safari on macOS with the local app hostnames.

<details>
<summary>Verified install sources, kits and owner controls (002)</summary>

- [x] Let the owner install an app by pasting the GitHub link to its own Compose file in a public repository into the UI. (2026-11-17, [PR #26](https://github.com/your-space-ai/your-space/pull/26)) **Replaced (2026-11-23):** the owner pastes the link to the app's kit, which names the Compose file. [Kits define apps](architecture/decisions.md#kits-define-apps)
- [x] Read the file at the exact commit the link resolves to and record it, with the commit of any installation kit applied; updates re-read the file from the same link. (2026-11-17, [PR #25](https://github.com/your-space-ai/your-space/pull/25)) **Changed (2026-11-23):** the kit pins the Compose file's commit, and a newer one reaches an installed app only when the owner chooses it. [Kits define apps](architecture/decisions.md#kits-define-apps)
- [x] Pin every image, including database services, to an exact version by digest, and validate and retain the installed image identity. (2026-11-17, [PR #25](https://github.com/your-space-ai/your-space/pull/25))
- [x] Check the app's fully resolved Compose file against an allowlist of settings; adapt it only by rules that hold for every app, reporting each change, and refuse anything else with reasons, including settings that would break app isolation. (2026-11-17, [PR #25](https://github.com/your-space-ai/your-space/pull/25))
- [x] Apply an installation kit, kept in a separate repository, for what a particular app needs (its interface, generated values, starter hosts, limits), with no app-specific logic in Your Space; an app without a kit installs if its own files are enough. (2026-11-17, [PR #25](https://github.com/your-space-ai/your-space/pull/25)) **Superseded in part (2026-11-23):** every installed app has a kit. [Kits define apps](architecture/decisions.md#kits-define-apps)
- [x] Let the owner provide app settings and secrets at installation and change them later; generate secrets instead of using published defaults, keep them out of output and logs, and store them encrypted in Your Space's database. (2026-11-17, [PR #28](https://github.com/your-space-ai/your-space/pull/28))
- [x] Install an app if its images run on the engine's processor type (ARM or Intel/AMD); fail installation with a clear message if no image matches. (2026-11-17, [PR #25](https://github.com/your-space-ai/your-space/pull/25))
- [x] Restrict app installation and removal to the owner for the first public release. (2026-11-17, [PR #26](https://github.com/your-space-ai/your-space/pull/26))
- [x] Warn the owner when installing an app that it is trusted with its own data, and state in the documentation that Your Space protects itself and other apps but is not a sandbox for hostile code. (2026-11-17, [PR #26](https://github.com/your-space-ai/your-space/pull/26))

</details>

<details>
<summary>Verified runtime isolation, storage and monitoring (002)</summary>

- [x] Run each app's containers through a runtime manager, the only part of Your Space that holds the engine connection, on any Docker-compatible engine shared with Your Space; apps keep running through Your Space restarts and updates, and come back when it starts. (2026-11-17, [PR #25](https://github.com/your-space-ai/your-space/pull/25))
- [x] Run an app-declared database service alongside the app when needed. (2026-11-17, [PR #25](https://github.com/your-space-ai/your-space/pull/25))
- [x] Provide app-specific durable storage that survives restarts and remains after uninstall. (2026-11-17, [PR #30](https://github.com/your-space-ai/your-space/pull/30))
- [x] Let the owner explicitly delete retained app data from the administration UI. (2026-11-17, [PR #30](https://github.com/your-space-ai/your-space/pull/30))
- [x] Isolate apps from host filesystem access, devices, and Docker controls, and protect platform services and other apps: each app on its own sealed network with its own volumes. (2026-11-17, [PR #29](https://github.com/your-space-ai/your-space/pull/29))
- [x] Let apps reach only approved internet hosts: the installation kit's starter hosts, approved with the install, and hosts the owner approves when an app's attempt shows up as an access request. (2026-11-17, [PR #28](https://github.com/your-space-ai/your-space/pull/28))
- [x] Run each managed app with memory and CPU limits so one app cannot take down the host. (2026-11-17, [PR #29](https://github.com/your-space-ai/your-space/pull/29))
- [x] Show the owner each app's status and logs. (2026-11-17, [PR #29](https://github.com/your-space-ai/your-space/pull/29))
- [x] Show the owner an Engine page with the engine connection, its version, and the space's resources and each app's use. (2026-11-17, [PR #26](https://github.com/your-space-ai/your-space/pull/26))

</details>

### Custom apps and sources

- [x] **Build a custom Home with an agent (011).** Resumable provisioning ran on disposable Docker. A scaffolded Home app ran in Chromium with reads from only the apps and roles the owner chose. (2026-11-21, [PR #70](https://github.com/your-space-ai/your-space/pull/70)) [Creator journey](https://github.com/your-space-ai/your-space/blob/main/specs/011-agent-workspace/spec.md) **Removed in part (2026-11-23):** the custom Home, Home read grants and `app new`, `app pack` and `app install-local` left the product for the alpha; agent setup from a shell stays. [Creator workflow deferred](architecture/decisions.md#creator-workflow-deferred)
- [x] Manage public and private GitHub repositories, grant an agent scoped file edits, and preview an install from a direct kit URL or an optional owner-selected directory. Public GitHub reads ran live. OAuth and write operations used a synthetic GitHub provider. (2026-11-21, [PR #70](https://github.com/your-space-ai/your-space/pull/70), [PR #72](https://github.com/your-space-ai/your-space/pull/72)) **Removed in part (2026-11-23):** managed repositories, agents' file edits and the GitHub connection left the product for the alpha; kit links stay, read from public GitHub. [Creator workflow deferred](architecture/decisions.md#creator-workflow-deferred) **Removed (2026-11-23, [alpha scope](architecture/decisions.md#alpha-scope)):** the kit directory and its review records.
- [x] Require owner confirmation of the pinned replacement and its storage changes. A running replacement read its predecessor’s volume marker under the same installation ID. (2026-11-21, [PR #70](https://github.com/your-space-ai/your-space/pull/70)) **Removed (2026-11-23):** deploying an installed app from a repository commit, and the replacement engine behind it, left the product with managed repositories. [Creator workflow deferred](architecture/decisions.md#creator-workflow-deferred)
- [ ] **First packaged release.** Rehearse the creator journey with a disposable live GitHub account and production OAuth configuration. Verify a private repo, an authorized fork and edit, and the owner-confirmed deployment from that commit. **Moved (2026-11-23):** to the deferred creator workflow below, with the features it checks.

- [ ] **Creator workflow (011)** · *Deferred journey*

  **Deferred (2026-11-23):** [Creator workflow deferred](architecture/decisions.md#creator-workflow-deferred). Out of the alpha, to get feedback before building more; the delivered work above keeps its history.

  - [ ] Connect GitHub, and install from a kit in a private repository through that connection in the web client. Until then a private kit installs with the server command, `install-app --kit -`, only when the Compose file it pins is public. **Moved (2026-11-25):** to [private GitHub sources (015)](#custom-apps-and-sources), read only, below.
  - [ ] Make a dashboard app with `app new`, `app pack` and `app install-local`, choose it as Home, and grant it read roles of other apps.
  - [ ] Create, import and fork GitHub repositories from Your Space, on a Repositories screen.
  - [ ] Grant an agent access to selected repositories, with creation and fork rights, and let it commit files through its key.
  - [ ] Install from a kit in a managed repository, and deploy an installed app from a reviewed repository commit, keeping its installation and volumes.
  - [ ] Rehearse with a disposable live GitHub account: a private repo, an authorized fork and edit, and the owner-confirmed deployment from that commit.

- [ ] **Private GitHub sources (015)** · *alpha.2*

  **Agreed (2026-11-25):** [Private GitHub sources](architecture/decisions.md#private-github-sources). The connection returns, read only, for installs, specified in the [journey 015 spec](https://github.com/your-space-ai/your-space/blob/main/specs/015-private-sources/spec.md).

  - [x] Connect GitHub with a fine-grained token, Contents read on chosen repositories, from the dashboard's GitHub page or the `github` server command, and manage it from either. Verified in Chromium against the stand-in GitHub; the run against real GitHub is the last item. (2026-11-25, [PR #130](https://github.com/your-space-ai/your-space/pull/130))
  - [x] Install from a kit in a private repository through that connection, in the web client and with the server command; the Compose file it pins stays public until the next item. Verified in Chromium against the stand-in GitHub; the run against real GitHub is the last item. (2026-11-25, [PR #131](https://github.com/your-space-ai/your-space/pull/131))
  - [x] Install from a kit whose Compose file is in a private repository, the kit's own or another one, in the web client and with the server command, `install-app --kit -` included. Verified in Chromium against the stand-in GitHub; the run against real GitHub is the last item. (2026-11-25, [PR #133](https://github.com/your-space-ai/your-space/pull/133))
  - [x] Pull private images from GHCR with an optional classic token limited to `read:packages`, added, replaced and removed from the GitHub page or `github image-token`. Verified in Chromium against the stand-in GitHub and a local registry that asks for a password; the run against real GitHub and GHCR is the last item. (2026-11-25, [PR #134](https://github.com/your-space-ai/your-space/pull/134))
  - [ ] Keep the connection through a data-key rotation, and keep public installs working when it is broken.
  - [ ] Run it against real GitHub with a disposable account.

- [ ] **Additional discovery sources** · *Later direction*

  Journey 011 supports private GitHub sources, direct kit URLs and one optional operator-selected GitHub directory. Later discovery work includes combining multiple directories and preserving update routing when a directory changes. (2026-11-23: private GitHub sources are deferred with the [creator workflow](#custom-apps-and-sources), and the operator-selected directory is gone; an app store chooses its own source when it comes. 2026-11-25: private GitHub sources return, read only, with [journey 015](#custom-apps-and-sources).)

- [ ] **Kits as app definitions** · *Later direction*

  **Agreed (2026-11-23):** [Kits define apps](architecture/decisions.md#kits-define-apps). Apps install only from a kit's link until these exist.

  - [ ] Draft an app's kit during the review when the owner pastes a bare Compose link, for the owner to check before installing.
  - [ ] An app store: a page that shows a chosen group of kits, with no format of its own.
  - [ ] Display fields in the kit format, such as a description, an icon and links, shown wherever the app is listed.

- [ ] **Build apps from source during installation** · *Later direction*

  **Deferred (2026-10-30):** [App deployment decision](architecture/decisions.md#accepted-future-app-deployment-direction).

  - [ ] Support building app images from repository source as an additional installation path.

  The first release requires developers to publish the exact images and versions declared by their
  app's integration files. Build execution and its operational requirements belong to this later work.

- [ ] **Alternative deployment-file formats** · *Later direction*

  **Deferred (2026-10-31):** [App deployment decision](architecture/decisions.md#accepted-future-app-deployment-direction).

  - [ ] Explore an app format other than Docker Compose if a real need surfaces, added as another
    importer for the app description.

  **Reworded (2026-11-14):** the first public release reads apps' own Compose files, with
  installation kits, instead of a Compose file with an `x-your-space` section.

### Integration contracts and SDKs

- [ ] **007 · Build and connect more apps** · *Deferred journey*
  - **Contracts and SDKs**
    - [ ] Document versioned public integration contracts for independently built and running apps.
    - [ ] Design the contract so it works the same whether Your Space runs the app or the app is hosted elsewhere.
    - [ ] Publish TypeScript and Python SDKs from this repository for apps in their own repositories, including first-party apps.
    - [ ] Verify each SDK with a working app.
    - [ ] Build on journey 011’s portable Compose apps with the full SDK for deeper integrations.
  - **External apps and compatibility**
    - [ ] Let the owner add an app someone already runs elsewhere through a connector that runs next to it and connects out to Your Space, instead of deploying it.
    - [x] Run two existing open-source apps, a personal finance app and a CRM, side by side from their own Compose files and kits in development. Their identically named database, Redis and worker services ran without collisions. (2026-11-14, [PR #30](https://github.com/your-space-ai/your-space/pull/30)) [Recorded two-app run](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/research.md#the-first-two-apps-from-their-own-files)

- [ ] **Additional SDK languages** · *Later direction*

  **Deferred (2026-10-31):** [Platform and independent apps](architecture/decisions.md#platform-and-independent-apps).

  - [ ] Publish SDKs for languages beyond TypeScript and Python, such as Go.

  Journey 007 delivers the TypeScript and Python SDKs first.

## AI agents

### Roles and approvals

- [x] **Agent identities and grants (005).** Create a named agent with its own key in the web UI. Grant any subset of the installation’s enabled kit roles. The gateway checks their combined routes and HTTP methods, supplies the app credential, and the app enforces its native permissions. Inspect or change the grants, rotate the key independently, or revoke the agent. (2026-11-21, [PR #60](https://github.com/your-space-ai/your-space/pull/60), [PR #62](https://github.com/your-space-ai/your-space/pull/62), [PR #65](https://github.com/your-space-ai/your-space/pull/65)) [Agent access specification](https://github.com/your-space-ai/your-space/blob/main/specs/005-owner-agent/spec.md)
- [x] Enforce per-route approvals and the owner’s all-write override. Record the result, agent and delegating owner. Gateway and browser tests cover denied actions and installations, withdrawn grants, rotated keys, and use of a single approval only once. (2026-11-21, [PR #63](https://github.com/your-space-ai/your-space/pull/63), [PR #65](https://github.com/your-space-ai/your-space/pull/65)) **Removed (2026-11-23, [alpha scope](architecture/decisions.md#alpha-scope)):** agents only read, so the all-write override is gone; per-route approvals stay.
- [x] Discover and invoke kit actions with the agent CLI. A live external agent completed an owner-approved read from an independently installed app. Automated tests separately exercised creating and editing a record, replay handling and stale edits against a fixture. (2026-11-21, [PR #64](https://github.com/your-space-ai/your-space/pull/64), [PR #66](https://github.com/your-space-ai/your-space/pull/66)) [Verification record](https://github.com/your-space-ai/your-space/blob/main/specs/005-owner-agent/tasks.md) **Removed (2026-11-23, [alpha scope](architecture/decisions.md#alpha-scope)):** agent writes, their receipts and replay; agents only read.
- [ ] **Agents and Approvals screens (013)** · *alpha.2*. One queue of agent actions waiting for the owner, with Waiting and Decided tabs; internet access requests stay on the related app. Each agent shows its app access, keys and activity. [Workspace redesign journey](https://github.com/your-space-ai/your-space/blob/main/specs/013-workspace-redesign/spec.md)
- [ ] **First packaged release.** Use an external agent to list records in the independent app and read one that the kit asks the owner to approve. Verify approval, denial and the upstream result. Remove the grant and retry in the same session, then repeat after key rotation and revocation. (Changed 2026-11-23: agents only read in the alpha; see the [alpha scope](architecture/decisions.md#alpha-scope).) Record the app and actions so another owner can repeat the [walkthrough](https://github.com/your-space-ai/your-space/blob/main/specs/005-owner-agent/quickstart.md).

### Agent connections and workflows

- [ ] **Agent writes** · *Later direction*

  **Cut from the alpha (2026-11-23):** [Alpha scope](architecture/decisions.md#alpha-scope).

  - [ ] Let an agent create and change records through kit routes, with exact owner approval.
  - [ ] Retry an interrupted write safely and refuse a stale edit, verified against a real app's API rather than a fixture.

- [ ] **Workspace MCP endpoint** · *Later direction*

  **Deferred (2026-11-02):** [Agent access through Your Space](architecture/decisions.md#agent-access-through-your-space).

  - [ ] Serve one MCP endpoint per workspace through the Your Space gateway.
  - [ ] Let off-the-shelf agents connect with the endpoint URL and a sign-in approved by their human.
  - [ ] Show each agent only the app actions its delegated roles allow, using the same checks as the CLI.

  The first public release gives agents the CLI.

- [ ] **Platform-hosted agents and workflows** · *Later direction*

  **Source:** [Later candidate journeys](architecture/decisions.md#later-candidate-journeys).

  - [ ] Run hosted agents through the same identity and authorization contracts as external agents.
  - [ ] Support workflows such as daily triage.
  - [ ] Carry the [provider-independent grants used by external agents](#roles-and-approvals) into hosted execution, regardless of the runtime or model provider.

  The execution runtime and model-provider integration remain open.

## Workspace and hosting

### Local and server setup

- [x] **Install and operate a workspace with the CLI (001, 003).** Download and verify a locally served versioned bundle, initialize and start the stack, create the owner, sign in, inspect status and logs, and stop and restart it with app data retained. (2026-11-18, [PR #35](https://github.com/your-space-ai/your-space/pull/35), [PR #36](https://github.com/your-space-ai/your-space/pull/36)) [CLI task record](https://github.com/your-space-ai/your-space/blob/main/specs/003-install-with-the-cli/tasks.md)
- [x] Recover owner access and manage secrets. Stored app settings are encrypted with a separate key that can be rotated independently. (2026-11-19, [PR #37](https://github.com/your-space-ai/your-space/pull/37), [PR #42](https://github.com/your-space-ai/your-space/pull/42)) [Encryption task record](https://github.com/your-space-ai/your-space/blob/main/specs/009-encrypt-stored-data/tasks.md)
- [x] Configure a domain, an owner-managed proxy or tunnel, a non-default local engine, or a manual Compose setup. Browser tests exercised proxy forwarding and HTTPS with a test certificate authority. (2026-11-19, [PR #38](https://github.com/your-space-ai/your-space/pull/38), [PR #39](https://github.com/your-space-ai/your-space/pull/39), [PR #40](https://github.com/your-space-ai/your-space/pull/40), [PR #41](https://github.com/your-space-ai/your-space/pull/41))
- [ ] **First packaged release.** Follow the guide using a published version on a personal machine and a Docker server. Verify owner claim, localhost sign-in, restart and recovery. From a second device, open the dashboard behind the owner’s proxy or tunnel and at a real domain with a publicly trusted certificate.

### Backups and updates

- [ ] **Upgrade an installation with the CLI (003)** · *First packaged release*. `your-space upgrade` moves an installation to the CLI's version without reinstalling. It backs up the database first, keeps the settings, owner, data and apps, and puts the previous version back when the new server doesn't become ready. A Caddy that fails after that is reported, not rolled back, and a rollback that can't stop the new server or check the database stops for the owner to finish by hand. The server refuses a database a newer version migrated. ([PR #110](https://github.com/your-space-ai/your-space/pull/110), in review) [Upgrade decision](architecture/decisions.md#your-space-updates-backup-and-restore)
- [ ] **Migrations on `main` stay as merged (016)** · *alpha.2*. A required pull request check refuses a change to a migration already on `main` and a new one not stamped after every earlier one, compared with `main` as it is when the check runs, so a database that follows Canary doesn't skip one. ([PR #132](https://github.com/your-space-ai/your-space/pull/132), in review) [Migrations decision](https://github.com/your-space-ai/your-space/blob/main/specs/016-release-channels/spec.md#8-migrations-on-main)

- [ ] **Upgrade to a channel's newest build (016)** · *alpha.2*. `your-space upgrade --channel alpha|canary` moves an installation to the newest build of that channel, named in the channel's feed, by running that build's own CLI. `upgrade` keeps every backup. Decided 2026-11-25. [Release channels spec](https://github.com/your-space-ai/your-space/blob/main/specs/016-release-channels/spec.md)

- [ ] **006 · Maintain and move a workspace** · *Deferred journey*
  - **Workspace backup, restore and removal**
    - [ ] Back up any installation through the CLI: the Your Space server produces the backup and returns it through its API, wherever the server runs.
    - [ ] Restore a backup into an installation.
    - [ ] Make backup and restore easy to script, so a person or their agent can move a workspace between installations themselves.
    - [ ] Before updating Your Space, record versions and snapshot its data; if the update fails, roll back automatically. 003's `upgrade` does this from the CLI with a local database backup, rolling back only before the new server is ready, and leaving the owner to finish by hand when it can't stop the new server or check the database; 006 keeps the server-produced snapshot.
    - [ ] Uninstall Your Space and every app container it manages; keep data by default, and require explicit confirmation and offer a backup before deleting it.
  - **App updates, history and rollback**
    - [ ] Show the owner when an installed app's kit has a newer commit, as an update the owner chooses to install, such as in the update notice of the [Apps screen (013)](https://github.com/your-space-ai/your-space/blob/main/specs/013-workspace-redesign/spec.md): Your Space reviews the newer kit and the Compose commit it pins, and changes nothing until the owner confirms. Nothing follows a kit's branch by itself. [Kits define apps](architecture/decisions.md#kits-define-apps)
    - [ ] Include app installation, removal and update events in the broader workspace activity history.
    - [ ] Extend the [confirmed replacement path](#custom-apps-and-sources) to general updates. Preserve app identity, source revision and provenance, enforce the approved update policy, and prevent silent expansion of access. (2026-11-23: the confirmed replacement path left the product with managed repositories, deferred in the [creator workflow](#custom-apps-and-sources); updates build their own.)
    - [ ] Extend 011’s owner-confirmed compatible replacements to general upstream updates with reviewed data migrations. (2026-11-23: those replacements are deferred with managed repositories.)
    - [ ] Back up app data and record image versions before each update; if the update fails, automatically roll back to the previous versions and restore the backup.

- [ ] **Automatic app updates** · *Later direction*

  **Deferred (2026-10-30):** [App update decision](architecture/decisions.md#accepted-future-app-distribution-direction).

  - [ ] Support automatic app updates under the owner's approved update policy.

  Journey 011 covered owner-confirmed compatible replacements, deferred with managed repositories on 2026-11-23. Journey 006 adds owner-chosen and broader upstream updates.

- [ ] **App backup history and manual rollback** · *Later direction*

  **Deferred (2026-10-31):** [App update decision](architecture/decisions.md#accepted-future-app-distribution-direction).

  - [ ] Keep more than one app backup and let the owner roll back an update that succeeded.

  Journey 006 restores the pre-update backup when an update fails.

### Deployment options

- [ ] **Additional deployment pathways** · *Later direction*

  **Source:** [Deployment boundaries](architecture/decisions.md#deployment-boundaries-and-licensing).

  - [ ] Support running app containers on hosts other than the Your Space server.
  - [ ] Add app deployment backends beyond Docker as they are specified and supported.
  - [ ] Provide platform-specific installation guides and deployment adapters for additional supported environments.
  - [ ] Keep provider-specific provisioning, networking, and storage outside the core platform.
  - [ ] Verify persistence and lifecycle behavior for each newly supported environment.

  Cloudflare and other cloud pathways need investigation before support is claimed.

- [ ] **Managed service** · *Later direction*

  **Source:** [Product and repository direction](architecture/decisions.md#accepted-product-and-repository-direction).

  - [ ] Provide hosted Your Space for users who do not want to operate a server.
  - [ ] Preserve compatible app contracts between self-hosted and managed deployments.
  - [ ] Use the same server-managed authentication model across deployment modes.
  - [ ] Keep managed-service code, such as billing, provisioning, and multi-tenant operations, in a separate private repository that integrates through the core's APIs.

  Provisioning, operations, billing, and email delivery require future planning. See [project license and business model](architecture/decisions.md#project-license-and-business-model).

## Accounts and access

### Owner access

**On main.** The owner can claim the workspace, sign in and recover access. Account and workspace identities survive restarts with their storage retained. [Owner access tasks](https://github.com/your-space-ai/your-space/blob/main/specs/001-workspace-owner-access/tasks.md)

<details>
<summary>Verified owner setup and sessions (001)</summary>

- [x] **Owner setup and sessions** (2026-11-08, [PR #14](https://github.com/your-space-ai/your-space/pull/14))
  - [x] Retain account and workspace identity across restarts and service recreation with durable storage retained. (2026-11-08, [PR #14](https://github.com/your-space-ai/your-space/pull/14))
  - [x] Create the owner with a server command that prints a single-use set-password link; the network alone can never create an account or the owner. (2026-11-08, [PR #12](https://github.com/your-space-ai/your-space/pull/12))
  - [x] Create one owner account and workspace, keeping account, workspace, membership, and ownership identities distinct. (2026-11-08, [PR #12](https://github.com/your-space-ai/your-space/pull/12))
  - [x] Prevent duplicate owners and keep public sign-up closed. Member invitations are planned in 004. (2026-11-08, [PR #12](https://github.com/your-space-ai/your-space/pull/12))
  - [x] Reach an accurate empty workspace and distinguish unavailable services from empty or unclaimed state. (2026-11-08, [PR #14](https://github.com/your-space-ai/your-space/pull/14))
  - [x] Sign in and out through one server-managed authentication system, with server-enforced session expiry and revocation. (2026-11-08, [PR #13](https://github.com/your-space-ai/your-space/pull/13))
  - [x] Keep the platform session in host-only cookies so it is never sent to app origins. (2026-11-08, [PR #13](https://github.com/your-space-ai/your-space/pull/13))
  - [x] Recover the existing owner account through an operator command without requiring email delivery or a standalone CLI. (2026-11-08, [PR #14](https://github.com/your-space-ai/your-space/pull/14))
  - [x] Preserve identity and revoke existing sessions after successful password recovery. (2026-11-08, [PR #14](https://github.com/your-space-ai/your-space/pull/14))

</details>

- [ ] **Sign-in and first run (013)** · *alpha.2*. Sign in from one row under a large greeting. After the owner account exists, pick a theme previewed in light and dark, then add a first app or skip. [Workspace redesign journey](https://github.com/your-space-ai/your-space/blob/main/specs/013-workspace-redesign/spec.md)

### Members and recovery

- [ ] **004 · Invite a team** · *Deferred journey*
  - **Invitations and account recovery**
    - [ ] Let the owner create an invitation link and share it directly with a prospective member.
    - [ ] Let the recipient sign up and join the workspace through the invitation.
    - [ ] Retain existing account, workspace, membership, and ownership identities when adding members.
    - [ ] Give each member a recovery code at signup that lets them reset their own password.
    - [ ] Let the owner reset a member's password with a temporary password the member must replace at next sign-in.
  - **App roles and sign-on**
    - [ ] Support app single sign-on through OpenID Connect with Your Space as the identity provider (level 1 integration).
    - [ ] Let the owner assign app roles to human members.
    - [ ] Assign multiple roles per member and app. When a member loses a role, remove that delegation from their agents and active sessions.
  - **Removing access and retaining activity**
    - [ ] Let the owner remove a member: sign them out everywhere and revoke their app roles and their agents' access.
    - [ ] Keep past app activity traceable to former members and deleted agents.
    - [ ] Disable a removed member's agents rather than deleting them, and let the owner delete them later.
    - [ ] Extend the owner’s agent activity log to team invitations, membership changes and member-role delegations.

- [ ] **Optional open sign-up** · *Later direction*

  **Source:** [Authentication and initial claim](architecture/decisions.md#authentication-and-initial-claim).

  - [ ] Let the owner choose to allow people to sign up without an invitation.

  The personal release has one owner. Journey 004 adds invitation-only membership.

- [ ] **Optional owner-configured email** · *Later direction*

  **Deferred (2026-11-02):** [Sessions, persistence, and recovery](architecture/decisions.md#sessions-persistence-and-recovery). Until then the owner gives no email address (2026-11-23, [alpha scope](architecture/decisions.md#alpha-scope)).

  - [ ] Let the owner add their own email (SMTP) settings to enable email delivery.
  - [ ] Verify owner and member email addresses when email is configured.
  - [ ] Send password-reset links to verified addresses through the existing recovery mechanism.

  Member recovery in 004 must work without configuring email.

## Releases

### Verification and publication

- [x] **Prepare the source preview.** The Linux ARM64 Docker quickstart was exercised from owner sign-in through installing, opening and restarting a sample app. The public-contribution CI and sign-off checks are implemented and were exercised locally. (2026-11-21, [PR #73](https://github.com/your-space-ai/your-space/pull/73), [PR #74](https://github.com/your-space-ai/your-space/pull/74)) [Docker quickstart](install/from-source.md)
- [x] Implement the release workflows for versioned images, CLI and install files, checksums, and Apple Silicon and Intel DMGs. The CLI and Mac packaging paths produced private test artifacts. (2026-11-18, [PR #35](https://github.com/your-space-ai/your-space/pull/35)) (2026-11-21, [PR #68](https://github.com/your-space-ai/your-space/pull/68))
- [ ] Prepare each release as a draft with the npm package, the standalone Linux executables, both DMGs, the Compose bundle and `SHA256SUMS`, after fresh Linux installs on both architectures, and publish the npm package only when the owner publishes the draft. ([PR #83](https://github.com/your-space-ai/your-space/pull/83), in review)
- [ ] Publish every push to `main` as a canary build, so the owner can run `main` before a release: images under the build's own version and a moving `canary` tag, built natively for ARM and Intel, and the CLI downloads and Compose bundle on one rolling `canary` prerelease, installed and checked as a release's are. A canary's CLI moves an installation onto it with `upgrade`, and the next release's `upgrade` moves it back. ([PR #124](https://github.com/your-space-ai/your-space/pull/124), in review) [Canary decision](architecture/decisions.md#journey-based-specifications) [Run the canary build](install/canary.md)
- [ ] Publish each channel's feed at a fixed address: a rolling `alpha` prerelease that Release publish points at each published release, and the feed files on the rolling `canary` prerelease (016, alpha.2). Both are built, in review: Canary's `channel.json` ([PR #135](https://github.com/your-space-ai/your-space/pull/135)) and the `alpha` feed, which Release publish writes ([PR #136](https://github.com/your-space-ai/your-space/pull/136)). To verify once alpha.2 is published, when FR-007's fixtures, constructed in the feeds' format for now, are replaced with the files the feeds serve (Canary's `canary-mac.yml` once the first Mac canary is published). [Release channels spec](https://github.com/your-space-ai/your-space/blob/main/specs/016-release-channels/spec.md)
- [ ] Publish a signed and notarized Mac canary once a day and on demand, from the newest Linux canary, with a second Developer ID certificate in a `macos-canary` environment (016, alpha.2). [Release channels spec](https://github.com/your-space-ai/your-space/blob/main/specs/016-release-channels/spec.md)
- [ ] **Verify and publish the first packaged release.** Run the combined owner journey from clean downloads on the supported hosts. Record the exact candidate, configurations and limitations, including layout and appearance checks on the distributed build.
- [ ] Complete the security, privacy, licensing, documentation and publication checks, obtain the owner’s approval, and verify the published artifacts. [Maintainer release guide](maintainers/releasing.md)

## Maintaining the checklist

Update the relevant product branch when scope or delivery changes. Keep each outcome in one place with its release stage and journey number. Check a parent only after its children and the combined outcome are verified. Record the date and implementation or release link when checking an item.

The [journey specifications](https://github.com/your-space-ai/your-space/blob/main/specs/README.md) preserve the build order and acceptance criteria. The [earlier delivery checklist](https://github.com/your-space-ai/your-space/blob/eb352241/docs/roadmap.md) preserves the dated implementation history.
