---
title: "Install and publish apps"
---

Your Space runs existing open-source apps from their own Compose files, on the same Docker engine,
and opens them inside Your Space.

**Install.** In Apps, paste the GitHub link to the app's Compose file and choose Review. The review
shows the exact commit and image versions that will run, what Your Space changes or leaves out of
the file, the settings it reads, and the internet hosts it may reach. Secrets the file gives a
published default for get generated values instead, and they are never shown. Install runs in the
background; you can leave the page. From the server, `docker compose exec server install-app <link>`
does the same. A kit Your Space can't read from GitHub, such as one in a private repository, can come
from this machine instead: `docker compose exec -T server install-app <link> --kit - < kit.yaml`.

When an app's own Compose file doesn't fit Your Space's rules, for example because it builds its
images or mounts folders of this machine, install it from a Compose file you write instead. Your
Space checks and adapts it like any other, records its digest, and reads nothing from GitHub for it:

```sh
docker compose exec -T server install-app --compose - --name notes < compose.yaml
```

The name comes from `--name`, or from the kit's `name`. A kit for it may leave out `source`, since
giving both in one command is what binds them. Standard input carries one file, so put the kit in
the server's container first:

```sh
docker compose exec -T server sh -c 'cat > /tmp/kit.yaml' < kit.yaml
docker compose exec -T server install-app --compose - --kit /tmp/kit.yaml < compose.yaml
```

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
- **Show inside Your Space:** on by default, on the app's page once the app has a link. Many apps
  refuse to be shown inside another site's page, to protect you from a site that shows the app
  invisibly and tricks you into clicking in it. With this on, the app's Caddy replaces that rule
  with one that lets only Your Space show the app; every other site is still refused. Turn it off
  to keep the app's own rule; Your Space then opens the app at its link in its own tab, as it does
  for a plain-HTTP link while you reach Your Space over HTTPS (browsers don't show one inside the
  other, apart from a link on this machine). The app's cookies are its own, so if your link is on
  another site than Your Space's, a browser that blocks other sites' cookies may not keep you signed
  in to the app in the pane: open it in its own tab, or turn this off.

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
docker compose exec server publish-app notes --no-frame
docker compose exec server publish-app notes --off
```

`--no-frame` opens the app in its own tab instead of inside Your Space, and `--frame` shows it inside
again. `install-app <link> --publish`, with the same `--port`, `--bind`, `--link` and `--no-frame`,
installs an app published.

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
