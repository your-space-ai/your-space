# Install by hand (advanced)

These are the steps the `your-space` command takes for you: download the release, configure `.env`,
and run Docker Compose and the server's commands. Use them if you'd rather not install the command.
Each step says which `your-space` command does the same.

## 1. Download

`your-space init` does this step.

For the source preview, use the [Docker source walkthrough](from-source.md). For a published
[Your Space release](https://github.com/your-space-ai/your-space/releases), save `your-space.tar.gz`
and `SHA256SUMS` from the same release to a new installation folder. In that folder, run
`sha256sum your-space.tar.gz` on Linux or `shasum -a 256 your-space.tar.gz` on macOS. Check that
the digest matches the `your-space.tar.gz` entry in `SHA256SUMS` before unpacking it:

```sh
tar -xzf your-space.tar.gz
cp env.example .env
```

The download holds `compose.yaml`, `stack.yaml`, a `modes` folder, and `env.example`. It never
contains `.env`, so your settings are never overwritten by a download. Run every later command in
this folder.

## 2. Configure

**For this machine, there's nothing to configure.** With nothing in `.env`, Your Space answers only
on this machine, at `http://space.localhost`, and generates its own secrets (see [Secrets](#secrets)). To
use it from other devices, add one line:

| You want | Add to `.env` | What happens |
| --- | --- | --- |
| Use it on this machine only (the default) | nothing | Plain HTTP at `http://space.localhost`, reachable only from this machine |
| Use your own domain | `YS_DOMAIN=space.example.com` | Ports 80 and 443 open to the network. Caddy gets and renews a Let's Encrypt certificate and redirects HTTP to HTTPS. See [Use Your Own Domain](other-devices.md#use-your-own-domain) |
| Use your own proxy or Tailscale | `YS_PROXY_URL=https://<the proxy's address>` | Caddy serves plain HTTP on `127.0.0.1:8080` only; your proxy or Tailscale handles HTTPS. See [Use Your Own Reverse Proxy](other-devices.md#use-your-own-reverse-proxy) or [Use Tailscale](other-devices.md#use-tailscale) |

If another program already uses port 80 on this machine (or 8080 with `YS_PROXY_URL`), also add
`YS_PORT=8081`, or any free port. On this machine only, Your Space then answers at
`http://space.localhost:8081`. With `YS_PROXY_URL`, keep using the proxy's HTTPS address and point
the proxy at the new port. `YS_PORT` doesn't apply to your own domain, which needs ports 80 and 443.

Which line you write decides which ports open: only `YS_DOMAIN` opens any to the network. The
server checks every line when it starts and refuses to start, with a message that says what to fix,
if a value is wrong, if both `YS_DOMAIN` and `YS_PROXY_URL` are set, or if a setting's name is
misspelled. Caddy waits for the server, so a wrong line never opens a port.

### Secrets

Your Space needs three secrets: the auth secret that signs sessions, the database password, and the
data key that encrypts installed apps' settings (see
[What Your Space Encrypts](../operate/README.md#what-your-space-encrypts)). On the first start it generates each one, 32
random bytes, and keeps it in the `ys-secrets` volume. It never generates them again, and it never
logs them. The log only notes that they were generated (`docker compose logs secrets`).

To use your own instead, for example from a password manager, add them to `.env` before the first
start:

```sh
BETTER_AUTH_SECRET=...   # at least 32 characters, e.g. from: openssl rand -base64 32
POSTGRES_PASSWORD=...
YS_DATA_KEY=...          # at least 32 characters
```

Your Space then uses them as given and never copies them anywhere. Keep `.env` private if you do.

To see the secrets in use and where each comes from:

```sh
docker compose exec server show-secrets
```

Every line it prints is valid in `.env`, so to manage a generated secret yourself, copy its line
there. To replace a secret later, see [Replace a Secret](../operate/recovery.md#replace-a-secret).

## 3. Start

`your-space start` does this step and the next.

```sh
docker compose up -d
docker compose ps
```

The first start downloads the images, which takes a minute or two. `docker compose ps` should show
all four services running (`caddy`, `server`, `runtime` and `postgres`), with `server` and
`postgres` marked `healthy`. If they aren't:

| You see | What to do |
| --- | --- |
| `service "secrets" didn't complete successfully` | Run `docker compose logs secrets`. It says what's wrong with a secret and how to fix it; see [Lost Secrets](../operate/recovery.md#lost-secrets) |
| `server` keeps restarting, and `docker compose logs server` says "PostgreSQL refused the database password" | The database password changed after the database was created. Change `POSTGRES_PASSWORD` in `.env` back, or [give PostgreSQL the new one](../operate/recovery.md#give-postgresql-the-database-password) |
| `dependency failed to start: container your-space-server-1 is unhealthy` | Run `docker compose logs server`. An `Invalid configuration` message names the setting to fix. Fix `.env` and run `docker compose up -d` again. No port was opened meanwhile |
| `Set YS_DOMAIN (your own domain) or YS_PROXY_URL (your own proxy or Tailscale) in .env, not both` | Remove one of the two lines. Every `docker compose` command stops with this message until you do |
| `address already in use` or `port is already allocated`, for port 80 or 8080 | Another program uses the port. Add `YS_PORT=8081` (or any free port) to `.env` |
| The same, for port 443 with your own domain | Another program uses the port, such as another web server. Stop it, or put Your Space behind it as [your own proxy](other-devices.md#use-your-own-reverse-proxy) |
| `server` is `unhealthy` after it was running | Run `docker compose logs server postgres` and see [When the Database Is Down](../operate/README.md#when-the-database-is-down) |

Open your address (for example `http://space.localhost`). It says Your Space has no owner yet and shows
the command to create one. There is no sign-up form: nobody can make an account from the web.

## 4. Create the Owner

```sh
docker compose exec server create-owner --username you --name "Your Name"
```

It prints a link:

```text
Owner created: Your Name (username you)
Set your password here (expires 2026-11-04T02:45:00Z, works once):
http://space.localhost/reset-password#token=...
If it expires, run: docker compose exec server reset-link
```

The command creates your account, your workspace ("Your Name's space"), and your ownership of it.
You sign in with the username. An email address is optional: add `--email you@example.com` to
store one. Your Space doesn't send email yet, so the address stays unverified and is never used to
sign in; a later release uses it for verification and recovery links.

Account rules:

- **Name:** 1 to 100 characters, without control characters such as tabs or line breaks.
- **Username:** 3 to 30 letters, digits, `_` or `.`, with each `.` between other characters. It is stored in lowercase, and signing in
  ignores case, so `You` and `you` are the same username.
- **Email (optional):** up to 254 characters: letters, digits, and `_ ' + -` in parts separated by
  single dots, then `@` and a domain such as `example.com`. It is stored in lowercase.

Running `create-owner` again does nothing and says the installation already has an owner. If the
command was interrupted (for example, the server stopped), run it again with the same username: it
finishes the job without creating duplicates.

For scripts, add `--json`. The output is one JSON object, including the link and its token, and the
exit status says what happened:

| Exit status | Meaning |
| --- | --- |
| 0 | Done |
| 1 | Invalid input, such as a username with a space in it |
| 2 | The installation already has an owner |
| 3 | The database could not be read. No owner was created; once the database is back, run the same command again |
| 4 | Something unexpected went wrong; nothing was reported as done |

The [command contract](../../specs/001-workspace-owner-access/contracts/operator-commands.md) lists
the exact output.

## 5. Set Your Password and Sign In

Open the link in a browser within 30 minutes. Choose a password of 12 to 128 characters; a long
passphrase is a good choice. Then sign in with your username and that password.

The link works once. If it expires or you lose it, run
`docker compose exec server reset-link` for a new one.

You now see your workspace, your name and username, and a way to sign out. Open **Apps** to review and install your first kit.
