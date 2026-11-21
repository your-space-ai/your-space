# Delivery tasks

Each implementation PR delivers one usable slice and its tests. Keep tasks open until verified.

- [ ] T001 Qualify the independent app integration, license and install recipe. Demonstrate a real list, create and edit, owner binding, safe replay and distinct actor attribution on synthetic records.
- [x] T002 Ship additive identity, credential and activity storage with owner web controls. Exercise on an upgraded existing workspace.
- [x] T003 Deliver the strict versioned kit parser, multi-role method/route matching, encrypted installation credential binding, grant editor, CLI discovery/read, installation-authenticated dispatch and neutral conformance fixture.
- [ ] T004 Deliver recommended kit settings, all-write and route toggles, a pending review screen, exact single-use approval and write dispatch, conditional edits, operation receipts and activity outcomes. Verify with a second unrelated catalog and the independent app.
- [x] T005 Verify actor and installation isolation, overlapping roles, stale kit revisions, secret redaction, concurrent approval and grant changes, rotation, revocation, crash recovery, and uninstall/reinstall.
- [ ] T006 Complete the external agent walkthrough, publish the user guide with secret-safe examples, and link sanitized evidence before checking the roadmap.

## Verification

Upgrading a populated pre-005 database preserves the owner session and installed app and grants zero agent access. PostgreSQL tests cover encrypted bindings, overlapping grants, concurrent approval and withdrawal, kit changes, credential replacement, uninstall and receipt recovery. Chromium exercises the owner UI, the bundled CLI and a separately running synthetic app through the private edge. The browser tests cover key rotation, revocation, direct reads, creating one record, approval and denial, and a final read of the persisted record. See [agent HTTP tests](../../server/tests/agent-access.test.ts), [browser tests](../../e2e/tests/agents.spec.ts) and the [operator guide](../../docs/install/README.md#give-an-external-agent-access-to-one-app).

A second, unrelated catalog exercises discovery, different credential injection and result filtering in the server suite. Two agent identities cannot read each other’s receipts or invoke routes on each other’s installations. A simulated interrupted dispatch expires to an unknown outcome without sending the write again. In an independent installation, a live external agent requested a read, waited for owner approval and retrieved the saved result with its original request ID. The fixture also covers replay-safe creates and conditional edits. Those writes remain unverified with the independent app. Enable write routes only after qualifying both operations against its API.
