# Specification Quality Checklist: Workspace Setup and Owner Access

**Purpose**: Review requirements quality and preserve agreed decisions before technical planning.

**Created**: 2026-10-28

**Last updated**: 2026-11-02

**Feature**: [Specification](../spec.md)

**Shared direction**: [Project decision record](../../../docs/architecture/decisions.md) and [spec map](../../../docs/spec-map.md)

**Marker semantics**: Checked items indicate reviewed document quality, not implemented or tested
product behavior. This checklist is maintained by the Spec Kit specification workflow.

## Content Quality

- [x] The behavioral specification focuses on user outcomes rather than a prescribed implementation.
- [x] Selected technologies and future architecture are preserved in the project-wide decision record.
- [x] The specification is readable without knowledge of internal frameworks or schemas.
- [x] All required Spec Kit sections are complete and template placeholders are removed.

## Requirement Completeness

- [x] No unresolved product-scope clarification blocks the owner-only specification.
- [x] Functional requirements are testable and linked to acceptance scenarios.
- [x] Success criteria are measurable without invented performance targets.
- [x] Operator-only owner creation, duplicates, interruptions, and link replay are covered.
- [x] Sign-in, direct protected access, sign-out, expiry, and remote browser access are covered.
- [x] Persistence, storage failure, and recovery preserve existing identity and ownership.
- [x] Email as a login identifier is distinct from mailbox verification and email delivery.
- [x] Operator recovery, invalid links, session revocation, and normal sign-in afterward are covered.
- [x] Dependencies, assumptions, exclusions, and planning choices are explicit.

## Decision Preservation

- [x] Manual Docker Compose on macOS/Linux, web-only delivery, Express on Node.js, and PostgreSQL are recorded as selected.
- [x] React/TypeScript/Vite, Better Auth, and Drizzle are recorded as selected; client supporting libraries remain open.
- [x] Owner setup and the working Compose deployment come first; spec 002 (install an app and use it) and then the CLI (spec 003) follow.
- [x] Owner creation and operator recovery remain available without the later standalone CLI.
- [x] Every installation uses one setup flow; the operator commands are scriptable so the CLI can wrap them (command names and mechanics are set in spec 003), and the desktop app uses the CLI.
- [x] Independent apps and the in-repository SDK remain future integration boundaries.
- [x] Embedded app UI is a product requirement; embedding, origins, and routing are decided in spec 002.
- [x] Your Space is the gateway for agent access (spec 005); apps still enforce their own roles, and endpoint-to-permission manifests remain unselected.
- [x] Agent delegation uses exact role-ID subsets in the same app installation and workspace, without a hierarchy.
- [x] Removing a human role removes that role from affected agents; sessions and credentials must respect revocation.
- [x] Role-ID containment is not misrepresented as universal effective-permission containment.
- [x] Future apps, agents, members, and managed hosting are not first-spec acceptance criteria; out-of-scope items name the spec that delivers them.
- [x] Remote access uses HTTPS and plain HTTP is localhost-only; the built-in proxy with automatic certificates is part of this feature, with an own-proxy or tunnel option (FR-028).
- [x] The platform session uses host-only cookies.
- [x] Documents contain no private application data, credentials, or private implementation history.

## Spec Map Conformance

- [x] The spec covers every roadmap item tagged `[001]`: manual Compose install, durable state, access
  from another device, ARM and Intel/AMD images, owner setup and sessions, and the web client.
- [x] Simple by default: the default interface shows only what the owner needs (FR-027).
- [x] No telemetry: no automatic outbound requests (FR-026).
- [x] ARM and Intel: images and guide verified on both (FR-022).
- [x] Known storage: durable state only in the database and named volumes, ready for backup (FR-023).
- [x] Versioned migrations from the first schema, ready for updates (FR-024).
- [x] The actual actor: records do not assume every actor is human (FR-025).
- [x] Docs and security included: the guide (FR-001) and security scenarios ship with the feature.

## Acceptance Traceability

| Requirements | Primary acceptance coverage |
|---|---|
| FR-001–FR-005 | Story 1; setup edge cases; SC-001–SC-002 |
| FR-006–FR-009 | Stories 1–2; Story 4; SC-003–SC-004, SC-007 |
| FR-010–FR-011 | Cross-cutting verification scenarios 1–3; invalid-input and repeated-attempt edge cases |
| FR-012–FR-014 | Stories 1 and 3; Story 4 identity preservation; SC-005–SC-006, SC-008 |
| FR-015–FR-016 | Story 2 scenarios 6–8; SC-009–SC-010 |
| FR-017–FR-020 | Story 4; denied-access scenarios across stories; SC-002–SC-004, SC-007–SC-008 |
| FR-002, FR-017 (scripted use) | Story 1 scenario 9; scripted-command edge case; SC-012 |
| FR-021 | Story 2 scenario 9; SC-009 |
| FR-022 | Cross-cutting scenario 4; SC-011 |
| FR-009 (durable sessions) | Story 3 scenario 2; SC-005 |
| FR-023 | Story 3 scenario 5; SC-005 |
| FR-024 | Cross-cutting scenario 8 |
| FR-025 | Cross-cutting scenario 7; Actor entity |
| FR-026–FR-027 | Cross-cutting scenarios 5–6; SC-013 |
| FR-028 | Story 1 scenario 10; proxy certificate edge case; SC-009 |

## Review Notes

- Independent reviews checked conversation coverage, constitutional consistency, scope, delegation,
  and setup/recovery behavior. Findings on licensing, stable role IDs, password storage, and
  verification coverage were addressed before completing this checklist.
- 2026-11-02: Updated to conform with the merged roadmap, decision record, and spec map: journey
  references, host-only cookies, HTTPS-only remote access, ARM and Intel/AMD images, storage layout,
  versioned migrations, actor identity, no telemetry, simple by default, scriptable operator commands,
  and sessions that survive restarts. An independent review checked the update against those documents.
- No runtime tests apply to this documentation-only change. Implementation acceptance scenarios
  have been specified, not executed.
- The next phase is technical planning with the open implementation choices in the decision record.
  Agreed stack selections are recorded; this PR does not select remaining libraries or start implementation.
