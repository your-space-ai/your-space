# Install Your Space

This guide installs Your Space with Docker Compose, creates its owner, and keeps it running. You
need access to the server's command line: that access, not a web page, is what makes you the
owner.

Your Space runs as three containers:

- **caddy** serves the web client and handles HTTPS, including getting certificates.
- **server** is the API. It also holds the two operator commands, `create-owner` and `reset-link`.
- **postgres** stores everything: your account, your workspace, and your sessions.

## Before You Start

You need:

- A Mac or Linux machine that can run Docker:
  - macOS with [Docker Desktop](https://docs.docker.com/desktop/), or
  - Linux with [Docker Engine](https://docs.docker.com/engine/install/) 28 or newer and the Docker
    Compose v2 plugin (`docker compose version` prints `v2` or later).
- About 1 GB of free memory and 2 GB of disk.
- `openssl` to generate secrets (installed on macOS and most Linux distributions).
- For access from other devices: a domain name pointing at the server, or [Tailscale](https://tailscale.com).
  See [Use Your Space From Other Devices](#use-your-space-from-other-devices).

Windows is not supported as a server. The versions this guide has been checked on are listed in
[VERIFICATION.md](VERIFICATION.md).

Check Docker before you go on:

```sh
docker version
docker compose version
```

If either command fails, install or start Docker first. On macOS, open Docker Desktop and wait
until it says it is running.

## 1. Download

Make a folder for Your Space and download the Compose file and the settings template:

```sh
mkdir your-space && cd your-space
curl -fsSL -o compose.yaml https://github.com/your-space-ai/your-space/releases/latest/download/compose.yaml
curl -fsSL -o .env https://github.com/your-space-ai/your-space/releases/latest/download/env.example
```

Run every later command in this folder.

## 2. Configure

Open `.env` in a text editor.

**Generate the two secrets** and paste each after its `=`:

```sh
openssl rand -base64 32   # for BETTER_AUTH_SECRET
openssl rand -hex 32      # for POSTGRES_PASSWORD
```

Keep `.env` private: anyone with these secrets can read or impersonate your installation. Don't
commit it or share it.

**Choose the address** people will use, `YS_PUBLIC_URL`:

| You want | Set in `.env` | What happens |
| --- | --- | --- |
| Use it on this machine only (the default) | `YS_PUBLIC_URL=http://localhost` | Plain HTTP, reachable only from this machine |
| Use your own domain | `YS_PUBLIC_URL=https://space.example.com` | Caddy gets and renews a Let's Encrypt certificate and redirects HTTP to HTTPS. The domain's DNS must point at this server, with ports 80 and 443 open to the internet |
| Use your own proxy or Tailscale | `YS_PUBLIC_URL=https://<the proxy's address>`, `YS_SITE_ADDRESS=http://:8080`, and `YS_TRUSTED_PROXIES=private_ranges` | Caddy serves plain HTTP on `127.0.0.1:8080`; your proxy or Tailscale handles HTTPS. See [Use Your Space From Other Devices](#use-your-space-from-other-devices) |

`YS_PUBLIC_URL` must be just the address: no path and no trailing slash. Plain `http://` works only
for `localhost`; the server refuses to start with plain HTTP for any other address, because your
sign-in would travel unencrypted.

## 3. Start

```sh
docker compose up -d
docker compose ps
```

The first start downloads the images, which takes a minute or two. `docker compose ps` should show
all three services running, with `server` and `postgres` marked `healthy`. If they aren't:

| You see | What to do |
| --- | --- |
| `required variable ... is missing a value` | A setting in `.env` is empty. Fill it in as in step 2 |
| `server` keeps restarting | Run `docker compose logs server`. An `Invalid configuration` message names the setting to fix |
| `Bind for 0.0.0.0:80 failed: port is already allocated` | Another program uses port 80 or 443. Stop it, or use [your own proxy](#use-your-own-reverse-proxy) |
| `server` is `unhealthy` | Run `docker compose logs server postgres` and see [When the Database Is Down](#when-the-database-is-down) |

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

- **Name:** 1 to 100 characters.
- **Email:** a valid address, up to 254 characters. It is stored in lowercase.

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
| 3 | The database could not be read; nothing was changed |
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

## Certificates

With your own domain in `YS_PUBLIC_URL`, Caddy asks Let's Encrypt for a certificate when it starts
and renews it automatically. To see what it is doing:

```sh
docker compose logs caddy
```

If the certificate isn't issued, the log names the reason. The usual causes:

- **The domain doesn't point at this server.** Check the DNS `A` (and `AAAA`) records.
- **Ports 80 or 443 are blocked.** Let's Encrypt must reach this server on both, from the internet.
  Check the firewall and any router port forwarding.

Caddy keeps retrying, and it never falls back to serving your domain over plain HTTP. Certificates
are kept in the `ys-caddy-data` volume, so restarts don't request new ones.
