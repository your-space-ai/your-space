# Contributing to Your Space

Thanks for your interest in Your Space. Before you start, read the [roadmap](docs/roadmap.md) and
the [architecture and product decisions](docs/architecture/decisions.md). For larger changes, open
an issue first so we can agree on the direction before you write code.

## Find your way around

| Location | What lives there |
| --- | --- |
| [web/](web/) and [desktop/](desktop/) | The browser dashboard and the Electron Mac launcher. |
| [server/](server/) | The workspace HTTP API, authorization and PostgreSQL migrations. |
| [runtime/](runtime/) | The service that manages installed apps with Docker. |
| [cli/](cli/) | The command for setting up and operating a workspace. |
| [shared/](shared/) | The [theme model](shared/appearance/) and [pane-layout model](shared/workspace-layout/) used by multiple packages. |
| [deploy/](deploy/) | The Compose stack, edge proxy configuration and release files. |
| [e2e/](e2e/) | Playwright tests, their disposable Compose stack and sample app fixtures. |
| [docs/](docs/README.md) and [specs/](specs/README.md) | User and maintainer guides, and the numbered feature specifications with their acceptance criteria. |

## Run the local checks

Use Node.js 26 or later and npm. The server tests need a disposable PostgreSQL 18 instance.
Set `TEST_DATABASE_URL` to a database on that instance using a role that can create databases.
The tests create and drop their own databases. Run these commands from the repository root.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

To exercise the CLI and Docker together, follow the [CLI acceptance walkthrough](specs/003-install-with-the-cli/quickstart.md).

## Sign off your commits (DCO)

Contributions are accepted under the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO). By signing off a commit you certify that you wrote it, or otherwise have the right to submit
it under the project's license. You keep the copyright to your contribution.

Add a sign-off to every commit with `git commit -s`, which appends a line like this:

```
Signed-off-by: Your Name <you@example.com>
```

The name and email must match the commit author. Every PR gets a sign-off check. The
organization-member exception requires a signature verified for the commit author and public
organization membership. Members with private membership can sign off normally. To sign off commits you already made, run `git rebase --signoff main` and
force-push the branch.

## Licensing of contributions

Your contribution is licensed under the license of the part of the project it changes:

- Your Space itself (server, runtime, web client, CLI and desktop app): [AGPL-3.0-only](LICENSE).
- The SDKs, once published from this repository: MIT, as stated in each SDK package.

SDK code must not import or copy code from the AGPL parts of the repository. SDKs talk to Your
Space only through its public APIs and contracts.

## Pull requests

- Describe your pull request with the [template](.github/pull_request_template.md).
- Run the [local checks](#run-the-local-checks) for your change before pushing.
- Keep each pull request to one change.
- Look for **Contribution checks**. For code changes it includes unit tests, typechecks and
  builds. Public code PRs also exercise Compose and Chromium on disposable GitHub-hosted
  runners. These checks use synthetic accounts and apps. You don’t need any project credentials.
  A maintainer may need to approve the run from a fork.

Maintainers can run the full GitHub checks on `main` with `gh workflow run ci.yml --ref main`
or **Actions → CI → Run workflow**. This runs the workspace, Compose and Chromium checks on
GitHub-hosted runners.

## Security issues

Don't report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).

## Code of conduct

Everyone taking part in this project is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).
