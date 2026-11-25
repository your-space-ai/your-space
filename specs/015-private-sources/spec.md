# 015 · Install apps from my private GitHub repositories

**Status**: Accepted 2026-11-25, for alpha.2. The owner settled every decision below. Slice 1
(Connect) delivered 2026-11-25 in [PR #130](https://github.com/your-space-ai/your-space/pull/130);
slices 2–5 to come.

**Created**: 2026-11-25

**Input**: The owner, 2026-11-25: "Lets bring back the ability to specify a kit from a private repo
by having the user connect their github account in the setting, then installing the kit tries to use
that connection to pull the kit if its not public. it should also support installing apps that are
private repos as well, as long as the signed in owner's github accuont has access to both."

**Decision record**: [Private GitHub sources](../../docs/architecture/decisions.md#private-github-sources)

## At a glance

- **Who:** the owner of a workspace whose kits, or the Compose files those kits pin, are in GitHub
  repositories that aren't public.
- **Done when:** the owner connects GitHub once, in the dashboard or with a server command, and
  then installs from a kit's link exactly as today, whether the kit, its Compose file, its images on
  GHCR, or all of them are private. Public installs
  work the same with or without the connection, and keep working when the connection is broken.
- **Not covered:** anything that writes to GitHub, managed repositories, agents reading
  repositories, and the rest of journey 011's creator workflow, which stays
  [deferred](../../docs/architecture/decisions.md#creator-workflow-deferred). Registries other than
  GHCR ([decision 4](#4-private-container-images)).

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
| Every operator registered an OAuth app | Nobody registers anything: the owner pastes a fine-grained token ([decision 1](#1-how-the-owner-connects-github)). |
| Never ran against real GitHub | [Acceptance](#acceptance) requires a recorded run against real GitHub, on a disposable account, before the journey is checked off. CI's stand-in GitHub covers the rest. |
| Rotating the data key left the token unreadable | The stored token moves to the new data key with everything else when the server starts after a rotation, and a test rotates the key with a connection in place ([decision 3](#3-storing-the-tokens-and-rotating-the-data-key)). A token no key can read shows **Reconnect** and never blocks a public install. |

The removed connection also asked for GitHub's `repo` scope for private access, which can read and
write every repository the account reaches. This one reads only: contents on the repositories the
owner picks, and, if the owner adds it, packages.

## Owner journey

1. **Connect.** The dashboard has a **GitHub** page beside Appearance and Engine (under Settings
   once [013](../013-workspace-redesign/spec.md)'s Settings arrives). It opens GitHub's new-token
   page pre-filled, the owner creates a fine-grained token with Contents read on the repositories
   they choose, and pastes it. The page then shows **Connected as @login** and **Disconnect**.
2. **Add an image token, if needed.** For private images on GHCR, the owner also pastes a classic
   token with only `read:packages`. The page shows it as a separate line, **Images: @login**, which
   the owner can add, replace or remove on its own.
3. **Install a private kit.** The owner pastes a kit's link, as today. Your Space reads it from
   public GitHub first. If GitHub answers that it doesn't exist, Your Space tries again with the
   connection. The review marks the kit **Private**, read through the connection.
4. **Install a kit whose app is private.** The kit's `source` names a Compose file in a private
   repository, the kit's own or another. Your Space reads it the same way, at `source.commit`, and
   the review marks it **Private** too. A private GHCR image is pulled with the image token and
   marked **Private image**.
5. **Something is wrong.** The review says which of these it is, in plain words, and what to do:
   not connected; connected, but GitHub doesn't show this repository to the connection; the file
   isn't there at that commit; a token no longer works; an image is private and there is no image
   token, or the image token can't read it.
6. **Disconnect.** The owner removes the connection, both tokens. Installed apps keep running. The
   page tells the owner to delete the tokens at GitHub too, and links there.

Every action on the GitHub page is also a server command
([decision 6](#6-one-connection-managed-from-the-web-client-or-the-server-command)): the page is a
wrapper over the same actions.

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
  hold: 256 KiB, UTF-8, exact 40-character commits. One other request is allowed: asking GitHub
  which account a token belongs to (`GET /user`), when the owner connects or adds the image token
  and when the GitHub page or `github status` shows the state. It gives the login for **Connected
  as @login**; a token GitHub refuses is reported as not accepted, and the owner is asked to connect
  again. For the image token, the same response's `X-OAuth-Scopes` header
  ([scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps))
  must list `read:packages` and nothing more, or the token is refused before it is stored. The
  image token is used for nothing but signing the engine in to `ghcr.io` (R9).
- **R3. Same rules.** A private kit and a private Compose file go through the same checks as public
  ones. Nothing about the kit format changes ([kit format](../002-install-an-app/contracts/kit-format.md)).
- **R4. Provenance.** The installed app records, for its kit and for its Compose file separately,
  how each was read: anonymously, or through the connection with the GitHub login it belonged to,
  beside the repository, path and commit it already records. A public kit naming a private Compose
  file records the kit as read anonymously and only the Compose file as read through the connection.
  Reinstalling after a disconnect reads the files again and needs a connection again for those read
  through it.
- **R5. The tokens stay on the server.** Both are encrypted under the data key, never returned by
  any API or command, never logged, and never given to an app or an agent. The API and `github
  status` report only whether each token is set, its login, when it last worked and whether GitHub
  still accepts it.
- **R6. One connection per workspace.** The owner holds it: one contents token and an optional
  image token. It authorizes Your Space to fetch files and pull images; it doesn't grant an
  installed app anything (constitution principle IV: "Repository access
  does not grant an app access to workspace resources").
- **R7. Only on request.** The connection is used only while the owner reviews or installs, and for
  the account check in R2 when the owner connects or checks its state. Nothing
  polls GitHub in the background, consistent with the no-telemetry rule
  ([spec map](../README.md#rules-every-spec-follows)).
- **R8. Docs.** The install guide gets a "Private kits" section with the connect steps in the
  dashboard and with the server command, what each token can read, the classic token's limits, and
  how to delete the tokens at GitHub. The architecture overview's install path names the private
  reads and the registry sign-in. Each lands with the slice that ships it, not before.
- **R9. Private images.** When a kit's image is on `ghcr.io` and the registry won't show it without
  credentials, Your Space retries with the image token, given to the engine as registry
  credentials for that pull only (Docker's `X-Registry-Auth` on the pull,
  [Docker Engine API v1.47](https://docs.docker.com/reference/api/engine/version/v1.47/)). The
  engine's API documents no credentials for the lookup Your Space uses to pin a digest without
  pulling, so the plan checks whether it accepts them; if not, Your Space pulls the image with the
  credentials and pins the digest the pulled image reports. Nothing is written to a Docker config
  file. Other registries stay public-only, with a message that says so.

## Decisions

The owner settled these on 2026-11-25. The options weighed and their sources are kept below each,
for when one is revisited.

### 1. How the owner connects GitHub

**Accepted: a fine-grained personal access token, pasted by the owner.** (Owner: "Fine-grained
token".) The GitHub page opens GitHub's new-token page pre-filled with a name and `contents=read`
([pre-filling](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#pre-filling-fine-grained-personal-access-token-details-using-url-parameters));
the owner picks the account and repositories, creates it and pastes it back. Nobody registers an
app, and there is no sign-in flow or refresh to build.

Its limits, stated in the guide: "Each token is limited to access resources owned by a single user
or organization"
([fine-grained tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens)),
so the first slice reaches one account or organization; it can't reach repositories where the owner
is only an outside collaborator
([limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations));
it expires when the owner chooses, 1 to 366 days or none unless an organization's policy forbids
it; and an organization can require approval for it or block it. The owner's request reached
"both" repositories the account can access; read-only access to everything the account reaches
isn't offered by any GitHub token type, so a second account is a second token, later, if needed.

Considered and not chosen:

- **A GitHub App the project publishes, with the device flow.** It reads only, across every account
  where it is installed: a user access token reaches what "both the user and app can access"
  ([user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)).
  It needs no client secret ("The `client_secret` is not needed for the device flow",
  [device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#error-codes-for-the-device-flow)),
  and its 8-hour tokens refresh without one
  ([refreshing](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)).
  But the project would register a public app in its name, since a private one "can only be
  installed on the account that owns the app"
  ([public or private](https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/making-a-github-app-public-or-private)),
  the owner installs it on each account
  ([installing](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)),
  and GitHub warns against the device flow without reason
  ([best practices](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app#client-secrets)).
  It stays the upgrade path: a second adapter for the same concept, not a redesign.
- **An OAuth app the project publishes.** No OAuth scope reads private code only: `repo` "Grants
  full access to public and private repositories including read and write access to code"
  ([scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps#available-scopes)).
- **The operator's own OAuth app.** The first reason the connection was cut.

### 2. What the connection may do

**Accepted: Contents read only, on the repositories the owner chooses.** (Owner: "yes, contents read
only".) That is enough to resolve a commit and read a file (R2). The GitHub page tells the owner to
choose **Only select repositories**. The image token (decision 4) is the one exception, and it only
reads packages.

### 3. Storing the tokens and rotating the data key

**Accepted: encrypted under the data key and moved on rotation, with a test.** (Owner: "yes, encrypt
under the data key".) Both tokens are stored like an app's secret settings
([spec 009](../009-encrypt-stored-data/spec.md)). The server's startup step that moves values onto a
new data key, which today covers apps' settings, agent credentials and agent requests, covers them
too; leaving the token out of that step is what broke the last connection. A test rotates the key
with a connection in place and installs a private kit afterwards. A token no key can read shows
**Reconnect**, never an error in a public review.

Considered: a file in the `ys-secrets` volume, which adds a secret outside the database and a second
rotation path; and not storing it, which means pasting a token for every install.

### 4. Private container images

**Accepted: in scope, with a second, optional token for GHCR.** (Owner: "ok, two tokens with
optional classic for images".) This changes the recommendation to leave private images out.
GitHub's container registry "only supports authentication using a personal access token (classic)"
([Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)),
and fine-grained tokens can't reach packages
([limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations)),
so the connection holds two tokens:

- **The contents token**, fine-grained, Contents read, for kits and Compose files (decision 1).
- **The image token**, optional: a classic token with only `read:packages`, "to download container
  images and read their metadata", used only to sign the engine in to `ghcr.io` when it pulls a
  private image (R9).

The image token is a slot of its own, apart from the contents token, so if fine-grained tokens gain
packages, it becomes a token swap. Its limits, stated on the GitHub page and in the guide:

- A classic token's scopes aren't limited to chosen repositories, so `read:packages` reads every
  package the account can see.
- An organization can stop classic tokens from reaching its resources
  ([token policy](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization)).
- An organization with SAML single sign-on must have the token authorized: "You must authorize your
  personal access token (classic) after creation before the token can access an organization that
  uses SAML single sign-on"
  ([single sign-on](https://docs.github.com/en/enterprise-cloud@latest/authentication/authenticating-with-single-sign-on/authorizing-a-personal-access-token-for-use-with-single-sign-on)).

GitHub's documentation gives no date for retiring classic tokens. Registries other than GHCR stay
public-only for now, and the review says so; general per-registry credentials are later direction.

### 5. Revoking and disconnecting

**Accepted: Disconnect forgets the tokens here; the owner revokes them at GitHub.** (Owner agreed to
each point.)

- **Disconnect** deletes both stored tokens at once, and the page, or the command's output, tells the
  owner to delete them at GitHub too, with the link. Removing only the image token works the same.
- Installed apps keep running and keep their records. Disconnecting a source must not "uninstall it,
  or delete its data"
  ([distribution direction](../../docs/architecture/decisions.md#accepted-future-app-distribution-direction)).
- A token GitHub refuses (expired, deleted, revoked) is marked on its next use: the GitHub page and
  `github status` show **Reconnect**, and a private install fails with a message that says which
  token to replace. Nothing checks the tokens in the background (R7).

Your Space can't revoke a token at GitHub for the owner: a personal access token is deleted in the
owner's own settings.

### 6. One connection, managed from the web client or the server command

**Accepted: one connection, used by both, and managed from either.** (Owner: "shouldn't matter where
i set it up, i should be able to manage from cli as well ui is like a cli wrapper on behalf of the
user".)

- `install-app <kit-link>` reads private files through the connection, as the web client does, and
  `install-app --kit -` uses it for a private Compose file or image the kit names. Without a
  connection, `--kit -` keeps working for a kit whose Compose file and images are public.
- A `github` server command has the GitHub page's actions: `github connect` (the contents token),
  `github status`, `github image-token` (add or replace it) and `github disconnect` (both, or
  `--image-token` for that one alone). It runs like the other server commands
  (`docker compose exec server github status`) and takes `--json`.
- Tokens are read from a hidden prompt, or from standard input when it isn't a terminal
  (`docker compose exec -T server github connect < token.txt`), never from the command line, where
  they would reach shell history and process lists.
- The GitHub page calls the same server actions, so the page and the command can't drift.

### 7. What the install review shows about a private source

**Accepted.** (Owner: "if i added my credentials, and i pasted in a private repo link, it should be
fine.")

- A **Private · read with your GitHub connection (@login)** label on each file read through the
  connection, beside its pinned link.
- A line when the kit pins a Compose file from a different private repository: "This kit reads
  `<owner>/<repo>` with your GitHub connection."
- A **Private image** label on each image pulled with the image token.
- No install until the owner confirms, as for every install. There is no prompt before reading: the
  owner gave the connection and pasted the link, and what the review reads stays in the owner's own
  review on their own server until they confirm.
- Each problem in the journey gets its own message.

Considered: the same review as for public sources, which hides that a kit reads a private
repository through the owner's connection; and refusing a private Compose file in another
repository, the rule of the intermediate design in the 2026-11-23 cut, which contradicts the
owner's request.

### 8. When it ships

**Accepted: alpha.2.** (Owner: "yes, everything we're doing is towards alpha 2".) Kits are often
private while they are drafts, and private kits can't install from the dashboard on the alpha.

## Acceptance

**In CI**, with the stand-in GitHub the browser journeys already use:

- Connecting shows the login; Disconnect removes both tokens; neither the API nor any command
  returns a token.
- The `github` server command connects, reports status, adds and replaces the image token and
  disconnects, with the same results the GitHub page shows; a token given as an argument is
  refused, and one given on standard input is accepted.
- An image token whose scopes are more than `read:packages` is refused before it is stored.
- A private kit, a public kit naming a private Compose file, and a private kit naming a private
  Compose file in another repository each install, and the review labels each private file.
- With no connection, with a token GitHub refuses, and with a token no key can read, a public kit
  still installs, and a private one shows the matching message.
- The repository-not-visible and file-missing cases each show their message.
- A private GHCR image pulls with the image token, is pinned to its digest and is labelled **Private
  image**; without the image token, or with one that can't read it, the review says which, and a
  private image on another registry is refused with its message.
- Rotating the data key with a connection in place, then restarting, keeps the connection, and a
  private kit installs afterwards.
- `install-app <private-kit-link>` installs through the connection, and `--kit -` with a private
  Compose file does too.
- Neither token appears in any log, API response, command output, Docker config file, app's
  environment or agent's request.

**Against real GitHub**, before the journey is checked off: a maintainer run on a fresh install,
with a disposable GitHub account and a disposable organization, recorded in the PR with the commit
it ran on:

1. Connect with a fine-grained token for the organization, Contents read, only select
   repositories, from the GitHub page. Check `github status` shows the same.
2. Install from a private kit whose Compose file is public, then from a private kit whose Compose
   file is in a second private repository; open each app.
3. Add a classic token with only `read:packages` with `github image-token`, and install a kit whose
   image is a private package on GHCR; open the app.
4. Try a kit in a repository the token wasn't given; see the not-visible message.
5. Rotate the data key, restart, and install again from a private kit.
6. Delete the contents token at GitHub; see **Reconnect** on the next private review, and install a public
   kit.
7. Disconnect with `github disconnect`; the GitHub page shows Connect, and the apps keep running.

The stand-in can't show that GitHub's real answers, a private repository's 404, the contents API's
raw text and GHCR's answer to the engine's sign-in among them, match what Your Space expects; only
the live run does.

## Delivery slices

Each slice ends with something the owner sees in the browser.

| Slice | Delivers | The owner sees |
| --- | --- | --- |
| 1. Connect | The GitHub page and the `github` server command for the contents token, storing it (decision 3), the rotation step and its test, Disconnect, and the docs' connect steps | **Connected as @login** on the GitHub page, also after connecting with the command, and the page back to **Connect** after Disconnect |
| 2. Private kits | Public-first reads with the connection on a 404, the review's labels and messages, provenance, and the server command | A private kit's review labelled **Private**, and its app open in a pane |
| 3. Private apps | The kit's Compose file read through the connection and the second-repository line | A kit with a private Compose file reviewed and installed |
| 4. Private images | The image token on the GitHub page and in `github image-token`, its scope check, signing the engine in to GHCR for a pull, pinning, and the review's labels and messages | **Images: @login** on the GitHub page, and a kit with a private GHCR image reviewed with **Private image** and installed |
| 5. Live run | The real-GitHub run above, any fixes it finds, and the overview and roadmap checked off | The recorded run's screenshots on the PR |

## Concept and adapter

Two concepts, each with its first adapter (constitution principle VIII):

- A **source credential** lets Your Space read a file at a commit in a source it can't read
  anonymously. Its first adapter is a fine-grained GitHub token; only the GitHub source code knows
  how it is sent, so a GitHub App's token, or another host's, is another adapter.
- A **registry credential** lets the engine pull an image a registry won't give anonymously. Its
  first adapter is the classic GitHub token for `ghcr.io`; only the runtime manager, which already
  talks to the engine, passes it on. A fine-grained token with packages, or another registry's
  credentials, is another adapter.

[Install apps](../../docs/apps/install-apps.md) · [Kit format](../002-install-an-app/contracts/kit-format.md) · [Journey 011](../011-agent-workspace/spec.md)
