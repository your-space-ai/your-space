# 015 · Install apps from my private GitHub repositories

**Status**: Draft for the owner to iterate on. The direction is accepted; the decisions below are
open and nothing here is built.

**Created**: 2026-11-25

**Input**: The owner, 2026-11-25: "Lets bring back the ability to specify a kit from a private repo
by having the user connect their github account in the setting, then installing the kit tries to use
that connection to pull the kit if its not public. it should also support installing apps that are
private repos as well, as long as the signed in owner's github accuont has access to both."

**Decision record**: [Private GitHub sources](../../docs/architecture/decisions.md#private-github-sources)

## At a glance

- **Who:** the owner of a workspace whose kits, or the Compose files those kits pin, are in GitHub
  repositories that aren't public.
- **Done when:** the owner connects GitHub once, in the dashboard, and then installs from a kit's
  link exactly as today, whether the kit, its Compose file or both are private. Public installs
  work the same with or without the connection, and keep working when the connection is broken.
- **Not covered:** anything that writes to GitHub, managed repositories, agents reading
  repositories, and the rest of journey 011's creator workflow, which stays
  [deferred](../../docs/architecture/decisions.md#creator-workflow-deferred). Private container
  images are [decision 4](#4-private-container-images).

## Why

Since the alpha, every kit pins a Compose file in a public repository. The web client reads public
GitHub only, and a kit in a private repository installs only from this machine with
`install-app --kit -`. A kit whose Compose file is in a private repository can't install at all,
since `install-app --compose` left the alpha
([Alpha scope](../../docs/architecture/decisions.md#alpha-scope)). An owner who keeps their own kits
private, as many will while they are drafts, has no way to install them from the dashboard.

Constitution principle IV already asks for this: "Users must be able to install compatible apps
directly from GitHub repositories, including public repositories and private repositories
accessible through their connected account"
([constitution](https://github.com/your-space-ai/your-space/blob/main/.specify/memory/constitution.md#iv-make-apps-directly-installable)).

## Why a new journey, not 011

011 is the creator workflow: an agent builds a Home app, Your Space manages repositories, agents
commit to them, and the owner deploys from a commit. Its GitHub connection asked for write access
because those features needed it. This journey only reads, only for the owner's installs, and
ships on its own, with acceptance of its own. Amending 011 would tie it to deferred rows it doesn't
need. 011 keeps its history, and its **Install from a kit** row points here for private sources.

## What the 2026-11-23 cut found, and how this answers it

The connection was cut because "every operator had to register an OAuth app of their own, the
connection had never run against real GitHub, and rotating the data key left its stored token
unreadable" ([Creator workflow deferred](../../docs/architecture/decisions.md#creator-workflow-deferred)).

| Reason | Answer |
| --- | --- |
| Every operator registered an OAuth app | No option recommended in [decision 1](#1-how-the-owner-connects-github) needs one. A fine-grained token needs no app at all; a GitHub App would be registered once, by the project, with a client ID that ships with Your Space. |
| Never ran against real GitHub | [Acceptance](#acceptance) requires a recorded run against real GitHub, on a disposable account, before the journey is checked off. CI's stand-in GitHub covers the rest. |
| Rotating the data key left the token unreadable | The stored token moves to the new data key with everything else when the server starts after a rotation, and a test rotates the key with a connection in place ([decision 3](#3-storing-the-token-and-rotating-the-data-key)). A token no key can read shows **Reconnect** and never blocks a public install. |

The removed connection also asked for GitHub's `repo` scope for private access, which can read and
write every repository the account reaches. Every option recommended here reads only.

## Owner journey

1. **Connect.** The dashboard has a **GitHub** page beside Appearance and Engine (under Settings
   once [013](../013-workspace-redesign/spec.md)'s Settings arrives). The owner follows its steps,
   and the page then shows **Connected as @login**, what the connection can read, and
   **Disconnect**.
2. **Install a private kit.** The owner pastes a kit's link, as today. Your Space reads it from
   public GitHub first. If GitHub answers that it doesn't exist, Your Space tries again with the
   connection. The review marks the kit **Private**, read through the connection.
3. **Install a kit whose app is private.** The kit's `source` names a Compose file in a private
   repository, the kit's own or another. Your Space reads it the same way, at `source.commit`, and
   the review marks it **Private** too.
4. **Something is wrong.** The review says which of these it is, in plain words, and what to do:
   not connected; connected, but GitHub doesn't show this repository to the connection; the file
   isn't there at that commit; the connection no longer works; an image is private.
5. **Disconnect.** The owner removes the connection. Installed apps keep running. Your Space links
   to the place on GitHub where the owner deletes or revokes it there too.

The server command follows the same path ([decision 6](#6-the-web-client-and-the-server-command)).

## Requirements

- **R1. Public first.** Every read tries public GitHub without the connection first, and uses the
  connection only when GitHub answers 404. A public kit and Compose file never use it, so an
  unreadable, expired or revoked connection never stops a public review or install.
- **R2. Read only.** The connection is used only to resolve a ref to a commit and read one file at a
  commit, through GitHub's REST API: the commits and contents endpoints, which need **Contents:
  read** ([GitHub App permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps),
  [fine-grained token permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)).
  The contents API returns a file's text with the `application/vnd.github.raw+json` media type
  ([repository contents](https://docs.github.com/en/rest/repos/contents)). The existing limits
  hold: 256 KiB, UTF-8, exact 40-character commits.
- **R3. Same rules.** A private kit and a private Compose file go through the same checks as public
  ones. Nothing about the kit format changes ([kit format](../002-install-an-app/contracts/kit-format.md)).
- **R4. Provenance.** The installed app records, for its kit and its Compose file, that each was
  read through the connection and the GitHub login it belonged to, beside the repository, path and
  commit it already records. Reinstalling after a disconnect reads the files again and needs a
  connection again.
- **R5. The token stays on the server.** It is encrypted under the data key, never returned by any
  API, never logged, and never given to an app or an agent. The API reports only whether a
  connection exists, its login, when it last worked and whether GitHub still accepts it.
- **R6. One connection per workspace.** The owner holds it. It authorizes Your Space to fetch
  files; it doesn't grant an installed app anything (constitution principle IV: "Repository access
  does not grant an app access to workspace resources").
- **R7. Only on request.** The connection is used only while the owner reviews or installs. Nothing
  polls GitHub in the background, consistent with the no-telemetry rule
  ([spec map](../README.md#rules-every-spec-follows)).
- **R8. Docs.** The install guide gets a "Private kits" section with the connect steps, what the
  connection can read, and how to remove it at GitHub. The architecture overview's install path
  names the private read. Both land with the slice that ships them, not before.

## Decisions

Each decision lists its options and a recommendation. None is a default until the owner chooses.

### 1. How the owner connects GitHub

| Option | What the owner does | Reads only? | Reaches | Costs |
| --- | --- | --- | --- | --- |
| **A. Fine-grained personal access token, pasted** | The GitHub page opens GitHub's new-token page pre-filled with a name and `contents=read` ([pre-filling](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#pre-filling-fine-grained-personal-access-token-details-using-url-parameters)). The owner picks the account and repositories, creates it, and pastes it back. | Yes: Contents read on the repositories chosen | One account or organization per token: "Each token is limited to access resources owned by a single user or organization" ([fine-grained tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens)). Not repositories where the owner is an outside collaborator ([limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations)). | Copying a token. It expires when the owner says (1 to 366 days, or none unless an organization's policy forbids it). An organization can require approval or block these tokens. No registration by anyone, no sign-in flow to build. |
| **B. A GitHub App the project publishes, with the device flow** | **Connect GitHub** shows a short code; the owner enters it at GitHub and approves. The owner installs the app on each account that owns repositories it should read, choosing repositories. | Yes: the app asks for Contents read only | Repositories "that both the user and app can access" ([user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)), across every account where it's installed. An organization owner, or a repository admin for repositories they administer, installs it there ([installing](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)). | The project registers a **public** GitHub App, since a private one "can only be installed on the account that owns the app" ([public or private](https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/making-a-github-app-public-or-private)). That is a public resource in the project's name and needs the owner's explicit approval first. The device flow needs no client secret: "The `client_secret` is not needed for the device flow" ([device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#error-codes-for-the-device-flow)). Its tokens expire after 8 hours and refresh without the secret: the secret is "Required unless the user access token was generated using the device flow" ([refreshing](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)). A refresh token unused for 6 months means connecting again. GitHub warns against enabling the device flow without reason and notes that a public client ID can be reused by anyone ([best practices](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app#client-secrets)); here the reason is that every self-hosted workspace has its own address, so no fixed callback URL can serve them all, and the device flow is the flow GitHub provides for that case. The removed connection's device-flow code is in history to reuse. |
| **C. An OAuth app the project publishes, with the device flow** | As B, without installing anything. | **No.** No OAuth scope reads private code only: `repo` "Grants full access to public and private repositories including read and write access to code" ([scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps#available-scopes)) | Everything the account can reach, outside-collaborator repositories included | Fails [decision 2](#2-what-the-connection-may-do). GitHub itself prefers GitHub Apps ([differences](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)). |
| **D. The operator's own OAuth app** | The operator registers an app and sets its client ID; then as C. | No, as C | As C | The first reason the connection was cut. |

**The tension.** The owner asked for private repositories "as long as the signed in owner's github
account has access to both". Only C and D reach everything the account can, and they do it with
write access to all of it. A and B read only what the owner or an installer chose. Neither reaches a
repository where the owner is only an outside collaborator, unless its owner installs the app (B).

**Recommendation: A, the fine-grained token.** It reads only, needs nothing registered by anyone,
no sign-in flow, no refresh and no public resource in the project's name, and it covers the case in
front of us: kits, and the Compose files they pin, under one account or organization. The cost is
one paste, and one token per account that owns the repositories; the first slice holds one token.
If pasting, or kits spread across accounts, becomes a real problem, B is the upgrade: built against
the same concept (a credential that reads a source), it is a second adapter, not a redesign
(constitution principle VIII). Choose B now if a **Connect GitHub** button, rather than a paste, is
what "connect their github account" should mean.

### 2. What the connection may do

| Option | |
| --- | --- |
| **A. Contents read on the repositories the owner chooses** | Enough to resolve a commit and read a file (R2). Nothing else. |
| B. Contents read on all the account's repositories | Less to choose when connecting; more exposed if the token leaks. |
| C. Anything broader | No feature here needs it. |

**Recommendation: A.** With the token (decision 1 A), the owner chooses **Only select
repositories**; the page says to. With a GitHub App, the app requests Contents read only and the
installer picks repositories. Your Space never asks for more.

### 3. Storing the token and rotating the data key

| Option | |
| --- | --- |
| **A. One encrypted row under the data key, moved on rotation** | The token is stored like an app's secret settings ([spec 009](../009-encrypt-stored-data/spec.md)). The server's startup step that moves values onto a new data key, which today covers apps' settings, agent credentials and agent requests, covers it too. A test rotates the key with a connection in place and installs a private kit afterwards. A token no key can read is reported as **Reconnect**, never as an error in a public review. |
| B. A file in the `ys-secrets` volume | Avoids the data key, but adds a secret outside the database, against the "known storage" rule, and a second path for rotation and backup. |
| C. Not stored: the owner pastes a token for each install | Nothing to rotate, but no connection, and the owner retypes it every time. |

**Recommendation: A.** It is the gap that broke the last connection: its column wasn't in the
rotation step. With a GitHub App (decision 1 B), the refresh token is stored and moved the same way.

### 4. Private container images

A private app often publishes its images privately, for example on GHCR. Reading a repository
doesn't pull them. GHCR "only supports authentication using a personal access token (classic)",
with `read:packages` ([Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)),
and fine-grained tokens can't reach packages
([limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations)).
Docker's engine API takes registry credentials on a pull in an `X-Registry-Auth` header, but its
documentation shows no such header for the registry lookup Your Space uses to pin a digest without
pulling ([Docker Engine API v1.47](https://docs.docker.com/reference/api/engine/version/v1.47/)).

| Option | |
| --- | --- |
| **A. Out of scope: images must be public** | The review refuses an image the registry won't show without credentials, naming the image and saying images must be public for now. |
| B. A classic token with `read:packages` for GHCR | A second, broader kind of token, for one registry, and the pin lookup needs checking first. |
| C. Registry credentials per registry, like `docker login` | The general answer; a feature of its own. |

**Recommendation: A**, with the clear refusal. The kits in use today pull public images. C goes on the
roadmap as later direction for when a real private image needs it.

### 5. Revoking and disconnecting

| Option | |
| --- | --- |
| **A. Disconnect forgets the token here; the owner revokes it at GitHub** | **Disconnect** deletes the stored token at once. The page links to where the owner deletes the token, or revokes a GitHub App's authorization, at GitHub. Installed apps keep running and keep their records. A token GitHub refuses (expired, deleted, revoked) is marked on its next use, and the GitHub page and the review show **Reconnect**. |
| B. Disconnect also stops or removes apps installed from private sources | Breaks the rule that disconnecting a source must not "uninstall it, or delete its data" ([distribution direction](../../docs/architecture/decisions.md#accepted-future-app-distribution-direction)). |
| C. Your Space revokes at GitHub | Not possible for B without the app's secret: GitHub's revoke endpoints need "the `client_secret` as the password" ([OAuth authorizations API](https://docs.github.com/en/rest/apps/oauth-applications)). A user revokes a GitHub App's authorization in their own settings ([reviewing and revoking](https://docs.github.com/en/apps/using-github-apps/reviewing-and-revoking-authorization-of-github-apps)). |

**Recommendation: A.** Nothing checks the token in the background (R7); a broken one is found when
the owner next needs it, and never affects what is already running.

### 6. The web client and the server command

`install-app` runs in the server's container with its database and data key, so it can use the
stored connection.

| Option | |
| --- | --- |
| **A. One connection, used by both** | The owner connects in the web client. `install-app <kit-link>` reads private files through it too, and `install-app --kit -` uses it for a private Compose file the kit names. Without a connection, `--kit -` keeps working for a kit whose Compose file is public. |
| B. Web client only | The server command stays public-only apart from `--kit -`, and a private Compose file can't install from it. |
| C. A as well as connecting from the command (`github connect --token -`) | For a server the owner never opens in a browser. The browser is the dashboard, so it can wait for a real need. |

**Recommendation: A.**

### 7. What the install review shows about a private source

| Option | |
| --- | --- |
| **A. Label each private file and name the connection** | The kit and the Compose file each show **Private · read with your GitHub connection (@login)** beside the pinned link. When the Compose file is in a different private repository from the kit, the review says so: "This kit reads `<owner>/<repo>` with your GitHub connection." Confirming the install is the owner's consent to that read. The four problems in the journey each get their own message. |
| B. The same review as for public sources | Hides that a kit, possibly written by someone else, reads a private repository through the owner's connection. |
| C. A, and refuse a kit whose private Compose file is in a different repository from the kit | The rule the intermediate design in the 2026-11-23 cut used. It contradicts the owner's request for private apps with kits elsewhere. |

**Recommendation: A.** A kit someone else wrote can name a private repository the owner can read.
Saying so in the review, before the owner confirms, makes that read visible without forbidding the
case the owner asked for.

### 8. When it ships

| Option | |
| --- | --- |
| **A. Alpha.2** | Private kits install from the dashboard in the next prerelease. |
| B. Later direction, timing open | Waits behind the rest of alpha.2. |

**Recommendation: A.** Kits are often private while they are drafts, and the kits used to try
journeys such as [014](https://github.com/your-space-ai/your-space/pull/123) are private today, so
they can't install on the alpha.

## Acceptance

**In CI**, with the stand-in GitHub the browser journeys already use:

- Connecting shows the login; Disconnect removes it; the API never returns the token.
- A private kit, a public kit naming a private Compose file, and a private kit naming a private
  Compose file in another repository each install, and the review labels each private file.
- With no connection, with a token GitHub refuses, and with a token no key can read, a public kit
  still installs, and a private one shows the matching message.
- The repository-not-visible, file-missing and private-image cases each show their message.
- Rotating the data key with a connection in place, then restarting, keeps the connection, and a
  private kit installs afterwards.
- `install-app <private-kit-link>` installs through the connection, and `--kit -` with a private
  Compose file does too.
- The token appears in no log, no API response, no app's environment and no agent's request.

**Against real GitHub**, before the journey is checked off: a maintainer run on a fresh install,
with a disposable GitHub account and a disposable organization, recorded in the PR with the commit
it ran on:

1. Connect with a token for the organization, Contents read, only select repositories.
2. Install from a private kit whose Compose file is public, then from a private kit whose Compose
   file is in a second private repository; open each app.
3. Try a kit in a repository the token wasn't given; see the not-visible message.
4. Rotate the data key, restart, and install again from a private kit.
5. Delete the token at GitHub; see **Reconnect** on the next private review, and install a public
   kit.
6. Disconnect; the apps keep running.

The stand-in can't show that GitHub's real answers, a private repository's 404 and the contents
API's raw text among them, match what Your Space expects; only the live run does.

## Delivery slices

Each slice ends with something the owner sees in the browser.

| Slice | Delivers | The owner sees |
| --- | --- | --- |
| 1. Connect | The GitHub page, storing the token (decision 3), the rotation step and its test, Disconnect, and the docs' connect steps | **Connected as @login** on the GitHub page, and the page back to **Connect** after Disconnect |
| 2. Private kits | Public-first reads with the connection on a 404, the review's labels and messages, provenance, and the server command | A private kit's review labelled **Private**, and its app open in a pane |
| 3. Private apps | The kit's Compose file read through the connection, the second-repository line, and the private-image refusal | A kit with a private Compose file reviewed and installed, and a private image refused with its message |
| 4. Live run | The real-GitHub run above, any fixes it finds, and the overview and roadmap checked off | The recorded run's screenshots on the PR |

## Concept and adapter

The concept is a **source credential**: something that lets Your Space read a file at a commit in a
source it can't read anonymously. Its first adapter is a GitHub token. Only the GitHub source code
knows how the token is sent (constitution principle VIII), so a GitHub App's token, or another
host's, is another adapter.

[Install apps](../../docs/apps/install-apps.md) · [Kit format](../002-install-an-app/contracts/kit-format.md) · [Journey 011](../011-agent-workspace/spec.md)
