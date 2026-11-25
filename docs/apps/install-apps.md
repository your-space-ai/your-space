---
title: "Install and publish apps"
---

Your Space runs existing open-source apps from their own Compose files, on the same Docker engine,
and opens them inside Your Space.

**Kits.** Every app installs from its kit: a small YAML file, in the app's own repository or in a
separate one, that is the app's definition in Your Space. It names the app's own Compose file at an
exact commit and says what Your Space needs to run and show the app: which service is its
interface, its environment, the internet hosts it needs, and its limits. The app's authors change
nothing. See the
[kit format](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/contracts/kit-format.md).

**Environment.** The kit's `env` is the app's whole environment: every variable the app gets, each
with a value or with where its value comes from. Your Space generates some, such as passwords, works
out others, such as the app's own address, and asks you for the rest in the review:

```yaml
env:
  SECRET_KEY_BASE: { generate: { bytes: 64, encoding: hex } }
  APP_URL: { derive: app_origin }
  OWNER_KEY: { ask: true }
  LOG_LEVEL: info
```

Your Space gives exactly these to the app's Compose file, for each `${VARIABLE}` in it, and to every
service that loads them with `env_file: .env`, as many apps' own files do. It keeps the values
encrypted and writes no settings file. A Compose file that needs a variable with no default that the
kit doesn't define is refused, and the review names it. Your Space refuses a file that loads settings
or labels from any other file on the machine, or that includes or extends other Compose files.

**Install.** In Apps, paste the GitHub link to the app's kit and choose Review. A link to a Compose
file isn't enough: Your Space says so and asks for the kit's link. The review shows the kit and the
Compose file it names, each at its exact commit, the image versions that will run, what Your Space
changes or leaves out of the file, the settings its kit defines, and the internet hosts it may
reach. Values Your Space generates, and secrets you give, are never shown. Install runs in the
background; you can leave the page.

**Exact commits.** A kit pins the app's Compose file: its `source` gives the repository, the path
and the full commit, and Your Space reads the file at exactly that commit, never at a branch's latest
one. A kit's link can name a branch, such as `blob/main/kit.yaml`; when you review, Your Space
resolves it to the kit's commit at that moment, and the review and the install use exactly that kit.
A kit without `source`, or without `source.commit`, is refused, and the message names the field. A
newer commit of the kit, or of the Compose file, never reaches an installed app by itself: you
install it when you choose to. Your Space doesn't yet tell you when a newer kit exists.

```yaml
source:
  repo: owner/app
  path: compose.yaml
  commit: 4f0c2d9e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e
```

A kit kept in the app's own repository names an earlier commit than its own, since a file can't
name the commit it is in: commit the Compose file, then the kit with that commit.

Your Space reads kits and Compose files from public GitHub. A kit in a private repository installs
from this machine instead, with the server command (see below).

From the server, `docker compose exec server install-app <kit-link>` does the same. A kit Your Space
can't read on GitHub, such as one in a private repository, can come from this machine instead, and
names the app's Compose file and its commit in a public repository:
`docker compose exec -T server install-app --kit - < kit.yaml`.

The app's Compose file is always the one its kit names in a public repository on GitHub. When an
app's own file is in a private repository or doesn't fit Your Space's rules, for example because it
builds its images or mounts folders of this machine, put a Compose file that fits in a public
repository and point the kit's `source` at it. Your Space no longer installs a Compose file given on
this machine (`install-app --compose`); an app installed that way before keeps running from the file
stored with it.

Installing an app trusts it with everything you put into it. Your Space keeps it away from your
other apps, Your Space's own data and this machine, and controls who can reach it, but it can't see
or check what the app does with your data.

**Open.** Each app is at `<app>.<Your Space's address>`, such as `http://notes.space.localhost`, and
only you, signed in to Your Space, can reach it. On this machine that works with no setup, through
`*.localhost`; on your own domain it needs one wildcard DNS record. Where it can't work, as on
Tailscale, [publish the app on a port](#publish-an-app-on-a-port). Apps open in a pane beside Your Space's navigation;
on a large screen, two apps open side by side. An app keeps its own accounts: you sign up in the app
the first time. A browser that blocks an app's cookies inside Your Space, as WebKit-based browsers
can on this machine's plain-HTTP setup, can't keep you signed in to the app in a pane; the pane then
offers a link to open the app in its own tab.

## Private Kits

Your Space can keep a GitHub connection: a token that can only read the repositories you choose,
for kits in private repositories. Your Space keeps it encrypted on this server, never shows it
again, and never gives it to apps or agents. Until Your Space reads kits through it, a private kit
installs with the server command, as above.

**Connect in the dashboard.** Open **GitHub** in the sidebar and choose **Create a token on GitHub**.
GitHub opens its new fine-grained token page with a name and read access to contents already chosen.
There:

1. Under **Resource owner**, choose the account or organization your repositories belong to.
2. Under **Repository access**, choose **Only select repositories**, and pick the repositories with
   your kits.
3. Keep **Contents** as **Read-only**: the token needs no other permission. Choose when it expires.
4. Generate the token, copy it, paste it on Your Space's GitHub page, and choose **Connect**.

The page then shows **Connected as @login**, the GitHub account the token belongs to. Your Space asks
GitHub about the token only when you connect, open the page or check its status.

**Connect with the server command.** `github connect` asks for the token without showing it, or
reads it from standard input. It never takes the token on the command line, where it would reach
your shell history and the list of running processes:

```sh
docker compose exec server github connect
docker compose exec -T server github connect < token.txt
docker compose exec server github status
```

Each takes `--json`. The page and the command share one connection, so a token connected with either
shows in both.

**What the token can read.** Only the contents of the repositories you pick, and only to read them.
Your Space takes only a fine-grained token, which starts with `github_pat_`, and refuses a classic
one, which can reach every repository your account can. A fine-grained token reaches the
repositories of one account or organization, not ones where you're only an outside collaborator. It expires when you chose, and an organization can require approval
for such tokens, or block them. When GitHub stops accepting the token, because it expired or you
deleted it, the GitHub page and `github status` say so: create a new one and connect again, which
replaces it. They say so too when Your Space can't read the stored token, as when its data key was
replaced without the one before it.

**Disconnect.** **Disconnect** on the GitHub page, or `docker compose exec server github disconnect`,
makes Your Space forget the token, and installed apps keep running. Your Space can't delete the token
at GitHub for you: delete it in your
[fine-grained tokens](https://github.com/settings/personal-access-tokens) on GitHub too.

## Publish an App on a Port

Your Space runs apps; your own network setup can reach them. Publishing puts an app's interface on a
port of this machine, for your own proxy or tunnel, such as `tailscale serve`, to send its own
address to. Choose it when installing the app, or later on the app's page, under Publishing:

- **Port:** by default the port the app's own Compose file publishes for its interface. If another
  app or program uses it, Your Space says so when you save; choose another. Your Space never picks
  one for you.
- **Address to listen on:** `127.0.0.1`, this machine only, by default. `0.0.0.0` listens on every
  network the machine is on.
- **Link:** the address you reach the app at through your proxy or tunnel, such as
  `https://notes.example.com`. The app's own address settings, such as the URL it puts in its links,
  use it, and Your Space shows the app there, in its pane. A changed link reaches them when the app
  restarts, which saving does.

Your Space shows an app with a link inside its pane wherever it can. Many apps refuse to be shown
inside another site's page, to protect you from a site that shows the app invisibly and tricks you
into clicking in it. The app's Caddy replaces that rule with one that lets only Your Space show the
app; every other site is still refused. Your Space opens the app at its link in its own tab instead
when its kit says it can't run in a pane, or for a plain-HTTP link while you reach Your Space over
HTTPS (browsers don't show one inside the other, apart from a link on this machine). The app's
cookies are its own, so if your link is on another site than Your Space's, a browser that blocks
other sites' cookies may not keep you signed in to the app in the pane: open it in its own tab
from the pane.

Saving restarts the app only if its address settings use a link you changed; any other change
recreates at most the app's Caddy. Its data is kept. The pane shows the app once the change is
applied.

A Caddy of Your Space's answers on the port and passes each request to the app with its `Host`
header, so the app sees the address you reached it at. The `X-Forwarded-*` headers your proxy sends
reach the app when the proxy connects from this machine, your local network or your tailnet; from
anywhere else, Caddy sets them itself. The app's answers come back as the app sent them, apart from
its framing headers while the app is shown inside Your Space.

A published port isn't behind Your Space's sign-in: anyone who can reach it reaches the app, and only
the app's own sign-in protects it. The app's own services still publish nothing, and its built-in
address keeps working.

From the server:

```sh
docker compose exec server publish-app notes --port 8081 --link https://notes.example.com
docker compose exec server publish-app notes --off
```

`install-app <kit-link> --publish`, with the same `--port`, `--bind` and `--link`, installs an app
published.

**Settings.** An app's page shows its settings, the variables its kit defines. Saving restarts the
app with the new values and keeps its data. A value the kit asks for can be replaced but not
cleared. Replacing a generated secret, such as a database password, can break the app.

**Internet access.** An app reaches only the hosts you approve. Its installation kit can name a few
it needs to work, which the review shows. When the app tries another host, the attempt fails and
Your Space shows an access request on the app's page: approve it, or dismiss it to stop being asked.

**Limits and logs.** Under Advanced, each service shows its state, its recent logs, and its memory
and CPU limits. An app that runs out of memory is stopped before Your Space itself. The Engine page
shows the engine Your Space uses and what each app uses.

**Remove.** Removing an app stops and deletes its containers and keeps its data. Installing it
again offers to reuse the data, with the settings it was written with: a setting kept with the data
keeps its value, even one that was never set, rather than one the kit generates or gives now. A
value never set this way leaves the app on its Compose file's default, if it has one, so give it a
value in the review. The review refuses kept data with a value for a variable the app's file uses
that the kit no longer defines: add it to the kit's `env`, or delete the data. Deleting kept data is
a separate step, and can't be undone.

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
