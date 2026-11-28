# Agent gateway and owner controls

The gateway contract defines owner controls, agent access and the results returned to each caller.

**Per app (2026-11-27, [journey 018](../../018-app-access/spec.md)).** `GET /api/agent/apps` lists the apps an agent can reach; `POST /api/agent/call` takes `installationId`, `method`, `path` (with any query) and `body`, for any path under the app's `api`, with the credential the agent's grant names. A grant holds that credential and its routes that ask; `PUT /api/agents/:id/grants/:installationId` takes `{credential, asks, revision, bindingRevision}`, and a null credential removes it. Bindings enable no roles. Route IDs, `invoke` and `actions` are gone. Before that, **writes (2026-11-26, [journey 017](../../017-agent-writes/spec.md)).** The input gains `body`, a write's JSON of at most 32 KiB, sent to the app as it is. The gateway keeps no operation ID or expected revision and doesn't match retries; a write's 2xx response other than `202 Accepted` that can't be passed on is `succeeded` without a result, and a `202` is `unknown`, as it is for a read. Before that, **alpha scope (2026-11-23):** agents only read: every route is a GET with `effect: read`, so invocations carry no body, operation ID or expected revision, and nothing reconciles an uncertain write. Approvals, grants, keys and request outcomes stay. The rows below describe reads; see the [alpha scope](../../../docs/architecture/decisions.md#alpha-scope).

| Caller | Operation | Contract |
| --- | --- | --- |
| Owner web session | Create/list/rename/disable agent; issue/rotate/revoke individual credentials | Owner-only endpoints under the agent resource. Mutations use the platform’s owner-session protections. Return a secret once on issuance or rotation. |
| Owner web session | Give an agent an app, or take it away | Name the bound credential its calls are sent with and its routes that ask first, with an expected revision. A null credential removes the grant (journey 018). |
| Owner web session | Read activity | Cursor-paged summaries scoped to this workspace, with request ID, timestamp, actor, delegating owner, app, action and outcome. |
| Agent key | List apps | Return the installed apps the agent has a grant for, with the path their API lives under, whether each is available and why not, and the agent's routes that ask. |
| Owner web session | Decide requests | Inspect an exact pending call; approve or deny with expected revision. |
| Agent key | Call | Submit the installation ID, a method and a path under the app's API, with a query and a JSON body. Return the app's bounded JSON response unchanged, or a pending request ID. An agent can poll its own status but cannot approve. A pending request has made no upstream call. |
| Gateway to integration | Authorize and execute | Check the path is under the kit's `api` and well formed, apply the grant's routes that ask, then inject the grant's bound credential server-side. The app enforces native resource authority. Preserve agent attribution in Your Space. |

CLI commands are `your-space agent apps --json`, `your-space agent call <installation-id> <METHOD> <path> [--body-stdin] --json` and `your-space agent request <id> --json` (journey 018). Resolve the workspace URL and agent key from the externally supplied environment (`YOUR_SPACE_URL`, `YOUR_SPACE_AGENT_KEY`). Listing, calling and request lookup must work without Docker or operator access on the agent machine. Machine-readable failures distinguish invalid credential, unavailable app or grant, approval pending, denied or expired approval, app refusal, app unavailability, and no usable answer. Denials disclose no resources outside the caller’s scope. Credential values never appear in argv, output, help examples, discovery or logs.

A call names `installationId`, `method` (`GET`, `POST`, `PATCH`, `PUT` or `DELETE`), `path`, a path under the app's `api` with any query after `?`, and, except for a `GET`, `body`. The path rules are [journey 018's FR-004](../../018-app-access/spec.md#requirements). Reject unknown fields. The canonical request also includes installation, actor, method, path, body and grant revision.

## Owner HTTP API

All paths are relative to the configured workspace origin. Owner routes require an active owner session. Send JSON and the exact workspace Origin on mutations. Data returned by these endpoints is marked no-store.

| Method and path | Input | Result |
| --- | --- | --- |
| GET `/api/agents/dashboard` | | Agents with key IDs and status and their grants (credential, routes that ask), installations with their API path, credentials and whether each is bound, or why agent access is unavailable, binding and grant revisions, pending call previews and the first page of activity. |
| POST `/api/agents` | `{name}` | New agent ID and name. It starts with zero credentials and zero grants. |
| PATCH `/api/agents/:id` | `{name}` or `{disabled:true}` | Rename or disable the identity. Disabling revokes all of its keys. |
| POST `/api/agents/:id/keys` | `{}` | `{id,key}`. Store the clear key now. |
| POST `/api/agents/:id/keys/:keyId/rotate` or `/revoke` | `{}` | Rotation revokes that key and returns a new ID and clear value. Revocation returns only its ID. |
| PUT `/api/agents/installations/:installationId` | `{revision,credential?}` or `{revision,credentials?}` | Revision after binding. A kit with one credential takes `credential`; a kit with named credentials takes `credentials`, a value or null per name. Replacing a credential keeps the grants that use it, on the new value only; pending approvals go stale (journey 018). |
| PUT `/api/agents/:id/grants/:installationId` | `{credential,asks,revision,bindingRevision}` | Give the agent the app with that bound credential and its routes that ask (`[{method,path}]`, `*` for one segment), or remove the grant with a null credential. Supply the current binding revision and revision zero when no grant exists. |
| POST `/api/agents/requests/:id/decision` | `{revision,approve}` | Final denial or the result of dispatching the exact approved request after current authority checks. |
| GET `/api/agents/activity` | Optional `before` cursor | Newest first, up to 50 entries and a next cursor. |

## Bearer HTTP API

Use the agent key in the Authorization header with the Bearer scheme. The agent’s environment needs only the gateway URL and its key.

- GET `/api/agent/apps` returns an apps array with installation ID, app name, API path, availability and reason, and the agent's routes that ask.
- POST `/api/agent/call` accepts installationId, method, path and body. A successful response contains id, status and the app's JSON response as `result`, unchanged. An approval request returns HTTP 202 with a pending ID. The saved result is encrypted and available for 24 hours; after that the request keeps its outcome and ID. Replacing the credential or app invalidates access to prior results.
- GET `/api/agent/requests/:id` returns the current status and any available result under the agent’s current access.
- Wrong credentials return 401; an ungranted or unavailable app returns 403. A call whose key was replaced after it was admitted returns 409 and isn't sent. A request changed under a pending decision returns 409. Upstream refusal (422) and no usable answer (502) have distinct statuses. Once an invocation exists, preserve its returned ID for status lookup.

Approval authorizes one execution of the captured request. A completed request returns the saved result to the same agent while it retains access to the route. The gateway clears that result after one day from request creation. A new read follows the current approval policy.

Pending reviews expire after 15 minutes. Disabling an identity, revoking its key, replacing its binding or editing its grant invalidates affected pending approvals. Stopping a server after dispatch may leave an outstanding claim; the expiry sweep marks its outcome unknown, and it is never sent again.

Immediately before dispatch, the server obtains the installed service's numeric endpoint from the [runtime socket](../../002-install-an-app/contracts/runtime-api.md). The runtime verifies the live interface container and its address on the app's isolated Docker bridge. Only the private server-to-edge socket can carry the selected target. Missing interface labels, on an app installed before Your Space labelled interfaces, require the app to be applied again, by stopping and starting it, before agent access works.

A forbidden invocation returns HTTP 403 with `status: denied` and no request ID. Owner activity samples the first denied route per agent per minute and keeps the most recent 32 samples per agent across all keys and installations. Successful and pending requests use their ordinary durable records.
