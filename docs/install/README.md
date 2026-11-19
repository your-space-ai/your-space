# Install Your Space

This guide installs Your Space with the `your-space` command, creates its owner, and keeps it
running. You need access to the machine's command line: that access, not a web page, is what makes
you the owner. Installing by hand with Docker Compose is still possible; see
[Install by Hand](#install-by-hand-advanced).

Your Space runs as four containers, after a short step that runs first:

- **secrets** runs once on each start, before the others, and exits. It generates the auth secret
  and the database password on the first start (see [Secrets](#secrets)), so `docker compose ps -a`
  lists it as exited.
- **caddy** serves the web client and handles HTTPS, including getting certificates.
- **server** is the API. It also holds the operator commands `create-owner`, `reset-link`,
  `show-owner` and `show-secrets`, which the `your-space` command runs for you.
- **runtime** is the runtime manager, the only part of Your Space that uses the Docker engine. It
  runs the apps you install.
- **postgres** stores everything: your account, your workspace, and your sessions.

## Before You Start

You need:

- A Linux or Mac machine with a Docker-compatible engine:
  - Linux with [Docker Engine](https://docs.docker.com/engine/install/) 28.3.3 or newer and the
    Docker Compose plugin. Older Engine versions can open ports meant for this machine only to the
    network after a firewall reload (CVE-2025-54388).
  - macOS with an engine such as [OrbStack](https://orbstack.dev), [Colima](https://github.com/abiosoft/colima)
    or [Docker Desktop](https://docs.docker.com/desktop/). Your Space doesn't need Docker Desktop
    itself; Docker Desktop's license is free only for personal use, education, non-commercial open
    source and small businesses.
- Docker Compose 2.26.0 or newer: `docker compose version` prints `v2.26.0` or later.
- About 1 GB of free memory and 2 GB of disk.
- For access from other devices: a domain name pointing at the server, or [Tailscale](https://tailscale.com).
  See [Use Your Space From Other Devices](#use-your-space-from-other-devices).

Windows is not supported as a server.

**Checked so far:** the `your-space` command, from a release built from this repository, and the
manual steps 2 to 5 and the later sections were checked only with locally built images on Linux on
Intel/AMD (x86_64) with Docker Engine 29 and Compose 5.6, in Chromium, Firefox, and WebKit. Each setup's published ports and the generated secrets were checked on Compose 5.6 and
2.26.0, and the this-machine and own-proxy setups also with a running stack. Downloading from
a release, the published images, macOS, ARM machines such as Apple Silicon, IPv6, and HTTPS with a
real domain or Tailscale have not been checked yet. [VERIFICATION.md](VERIFICATION.md) lists
exactly what was tested, with versions.

Check Docker before you go on:

```sh
docker version
docker compose version
```

If either command fails, install or start Docker first. On macOS, start your engine (for example,
open OrbStack, or run `colima start`) and wait until it is running. `your-space` checks all of this
too, and says what is missing.

## 1. Get the `your-space` Command

It is published with each release, for Linux on Intel/AMD and ARM. Use whichever way you install
command-line tools:

- **npm**, if Node.js 22.12 or newer is installed: run it with `npx your-space`, or install it with
  `npm install -g your-space`.
- **A Linux package**: download the `.deb` or `.rpm` for your machine from the
  [latest release](https://github.com/your-space-ai/your-space/releases/latest), then install it
  with `sudo apt install ./your-space_*.deb` or `sudo dnf install ./your-space-*.rpm`.
- **The standalone command**, which needs nothing else installed. On Intel/AMD (use `arm64` for ARM):

  ```sh
  curl -fsSLO https://github.com/your-space-ai/your-space/releases/latest/download/your-space-linux-x64
  curl -fsSLO https://github.com/your-space-ai/your-space/releases/latest/download/SHA256SUMS
  sha256sum -c --ignore-missing SHA256SUMS
  install -m 755 your-space-linux-x64 ~/.local/bin/your-space
  ```

  `sha256sum` must print `your-space-linux-x64: OK`.

Check it works:

```sh
your-space --version
```

On a Mac, use npm for now. Packages for macOS come later.

## 2. Make a Folder for Your Space

```sh
mkdir your-space && cd your-space
your-space init
```

`init` asks how you'll reach Your Space; press Enter for **This machine**, the default. It downloads
the release that matches the `your-space` command's version, checks it against the release's
checksums, and writes `.env`. With this machine, `.env` has no settings at all.

Run every later `your-space` command in this folder, or name it with `--workdir <folder>`.

## 3. Start It

```sh
your-space start
```

It checks Docker and the ports it needs, starts Your Space (the first start downloads the images,
which takes a minute or two), and asks your name and the username you'll sign in with. Then it
creates your account and prints a summary: your address, a link to set your password, and what is
running. On a computer with a browser, it opens the link for you.

If something is in the way, `start` says what and what to do. For example, when another program
already uses port 80, it offers the next free port and writes it to `.env` as `YS_PORT`.

## 4. Set Your Password and Sign In

Open the link within 30 minutes. Choose a password of 12 to 128 characters; a long passphrase is a
good choice. Then sign in with your username and that password.

The link works once. If it expires or you lose it, `your-space owner reset-link` prints a new one.

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

## Certificates

With your own domain, Caddy asks Let's Encrypt for a certificate when it starts and renews it
automatically. `your-space start` and `your-space configure` wait up to three minutes for it, and
`your-space status` shows whether it is issued. If it isn't, they read Caddy's log and say why in
plain words. To see the log itself:

```sh
your-space logs caddy
```

The usual causes:

- **The domain doesn't point at this server.** Check the DNS `A` record.
- **Ports 80 or 443 are blocked.** Let's Encrypt must reach this server on both, from the internet.
  Check the firewall and any router port forwarding.
- **The domain has an `AAAA` (IPv6) record.** Let's Encrypt may try IPv6 first, and Your Space
  listens on IPv4 only for now. Remove the `AAAA` record.

Caddy keeps retrying, and it never falls back to serving your domain over plain HTTP. Certificates
are kept in the `ys-caddy-data` volume, so restarts don't request new ones.

## Use Your Space From Other Devices

By default Your Space answers only on this machine, at `http://space.localhost`. To use it from a phone or
another computer, give it an HTTPS address in one of three ways:

| Way | You need | Who can reach it |
| --- | --- | --- |
| [Your own domain](#use-your-own-domain) | A domain whose DNS points at this server, with ports 80 and 443 open to the internet | Anyone on the internet; only the owner can sign in |
| [Your own reverse proxy](#use-your-own-reverse-proxy) | A proxy that already handles HTTPS, on this machine or in a container | Whoever can reach your proxy |
| [Tailscale](#use-tailscale) | Tailscale on this server and on each device | Only your devices on your tailnet |

A plain `http://` address on your network is not one of them; see
[Plain HTTP on Your Network Is Not Supported](#plain-http-on-your-network-is-not-supported).

`your-space configure` changes the setup: it asks the same question as `init`, writes `.env`,
checks what it can, and restarts Your Space with the new address. If the new setup can't start, it
puts the old one back. By hand, change `.env` and run `docker compose up -d`. Then open the address
on the other device and sign in with the same username and password. It's the same account and
workspace, so there is nothing to set up again.

### Use Your Own Domain

1. Point the domain's DNS `A` record at this server. IPv6 isn't supported yet, so don't add an
   `AAAA` record.
2. Open ports 80 and 443 to the internet, in the firewall and any router port forwarding. Let's
   Encrypt reaches the server through them to issue the certificate.
3. For apps, point a wildcard record (`*.space.example.com`) at the same server too. Each app is
   at `<app>.space.example.com`, and Caddy gets its certificate when it is first opened.
4. Give Your Space the domain, as just the name, without `https://`:

   ```sh
   your-space configure --domain space.example.com
   ```

   Or choose it when you run `init`. `your-space` first checks that `space.example.com` and a name
   under it both resolve, to the same addresses, and stops if they don't; add `--ignore-checks` to
   go on anyway. It can't tell from inside whether those addresses are this server's public one, so
   it shows them. By hand, add `YS_DOMAIN=space.example.com` to `.env` and run `docker compose up -d`.

Caddy gets a certificate, renews it automatically, and redirects `http://space.example.com` to
HTTPS. If the address doesn't load, see [Certificates](#certificates). The server refuses names
that can't get a public certificate, such as an IP address, `localhost`, or a Tailscale `.ts.net`
name, and says what to use instead.

### Use Your Own Reverse Proxy

Use this if a proxy, such as nginx, Caddy, Traefik, or Nginx Proxy Manager, already handles HTTPS
for other services.

1. Give Your Space the address your proxy serves:

   ```sh
   your-space configure --proxy-url https://space.example.com
   ```

   Your Space then serves plain HTTP on `127.0.0.1:8080`, reachable only from this machine, and
   doesn't use ports 80 and 443 at all, so it doesn't compete with your proxy for them. It gets no
   certificate. If another program has port 8080, add `--port 8090` (or any free port) and use that
   port below. By hand, add `YS_PROXY_URL=https://space.example.com` (and `YS_PORT`) to `.env`.

2. If you set it by hand, run `docker compose up -d`. `your-space status` now lists, under "Your
   proxy or tunnel forwards", the names your proxy must send to Your Space, each app's included.

3. Point your proxy at Your Space:

   - **A proxy on this machine** forwards to `http://127.0.0.1:8080`.
   - **A proxy in a container** can't reach `127.0.0.1` on the machine. Instead, join it to Your
     Space's network, `your-space_edge`, and forward to `http://your-space:8080`. In your proxy's
     Compose file:

     ```yaml
     services:
       proxy:              # your proxy's service
         networks: [default, your-space]
     networks:
       your-space:
         external: true
         name: your-space_edge
     ```

     The network exists once Your Space runs with `YS_PROXY_URL`, so start Your Space first.
     Attach only your proxy to it: Your Space accepts a visitor's address from anything on it.

4. Your proxy must:

   - **pass the original `Host` header.** Your Space answers only to the address in `YS_PROXY_URL`.
     Requests that arrive under another name get status 421 and a message that says to fix this;
   - **set `X-Forwarded-For` to the visitor's address,** replacing any value the visitor sent. The
     sign-in limit counts attempts per address;
   - **forward apps' names too.** Each app is at `<app>.<your proxy's name>`, such as
     `sure.space.example.com`, so give the proxy a wildcard name (`*.space.example.com`) with its
     certificate and forward it to the same place. Every name other than Your Space's own goes to
     an app.

   Caddy and Traefik do both by default. In nginx, add:

   ```nginx
   proxy_set_header Host $http_host;
   proxy_set_header X-Forwarded-For $remote_addr;
   ```

Your Space reads the visitor's address only from connections to port 8080. Visitors on your own
network, with addresses such as `192.168.1.20`, look like proxies, so behind a proxy they share one
sign-in limit. Don't let your proxy add to an `X-Forwarded-For` the visitor sent (in nginx,
`$proxy_add_x_forwarded_for`): a device on your own network could then put a made-up address in
front of its own and get a fresh sign-in limit for every guess.

### Use Tailscale

[Tailscale](https://tailscale.com) gives this server an HTTPS address that only your own devices can
reach. You need no domain and no ports open to the internet.

1. Install Tailscale on this server and on each device you'll use, signed in to the same tailnet
   (your Tailscale network).
2. On the server, run (on Linux, with `sudo`):

   ```sh
   tailscale serve --bg --https=443 http://127.0.0.1:8080
   ```

   If you set `YS_PORT`, use that port instead of `8080`.

   It prints the server's address, such as `https://myserver.tail1234.ts.net`. If it says HTTPS
   isn't enabled for your tailnet, follow the link it prints. `--bg` keeps it serving after you
   close the terminal; `tailscale serve status` shows the address again. Until the next two steps
   are done, the address shows an error page.

3. Give Your Space that address, with `https://` and no trailing slash:

   ```sh
   your-space configure --proxy-url https://myserver.tail1234.ts.net
   ```

   By hand, add `YS_PROXY_URL=https://myserver.tail1234.ts.net` to `.env` and run
   `docker compose up -d`.

Tailscale passes the original `Host` header and the visitor's tailnet address, so nothing else needs
setting up. Apps don't work over Tailscale yet: each app needs a name under Your Space's address,
such as `sure.myserver.tail1234.ts.net`, and Tailscale's names can't hold a name under a machine's
name. A Tailscale Service gets a name beside it (`sure.tail1234.ts.net`) instead, which isn't the
app's address.

### Plain HTTP on Your Network Is Not Supported

You can't use Your Space from another device at a plain address like `http://192.168.1.20`. Your
Space sends your password and session to other machines only over HTTPS, so nobody on the network
can read them or take over your session. `YS_PROXY_URL` must start with `https://`, and
`YS_DOMAIN` gets HTTPS from Let's Encrypt; the server refuses anything else, and
`docker compose logs server` says why.

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
  attempts don't extend the wait. This slows password guessing but never locks your account: once
  the wait is over, the right password works. If Your Space can't see visitors' own addresses, for
  example behind a proxy that doesn't pass them on, all visitors share one limit (see
  [Use Your Own Reverse Proxy](#use-your-own-reverse-proxy)).
- **Passwords** are 12 to 128 characters. Your Space stores only a salted, one-way scrypt hash of
  each password (Better Auth's default: N=16384, r=16, p=1, a 64-byte key, and a random 16-byte salt
  per password), never the password itself.
- **Set-password and reset links** carry a random 24-character token, too long to guess. The token
  is in the part of the link after `#`, which browsers never send to a server, so it doesn't appear
  in server or proxy logs. The database keeps only a hash of it, so a copy of the database can't
  open a link that still works.

## Apps

Your Space runs existing open-source apps from their own Compose files, on the same Docker engine,
and opens them inside Your Space.

**Install.** In Apps, paste the GitHub link to the app's Compose file, for example
`https://github.com/we-promise/sure/blob/main/compose.example.yml`, and choose Review. The review
shows the exact commit and image versions that will run, what Your Space changes or leaves out of
the file, the settings it reads, and the internet hosts it may reach. Secrets the file gives a
published default for get generated values instead, and they are never shown. Install runs in the
background; you can leave the page. From the server, `docker compose exec server install-app <link>`
does the same.

Installing an app trusts it with everything you put into it. Your Space keeps it away from your
other apps, Your Space's own data and this machine, and controls who can reach it, but it can't see
or check what the app does with your data.

**Open.** Each app is at `<app>.<Your Space's address>`, such as `http://sure.space.localhost`, and
only you, signed in to Your Space, can reach it. Apps open in a pane beside Your Space's navigation;
on a large screen, two apps open side by side. An app keeps its own accounts: you sign up in the app
the first time. On this machine, Safari doesn't keep apps' cookies inside Your Space, so apps open in
their own tab there; over HTTPS they open in a pane in every browser.

**Settings.** An app's page shows its settings. Saving restarts the app with the new values and
keeps its data. Replacing a generated secret, such as a database password, can break the app.

**Internet access.** An app reaches only the hosts you approve. Its installation kit can name a few
it needs to work, which the review shows. When the app tries another host, the attempt fails and
Your Space shows an access request on the app's page: approve it, or dismiss it to stop being asked.

**Limits and logs.** Under Advanced, each service shows its state, its recent logs, and its memory
and CPU limits. An app that runs out of memory is stopped before Your Space itself. The Engine page
shows the engine Your Space uses and what each app uses.

**Remove.** Removing an app stops and deletes its containers and keeps its data. Installing it
again offers to reuse the data. Deleting kept data is a separate step, and can't be undone.

**Stop Your Space and its apps.** `docker compose restart` and updates leave apps running.
`your-space stop` stops everything, apps first; by hand:

```sh
docker compose exec runtime stop-apps
docker compose stop
```

`your-space start`, or `docker compose up -d`, starts Your Space, and Your Space starts its apps.

**Another Docker engine.** Your Space uses `/var/run/docker.sock`. To use another engine's socket,
such as rootless Docker's or Colima's, set its path in `.env`:

```sh
YS_ENGINE_SOCKET=/run/user/1000/docker.sock
```

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
  back, or [give PostgreSQL the new one](#give-postgresql-the-database-password).

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

## Lost Secrets

If the `ys-secrets` volume is gone but the database is still there, Your Space stops before it
starts anything, instead of generating new secrets: a new database password wouldn't work, because
PostgreSQL only accepts the one it was created with. `your-space start` says so and what to do; by
hand, `docker compose up -d` reports that the `secrets` service didn't complete, and
`docker compose logs secrets` explains.

Ways to recover, best first:

1. **Restore the `ys-secrets` volume** from a backup, or **put the old values back** in `.env` as
   `BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD`. Then run `docker compose up -d`.
2. **Start with new secrets.** Your account and workspace stay; every device is signed out. If the
   data key was lost too (it is in the same volume, unless you set `YS_DATA_KEY` in `.env`),
   installed apps' settings can't be read, and each app must be removed, keeping its data, and
   installed again; its page says so. Run:

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
  app's settings with the new one. Once `docker compose ps` shows the server healthy, remove the old
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

It prints a link:

```text
Password reset link for you@example.com (expires 2026-11-04T01:45:00Z, works once):
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
- **Your account stays the same.** It keeps its username, workspace and ownership. An email you
  gave stays unverified: server access doesn't prove you control the mailbox.

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
| 3 | The database could not be read; nothing was changed. See [When the Database Is Down](#when-the-database-is-down) |
| 4 | Something unexpected went wrong; nothing was reported as done |

If `docker compose exec` itself fails, for example because the server isn't running, the exit status
is Docker's own and there is no JSON. Start Your Space with `docker compose up -d` and run
`reset-link` again. The
[command contract](../../specs/001-workspace-owner-access/contracts/operator-commands.md) lists the
exact output.

## Install by Hand (Advanced)

These are the steps the `your-space` command takes for you: download the release, configure `.env`,
and run Docker Compose and the server's commands. Use them if you'd rather not install the command.
Each step says which `your-space` command does the same.

### 1. Download

`your-space init` does this step.

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

### 2. Configure

**For this machine, there's nothing to configure.** With nothing in `.env`, Your Space answers only
on this machine, at `http://space.localhost`, and generates its own secrets (see [Secrets](#secrets)). To
use it from other devices, add one line:

| You want | Add to `.env` | What happens |
| --- | --- | --- |
| Use it on this machine only (the default) | nothing | Plain HTTP at `http://space.localhost`, reachable only from this machine |
| Use your own domain | `YS_DOMAIN=space.example.com` | Ports 80 and 443 open to the network. Caddy gets and renews a Let's Encrypt certificate and redirects HTTP to HTTPS. See [Use Your Own Domain](#use-your-own-domain) |
| Use your own proxy or Tailscale | `YS_PROXY_URL=https://<the proxy's address>` | Caddy serves plain HTTP on `127.0.0.1:8080` only; your proxy or Tailscale handles HTTPS. See [Use Your Own Reverse Proxy](#use-your-own-reverse-proxy) or [Use Tailscale](#use-tailscale) |

If another program already uses port 80 on this machine (or 8080 with `YS_PROXY_URL`), also add
`YS_PORT=8081`, or any free port. Your Space then answers at `http://space.localhost:8081`. `YS_PORT`
doesn't apply to your own domain, which needs ports 80 and 443.

Which line you write decides which ports open: only `YS_DOMAIN` opens any to the network. The
server checks every line when it starts and refuses to start, with a message that says what to fix,
if a value is wrong, if both `YS_DOMAIN` and `YS_PROXY_URL` are set, or if a setting's name is
misspelled. Caddy waits for the server, so a wrong line never opens a port.

#### Secrets

Your Space needs three secrets: the auth secret that signs sessions, the database password, and the
data key that encrypts installed apps' settings (see
[What Your Space Encrypts](#what-your-space-encrypts)). On the first start it generates each one, 32
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
there. To replace a secret later, see [Replace a Secret](#replace-a-secret).

### 3. Start

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
| `service "secrets" didn't complete successfully` | Run `docker compose logs secrets`. It says what's wrong with a secret and how to fix it; see [Lost Secrets](#lost-secrets) |
| `server` keeps restarting, and `docker compose logs server` says "PostgreSQL refused the database password" | The database password changed after the database was created. Change `POSTGRES_PASSWORD` in `.env` back, or [give PostgreSQL the new one](#give-postgresql-the-database-password) |
| `dependency failed to start: container your-space-server-1 is unhealthy` | Run `docker compose logs server`. An `Invalid configuration` message names the setting to fix. Fix `.env` and run `docker compose up -d` again. No port was opened meanwhile |
| `Set YS_DOMAIN (your own domain) or YS_PROXY_URL (your own proxy or Tailscale) in .env, not both` | Remove one of the two lines. Every `docker compose` command stops with this message until you do |
| `address already in use` or `port is already allocated`, for port 80 or 8080 | Another program uses the port. Add `YS_PORT=8081` (or any free port) to `.env` |
| The same, for port 443 with your own domain | Another program uses the port, such as another web server. Stop it, or put Your Space behind it as [your own proxy](#use-your-own-reverse-proxy) |
| `server` is `unhealthy` after it was running | Run `docker compose logs server postgres` and see [When the Database Is Down](#when-the-database-is-down) |

Open your address (for example `http://space.localhost`). It says Your Space has no owner yet and shows
the command to create one. There is no sign-up form: nobody can make an account from the web.

### 4. Create the Owner

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

### 5. Set Your Password and Sign In

Open the link in a browser within 30 minutes. Choose a password of 12 to 128 characters; a long
passphrase is a good choice. Then sign in with your username and that password.

The link works once. If it expires or you lose it, run
`docker compose exec server reset-link` for a new one.

You now see your workspace, your name and username, and a way to sign out. The workspace is empty:
installing apps comes in a later release.
