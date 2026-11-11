# Contract: Operator Commands

**Feature**: [001 Workspace Setup and Owner Access](../spec.md) · **Plan**: [plan.md](../plan.md)

Three commands ship inside the server image and run through Docker Compose on the host. Server
access is the authority to create the owner and recover access (FR-002, FR-017). Spec 003's CLI and
spec 008's desktop app wrap these commands without a separate path, so their output and exit codes
are a contract.

```sh
docker compose exec server create-owner --username <username> --name <name> [--email <email>] [--json]
docker compose exec server reset-link [--json]
docker compose exec server show-secrets [--json]
docker compose run --rm secrets [--new auth-secret] [--new database-password]
```

`show-secrets` and the `secrets` step are described at the end
([research R16](../research.md#r16-platform-secrets)).

`create-owner` and `reset-link` are small executables on the server image's `PATH`. They run Node
scripts that share the server's configuration and database. Arguments are parsed with Node's
built-in `util.parseArgs`. Both commands use a Better Auth instance that exists only inside the
command's own process ([research R4](../research.md#r4-owner-first-then-invite-only)).

## Exit Codes

| Code | Meaning | Applies to |
| --- | --- | --- |
| 0 | Success | all three |
| 1 | Usage error, or a name, username or email that fails the account rules | all three |
| 2 | Not applicable in the current state: an owner already exists (`create-owner`) or doesn't exist yet (`reset-link`) | `create-owner`, `reset-link` |
| 3 | Storage unavailable or unreadable. No owner was created and no link was printed; for `create-owner`, running it again finishes the job | `create-owner`, `reset-link` |
| 4 | Unexpected error; nothing was reported as successful | both |

If the `server` container is not running, `docker compose exec` itself fails with a non-zero exit
code before either command starts. The guide documents this case.

With `--json`, every failure is one JSON object on stdout with `"ok": false` and an `error` code. Two
codes apply to both commands:

```json
{ "ok": false, "error": "usage", "message": "Unknown option '--x'. Usage: …" }
{ "ok": false, "error": "unexpected", "message": "Something unexpected went wrong. Nothing was reported as done." }
```

`usage` comes with exit 1 and `unexpected` with exit 4. When the server's configuration is invalid,
`unexpected` carries the configuration message instead, naming the setting to fix. Log lines, if any, go to stderr, so stdout
holds only that object.

## Set-Password and Reset Links

Both commands print the same kind of link: `<public address>/reset-password#token=<token>`, where the public address is derived from `.env` (`http://localhost`, `https://<YS_DOMAIN>`, or `YS_PROXY_URL`).

- **Source:** the command calls Better Auth's `auth.api.requestPasswordReset`. Better Auth creates a
  random token, stores it, and calls `sendResetPassword`, which prints the link instead of emailing
  it.
- **Lifetime:** valid for 30 minutes and works once. Using it signs out every existing session.
- **Only the newest link works:** issuing a link, from either command, cancels any earlier link for
  the owner that hasn't been used. There is never more than one working link.
- **Fragment:** the token is in the URL fragment (`#token=`). Browsers never send fragments to a
  server, so the token can't appear in proxy logs, server logs, or a `Referer` header. The page posts
  it to `/api/auth/reset-password` in the request body.
- **Not in logs:** the link is printed only to the operator's terminal and never written to logs.
- **Stored as a hash:** the database keeps `reset-password:` and a SHA-256 hash of the identifier,
  never the token, so a copy of the database can't open a link that still works.

## `create-owner`

Creates the owner account, the workspace, and the owner membership, marks the installation as
having an owner, and prints a set-password link.

Human output, exit 0:

```text
Owner created: Sam Rivera (username sam)
Set your password here (expires 2026-11-04T02:45:00Z, works once):
https://space.example.com/reset-password#token=<token>
If it expires, run: docker compose exec server reset-link
```

`--json` output, exit 0:

```json
{ "ok": true, "username": "sam", "email": null, "url": "https://…/reset-password#token=…", "token": "…", "expiresAt": "2026-11-04T02:45:00Z" }
```

With `--email sam@example.com`, the first line reads `Owner created: Sam Rivera (username sam, email
sam@example.com, unverified)` and `email` is that address. `email` is `null` when none was given.

`token` is included so the CLI and desktop app can set the password for the user without opening the
link.

Failure, `--json`:

```json
{ "ok": false, "error": "invalid_input", "fields": { "username": "Use 3 to 30 characters." } }
{ "ok": false, "error": "owner_exists", "message": "This installation already has an owner." }
{ "ok": false, "error": "storage_unavailable", "message": "The database could not be read." }
```

Rules:

- **Name:** 1 to 100 characters after trimming.
- **Username:** 3 to 30 letters, digits, `_` or `.`, stored lowercase. The owner signs in with it,
  without regard to case.
- **Email (optional):** a valid address of up to 254 characters, stored lowercase and unverified.
  It never signs in. Without one, the account holds `<username>@users.invalid`, a reserved address
  that can't receive mail and is never shown or reported; an address at `users.invalid` is refused.
- **Initial password:** the account starts with a random password that is never shown or stored
  anywhere else, so the set-password link is the only way in.
- **Workspace name:** "&lt;name&gt;'s space".
- **Rerun:** if a run stops partway, running it again with the same username reuses the account and
  workspace it already created and finishes the job. With a different username it exits 1
  (`invalid_input`), naming the username the earlier run used.
- **One at a time:** runs take turns through a database lock. Of two runs started together, one
  creates the owner and the other exits 2 (`owner_exists`).
- **Event:** records an `owner.created` event credited to the operator actor.

## `reset-link`

Issues a single-use password reset link for the existing owner. It does not change the password,
sessions, or ownership until the link is used (FR-018).

Human output, exit 0:

```text
Password reset link for sam (expires 2026-11-04T01:45:00Z, works once):
https://space.example.com/reset-password#token=<token>
Using it signs out every existing session.
```

`--json` output, exit 0:

```json
{ "ok": true, "username": "sam", "url": "https://…/reset-password#token=…", "token": "…", "expiresAt": "2026-11-04T01:45:00Z" }
```

Failure, `--json`, exit 2 or 3:

```json
{ "ok": false, "error": "no_owner", "message": "This installation has no owner yet. Run create-owner." }
{ "ok": false, "error": "storage_unavailable", "message": "The database could not be read." }
```

The command records a `recovery.link_issued` event credited to the operator actor.

## `show-secrets`

Prints the auth secret and the database password in use, and where each comes from: `set in .env`
or `generated by Your Space` (the copy in the `ys-secrets` volume). It changes nothing and logs
nothing; the values appear only in the operator's terminal.

Human output, exit 0:

Every line is valid in `.env`, so a generated secret's line can be copied there as it is:

```text
# auth secret, generated by Your Space
BETTER_AUTH_SECRET=<43 characters>
# database password, set in .env
POSTGRES_PASSWORD=<value>
# Keep these private. To manage a generated one yourself, copy its line into .env; Your Space then uses .env.
```

`--json` output, exit 0:

```json
{ "ok": true, "secrets": [{ "name": "BETTER_AUTH_SECRET", "source": "generated", "value": "…" }, { "name": "POSTGRES_PASSWORD", "source": "env", "value": "…" }] }
```

Exit 1 with `usage` for an unknown argument. Exit 4 with `unexpected` when a secret has no value yet,
naming it.

## The `secrets` Step

A one-shot service in `deploy/stack.yaml`. `docker compose up` runs it before PostgreSQL and the
server, and they start only if it exits 0. For each secret it uses a value set in `.env` exactly as
given, keeps the generated copy in `ys-secrets`, or generates one for a new installation. It always
creates both folders in the volume, since PostgreSQL mounts its folder. It exits 1, writing nothing,
when:

- a value in `.env` starts or ends with a space, or `BETTER_AUTH_SECRET` is shorter than 32
  characters;
- the database exists but a secret is missing. The message names every missing secret and how to
  recover.

Its log (`docker compose logs secrets`) names each secret and what happened (`secrets.from_env`,
`secrets.kept`, `secrets.generated`, `secrets.replaced`, `secrets.not_replaced`), never a value.

`docker compose run --rm secrets --new auth-secret` or `--new database-password` replaces a
generated secret, even next to an existing database. A secret set in `.env` is left as it is
(`secrets.not_replaced`, with a note), so the same command works whichever secrets `.env` sets.
A running server keeps the secrets it started with, so the step prints what to do next:

- a new auth secret takes effect on `docker compose restart server`, which signs out every device;
- a new database password must first be given to PostgreSQL (the guide's "Give PostgreSQL the
  Database Password"), then the server restarted.
