---
title: "Recover secrets and the owner account"
---

## Lost Secrets

If the `ys-secrets` volume is gone but the database is still there, Your Space stops before it
starts anything, instead of generating new secrets: a new database password wouldn't work, because
PostgreSQL only accepts the one it was created with. `your-space start` says so and what to do; by
hand, `docker compose up -d` reports that the `secrets` service didn't complete, and
`docker compose logs secrets` explains.

Ways to recover, best first:

1. **Restore the `ys-secrets` volume** from a backup, or **put the old values back** in `.env` as
   `BETTER_AUTH_SECRET`, `POSTGRES_PASSWORD` and `YS_DATA_KEY`. Then run `docker compose up -d`.
   Without the old data key, installed apps' settings and the GitHub connection's token can't be
   read; see option 2.
2. **Start with new secrets.** Your account and workspace stay; every device is signed out. If the
   data key was lost too (it is in the same volume, unless you set `YS_DATA_KEY` in `.env`),
   installed apps' settings can't be read, and an app can't be installed again over its kept data,
   because that data depends on the settings, such as the app's own database password. Restore the
   old data key if you can. Otherwise remove the app, delete its kept data on its page, and install it
   again: the app starts empty, and deleting its data can't be undone. The GitHub page then shows
   **Reconnect**: connect GitHub again with a new token. Run:

   ```sh
   your-space start --new-secrets
   ```

   It runs every step below for you. By hand, in the folder with `compose.yaml`:

   ```sh
   docker compose run --rm secrets --new auth-secret --new database-password
   docker compose up -d --wait postgres
   ```

   Then [give PostgreSQL the database password](#give-postgresql-the-database-password), and start
   the rest with `docker compose up -d`. A secret set in `.env` is left as it is by `--new`, so these
   steps work whichever secrets you set there.

### Give PostgreSQL the Database Password

PostgreSQL keeps the password it was created with. After a new generated password, or after you
change `POSTGRES_PASSWORD` in `.env`, give it the password now in use (the one in `.env` if set,
otherwise the generated one). With Your Space started, run this in the folder with `compose.yaml`,
all lines at once:

```sh
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U yourspace -d yourspace <<'EOF'
SET log_min_error_statement = panic;
\set pw `if [ -n "$POSTGRES_PASSWORD" ]; then printf '%s' "$POSTGRES_PASSWORD"; else cat /run/ys-secrets/password; fi`
SELECT :'pw' <> '' AS found \gset
\if :found
ALTER ROLE yourspace PASSWORD :'pw';
\else
\echo 'No database password in .env or ys-secrets, so nothing was changed.'
\endif
EOF
```

It prints `ALTER ROLE` when done. It connects through PostgreSQL's own socket inside its container,
which needs no password, and it reads the password inside the container, so the password never
appears in a command line or a log. Then restart the server so it reconnects:
`docker compose restart server`.

### Replace a Secret

To replace a generated secret, for example because it may have leaked, run
`your-space secrets replace auth-secret`, `your-space secrets replace database-password` or
`your-space secrets replace data-key`. It asks
first, then runs every step below. `your-space secrets show` says where each secret comes from, and
`--reveal` shows the values. By hand:

- **Auth secret:** `docker compose run --rm secrets --new auth-secret`, then
  `docker compose restart server`. Every device is signed out when the server restarts, and nothing
  else changes.
- **Data key:** `docker compose run --rm secrets --new data-key`, then `docker compose restart server`.
  The secrets step keeps the replaced key until the server, as it starts, has re-encrypted every
  app's settings, and the GitHub connection's token, with the new one. Once `docker compose ps` shows the server healthy, remove the old
  key: `docker compose run --rm secrets --forget previous-data-key`. Until it is removed, the data
  key can't be replaced again.
- **Database password:** `docker compose run --rm secrets --new database-password`, then
  [give PostgreSQL the database password](#give-postgresql-the-database-password) and restart the
  server.

A secret set in `.env` is changed in `.env` instead. After changing `BETTER_AUTH_SECRET`, run
`docker compose up -d`; after changing `POSTGRES_PASSWORD`, run `docker compose up -d` and then give
PostgreSQL the database password as above.

## Recover the Owner Account

If you've lost the owner's password, or the set-password link expired, get a new link. On the
server, in Your Space's folder, run:

```sh
your-space owner reset-link
```

By hand, the same is:

```sh
docker compose exec server reset-link
```

Either prints a new link for the owner. The `docker compose` form prints:

```text
Password reset link for you (expires 2026-11-04T01:45:00Z, works once):
http://space.localhost/reset-password#token=...
Using it signs out every existing session.
```

Open the link within 30 minutes and choose a new password of 12 to 128 characters. Then sign in
with it.

- **Server access is the proof.** Only someone who can run commands on this server can get a link;
  the web page can't issue one. No email is sent or needed.
- **The link works once, for 30 minutes.** Each run prints a new link and cancels the previous one
  if it wasn't used, including the set-password link from `create-owner`. Only the newest link
  works. Treat it like a password; Your Space doesn't log it.
- **Running the command changes nothing by itself.** The old password keeps working, and nobody is
  signed out, until someone uses the link.
- **Using the link signs out every device.** Sign in again with the new password on each.
- **Your account stays the same.** It keeps its username, workspace and ownership.

For scripts, add `--json`, and `-T` so Docker doesn't attach a terminal:

```sh
docker compose exec -T server reset-link --json
```

```json
{"ok":true,"username":"you","url":"http://space.localhost/reset-password#token=...","token":"...","expiresAt":"2026-11-04T01:45:00Z"}
```

| Exit status | Meaning |
| --- | --- |
| 0 | Done |
| 1 | Invalid usage, such as an unknown option or an extra argument |
| 2 | There is no owner yet. Run `create-owner` first |
| 3 | The database could not be read. No link is printed, and an earlier unused link may no longer work: run `reset-link` again once the database is back. See [When the Database Is Down](index.md#when-the-database-is-down) |
| 4 | Something unexpected went wrong; nothing was reported as done |

If `docker compose exec` itself fails, for example because the server isn't running, the exit status
is Docker's own and there is no JSON. Start Your Space with `docker compose up -d` and run
`reset-link` again. The
[command contract](https://github.com/your-space-ai/your-space/blob/main/specs/001-workspace-owner-access/contracts/operator-commands.md) lists the
exact output.
