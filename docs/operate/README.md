# Run Your Space

How to run, restart and look after an installed workspace. To install one, see the [installation guide](../install/README.md).

## Run It

| To | Run |
| --- | --- |
| See what is running, your address, and your apps | `your-space status` |
| Stop Your Space and its apps (nothing is deleted) | `your-space stop` |
| Start them again | `your-space start` |
| Read the logs | `your-space logs`, or `your-space logs server --follow` for one service |
| Change how Your Space is reached | `your-space configure` |
| Get a new set-password link | `your-space owner reset-link` |
| See or replace the secrets | `your-space secrets show`, `your-space secrets replace <name>` |

Your Space also starts by itself when Docker starts, for example after a reboot, unless you stopped
it.

For scripts, add `--json` to any command but `logs`: it prints one JSON object and never asks a
question, so each answer needs its option. `--yes` answers yes and takes the defaults:

```sh
your-space init --yes --json
your-space start --owner-name "Sam Rivera" --owner-username sam --json
```

The exit status says what happened: 0 done, 1 an invalid option or answer, 2 something in the way
(the message says what), 3 Docker or the database couldn't be reached, 4 something unexpected. The
[command contract](../../specs/003-install-with-the-cli/contracts/cli-commands.md) lists every
option and field.

The `your-space` command runs `docker compose` in this folder, so every `docker compose` command in
this guide still works here, and a folder you set up by hand works with `your-space` as it is.
There is one Your Space per Docker engine: `your-space` refuses to start a second one from another
folder, since both would share the same volumes.

## Sign-In and Sessions

- **Sessions** last 7 days and are extended, at most once a day, while you use Your Space. You're
  asked to sign in again only after about a week away.
- **Restarts** don't sign you out. Sessions are stored in the database.
- **Signing out** ends the session on that device only. To sign out every device, set a new
  password with [`reset-link`](recovery.md#recover-the-owner-account).
- **Too many attempts:** after 3 sign-in attempts from one network address, each within 10 seconds
  of the one before and whether or not the password is right, Your Space refuses further attempts
  with "Too many sign-in attempts" until 10 seconds pass without an accepted attempt. Refused
  attempts don't extend the wait. This slows password guessing but never locks your account: once
  the wait is over, the right password works. If Your Space can't see visitors' own addresses, for
  example behind a proxy that doesn't pass them on, all visitors share one limit (see
  [Use Your Own Reverse Proxy](../install/other-devices.md#use-your-own-reverse-proxy)).
- **Passwords** are 12 to 128 characters. Your Space stores only a salted, one-way hash of each
  password, never the password itself.
- **Set-password and reset links** carry a random 24-character token, too long to guess. The token
  is in the part of the link after `#`, which browsers never send to a server, so it doesn't appear
  in server or proxy logs. The database keeps only a hash of it, so a copy of the database can't
  open a link that still works.

## Restarts and Your Data

Everything Your Space itself keeps is in three Docker volumes (a fourth, `ys-runtime`, holds
nothing durable):

| Volume | What it holds |
| --- | --- |
| `ys-postgres` | The database: your account, password hash, workspace, and sessions |
| `ys-secrets` | The generated auth secret and database password. Keep it with `ys-postgres` |
| `ys-caddy-data` | Caddy's HTTPS certificates |

`docker volume ls` lists them as `your-space_ys-postgres`, `your-space_ys-secrets`, and
`your-space_ys-caddy-data`. Nothing else is kept in the containers, so they can be removed and
recreated at any time.

Your settings are in `.env`, next to `compose.yaml`. Keep it with the volumes:

- Setting or changing `BETTER_AUTH_SECRET` signs out every device. Nothing else is lost.
- Don't change `POSTGRES_PASSWORD` once the database exists. PostgreSQL keeps the password it was
  created with, so the server would stop with "PostgreSQL refused the database password". Change it
  back, or [give PostgreSQL the new one](recovery.md#give-postgresql-the-database-password).

These keep everything, including your sessions:

| To | Run |
| --- | --- |
| Restart Your Space | `docker compose restart` |
| Remove and recreate the containers | `docker compose down`, then `docker compose up -d` |

Afterwards `docker compose ps` shows the services running again, you're still signed in, and you
never need to create the owner again. Your Space also starts by itself when Docker starts, for
example after a reboot, unless you stopped it with `docker compose stop` or `docker compose down`.
On macOS, that needs your engine (OrbStack, Colima or Docker Desktop) set to start when you sign in.

Apps keep their data in their own volumes, named after the app, such as `ys-sure_postgres-data`.
`docker compose down -v` doesn't delete them, and doesn't stop the apps: stop them first with
`docker compose exec runtime stop-apps`.

> [!WARNING]
> `docker compose down -v` is not a restart. `-v` (`--volumes`) deletes all three volumes, and your
> account and workspace with them: the next start has no owner. `docker volume rm` on these
> volumes, or `docker volume prune --all` while Your Space is down, does the same. There is no
> undo.

Updating Your Space and backing it up aren't covered yet; they come in a later release.

## When the Database Is Down

If PostgreSQL stops or can't be read, Your Space reports a storage problem and changes nothing. It
never takes a missing database for a new installation, so it never offers to create an owner again.

| Where | What you see |
| --- | --- |
| The web page | "Your Space can't read its storage", with a **Try again** button |
| `<your address>/api/status` | HTTP status 503 and `{"state":"storage_unavailable"}` |
| `create-owner` | Exit status 3 and "The database could not be read." Nothing was changed |
| `reset-link` | Exit status 3 and "The database could not be read." No link is printed, and an earlier unused link may have stopped working: run `reset-link` again once the database is back |
| `docker compose ps` | `server` turns `unhealthy` |

To find the cause:

```sh
docker compose ps
docker compose logs postgres
```

`postgres` should be listed as `Up` and `(healthy)`. If it's missing, it has stopped
(`docker compose ps -a` lists it). Its log says why it stopped or can't start, for example a full
disk.

To bring it back:

```sh
docker compose up -d
```

`docker compose start postgres` works too. Once `postgres` is healthy, the server reconnects by
itself within a few seconds; you don't need to restart it. Select **Try again** in the browser: your
account, workspace, and session are as they were.

If the server itself restarted while the database was down, it waits about a minute for the
database, then exits, and Docker keeps starting it again until the database is back. Meanwhile the
web page says "Can't reach Your Space".

Don't delete the `ys-postgres` volume to make the error go away: that deletes your workspace.

## What Your Space Encrypts

Your Space's database is PostgreSQL, which doesn't encrypt what it stores: anyone with a copy of the
`ys-postgres` volume, a file backup, or the disk can read it.

- **Installed apps' settings** (their keys, passwords and API keys, generated or yours) are
  encrypted by Your Space with the data key, AES-256-GCM. The data key is kept apart from the
  database, in the `ys-secrets` volume or in `.env`, so a copy of the database alone doesn't reveal
  them.
- **Passwords and set-password links** are never stored: only one-way hashes of them are.
- **Sessions** can't be used from a copy of the database alone: a sign-in cookie is also signed
  with the auth secret, which is in `ys-secrets`.
- **Everything else**, such as names, usernames, email addresses, which apps are installed, and the
  activity log, is stored as it is.

The data key sits on the same machine as the database, so it protects copies of the database, not
the machine itself. To protect everything on a disk that could be lost, stolen or thrown away,
encrypt the disk itself: LUKS (or ZFS's own encryption) on Linux, FileVault on a Mac. That protects
the disk while the machine is off, not a copy taken while it runs.
