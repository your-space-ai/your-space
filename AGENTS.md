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
`npx mint@4 broken-links --check-anchors` from `docs/`.

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
them doesn't run them again. The Compose setups checks run on GitHub Actions; in a stack, only the
pull request based on `main` runs them, and the ones above it run them when they reach `main`. A
draft runs only the GitHub Actions checks: CircleCI's jobs, the browser tests and the Argos
screenshots included, run when it is marked ready for review. Keep a pull request a draft until its
reviewer is ready to review it, so that changes merged below it don't cost extra runs. Code review
runs on drafts too: fix its findings before marking a draft ready. Argos's screenshots are
Chromium's, and a change to documents alone, or a run skipped because its code already passed,
uploads none.

Every pull request reports **Contribution checks** and verifies DCO sign-offs. Public code pull
requests run Compose on every layer and owner/agent journeys in Chromium on GitHub-hosted runners. CircleCI can read public PR metadata
without a token. Hosted runs report results in job logs and upload selected synthetic screenshots
only when Argos is configured. Use a local evidence run for HTML reports and video.
The subscription-backed review workflow runs only in the private repository.
