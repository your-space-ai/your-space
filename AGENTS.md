# Repository Guidance

Before creating or changing a specification, technical plan, or public integration contract, read
the [constitution](.specify/memory/constitution.md) and the
[project-wide architecture and product decisions](docs/architecture/decisions.md).

Keep shared decisions in the project-wide record. Feature specifications under `specs/` define
their own delivery scope and acceptance criteria and should link to shared direction.

Update the decision record when an agreed cross-feature decision changes, preserving the rationale
and distinguishing accepted, open, and superseded decisions. Accepted future direction is not a
claim of implementation and does not automatically expand an individual feature's scope.

Keep the [roadmap](docs/roadmap.md) as a derived delivery view of the decision record. When agreed
direction, sequencing, or verified delivery status changes, update the affected roadmap entries
in the same PR. Preserve the distinction between agreed order, unscheduled direction, and candidates;
keep rationale in decisions and acceptance criteria in specifications.

The [architecture overview](docs/architecture/overview.md) diagrams the running system layer by
layer. When a decision adds, removes, or moves a component, layer, or request path, update the
overview in the same change.

Keep the maintained documentation to the reference set: the README, `docs/install/`, `docs/operate/`, `docs/apps/`,
`docs/maintainers/`, the decision record, roadmap, architecture overview, glossary and `specs/`.
In-depth explanations of how the code works come from the generated
[DeepWiki](https://deepwiki.com/your-space-ai/your-space). Don't add hand-written walkthroughs of
internals; steer DeepWiki instead by editing its page plan and notes in `.devin/wiki.json`
(at most 30 pages). When a change adds, removes or renames a subsystem, update that file in the same PR.

The [spec map](specs/README.md) records journey numbers, dependencies and build order.
Keep each roadmap outcome under the product area it belongs to. Record its delivery stage there
and link its journey when one exists. When a change in scope or timing affects a journey,
update the corresponding spec map entry in the same change.

Structure the roadmap as nested checklists: high-level capabilities contain specific functionality.
Check off only delivered, verified work; retain completed entries with a completion date and
implementation PR or release link. A parent is complete only when its in-scope children and the
combined capability are complete. Preserve deferred or replaced work explicitly rather than deleting
its history or marking it complete.

When a feature specification referenced through an in-review PR is merged, replace its PR links
in the roadmap and release guide with links to the maintained specification.

The documentation in `docs/` is published with Mintlify from `docs/docs.json`. Give each page a
`title` in front matter instead of a `#` heading, add new pages to the navigation in `docs/docs.json`,
and link to files outside `docs/` with full `https://github.com/your-space-ai/your-space/blob/main/...`
URLs, because the site only serves `docs/`. Name a folder's landing page `index.md`, not `README.md`,
which Mintlify doesn't publish. Check changes with `npx mint@4 validate` and
`npx mint@4 broken-links --check-anchors` from `docs/`; the **Docs** workflow runs both on pull requests that change `docs/`.

Write pull request descriptions with the [template](.github/pull_request_template.md). Its visible
part answers three questions in a minute: what the PR changes and why (Summary), where to look
(Review focus), and what the reviewer must decide (Decisions needed). Keep it to about a screen.
Everything else goes in collapsed sections, and a section that doesn't apply is left out. CI, code
review and visual evidence show in the PR's checks, so the description doesn't repeat them. Keep
the description current as the PR changes rather than appending history.

While the repository is private, GitHub Actions minutes are limited. Run the checks locally before
pushing, and push a stack of pull requests once per round of fixes rather than after each fix. The
browser tests run on CircleCI, on every pull request in a stack: in Chromium on pull requests, and
in Chromium, Firefox and WebKit on `main`. A pull request whose code (its git tree) already passed
them doesn't run them again, and neither does a change to CI configuration (`.github/`,
`.circleci/`) or documentation alone, on a pull request or on `main`: its browser tests, Arm checks
and Compose setups stop early or are skipped, and count as passed. On a pull request, a push that
changes only those files since the branch last passed the browser tests or Arm checks doesn't run
them again either. The Compose setups checks run on
GitHub Actions; in a stack, only the pull request based on `main` runs them, and the ones above it
run them when they reach `main`. A
draft runs only the GitHub Actions checks: CircleCI's jobs, the browser tests and the Argos
screenshots included, run when it is marked ready for review. CodeRabbit reviews drafts. So open a
pull request as a draft and keep it one until it is complete, code and implementation, and every
CodeRabbit finding is fixed or answered with its thread resolved; only then mark it ready. On a
ready pull request, fix only browser test failures. Anything else, such as a new review finding, a
design change or more implementation, turns it back into a draft until it is done. The
[pr-review-flow skill](.agents/skills/pr-review-flow/SKILL.md) gives the steps. Argos's screenshots
are Chromium's, and a change to documents alone, or a run skipped because its code already passed,
uploads none.

Every pull request reports **Contribution checks**, which verifies DCO sign-offs and that migrations
on `main` stay as merged ([Migration order](docs/maintainers/contributor-ci.md#migration-order)). Public code pull
requests run Compose on every layer and owner/agent journeys in Chromium on GitHub-hosted runners. CircleCI can read public PR metadata
without a token. Hosted runs report results in job logs and upload selected synthetic screenshots
only when Argos is configured. Use a local evidence run for HTML reports and video.
The subscription-backed review workflow runs only in the private repository.
