# Agent gateway and owner controls

The gateway contract defines owner controls, agent access and the results returned to each caller.

**Writes (2026-11-26, [journey 017](../../017-agent-writes/spec.md)).** The input gains `body`, a write's JSON of at most 32 KiB, sent to the app as it is. The gateway keeps no operation ID or expected revision and doesn't match retries; a write's 2xx response other than `202 Accepted` that can't be passed on is `succeeded` without a result, and a `202` is `unknown`, as it is for a read. Before that, **alpha scope (2026-11-23):** agents only read: every route is a GET with `effect: read`, so invocations carry no body, operation ID or expected revision, and nothing reconciles an uncertain write. Approvals, grants, keys and request outcomes stay. The rows below describe reads; see the [alpha scope](../../../docs/architecture/decisions.md#alpha-scope).

| Caller | Operation | Contract |
| --- | --- | --- |
| Owner web session | Create/list/rename/disable agent; issue/rotate/revoke individual credentials | Owner-only endpoints under the agent resource. Mutations use the platform’s owner-session protections. Return a secret once on issuance or rotation. |
| Owner web session | Read eligible roles; replace a grant for one installation | Return role IDs and grant revision. Replace an exact subset with an expected revision. An empty set withdraws access. |
| Owner web session | Read activity | Cursor-paged summaries scoped to this workspace, with request ID, timestamp, actor, delegating owner, app, action and outcome. |
| Agent key | Discover actions | Return supported installed-app IDs and bounded action descriptions available under current grants. The pinned kit supplies role and route metadata. |
| Owner web session | Configure approvals and decide requests | Set route overrides per agent and installation. Inspect an exact pending request; approve or deny with expected revision. |
| Agent key | Invoke | Submit the installation ID and use the kit route ID as the action ID. Map `input.path` and `input.query` to the route’s `pathParams` and `queryFields`. Return the app's bounded JSON response unchanged, or a pending request ID. An agent can poll its own status but cannot approve. A pending request has made no upstream call. |
| Gateway to integration | Authorize and execute | Match the granted route template and HTTP method in the pinned kit, apply owner approval policy, then inject the installation-bound app credential server-side. The app enforces native resource authority. Preserve agent attribution in Your Space. |

CLI commands include `your-space agent actions --json` and `your-space agent invoke <installation-id> <action-id> --input-stdin --json`. Resolve the workspace URL and agent key from the externally supplied environment (`YOUR_SPACE_URL`, `YOUR_SPACE_AGENT_KEY`). Discover, invoke and request lookup must work without Docker or operator access on the agent machine. Machine-readable failures distinguish invalid credential, unavailable action or grant, approval pending, denied or expired approval, app refusal, app unavailability, and no usable answer. Denials disclose no resources outside the caller’s scope. Credential values never appear in argv, output, help examples, discovery or logs.

An action ID is exactly the kit route ID. The invoke input has two named objects, `path` and `query`, validated against the route’s `pathParams` and `queryFields`, and, for a write, `body` (journey 017). Omitted objects are empty. Reject unknown fields, and a `body` on a read. The canonical request also includes installation, actor, route and kit revision.

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
| PUT `/api/agents/:id/grants/:installationId` | `{roles,overrides,revision,bindingRevision}` | Replace the role set and approval preferences. Overrides map route IDs to ask or allow. Supply the current binding revision and revision zero when no grant exists. |
| POST `/api/agents/requests/:id/decision` | `{revision,approve}` | Final denial or the result of dispatching the exact approved request after current authority checks. |
| GET `/api/agents/activity` | Optional `before` cursor | Newest first, up to 50 entries and a next cursor. |

## Bearer HTTP API

Use the agent key in the Authorization header with the Bearer scheme. The agent’s environment needs only the gateway URL and its key.

- GET `/api/agent/actions` returns an actions array with installation ID, action ID, HTTP method, path template, effect and supported input fields.
- POST `/api/agent/invoke` accepts installationId, actionId and input. A successful response contains id, status and the app's JSON response as `result`, unchanged (2026-11-24; superseded: a result filtered to the route's `outputFields`, see the [kit contract](kit-agent-access.md#supported-declarations)). An approval request returns HTTP 202 with a pending ID. The saved result is encrypted and available for 24 hours; after that the request keeps its outcome and ID. Replacing the credential or app invalidates access to prior results.
- GET `/api/agent/requests/:id` returns the current status and any available result under the agent’s current access.
- Wrong credentials return 401; ungranted actions return 403. A request changed under a pending decision returns 409. Upstream refusal (422) and no usable answer (502) have distinct statuses. Once an invocation exists, preserve its returned ID for status lookup.

Approval authorizes one execution of the captured request. A completed request returns the saved result to the same agent while it retains access to the route. The gateway clears that result after one day from request creation. A new read follows the current approval policy.

Pending reviews expire after 15 minutes. Disabling an identity, revoking its key, replacing its binding or editing its grant invalidates affected pending approvals. Stopping a server after dispatch may leave an outstanding claim; the expiry sweep marks its outcome unknown, and it is never sent again.

Immediately before dispatch, the server obtains the installed service's numeric endpoint from the [runtime socket](../../002-install-an-app/contracts/runtime-api.md). The runtime verifies the live interface container and its address on the app's isolated Docker bridge. Only the private server-to-edge socket can carry the selected target. Missing interface labels, on an app installed before Your Space labelled interfaces, require the app to be applied again, by stopping and starting it, before agent access works.

A forbidden invocation returns HTTP 403 with `status: denied` and no request ID. Owner activity samples the first denied route per agent per minute and keeps the most recent 32 samples per agent across all keys and installations. Successful and pending requests use their ordinary durable records.
