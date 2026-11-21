# Proposed v1 interfaces

Implementation contract for review. Routes below are proposed; the shipped CLI and HTTP API do not yet provide them.

| Caller | Operation | Contract |
| --- | --- | --- |
| Owner web session | Create/list/rename/disable agent; issue/rotate/revoke individual credentials | Owner-only endpoints under the agent resource. Mutations use the platform’s owner-session protections. Return a secret once on issuance or rotation. |
| Owner web session | Read eligible roles; replace a grant for one installation | Return role IDs and grant revision. Replace an exact subset with an expected revision. An empty set withdraws access. |
| Owner web session | Read activity | Cursor-paged summaries scoped to this workspace, with request ID, timestamp, actor, delegating owner, app, action and outcome. |
| Agent key | Discover actions | Return supported installed-app IDs and bounded action descriptions available under current grants. The app supplies role/action metadata. |
| Agent key | Invoke | Submit installation ID, action ID, typed input and, for writes, operation ID and applicable expected resource revision. Return a bounded app result and correlation ID. |
| Gateway to integration | Authorize and execute | Use the registered internal endpoint with an authenticated envelope binding installation, actor, delegator, exact roles and request. The app checks local resource authority and input schema before execution. |
| Gateway to integration | Reconcile uncertain write | Look up the original operation within the same installation and actor scope. Return recorded receipt, pending or unknown. |

Proposed CLI: `your-space agent actions --json` and `your-space agent invoke <installation-id> <action-id> --input-stdin --json`. Resolve the workspace URL and agent key from the externally supplied environment (`YOUR_SPACE_URL`, `YOUR_SPACE_AGENT_KEY`). Discover, invoke and receipt lookup must work without Docker or operator access on the agent machine. Writes accept caller-persisted operation IDs and revisions. Machine-readable failures distinguish invalid credential, unavailable action or grant, stale revision, app unavailability, and uncertain outcome. Denials disclose no resources outside the caller’s scope. Credential values never appear in argv, output, help examples, discovery or logs.
