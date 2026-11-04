# Contract: Operator Commands

**Feature**: [001 Workspace Setup and Owner Access](../spec.md) · **Plan**: [plan.md](../plan.md)

Two commands ship inside the server image and run through Docker Compose on the host. They are the
operator-only channel for setup and recovery authority (FR-002, FR-017). Spec 003's CLI and spec
008's desktop app wrap them without a separate path, so their output and exit codes are a contract.

```sh
docker compose exec server setup-code [--json]
docker compose exec server reset-link [--json]
```

`setup-code` and `reset-link` are small executables on the server image's `PATH`. They run Node
scripts that use the same configuration, database connection, and Better Auth instance as the
server. Arguments are parsed with Node's built-in `util.parseArgs`.

## Exit Codes

| Code | Meaning | Applies to |
| --- | --- | --- |
| 0 | Success | both |
| 1 | Usage error (unknown flag) | both |
| 2 | Not applicable in the current state: already claimed (`setup-code`) or not yet claimed (`reset-link`) | both |
| 3 | Storage unavailable or unreadable; nothing was changed | both |
| 4 | Unexpected error; nothing was reported as successful | both |

If the `server` container is not running, `docker compose exec` itself fails with a non-zero exit
code before either command starts. The guide documents this case.

## `setup-code`

Issues a new setup code for an unclaimed installation. Issuing a code cancels any earlier code.

Human output (stdout), exit 0:

```text
Setup code: 7KQ4-M2XD-9FJP-R8TB-W3NC-H6VA
It expires at 2026-11-04T02:15:00Z (in 60 minutes) and works once.
Open your Your Space address and enter it on the setup page.
```

`--json` output, exit 0:

```json
{ "ok": true, "code": "7KQ4-M2XD-9FJP-R8TB-W3NC-H6VA", "expiresAt": "2026-11-04T02:15:00Z" }
```

Failure, `--json`, exit 2 or 3:

```json
{ "ok": false, "error": "already_claimed", "message": "This installation already has an owner." }
{ "ok": false, "error": "storage_unavailable", "message": "The database could not be read." }
```

Rules:

- The code is printed only to the operator's terminal. It is never written to logs.
- Only a hash of the code is stored, with its expiry and failed-attempt count.
- The code is 24 random characters from a 32-symbol alphabet without look-alikes (about 120 bits),
  shown in groups of four. It is valid for 60 minutes. After 10 failed claim attempts it stops
  working and the operator issues a new one.

## `reset-link`

Issues a single-use password reset link for the existing owner. It does not change the password,
sessions, or ownership until the link is used (FR-018).

Human output, exit 0:

```text
Password reset link for owner@example.com:
https://space.example.com/reset-password#token=<token>
It expires at 2026-11-04T01:45:00Z (in 30 minutes) and works once.
Using it signs out every existing session.
```

`--json` output, exit 0:

```json
{ "ok": true, "email": "owner@example.com", "url": "https://…", "expiresAt": "2026-11-04T01:45:00Z" }
```

Failure, `--json`, exit 2 or 3:

```json
{ "ok": false, "error": "not_claimed", "message": "This installation has no owner yet. Use setup-code." }
{ "ok": false, "error": "storage_unavailable", "message": "The database could not be read." }
```

Rules:

- The command calls Better Auth's `auth.api.requestPasswordReset` for the owner's email. Better
  Auth creates the token and calls the `sendResetPassword` callback, which in this process prints the
  link instead of emailing it.
- The link is built from the configured public address (`YS_PUBLIC_URL`) and puts the token in the
  URL fragment (`#token=`). Browsers never send fragments to the server, so the token cannot appear in
  proxy or server logs or in a `Referer` header. The reset page posts it in the request body.
- The command records a `recovery.link_issued` event credited to the operator actor.
- It also clears the owner account's sign-in limits, so a locked-out owner can always get back in.
