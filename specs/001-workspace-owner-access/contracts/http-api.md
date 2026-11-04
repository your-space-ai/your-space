# Contract: HTTP API

**Feature**: [001 Workspace Setup and Owner Access](../spec.md) · **Plan**: [plan.md](../plan.md)

All endpoints are under `/api` on the Your Space origin; Caddy forwards `/api/*` to the server and
serves the web client for every other path. Bodies are JSON. Errors use one shape:

```json
{ "error": "<code>", "message": "<safe, human-readable text>" }
```

Error messages never include passwords, codes, tokens, session values, or stack traces (FR-010,
FR-020).

This API is internal to Your Space's own clients in this feature; it is not yet a public,
versioned app contract (those start in spec 002).

## Custom Endpoints (Your Space code)

### `GET /api/health`

For the Compose health check and troubleshooting. No authentication.

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | `{ "status": "ok" }` | Server and database reachable |
| 503 | `{ "status": "storage_unavailable" }` | Database query failed |

### `GET /api/status`

Tells the client whether to show sign-in or the "no owner yet" page. No authentication.

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | `{ "owner": false }` | The installation row says no owner exists yet |
| 200 | `{ "owner": true }` | The owner exists |
| 503 | `{ "state": "storage_unavailable" }` | The database could not be read, or the installation row is missing |

"No owner" is reported only when the database positively says so. A failed read or a missing row is
never reported as "no owner" (FR-013). The "no owner yet" page only explains how to run
`create-owner`; it has no form.

## Better Auth Endpoints (library, mounted at `/api/auth/*`)

Your Space uses these unchanged. The web client calls them through Better Auth's React client.

| Endpoint | Used for |
| --- | --- |
| `POST /api/auth/sign-in/email` | Sign in (Story 2) |
| `POST /api/auth/sign-out` | Sign out; deletes the session row (FR-009) |
| `GET /api/auth/get-session` | Current session and user, for routing and the home screen |
| `POST /api/auth/reset-password` | Sets the first password or a new one; the token is sent in the request body (Stories 1 and 4). Password: 12 to 128 characters |
| `GET /api/auth/organization/list` | The owner's workspace, for the home screen |

Better Auth's other routes stay as the library ships them. Its configuration keeps them from
creating accounts or adding people (FR-005; [research R4](../research.md#r4-owner-first-then-invite-only)):

- `POST /api/auth/sign-up/email` is refused because `disableSignUp` is on. The owner is created by
  the `create-owner` command, whose Better Auth instance exists only in that command's process.
- `POST /api/auth/request-password-reset` is refused because the public instance has no
  `sendResetPassword`. Only the `reset-link` command issues reset links.
- Organization routes cannot add anyone. Adding a member is server-only in the plugin, accepting an
  invitation needs an account that can't be created, and creating another organization is off
  (`allowUserToCreateOrganization: false`).

Sign-in is limited by Better Auth's built-in defaults (3 attempts per 10 seconds per IP), and a
limited request gets `429`.

## Protected Requests

Requests to protected Your Space endpoints without a valid session get `401 { "error": "unauthenticated" }`
and change nothing (Story 2, scenario 3). In this feature the protected data is the session, the
user, and the workspace, all served through Better Auth's session-checked endpoints. Custom
protected endpoints added later use one middleware that calls `auth.api.getSession` with the request
headers.
