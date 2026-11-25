---
title: "Checking an outside contribution"
---

The required **Contribution checks** job includes sign-off verification, [Migration order](#migration-order) and the code checks selected by the PR diff. A separate **Dependency review** check uses GitHub's MIT-licensed [Dependency Review Action v5.0.1](https://github.com/actions/dependency-review-action/tree/bbc44d14a204704ccc493733616cd1e93a0321ec) to read the dependency graph diff. It fails on newly introduced moderate or higher advisories, including development tools, but it is not required: a failure is a clear signal to read the advisory, and a maintainer can still merge after deciding the risk is acceptable, for example a development-only tool that never ships. It runs on a hosted runner with read-only access. The action ships only in CI. Existing vulnerabilities have separate Dependabot, CodeQL and container scans.

Before approving an external run, inspect the changed workflow and every script it invokes. GitHub Actions requires approval for all external contributors. Keep fork tokens read-only, secrets unavailable, and PR jobs on GitHub-hosted runners. Keep building fork pull requests and sharing secrets with forks turned off in the public repository's CircleCI project settings, which aren't stored in the repository. CircleCI status is optional for external PRs: only Contribution checks is required. Full browser coverage runs on main. Mac signing runs on a GitHub-hosted runner in the protected `macos-release` environment, reached only from Release draft on main; no workflow runs on a maintainer's machine. Keep signing secrets on that environment, never on the repository, and keep pull request triggers out of the signing workflow. Check these settings again when adding a trigger.

## Migration order

Contribution checks requires **Migration order**, which keeps the server's migrations in `server/drizzle/` append-only ([spec 016, decision 8](https://github.com/your-space-ai/your-space/blob/main/specs/016-release-channels/spec.md#8-migrations-on-main)). It refuses a pull request that changes, deletes or renames a migration already on `main`: its journal entry in `meta/_journal.json`, its `.sql` file or its `meta/NNNN_snapshot.json`. It also refuses a new migration that isn't the next `idx`, whose tag doesn't start with that `idx`, or whose `when` stamp isn't later than every stamp before it or is more than a day ahead of the check's clock, and a new `.sql` file or snapshot without its own new journal entry, or an entry without both. `npm run db:generate` writes all three. Drizzle runs only migrations stamped later than the newest a database records, and never reads one again once applied, so a database that followed Canary would skip either mistake without an error.

The check compares the pull request's head with `main` as it is when the check runs, which the checkout fetches, rather than the base the pull request event names, so a stacked pull request and a re-run are checked against what they would merge into. A pull request that changes none of the migration files in `server/drizzle/`, the journal, the `.sql` files and the snapshots, passes however far behind `main` it is. On `main`, each push is compared with the commit before it, as an alarm. Run it locally with `node server/scripts/check-migrations.mjs origin/main HEAD` after `git fetch origin main`.

The job runs the pull request's own copy of `server/scripts/check-migrations.mjs`, as every job runs the pull request's workflow, so a change to the script or the job is a change to the rule: review it as one. A change that has to rewrite merged migrations, such as a drizzle-kit snapshot format upgrade, changes the check in the same pull request.

At merge, two pull requests that each add a migration both append to `meta/_journal.json` and add the same `meta/NNNN_snapshot.json`, so they conflict: GitHub won't squash the second until it is updated from `main`, and the update runs the check again against `main`.

To fix a failure:

- **A merged migration changed.** Put it back as it is on `main`, and make the change in a new migration instead: `git restore --source origin/main --staged --worktree -- server/drizzle/<file>`, then `npm run db:generate --workspace server -- --name <name>`.
- **`main` took a migration after your branch left it, or yours is stamped too early.** Rebase on `main`. Where your migration conflicts, take `main`'s `server/drizzle/` and generate yours again, which stamps it after `main`'s. `db:generate` reads the schema, so resolve any conflict in `server/src/db/` first:

  ```sh
  git fetch origin main
  git rebase origin/main
  # At each conflict in server/drizzle, once server/src/db/ has none:
  git restore --source origin/main --staged --worktree -- server/drizzle
  npm run db:generate --workspace server -- --name <name>
  git add server/drizzle
  git rebase --continue
  ```

  Anything you wrote into your `.sql` file by hand, such as an `UPDATE`, goes into the generated one again.
- **Yours is stamped more than a day ahead.** Set the machine's clock right, then generate it again the same way.
