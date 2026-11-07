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

Windows is not supported as a server.

**Checked so far:** this guide has been run end to end only on Linux on Intel/AMD (x86_64) with
Docker Engine 29, in Chromium, Firefox, and WebKit. macOS, ARM machines such as Apple Silicon, and
HTTPS with a real domain or Tailscale have not been checked yet. [VERIFICATION.md](VERIFICATION.md)
lists exactly what was tested, with versions.

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

## Use Your Space From Other Devices

By default Your Space answers only on this machine, at `http://localhost`. To use it from a phone or
another computer, give it an HTTPS address in one of three ways:

| Way | You need | Who can reach it |
| --- | --- | --- |
| [Your own domain](#use-your-own-domain) | A domain whose DNS points at this server, with ports 80 and 443 open to the internet | Anyone on the internet; only the owner can sign in |
| [Your own reverse proxy](#use-your-own-reverse-proxy) | A proxy on this machine that already handles HTTPS | Whoever can reach your proxy |
| [Tailscale](#use-tailscale) | Tailscale on this server and on each device | Only your devices on your tailnet |

A plain `http://` address on your network is not one of them; see
[Plain HTTP on Your Network Is Not Supported](#plain-http-on-your-network-is-not-supported).

After you change `.env`, apply it with `docker compose up -d`. Then open the address on the other
device and sign in with the same email and password. It's the same account and workspace, so there
is nothing to set up again.

### Use Your Own Domain

1. Point the domain's DNS `A` record (and `AAAA`, if the server has IPv6) at this server.
2. Open ports 80 and 443 to the internet, in the firewall and any router port forwarding. Let's
   Encrypt reaches the server through them to issue the certificate.
3. In `.env`, set the address and leave `YS_SITE_ADDRESS` and `YS_TRUSTED_PROXIES` unset:

   ```sh
   YS_PUBLIC_URL=https://space.example.com
   ```

4. Run `docker compose up -d`.

Caddy gets a certificate, renews it automatically, and redirects `http://space.example.com` to
HTTPS. If the address doesn't load, see [Certificates](#certificates).

### Use Your Own Reverse Proxy

Use this if a proxy on this machine, such as nginx, Caddy, or Traefik, already handles HTTPS for
other services.

1. In `.env`, set the address your proxy serves, and turn on proxy mode:

   ```sh
   YS_PUBLIC_URL=https://space.example.com
   YS_SITE_ADDRESS=http://:8080
   YS_TRUSTED_PROXIES=private_ranges
   ```

   Your Space then serves plain HTTP on `127.0.0.1:8080`, reachable only from this machine, and gets
   no certificate. `YS_TRUSTED_PROXIES=private_ranges` lets it take the visitor's address from your
   proxy.

2. Point your proxy at `http://127.0.0.1:8080`. It must:

   - run on this machine, directly or in a container with host networking
     (`network_mode: host`). Port 8080 accepts connections only on this machine's own `127.0.0.1`,
     so a proxy in an ordinary container can't reach it;
   - pass the original `Host` header;
   - set `X-Forwarded-For` to the visitor's address, replacing any value the visitor sent. The
     sign-in limit counts attempts per address; without this header, all visitors share one limit.

   Caddy and Traefik do both by default. In nginx, add:

   ```nginx
   proxy_set_header Host $host;
   proxy_set_header X-Forwarded-For $remote_addr;
   ```

3. If your proxy uses ports 80 and 443 on this machine, stop Your Space from publishing them. Create
   `compose.override.yaml` next to `compose.yaml`:

   ```yaml
   services:
     caddy:
       ports: !override
         - "127.0.0.1:8080:8080"
   ```

   Docker Compose reads this file automatically. `!override` replaces the port list from
   `compose.yaml` and needs Docker Compose 2.24.4 or later. Without the override, your proxy and
   Your Space compete for ports 80 and 443, and one of them fails to start.

4. Run `docker compose up -d`.

### Use Tailscale

[Tailscale](https://tailscale.com) gives this server an HTTPS address that only your own devices can
reach. You need no domain and no ports open to the internet.

1. Install Tailscale on this server and on each device you'll use, signed in to the same tailnet
   (your Tailscale network).
2. On the server, run (on Linux, with `sudo`):

   ```sh
   tailscale serve --bg --https=443 http://127.0.0.1:8080
   ```

   It prints the server's address, such as `https://myserver.tail1234.ts.net`. If it says HTTPS
   isn't enabled for your tailnet, follow the link it prints. `--bg` keeps it serving after you
   close the terminal; `tailscale serve status` shows the address again.

3. In `.env`, set that address, with no trailing slash, and turn on proxy mode:

   ```sh
   YS_PUBLIC_URL=https://myserver.tail1234.ts.net
   YS_SITE_ADDRESS=http://:8080
   YS_TRUSTED_PROXIES=private_ranges
   ```

4. Run `docker compose up -d`.

Your Space doesn't use ports 80 and 443 in this mode. To stop publishing them, add the
`compose.override.yaml` from [Use Your Own Reverse Proxy](#use-your-own-reverse-proxy).

### Plain HTTP on Your Network Is Not Supported

You can't use Your Space from another device at a plain address like `http://192.168.1.20`. Your
Space sends your password and session to other machines only over HTTPS, so nobody on the network
can read them or take over your session. The server refuses to start with plain `http://` for any
address other than `localhost`, and `docker compose logs server` says why.

For devices on your own network, use [Tailscale](#use-tailscale): it needs no domain.

## Sign-In and Sessions

- **Sessions** last 7 days and are extended, at most once a day, while you use Your Space. You're
  asked to sign in again only after about a week away.
- **Restarts** don't sign you out. Sessions are stored in the database.
- **Signing out** ends the session on that device only. To sign out every device, set a new
  password with [`reset-link`](#recover-the-owner-account).
- **Too many attempts:** after 3 sign-in attempts from one network address, each within 10 seconds
  of the one before and whether or not the password is right, Your Space refuses further attempts
  with "Too many sign-in attempts" until 10 seconds pass without an accepted attempt. Refused
  attempts don't extend the wait. (For IPv6, one address means one `/64` network.) This slows
  password guessing but never locks your account: once the wait is over, the right password works.
- **Passwords** are 12 to 128 characters. Your Space stores only a salted, one-way scrypt hash of
  each password (Better Auth's default: N=16384, r=16, p=1, a 64-byte key, and a random 16-byte salt
  per password), never the password itself.
- **Set-password and reset links** carry a random 24-character token, too long to guess. The token
  is in the part of the link after `#`, which browsers never send to a server, so it doesn't appear
  in server or proxy logs.

## Restarts and Your Data

Everything Your Space keeps is in two Docker volumes:

| Volume | What it holds |
| --- | --- |
| `ys-postgres` | The database: your account, password hash, workspace, and sessions |
| `ys-caddy-data` | Caddy's HTTPS certificates |

`docker volume ls` lists them as `your-space_ys-postgres` and `your-space_ys-caddy-data`. Nothing
else is kept in the containers, so they can be removed and recreated at any time.

Your settings and secrets are in `.env` (and `compose.override.yaml`, if you made one), next to
`compose.yaml`. Keep them with the volumes:

- Changing `BETTER_AUTH_SECRET` signs out every device.
- Don't change `POSTGRES_PASSWORD` after the first start. PostgreSQL keeps the password it was
  first given, so the server could no longer connect.

These keep everything, including your sessions:

| To | Run |
| --- | --- |
| Restart Your Space | `docker compose restart` |
| Remove and recreate the containers | `docker compose down`, then `docker compose up -d` |

Afterwards `docker compose ps` shows the services running again, you're still signed in, and you
never need to create the owner again. Your Space also starts by itself when Docker starts, for
example after a reboot, unless you stopped it with `docker compose stop` or `docker compose down`.
On macOS, that needs Docker Desktop set to start when you sign in.

> [!WARNING]
> `docker compose down -v` is not a restart. `-v` (`--volumes`) deletes both volumes, and your
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
| `create-owner` and `reset-link` | Exit status 3 and "The database could not be read." Nothing was changed |
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

## Recover the Owner Account

If you've lost the owner's password, or the set-password link from `create-owner` expired, get a
new link. On the server, in the folder with `compose.yaml`, run:

```sh
docker compose exec server reset-link
```

It prints a link:

```text
Password reset link for you@example.com (expires 2026-11-04T01:45:00Z, works once):
http://localhost/reset-password#token=...
Using it signs out every existing session.
```

Open the link within 30 minutes and choose a new password of 12 to 128 characters. Then sign in
with it.

- **Server access is the proof.** Only someone who can run commands on this server can get a link;
  the web page can't issue one. No email is sent or needed.
- **The link works once, for 30 minutes.** Each run prints a new link. Links you haven't used keep
  working until they expire, so treat each one like a password. Your Space doesn't log them.
- **Running the command changes nothing by itself.** The old password keeps working, and nobody is
  signed out, until someone uses the link.
- **Using the link signs out every device.** Sign in again with the new password on each.
- **Your account stays the same.** It keeps its workspace and ownership, and the email stays
  unverified: server access doesn't prove you control the mailbox.

For scripts, add `--json`, and `-T` so Docker doesn't attach a terminal:

```sh
docker compose exec -T server reset-link --json
```

```json
{"ok":true,"email":"you@example.com","url":"http://localhost/reset-password#token=...","token":"...","expiresAt":"2026-11-04T01:45:00Z"}
```

| Exit status | Meaning |
| --- | --- |
| 0 | Done |
| 1 | Invalid usage, such as an unknown option or an extra argument |
| 2 | There is no owner yet. Run `create-owner` first |
| 3 | The database could not be read; nothing was changed. See [When the Database Is Down](#when-the-database-is-down) |
| 4 | Something unexpected went wrong; nothing was reported as done |

If `docker compose exec` itself fails, for example because the server isn't running, the exit status
is Docker's own and there is no JSON. Start Your Space with `docker compose up -d` and run
`reset-link` again. The
[command contract](../../specs/001-workspace-owner-access/contracts/operator-commands.md) lists the
exact output.
