# Delivery tasks

Each implementation PR delivers one usable slice and its tests. Keep tasks open until verified.

- [ ] T001 Qualify the independent app integration, license and install recipe. Demonstrate a real list, create and edit, owner binding, safe replay and distinct actor attribution on synthetic records.
- [x] T002 Ship additive identity, credential and activity storage with owner web controls. Exercise on an upgraded existing workspace.
- [x] T003 Deliver the strict versioned kit parser, multi-role method/route matching, encrypted installation credential binding, grant editor, CLI discovery/read, installation-authenticated dispatch and neutral conformance fixture.
- [ ] T004 Deliver recommended kit settings, all-write and route toggles, a pending review screen, exact single-use approval and write dispatch, conditional edits, operation receipts and activity outcomes. Verify with a second unrelated catalog and the independent app.
- [ ] T005 Verify actor and installation isolation, overlapping roles, stale kit revisions, secret redaction, concurrent approval and grant changes, rotation, revocation, crash recovery, and uninstall/reinstall.
- [ ] T006 Complete the external agent walkthrough, publish the user guide with secret-safe examples, and link sanitized evidence before checking the roadmap.

## Candidate evidence · PR 59

T002 and T003 are implemented on the review branch. The PostgreSQL migration suite exercises upgrades and preserved owner identity. Server tests cover encrypted bindings, grants, concurrent decisions, key lifecycle and receipt handling. Chromium exercises the owner UI, the bundled CLI and a separately running synthetic app through the private edge. The test verifies list, create, an approved edit, a denied write and an independent read of the final record. See [agent HTTP tests](../../server/tests/agent-access.test.ts), [browser tests](../../e2e/tests/agents.spec.ts) and the [operator guide](../../docs/install/README.md#give-an-external-agent-access-to-one-app).

The independent real-agent/real-app walkthrough remains open. The synthetic app covers conditional and replay-safe writes. Each real kit must qualify its upstream routes before enabling them.
