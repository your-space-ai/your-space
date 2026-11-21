# Proposed v1 interfaces

Implementation contract for review. Routes below are proposed; the shipped CLI and HTTP API do not yet provide them.

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

Proposed CLI: `your-space agent actions --json` and `your-space agent invoke <installation-id> <action-id> --input-stdin --json`. Resolve the workspace URL and agent key from the externally supplied environment (`YOUR_SPACE_URL`, `YOUR_SPACE_AGENT_KEY`). Discover, invoke and receipt lookup must work without Docker or operator access on the agent machine. Writes accept caller-persisted operation IDs and revisions. Machine-readable failures distinguish invalid credential, unavailable action or grant, approval pending, denied or expired approval, stale revision, app unavailability, and uncertain outcome. Denials disclose no resources outside the caller’s scope. Credential values never appear in argv, output, help examples, discovery or logs.

An action ID is exactly the kit route ID. The invoke input has three named objects, `path`, `query` and `body`, validated against the route’s `pathParams`, `queryFields` and `bodyFields`. Omitted objects are empty. Reject unknown fields. The canonical request also includes installation, actor, route, kit revision, expected resource revision and operation ID. Caller metadata is distinct from input fields; only the server renders it into the upstream request using the kit bindings.
