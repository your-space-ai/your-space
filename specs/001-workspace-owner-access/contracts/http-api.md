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

### `GET /api/setup/status`

Tells the client whether to show setup or sign-in. No authentication.

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | `{ "state": "unclaimed" }` | The installation row says unclaimed |
| 200 | `{ "state": "claimed" }` | The installation has an owner |
| 503 | `{ "state": "storage_unavailable" }` | The database could not be read, or the installation row is missing |

Unclaimed is reported only when the database positively says so. A failed read or a missing row is
never reported as unclaimed (FR-013).

### `POST /api/setup/claim`

Creates the owner account, the workspace, and ownership, then signs the owner in.

Request:

```json
{ "code": "7KQ4-M2XD-9FJP-R8TB-W3NC-H6VA", "name": "Sam Rivera", "email": "sam@example.com", "password": "…" }
```

The code is accepted with or without dashes and in any letter case.

| Status | Body | Meaning |
| --- | --- | --- |
| 201 | `{ "workspace": { "id", "name" }, "user": { "id", "name", "email" } }` plus a `Set-Cookie` session | Claimed; the owner is signed in |
| 400 | `{ "error": "invalid_input", "message", "fields": { "email": "…" } }` | Name, email, or password fails the account rules |
| 401 | `{ "error": "invalid_code" }` | Missing, wrong, expired, used, or locked code; the message does not say which |
| 409 | `{ "error": "already_claimed" }` | Already claimed, including a retried or double-clicked claim that already succeeded; the client goes to sign-in |
| 503 | `{ "error": "storage_unavailable" }` | Database unavailable; nothing was claimed |

Account rules (FR-003): name 1 to 100 characters after trimming; a syntactically valid email of up
to 254 characters, stored lowercase; password 12 to 128 characters.

The code has about 120 bits of randomness, so guessing it is not practical and no attempt limit
applies ([research R6](../research.md#r6-setup-code)).

The workspace is named "&lt;name&gt;'s space" at setup. Renaming it is not part of this feature.

## Better Auth Endpoints (library, mounted at `/api/auth/*`)

Your Space uses these unchanged. The web client calls them through Better Auth's React client.

| Endpoint | Used for |
| --- | --- |
| `POST /api/auth/sign-in/email` | Sign in (Story 2) |
| `POST /api/auth/sign-out` | Sign out; deletes the session row (FR-009) |
| `GET /api/auth/get-session` | Current session and user, for routing and the home screen |
| `POST /api/auth/reset-password` | Sets the new password; the token is sent in the request body (Story 4) |
| `GET /api/auth/organization/list` | The owner's workspace, for the home screen |

Better Auth's other routes stay as the library ships them. Its configuration keeps them from
creating accounts or adding people (FR-005; [research R4](../research.md#r4-owner-first-then-invite-only)):

- `POST /api/auth/sign-up/email` is refused because `disableSignUp` is on. The owner is created by
  the claim through a server-only instance that is not reachable over HTTP.
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
