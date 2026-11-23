---
title: "Manage app source and installation kits"
---

Connect a GitHub account in **Repositories**. Choose public access or opt into private access. The workspace lists repositories it created, forked or imported under that connected account. Enter an existing repository's owner and name to import it. From an installed GitHub-backed app, choose **Customize** to start from its source. GitHub applies the parent network's visibility and the organization's fork policy. A fork of a private upstream can stay private where GitHub permits it. A fork of a public upstream belongs to its public fork network. [Connect GitHub](github-connection.md) · [GitHub fork permissions and visibility](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/about-permissions-and-visibility-of-forks)

## Give an agent repository access

Choose its identity under **Repository access**. Select each managed repo it can read and edit. You can also allow creating repos and forking sources of installed apps or its explicitly granted repos. An agent receives edit access to the new repo it creates or forks. Changes to these grants require an owner session. Disconnecting revokes the local account credential and repository grants.

The agent sends its Your Space bearer key to `/api/agent/repositories` on this workspace. The gateway attaches the GitHub credential on outbound GitHub requests. Repository IDs are GitHub's numeric IDs, encoded as strings.

| Operation | Method and path under the prefix | Fields |
| --- | --- | --- |
| Discover allowed repositories | GET / | Returns repos, canCreate and canFork |
| Create a repository | POST /create | name, private |
| Fork an authorized upstream | POST /fork | fullName, optional name |
| Read a regular UTF-8 file | GET /file | repoId, path and optional ref as query parameters |
| Create or edit a file | PUT /file | repoId, path, branch, message, content and the previous file sha when replacing it |

File reads return content and SHA. Writes return the new commit and file SHA. If GitHub reports a conflict, read the new revision before editing. Creating a custom app can start with the three [scaffold files](build-an-app.md). The owner confirms deployment of the selected commit through the dashboard.

## Install a kit from GitHub

Every app installs from its kit. In **Apps**, paste the GitHub link to a kit YAML file and review the installation preview, or choose a kit under **Kit directory**. A fresh workspace can use kit links and local kit files without configuring a directory. With a connected GitHub account, Your Space reads the kit through it, so a kit in a private repository works when the connection includes private repositories. To use a kit file on this machine, run `docker compose exec -T server install-app --kit - < kit.yaml` in the installation folder; the kit names the app's public Compose file. A kit names its Compose file's repository, path and exact commit, and Your Space reads the file at that commit, never at a branch's latest one. Import a separate private Compose repository before following a kit's reference to it. The installation records the kit's commit, resolved when you review, and the Compose commit the kit pins.

To install from a repository you manage, choose **Install new app** on it and give a branch, tag or commit and the path of its kit, such as `kit.yaml`. Your Space reads the kit at the commit that resolves to, and the Compose file the kit names at the commit the kit pins. A kit beside its Compose file names an earlier commit than its own: commit the Compose file first, then the kit with that commit.

To offer a directory, set `YS_KITS_REPOSITORY=owner/repository` in the workspace’s `.env` and recreate the server with `docker compose up -d`. Choose a repository you trust to publish kit reviews. Your Space lists `apps/<upstream-owner>/<upstream-repo>.yaml` from its default branch and pins each entry to a commit. The web directory uses the workspace owner’s connected GitHub account when available. The directory lists kits and holds their reviews; it no longer finds a kit from a Compose link. Review status requires matching repository, path and content digest for the attested kit commit. A review continues to apply across unrelated commits only if the kit bytes match that revision. Your Space looks up this evidence in `reviews/sha256/<digest>.json` on the configured repository’s default branch. Owners still choose every agent grant.

## Apply an in-place change

Select an existing installation and review the candidate commit, services, image digests and storage impact. A custom image must be available to the runtime and named by digest. The HTML starter can update through `app pack`. Changes that require different mounts, service topology or settings require a separate migration. Compatible deployments keep the installation ID, settings and attached named volumes. The owner reviews agent access again after the source changes. If startup fails, Your Space attempts to reapply the previous Compose and recorded image versions. Application-level data written by the new version needs the app's own recovery plan.

If deployment is interrupted, reconnect the same GitHub account, reopen the repository and select the installation under **Update an installed app**. Your Space retrieves the reviewed commit, image digests and volumes. Choose **Resume reviewed deployment** to confirm and continue.

If the confirmation response is lost, the owner can check the exact deployment with
`GET /api/repositories/:id/deploy/receipt`. Supply `appId`, `previewId` and the full reviewed
`commit` as query parameters. The response contains `receipt` with the app ID, repository ID,
commit and `applied` status when that review completed under the connected GitHub account.
While that exact review is in the `applying` state, the response includes `applying: true` and a
null receipt. A client can recheck for completion. Other unconfirmed outcomes return only a
null receipt. Checking a receipt never starts or resumes a deployment.
