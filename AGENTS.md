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
