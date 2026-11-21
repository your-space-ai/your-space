# Agent gateway and owner controls

These interfaces are implemented on the journey 005 branch.

| Caller | Operation | Contract |
| --- | --- | --- |
| Owner web session | Create/list/rename/disable agent; issue/rotate/revoke individual credentials | Owner-only endpoints under the agent resource. Mutations use the platform’s owner-session protections. Return a secret once on issuance or rotation. |
| Owner web session | Read eligible roles; replace a grant for one installation | Return role IDs and grant revision. Replace an exact subset with an expected revision. An empty set withdraws access. |
| Owner web session | Read activity | Cursor-paged summaries scoped to this workspace, with request ID, timestamp, actor, delegating owner, app, action and outcome. |
| Agent key | Discover actions | Return supported installed-app IDs and bounded action descriptions available under current grants. The pinned kit supplies role and route metadata. |
| Owner web session | Configure approvals and decide requests | Set an all-writes floor and route overrides per agent and installation. Inspect an exact pending request; approve or deny with expected revision. |
| Agent key | Invoke | Submit installation ID, action ID, typed input and, for writes, operation ID and applicable expected resource revision. Return a bounded allowlisted result or a pending request ID. An agent can poll its own status but cannot approve. A pending request has made no upstream call. |
| Gateway to integration | Authorize and execute | Match the granted route template and HTTP method in the pinned kit, apply owner approval policy, then inject the installation-bound app credential server-side. The app enforces native resource authority. Preserve agent attribution in Your Space. |
| Gateway to integration | Reconcile uncertain write | Look up the original operation within the same installation and actor scope. Return recorded receipt, pending or unknown. |

CLI commands include `your-space agent actions --json` and `your-space agent invoke <installation-id> <action-id> --input-stdin --json`. Resolve the workspace URL and agent key from the externally supplied environment (`YOUR_SPACE_URL`, `YOUR_SPACE_AGENT_KEY`). Discover, invoke and receipt lookup must work without Docker or operator access on the agent machine. Writes accept caller-persisted operation IDs and revisions. Machine-readable failures distinguish invalid credential, unavailable action or grant, approval pending, denied or expired approval, stale revision, app unavailability, and uncertain outcome. Denials disclose no resources outside the caller’s scope. Credential values never appear in argv, output, help examples, discovery or logs.

An action ID is exactly the kit route ID. The invoke input has three named objects, `path`, `query` and `body`, validated against the route’s `pathParams`, `queryFields` and `bodyFields`. Omitted objects are empty. Reject unknown fields. The canonical request also includes installation, actor, route, kit revision, expected resource revision and operation ID. Caller metadata is distinct from input fields; only the server renders it into the upstream request using the kit bindings.


## Owner HTTP API

All paths are relative to the configured workspace origin. Owner routes require an active owner session. Send JSON and the exact workspace Origin on mutations. Data returned by these endpoints is marked no-store.

| Method and path | Input | Result |
| --- | --- | --- |
| GET `/api/agents/dashboard` | | Agents, key IDs and status, installations with kit roles and routes, binding/grant revisions, pending approval previews and the first page of activity. |
| POST `/api/agents` | `{name}` | New agent ID and name. It starts with zero credentials and zero grants. |
| PATCH `/api/agents/:id` | `{name}` or `{disabled:true}` | Rename or disable the identity. Disabling revokes all of its keys. |
| POST `/api/agents/:id/keys` | `{}` | `{id,key}`. Store the clear key now. |
| POST `/api/agents/:id/keys/:keyId/rotate` or `/revoke` | `{}` | Rotation revokes that key and returns a new ID and clear value. Revocation returns only its ID. |
| PUT `/api/agents/installations/:installationId` | `{enabledRoles,revision,credential?}` | Revision after binding. Omit credential to retain it, replace it with a new value, or pass null with empty enabledRoles to disconnect. Rebinding clears previous grants. |
| PUT `/api/agents/:id/grants/:installationId` | `{roles,askAllWrites,overrides,revision,bindingRevision}` | Replace the role set and approval preferences. Overrides map route IDs to ask or allow. Supply the current binding revision and revision zero when no grant exists. |
| POST `/api/agents/requests/:id/decision` | `{revision,approve}` | Final denial or the result of dispatching the exact approved request after current authority checks. |
| GET `/api/agents/activity` | Optional `before` cursor | Newest first, up to 50 entries and a next cursor. |

## Bearer HTTP API

Use the agent key in the Authorization header with the Bearer scheme. The agent’s environment needs only the gateway URL and its key.

- GET `/api/agent/actions` returns an actions array with installation ID, action ID, HTTP method, path template, effect, supported input fields and revision requirement.
- POST `/api/agent/invoke` accepts installationId, actionId, input, plus operationId for writes and expectedRevision when declared. A successful response contains id, status and filtered result. An approval request returns HTTP 202 with a pending ID. Filtered response data is encrypted and available for 24 hours. After that the receipt retains its outcome and ID. A duplicate write with the same normalized input and unchanged authority returns its existing outcome. The upstream operation ID is derived from the agent, installation, route and client operation ID so agents sharing an app credential cannot collide.
- GET `/api/agent/requests/:id` returns the current status and any available filtered result under the agent’s current access. Where a kit declares a receipt endpoint, polling an unknown write can recover its result through that scope-checked read. An absent or inconclusive receipt leaves the outcome unknown. The gateway never automatically resends an uncertain write.
- Wrong credentials return 401; ungranted actions return 403. A stale revision or conflicting reuse of an operation ID returns 409. Upstream refusal and uncertain results have distinct statuses. Once an invocation exists, preserve its returned ID for status lookup.

Pending reviews expire after 15 minutes. Disabling an identity, revoking its key, replacing its binding or editing its grant invalidates affected pending approvals. Stopping a server after dispatch may leave an outstanding claim; the expiry sweep exposes its outcome as unknown for reconciliation.
