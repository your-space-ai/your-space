# Contributing to Your Space

Thanks for your interest in Your Space. Before you start, read the [roadmap](docs/roadmap.md) and
the [architecture and product decisions](docs/architecture/decisions.md). For larger changes, open
an issue first so we can agree on the direction before you write code.

## Sign off your commits (DCO)

Contributions are accepted under the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO). By signing off a commit you certify that you wrote it, or otherwise have the right to submit
it under the project's license. You keep the copyright to your contribution.

Add a sign-off to every commit with `git commit -s`, which appends a line like this:

```
Signed-off-by: Your Name <you@example.com>
```

The name and email must match the commit author. A check on every pull request rejects commits
without a sign-off. To sign off commits you already made, run `git rebase --signoff main` and
force-push the branch.

## Licensing of contributions

Your contribution is licensed under the license of the part of the project it changes:

- Your Space itself (server, runtime, web client, CLI and desktop app): [AGPL-3.0-only](LICENSE).
- The SDKs, once published from this repository: MIT, as stated in each SDK package.

SDK code must not import or copy code from the AGPL parts of the repository. SDKs talk to Your
Space only through its public APIs and contracts.

## Pull requests

- Describe your pull request with the [template](.github/pull_request_template.md).
- Run the checks locally before pushing: `npm run typecheck` and `npm test`.
- Keep each pull request to one change.

## Security issues

Don't report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).

## Code of conduct

Everyone taking part in this project is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).
