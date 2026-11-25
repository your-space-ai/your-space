---
title: "Run Your Space"
---

How to run, restart and look after an installed workspace. To install one, see the [installation guide](../install/index.md).

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
| Move to a newer release | `your-space upgrade`, with that release's command ([Update Your Space](#update-your-space)) |

Your Space also starts by itself when Docker starts, for example after a reboot, unless you stopped
it.

For scripts, add `--json` to any command but `logs`: it prints one JSON object and never asks a
question, so each answer needs its option. `--yes` answers yes and takes the defaults:

```sh
your-space init --yes --json
your-space start --owner-name "Sam Rivera" --owner-username sam --json
```

The exit status says what happened: 0 done, 1 an invalid option or answer, 2 something in the way,
such as Docker not running (the message says what), 3 something Your Space needs couldn't be
reached, such as a release download or the database, 4 something unexpected. The
[command contract](https://github.com/your-space-ai/your-space/blob/main/specs/003-install-with-the-cli/contracts/cli-commands.md) describes the
main commands, their options, JSON fields and errors.

The `your-space` command runs `docker compose` in this folder, so every `docker compose` command in
this guide still works here, and a folder you set up by hand works with `your-space` as it is.
There is one Your Space per Docker engine: `your-space` refuses to start a second one from another
folder, since both would share the same volumes.

## Update Your Space

Each release comes with its own `your-space` command, and `your-space upgrade` moves your
installation to that command's version. In the installation's folder, run the latest release's
command once with npx:

```sh
npx @your-space-ai/cli@latest upgrade
```

Or install the new release's command as you got the first one
([Get the `your-space` Command](../install/index.md#1-get-the-your-space-command)), then run
`upgrade` in the installation's folder:

```sh
npm install -g @your-space-ai/cli@<version>
your-space upgrade
```

To move to the newest build of a release channel instead, add `--channel alpha` or
`--channel canary` to `upgrade`, with a command that has the flag: see
[Follow a Release Channel](#follow-a-release-channel).

It names both versions and asks first; `--yes` answers for you. Then it:

1. Downloads the release's files and checks them against its checksums, as `init` does, then
   downloads its images. Nothing has changed yet, so a failed download leaves Your Space as it was.
2. Stops Your Space and backs up its database to `backups/<time>-<old version>.sql` in the
   installation folder, a file only you can read. Your apps keep running.
3. Replaces `compose.yaml`, `stack.yaml`, `modes/` and `env.example` with the new release's, and
   starts the new version, whose server updates the database as it starts. `.env` keeps every line
   you set. A setting the new release needs that `.env` doesn't have is added from its `env.example`.
4. Once the new server is ready, the upgrade is done, and Caddy, the only way in, starts. If Caddy
   doesn't start, for example because its port was taken meanwhile, `upgrade` says why: fix it and
   run `your-space start`.

Afterwards Your Space runs the new version, even if it was stopped before.

If the new version's server doesn't become ready, `upgrade` puts the previous version back: its
files and `.env`, and the database from the backup if the new version had already changed it. Then
it starts the previous version and says what went wrong. Restoring the backup discards none of your
changes: Your Space stopped before the backup was taken, and no request reaches the new version
before that point.
The database as the new version left it is kept too, as `yourspace_upgrade_failed_<time>`; once you
don't need it, delete it with the `dropdb` command `upgrade` prints.

While it runs, `start`, `stop`, `configure` and another `upgrade` refuse to run, and the other way
round: each holds `.your-space.lock` in the installation folder, so run them as the user who owns
that folder. Ctrl-C before the new server starts stops an upgrade at its next step and puts the
previous version back, as a failure does, with the same exceptions: if `upgrade` can't put
something back, it says what is left to do by hand. Once the new server is starting, the upgrade
runs to its result. If an
upgrade is killed outright, the next one says which files it left behind, and `start` refuses
until the files and the database match again.

- An installation already at the command's version is left as it is.
- Your Space doesn't go back to an earlier version. `upgrade` refuses an installation that is newer
  than the command, and a server refuses to start on a database a newer version has updated.
- A version that can't upgrade an installation as old as yours says `Upgrade to <version> first`
  and changes nothing: upgrade to that version with its own command, then again. No version needs
  this yet.

The backup holds the database: your account, workspace, sessions and installed apps, with the apps'
settings still encrypted. It doesn't hold the `ys-secrets` volume, Caddy's certificates or your
apps' data, which stay in their volumes. `upgrade` keeps every backup, so `backups/` holds one from
each version the installation left, each the size of the database. Keep them private, and delete
old ones you no longer need.

### Follow a Release Channel

`your-space upgrade --channel <name>` moves the installation to the newest build of a release
channel: `alpha`, the newest release, or `canary`, the newest
[canary build](../install/canary.md) of `main`.

```sh
your-space upgrade --channel alpha
```

It reads the channel's `channel.json`, which names its newest build, then downloads that build's own
`your-space` command, the Linux executable or the npm package, as the one you ran is. It checks the
download against that build's `SHA256SUMS`, and that it reports the version `channel.json` names,
then runs its `upgrade`, which does all of the above. So each version upgrades with its own steps.

- It changes nothing when the installation already runs that build, or a newer one. An installation
  on a canary moves to Alpha with the first alpha newer than it.
- If a file is missing or doesn't match, as when a newer canary replaces the canary's files while it
  runs, it changes nothing: run it again.
- Ctrl-C while it downloads that build's command stops it with nothing changed. Once that build's
  `upgrade` runs, Ctrl-C reaches it and stops it as above.
- It stores nothing, and doesn't install that build's command: the `your-space` you ran stays at
  its version. Plain `upgrade` still moves the installation to the command's own version.
- The flag comes with 0.1.0-alpha.2 and the canary builds made since it was added. The command
  inside the Mac app doesn't take it: the app moves its own workspace when it updates. Don't point
  another `your-space` command at the app's workspace either: the app doesn't start a workspace
  newer than itself.

### Restore the Backup by Hand

You need this only when `upgrade` tells you to: when it couldn't restore the database itself, or
when an earlier upgrade stopped part way and you go back to the previous version. In the
installation folder, with the previous version's files back in place, stop Your Space and start its
database alone:

```sh
docker compose stop caddy server
docker compose up -d --wait postgres
```

Then load the backup `upgrade` named into a new database. Your current database is untouched until
this has worked, so if a command fails, stop there:

```sh
docker compose exec -T postgres psql -U yourspace -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE IF EXISTS yourspace_restore' \
  -c 'CREATE DATABASE yourspace_restore OWNER yourspace TEMPLATE template0'
docker compose exec -T postgres psql -U yourspace -d yourspace_restore -v ON_ERROR_STOP=1 \
  --single-transaction -q -o /dev/null < backups/<file>.sql
```

Swap it in, keeping the database the new version changed as `yourspace_before_restore`. Then
delete `.upgrade-restore`, which `upgrade` leaves so that nothing starts Your Space until the files
and the database match, and start Your Space:

```sh
docker compose exec -T postgres psql -U yourspace -d postgres -v ON_ERROR_STOP=1 --single-transaction \
  -c 'ALTER DATABASE yourspace RENAME TO yourspace_before_restore' \
  -c 'ALTER DATABASE yourspace_restore RENAME TO yourspace' \
  && rm -f .upgrade-restore && your-space start
```

Once Your Space works, delete the copy you kept:
`docker compose exec -T postgres dropdb -U yourspace yourspace_before_restore`.

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

Everything Your Space itself keeps is in three Docker volumes (two more, `ys-runtime` and
`ys-agent-edge`, hold only sockets and nothing durable):

| Volume | What it holds |
| --- | --- |
| `ys-postgres` | The database: your account, password hash, workspace, and sessions |
| `ys-secrets` | The generated auth secret, database password and data key. Keep it with `ys-postgres` |
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
The [Mac app's](../install/macos-desktop.md) local workspace stops when you quit the app, so it
starts again when you open the app.

Apps keep their data in their own volumes, named after the app, such as `ys-notes_postgres-data`.
`docker compose down -v` doesn't delete them, and doesn't stop the apps: stop them first with
`docker compose exec runtime stop-apps`. [Knowledge bases](../apps/knowledge-bases.md) are volumes
of Your Space's, such as `ys-knowledge.your-space.course-notes`. `docker compose down -v` doesn't
delete them either, and neither does removing an app or deleting its data; deleting the knowledge
base in **Knowledge** does. A [synced knowledge base](google-drive.md) also has a volume of its sync
state, such as `ys-knowledge.your-space.course-notes.sync`, which goes with it.

> [!WARNING]
> `docker compose down -v` is not a restart. `-v` (`--volumes`) deletes all of Your Space's volumes,
> these three included, and your account and workspace with them: the next start has no owner.
> `docker volume rm` on these volumes, or `docker volume prune --all` while Your Space is down, does
> the same. There is no undo.

To move to a newer release, see [Update Your Space](#update-your-space); it backs up the database
first. Backing up a workspace on its own isn't covered yet; it comes in a later release.

## Remove Your Space

There is no uninstall command yet. To remove Your Space, or to start over with a new installation,
follow these steps in order. With the Mac app, read [its steps](../install/macos-desktop.md#remove-your-space-from-a-mac)
first: if the app only connects to a server, they are all you need, and these steps would delete
that server's apps. Otherwise they say when to quit the app and how to reach its Docker engine.

1. With Your Space running (`your-space start` if you stopped it), open each app in **Apps** and
   select **Remove app**, then **Delete data**. Removing an app deletes its containers and
   networks; deleting its data deletes its volumes, which can't be undone. Then delete each
   knowledge base in **Knowledge**, which deletes its files.
2. In the installation folder (`~/my-your-space` if you used `setup` and kept its default), stop
   any app still running, then delete Your Space's containers, networks and volumes. If Your Space is
   already stopped, as after quitting the Mac app, its apps are too: skip the first command.

   ```sh
   docker compose exec runtime stop-apps
   docker compose down -v
   ```

3. Delete the installation folder. It holds your settings in `.env`, any set-password link `setup`
   saved, and the database backups `upgrade` made in `backups/`. If `.env` sets `YS_ENGINE_SOCKET`, note its path first: the commands below for
   leftovers need it.

> [!WARNING]
> Remove the apps first. `docker compose down -v` deletes Your Space's database, and with it the
> record of which apps are installed, so **Apps** can't remove them afterwards. Their containers,
> networks and volumes stay behind, and apps that weren't stopped keep running. If you later install
> an app with the same name on this Docker engine, it reuses that app's leftover volumes: the old
> data meets newly generated settings, such as a new database password, and the app may not start.
> A knowledge base created again with the same name keeps its leftover files the same way.

To find what an earlier installation left behind, list what carries its label for its apps. The
label's value is the installation's Compose project name: `your-space`, the `name` in
`compose.yaml`, unless you changed it. If you did, use yours in each command below. App volumes are
named after their app, such as `ys-notes_postgres-data`, and knowledge bases' volumes after the
installation and the knowledge base, such as `ys-knowledge.your-space.course-notes`. Run these commands against the Docker
engine your apps ran on: if `.env` set `YS_ENGINE_SOCKET`, that's the engine at that path, so first
run `unset DOCKER_CONTEXT` and `export DOCKER_HOST="unix://<that path>"` in the same shell. If the
folder is already gone and you don't know the path, run the lists against each engine on this
machine; `docker context ls` shows those the Docker command knows.

```sh
docker ps -a --filter label=ai.your-space.installation=your-space
docker volume ls --filter label=ai.your-space.installation=your-space
docker network ls --filter label=ai.your-space.installation=your-space
```

To delete them, the apps' data included, with no undo, run these in order, before you set up Your
Space on this Docker engine again: a new installation with the same name labels its apps the same
way, so these commands would delete them too. Skip the first command if the first list was empty;
the two `prune` commands ask before deleting:

```sh
docker rm -f $(docker ps -aq --filter label=ai.your-space.installation=your-space)
docker volume prune --all --filter label=ai.your-space.installation=your-space
docker network prune --filter label=ai.your-space.installation=your-space
```

Each app also had anonymous volumes, such as its outbound proxy's logs. They carry no Your Space
label, and Your Space doesn't keep them as app data: removing an app in **Apps** deletes them.
`docker volume prune`, with no options, deletes them too, but also every other unused anonymous
volume on this Docker engine, so skip it if the engine runs other projects. Images stay too:
`docker image ls` lists them, and `docker image rm` deletes those you don't need.

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

- **Installed apps' settings** (their keys, passwords and API keys, generated or yours), and the
  client secret and token of the [Google connection](google-drive.md), are encrypted by Your Space
  with the data key, AES-256-GCM. The data key is kept apart from the
  database, in the `ys-secrets` volume or in `.env`, so a copy of the database alone doesn't reveal
  them.
- **The GitHub connection's tokens**, the contents token and the image token, are encrypted with the
  data key the same way, and are never shown again.
- **Passwords and set-password links** are never stored: only one-way hashes of them are.
- **Sessions** can't be used from a copy of the database alone: a sign-in cookie is also signed
  with the auth secret, which is in `ys-secrets`.
- **Everything else**, such as names, usernames, email addresses, which apps are installed, and the
  activity log, is stored as it is.

The data key sits on the same machine as the database, so it protects copies of the database, not
the machine itself. To protect everything on a disk that could be lost, stolen or thrown away,
encrypt the disk itself: LUKS (or ZFS's own encryption) on Linux, FileVault on a Mac. That protects
the disk while the machine is off, not a copy taken while it runs.
