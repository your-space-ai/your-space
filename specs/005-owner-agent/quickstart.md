# Candidate acceptance walkthrough

**Alpha scope (2026-11-23).** Agents only read, so steps 3 to 5 use reads only. The write steps from before wait under [Deferred until agents write](#deferred-until-agents-write) ([decision](../../docs/architecture/decisions.md#alpha-scope)).

Use a disposable workspace, an independent app installation and synthetic records. Record exact platform commit, integration build, app image and external agent version in local test evidence. Keep credentials and private app data out of evidence.

1. Open the web dashboard, install the pinned app, complete app-side owner linking, and inspect the roles declared by its kit. Create an agent named “Test agent” and issue its own key.
2. The owner injects the key into the selected external agent’s private environment as `YOUR_SPACE_AGENT_KEY` and sets `YOUR_SPACE_URL`. Give the agent the CLI and a reachable workspace address. Supply no personal login, app token, model secret from another system, or operator access. Redact the secret from tool traces, command echo and diagnostics. Keep each agent’s key independent.
3. Try discovery with zero grants. Grant a role with only the list route for one installation. Ask the real agent to list records and to call a route its role doesn't grant. Record the permitted read and the denied call.
4. Grant a kit role with a list route and a read the kit marks Ask. Ask the agent to list records, then to read one record. Verify the list runs directly and the read is pending. Approve the exact read once in Your Space and verify the agent gets only the declared fields. Check the owner-visible activity records match the agent and app.
5. Ask the agent for another read and deny it; verify the agent sees the denial and another agent cannot approve it. Set the read to Allow and verify it runs directly. Verify that a second role cannot bypass the same route policy and no agent result exposes the app credential. Confirm another installation and another agent cannot access the record. Reduce the grant while the original agent is running and repeat. Rotate its key, then disable the agent; verify the old key, then all keys, lose access as expected.
6. Repeat gateway access on localhost and over remote HTTPS. Exercise browser-published app access separately: it must confer no agent authority. Recheck grants after restart and uninstall/reinstall. Revoke the test credentials and remove them from the agent environment. Record observed outcomes and unsupported paths alongside synthetic CI results.

## Deferred until agents write

The walkthrough before 2026-11-23 also covered writes. They return when agents write again:

- Grant a kit role permitting create and edit, configure direct create and Ask on edit, create one synthetic record and edit a field on it. Verify the pending edit, one stable record ID after approval, the new field value and preserved unrelated fields. Repeat after a simulated lost response with the same operation ID and verify exactly one record.
- Enable Ask for all writes and confirm it overrides direct create. Reject one write and verify no upstream change. Make a competing edit in the human UI and verify the stale agent edit conflicts.
