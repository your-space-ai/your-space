# Manage app source and installation kits

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

Open **Apps → Kit directory**, choose a listing or paste a GitHub link to its YAML file, then review the ordinary installation preview. The directory reads the configured kits repository, at its pinned commit, from `apps/<upstream-owner>/<upstream-repo>.yaml`. A linked kit can name the target repository and Compose path. A co-located kit without a source uses a sibling `compose.yaml`. Import a separate private source repository before following a kit's reference to it. Installation records include the resolved kit and Compose revisions. Directory inclusion grants no agent permissions.

## Apply an in-place change

Select an existing installation and review the candidate commit, services, image digests and storage impact. A custom image must be available to the runtime and named by digest. The HTML starter can update through `app pack`. Changes that require different mounts, service topology or settings require a separate migration. Compatible deployments keep the installation ID, settings and attached named volumes. The owner reviews agent access again after the source changes. If startup fails, Your Space attempts to reapply the previous Compose and recorded image versions. Application-level data written by the new version needs the app's own recovery plan.
