# Install Your Space

This guide installs Your Space with Docker Compose, creates its owner, and keeps it running. You
need access to the server's command line: that access, not a web page, is what makes you the
owner.

Your Space runs as three containers, after a short step that runs first:

- **secrets** runs once on each start, before the others, and exits. It generates the auth secret
  and the database password on the first start (see [Secrets](#secrets)), so `docker compose ps -a`
  lists it as exited.
- **caddy** serves the web client and handles HTTPS, including getting certificates.
- **server** is the API. It also holds the operator commands `create-owner`, `reset-link`, and
  `show-secrets`.
- **postgres** stores everything: your account, your workspace, and your sessions.

## Before You Start

You need:

- A Mac or Linux machine that can run Docker:
  - macOS with [Docker Desktop](https://docs.docker.com/desktop/), or
  - Linux with [Docker Engine](https://docs.docker.com/engine/install/) 28.3.3 or newer and the
    Docker Compose plugin. Older Engine versions can open ports meant for this machine only to the
    network after a firewall reload (CVE-2025-54388).
- Docker Compose 2.26.0 or newer: `docker compose version` prints `v2.26.0` or later.
- About 1 GB of free memory and 2 GB of disk.

Windows is not supported as a server.

**Checked so far:** steps 2 to 5 and the later sections were checked only with locally built
images on Linux on Intel/AMD (x86_64) with Docker Engine 29 and Compose 5.6, in Chromium, Firefox,
and WebKit. Downloading from a release, the published images, macOS, ARM machines such as Apple
Silicon, IPv6, and HTTPS with a real domain or Tailscale have not been checked yet.

Check Docker before you go on:

```sh
docker version
docker compose version
```

If either command fails, install or start Docker first. On macOS, open Docker Desktop and wait
until it says it is running.

## 1. Download

Make a folder for Your Space, download the release into it, and make your settings file. It starts
with every line commented out:

```sh
mkdir your-space && cd your-space
curl -fsSL https://github.com/your-space-ai/your-space/releases/latest/download/your-space.tar.gz | tar -xz
cp env.example .env
```

The download holds `compose.yaml`, `stack.yaml`, a `modes` folder, and `env.example`. It never
contains `.env`, so your settings are never overwritten by a download. Run every later command in
this folder.

## 2. Configure

**For this machine, there's nothing to configure.** With nothing in `.env`, Your Space answers only
on this machine, at `http://localhost`, and generates its own secrets (see [Secrets](#secrets)).

| You want | Add to `.env` | What happens |
| --- | --- | --- |
| Use it on this machine only (the default) | nothing | Plain HTTP at `http://localhost`, reachable only from this machine |

If another program already uses port 80 on this machine (or 8080 with `YS_PROXY_URL`), also add
`YS_PORT=8081`, or any free port. Your Space then answers at `http://localhost:8081`. `YS_PORT`
doesn't apply to your own domain, which needs ports 80 and 443.

### Secrets

Your Space needs two secrets: the auth secret that signs sessions, and the database password. On
the first start it generates each one, 32 random bytes, and keeps it in the `ys-secrets` volume. It
never generates them again, and it never logs them. The log only notes that they were generated
(`docker compose logs secrets`).

To use your own instead, for example from a password manager, add them to `.env` before the first
start:

```sh
BETTER_AUTH_SECRET=...   # at least 32 characters, e.g. from: openssl rand -base64 32
POSTGRES_PASSWORD=...
```

Your Space then uses them as given and never copies them anywhere. Keep `.env` private if you do.

To see the secrets in use and where each comes from:

```sh
docker compose exec server show-secrets
```

Every line it prints is valid in `.env`, so to manage a generated secret yourself, copy its line
there. To replace a secret later, see [Replace a Secret](#replace-a-secret).

## 3. Start

```sh
docker compose up -d
docker compose ps
```

The first start downloads the images, which takes a minute or two. `docker compose ps` should show
all three services running, with `server` and `postgres` marked `healthy`. If they aren't:

| You see | What to do |
| --- | --- |
| `service "secrets" didn't complete successfully` | Run `docker compose logs secrets`. It says what's wrong with a secret and how to fix it; see [Lost Secrets](#lost-secrets) |
| `server` keeps restarting, and `docker compose logs server` says "PostgreSQL refused the database password" | The database password changed after the database was created. Change `POSTGRES_PASSWORD` in `.env` back, or [give PostgreSQL the new one](#give-postgresql-the-database-password) |
| `dependency failed to start: container your-space-server-1 is unhealthy` | Run `docker compose logs server`. An `Invalid configuration` message names the setting to fix. Fix `.env` and run `docker compose up -d` again. No port was opened meanwhile |
| `address already in use` or `port is already allocated`, for port 80 or 8080 | Another program uses the port. Add `YS_PORT=8081` (or any free port) to `.env` |

Open your address (for example `http://localhost`). It says Your Space has no owner yet and shows
the command to create one. There is no sign-up form: nobody can make an account from the web.

## 4. Create the Owner

```sh
docker compose exec server create-owner --email you@example.com --name "Your Name"
```

It prints a link:

```text
Owner created: Your Name <you@example.com>
Set your password here (expires 2026-11-04T02:45:00Z, works once):
http://localhost/reset-password#token=...
If it expires, run: docker compose exec server reset-link
```

The command creates your account, your workspace ("Your Name's space"), and your ownership of it.
Your email is your sign-in name. Your Space doesn't send email, so the address stays unverified;
that doesn't limit anything.

Account rules:

- **Name:** 1 to 100 characters, without control characters such as tabs or line breaks.
- **Email:** up to 254 characters: letters, digits, and `_ ' + -` in parts separated by single dots,
  then `@` and a domain such as `example.com`. It is stored in lowercase.

Running `create-owner` again does nothing and says the installation already has an owner. If the
command was interrupted (for example, the server stopped), run it again with the same email: it
finishes the job without creating duplicates.

For scripts, add `--json`. The output is one JSON object, including the link and its token, and the
exit status says what happened:

| Exit status | Meaning |
| --- | --- |
| 0 | Done |
| 1 | Invalid input, such as a malformed email |
| 2 | The installation already has an owner |
| 3 | The database could not be read. No owner was created; once the database is back, run the same command again |
| 4 | Something unexpected went wrong; nothing was reported as done |

The [command contract](../../specs/001-workspace-owner-access/contracts/operator-commands.md) lists
the exact output.

## 5. Set Your Password and Sign In

Open the link in a browser within 30 minutes. Choose a password of 12 to 128 characters; a long
passphrase is a good choice. Then sign in with your email and that password.

The link works once. If it expires or you lose it, run
`docker compose exec server reset-link` for a new one.

You now see your workspace, your name and email, and a way to sign out. The workspace is empty:
installing apps comes in a later release.

## Lost Secrets

If the `ys-secrets` volume is gone but the database is still there, Your Space stops before it
starts anything, instead of generating new secrets: a new database password wouldn't work, because
PostgreSQL only accepts the one it was created with. `docker compose up -d` reports that the
`secrets` service didn't complete, and `docker compose logs secrets` explains.

Ways to recover, best first:

1. **Restore the `ys-secrets` volume** from a backup, or **put the old values back** in `.env` as
   `BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD`. Then run `docker compose up -d`.
2. **Start with new secrets.** Your account and workspace stay; every device is signed out. In the
   folder with `compose.yaml`:

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

To replace a generated secret, for example because it may have leaked:

- **Auth secret:** `docker compose run --rm secrets --new auth-secret`, then
  `docker compose restart server`. Every device is signed out when the server restarts, and nothing
  else changes.
- **Database password:** `docker compose run --rm secrets --new database-password`, then
  [give PostgreSQL the database password](#give-postgresql-the-database-password) and restart the
  server.

A secret set in `.env` is changed in `.env` instead. After changing `BETTER_AUTH_SECRET`, run
`docker compose up -d`; after changing `POSTGRES_PASSWORD`, run `docker compose up -d` and then give
PostgreSQL the database password as above.
