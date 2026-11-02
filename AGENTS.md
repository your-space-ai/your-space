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

The roadmap's pre-public section is grouped into layers and opens with an overview tree. Whenever
a pre-public item is added, removed, moved, re-prioritized, reworded in meaning, or deferred, update
the tree in the same change so it still maps one-to-one to the checklist and its priority markers
match. See "Maintaining the Checklist" in the roadmap.

Structure the roadmap as nested checklists: high-level capabilities contain specific functionality.
Check off only delivered, verified work; retain completed entries with a completion date and
implementation PR or release link. A parent is complete only when its in-scope children and the
combined capability are complete. Preserve deferred or replaced work explicitly rather than deleting
its history or marking it complete.

When a feature specification referenced through an in-review PR is merged, replace its PR links
in the roadmap and readiness documents with links to the maintained specification.
