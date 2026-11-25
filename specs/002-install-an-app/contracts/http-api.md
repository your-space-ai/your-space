# Apps HTTP API and Commands

Every route below requires the signed-in owner (FR-010); others get 401 or 403 and nothing changes.
Apps install only from their kits (decision 2026-11-23): `POST /api/apps/preview`, which reviewed an
app from its Compose file's link, is retired, and a review comes from the kit's link.
A request with any method but `GET` or `HEAD` must also carry Your Space's exact origin in its
`Origin` header, which browsers send from Your Space's own pages. Without it, or with another origin
such as an app's, it gets `403 forbidden` and nothing changes: apps are on names under Your Space's,
so the browser sends the owner's session with a request from an app's page too.
Errors use journey 001's shape `{ "error": "<code>", "message": "…" }`.

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/apps` | | `{ apps: [{ name, title, state, stateReason, origin, pane, hasInterface, pendingRequests, publish, framing }], retained: [{ name, title, removedAt }] }` |
| `POST /api/kits/preview` | `{ kitUrl }` | The review of the app the kit at `kitUrl`, a GitHub link, defines: `{ previewId, name, title, source: { repo, path, commit, read }, kit: { source, repo, path, commit, read }, readsRepository, services, images, adaptations, settings: [{ name, secret, generated, value? }], outbound, publishPort, retained, knowledge }`. The settings are exactly the variables the kit's `env` defines. Secret values are never included. A Compose file that needs a variable, with no default, that the kit's `env` doesn't define has a refusal for it, `{ service: "", setting: "env", reason: "The kit doesn't define NAME, …" }`, and doesn't install. `publishPort` is the port publishing uses by default, or null without an interface. `knowledge` is `{ path }` for a kit that asks for knowledge bases, or null. The kit is read at the commit `kitUrl` resolves to now, even a branch link such as `blob/main/kit.yaml`, and the Compose file at exactly the commit the kit's `source.commit` pins ([kit format](kit-format.md)); `kit.commit` and `source.commit` are those commits, and the install uses them. `400 kit_required` when the link is to a Compose file rather than a kit; `400 source` when the kit doesn't pin its Compose file: no `source`, or a `source` without its full `commit`. Both are read from public GitHub, and a kit or Compose file public GitHub doesn't show through the GitHub connection ([journey 015](../../015-private-sources/spec.md)); each `read` says how: `{ read: "anonymous" }`, or `{ read: "connection", login }`. `readsRepository` is the Compose file's repository when it was read through the connection and isn't the kit's own (a kit given on this machine has none), for the review's line "This kit reads `<owner>/<repo>` with your GitHub connection.", or null. `404 not_connected` when public GitHub doesn't show the kit's repository, or its Compose file's, and nothing is connected; `404 repository_not_visible` when GitHub doesn't show it to the connection either; `404 not_found` when the repository has no such branch, tag or commit, for a Compose file the commit the kit pins; `404 file_missing` when the file isn't there at that commit; `409 token_refused` when GitHub no longer accepts the connection's token, which is marked so the GitHub page shows Reconnect; `409 token_unreadable` when no data key here can read it. (2026-11-25: these replace `404 kit_not_found`, which said to install a private kit with `install-app --kit -`.) Each of `images` is `{ ref, digest, runsHere, private }`; `private` marks an image GHCR showed only with the GitHub connection's image token, which the review labels **Private image**. An image whose registry wants a sign-in has a refusal, `{ service: "", setting: "image", reason }`, saying which: GHCR with no image token, with one no data key here can read, or with one that can't read the image; or another registry, from which Your Space pulls public images only. |
| `POST /api/apps` | `{ previewId, settings?: { NAME: value }, reuseData?: boolean, publish?: { port?, bind?, link?, frame? }, knowledge?: [name] }` | `202 { name, jobId }`; `409 port_in_use` when another published app, a container or another program on this machine uses the port |
| `GET /api/apps/{name}` | | The app: state, services with state, settings (secrets as set or not set), outbound hosts, access requests, limits, the latest job, and `provenance`: `{ kit, compose }`, how each was read (`{ read: "anonymous" }` or `{ read: "connection", login }`; `kit` is null for a kit file given on this machine), or null for an app installed before journey 015 |
| `GET /api/apps/{name}/logs?service=` | | `{ lines }` |
| `PUT /api/apps/{name}/settings` | `{ values: { NAME: value \| null } }` | `202 { jobId }`; the app is applied again. `400 secret_required` or `400 setting_required` when it clears a secret or a value the kit asks for with `ask: true`, which can only be replaced; `400 unknown_setting` for a derived or unknown one |
| `PUT /api/apps/{name}/knowledge` | `{ bases: [name] }` | `202 { jobId }`; the app has exactly these knowledge bases, and is applied again, which recreates its interface service. `400 no_knowledge` for an app whose kit doesn't ask for knowledge, `400 unknown_knowledge_base` for a name with no knowledge base (journey 014) |
| `GET /api/knowledge` | | `{ knowledgeBases: [{ name, title, createdAt, apps: [{ name, title }] }] }`, each with the installed apps given it |
| `POST /api/knowledge` | `{ name, title? }` | `201 { name, title }`; the title defaults to the name. `400 bad_name` unless the name is 1 to 40 lower-case letters, digits and dashes, starting and ending with a letter or digit; `409 already_exists` |
| `PATCH /api/knowledge/{name}` | `{ title }` | `200 { name, title }`; the name never changes |
| `DELETE /api/knowledge/{name}` | | `204`; takes it from every app it was given to, applies those apps again, then deletes its files. `409` when the runtime manager refuses, as while an app still mounts it; it can be tried again |
| `PUT /api/apps/{name}/limits` | `{ limits: { service: { memory, cpus } } }` | `202 { jobId }` |
| `PUT /api/apps/{name}/publish` | `{ publish: { port?, bind?, link?, frame? } \| null }` | `202 { jobId }`; the app is applied again. `null` stops publishing; a field left out keeps its value, or its default the first time. `409 port_in_use` when another published app, a container or another program on this machine uses the port |
| `POST /api/apps/{name}/outbound` | `{ host }` | `202 { jobId }` |
| `DELETE /api/apps/{name}/outbound/{host}` | | `202 { jobId }` |
| `POST /api/apps/{name}/requests/{id}/approve` | | `202 { jobId }` |
| `POST /api/apps/{name}/requests/{id}/dismiss` | | `204` |
| `POST /api/apps/{name}/remove` | | `202 { jobId }`; data is kept |
| `DELETE /api/apps/{name}/data` | `{ confirm: "<name>" }` | `204`; only for a removed app |
| `GET /api/apps/{name}/open?return=/path` | | `302` to the app's handoff, or to sign-in. `return` must start with a single `/`; anything else (a scheme, `//`, a backslash) becomes `/`. Sent with `Referrer-Policy: no-referrer` |
| `GET /api/jobs/{id}` | | `{ id, state, steps, error }` |
| `GET /api/engine` | | `{ reachable, version, arch, cpus, memory, connection, apps: [{ name, memory, cpuPercent }] }` |

## Gate listener (port 3001, reached only by Caddy)

| Path | Answer |
| --- | --- |
| `GET /gate` (with `X-Forwarded-Host`, `X-Forwarded-Uri`) | `200` with `X-YS-Upstream: ys-<app>-ui:<port>` for a valid pass; otherwise `302` to `/api/apps/<app>/open` on Your Space's origin. `404` for a name under Your Space's where no app is installed |
| `GET /handoff?code=&return=` | Sets the pass cookie on the app's host and redirects to `return`, under the same rule as `/open`, with `Referrer-Policy: no-referrer`. The code works once, for 60 seconds, and isn't logged |
| `GET /tls-ask?domain=` | `200` for an installed app's name or Your Space's own, else `404` |

Behind the owner's proxy, Caddy sends the gate every name that isn't exactly Your Space's own. `/gate`
and `/handoff` answer a name that isn't under Your Space's either, such as `127.0.0.1:8080` from a
proxy that rewrote `Host`, with the API's `421` `wrong_host` answer
([Host Check](../../001-workspace-owner-access/contracts/http-api.md#host-check)): as JSON when
`X-Forwarded-Uri` is under `/api`, and as its message in plain text otherwise.

`publish` (decision 2026-11-19) is `{ port, bind, link, inPane }` or null: the app's interface on
`bind:port` of this machine, for the owner's own proxy or tunnel, outside the gate. `port` defaults to
the port the app's file publishes for its interface, else the interface's port; `bind` is an IP
address, `127.0.0.1` by default; `link` is an `http` or `https` origin, or null. With a link, the
settings a kit derives with `app_origin` and `app_host` take the link's values whenever the app
starts, and the app's `origin` in `GET /api/apps` and `GET /api/apps/{name}` is the link; otherwise it
is the app's built-in address, `<app>.<Your Space's address>`. The gate, `/open` and the handoff
always use the built-in address. `inPane`, which the server only reports, says whether Your Space
shows the app at its link in its pane, where the app's Caddy lets only Your Space's origin frame it:
the app has a link, its kit lets it run in a pane, and the link isn't plain HTTP inside an HTTPS Your
Space (one on this machine, like `http://127.0.0.1:8081`, is fine). The server sends the same answer to
the runtime manager, so the Caddy replaces the app's framing rules exactly when the pane frames the
link; otherwise it passes the app's framing headers on unchanged, and the web client opens the app at
its link in its own tab. (Superseded 2026-11-23: `frame`, the owner's switch to keep the app out of
the pane, left with the [alpha scope](../../../docs/architecture/decisions.md#alpha-scope); a `frame`
an older client sends is ignored.)

`framing`, for an app with `inPane`, is the short ID of the app's Caddy while it runs and lets Your
Space's origin frame the app, as the runtime manager reports it, and null until then: while a change
is applied, or while the runtime manager can't be reached. The web client frames the link only then,
at `<link>/?ys-pane=<framing>`. The Caddy gets a new ID whenever it is recreated, so a page the browser
cached at another address, such as the app's refusal to be framed before the change applied, is
never shown in the pane.

## Commands

```bash
docker compose exec -T server install-app <github-link-to-kit> [--reuse-data] [--publish [--port <n>] [--bind <address>] [--link <url>]] [--json]
docker compose exec -T server install-app --kit <file | -> [--reuse-data] [--publish [--port <n>] [--bind <address>] [--link <url>]] [--json]
docker compose exec server publish-app <name> [--port <n>] [--bind <address>] [--link <url>] [--off] [--json]
docker compose exec server list-apps [--json]
docker compose exec runtime stop-apps
```

`install-app` prints the review, installs, and waits until the app is running or failed; exit status
0 or 1. Every app installs with a kit, and the kit names the app's Compose file on GitHub at an
exact commit, where the command reads it ([kit format](kit-format.md)). The command takes the kit's GitHub link, or `--kit` with a kit on this
machine, which needs the GitHub connection only for a private Compose file it names: `-` reads it from
standard input (`--kit - < kit.yaml`), and any other value is the kit file. The command runs in the
server's container, so a path is one inside it; standard input is how a file on the host gets
there. A kit on this machine is checked like one from GitHub and recorded as `sha256:<digest>`; it
must have `source`, with its `commit`. Given a Compose file's link, or a Compose file as `--kit`, the command installs
nothing and says that installs need a kit. A kit's link, or a Compose file, that public GitHub
doesn't show is read through the GitHub connection, as in the web client, and a refusal the
connection answers says to connect with `github connect`. With `--json`, the result has the kit's `kit` source: its link at its
commit, or its digest, and the app's `provenance`.

`--compose` and `--name` are gone (2026-11-23, [alpha scope](../../../docs/architecture/decisions.md#alpha-scope)):
the owner no longer gives the command a Compose file on this machine, and `--files-stdin` left with
journey 011's creator features. An app installed from one
before is recorded as `sha256:<digest>` and keeps starting from its stored text; `list-apps --json`
gives each app's `source`: the link to its Compose file, or that digest, and its `commit` is the
exact commit read. Data kept under a name can be reused with `--reuse-data`. An installed app
follows no branch: a newer kit, or the newer Compose commit it pins, reaches it only when the owner
chooses to install it. Offering a newer kit as an update is left to journey 006.

`publish-app` publishes an installed app, changes how (an option left out keeps its value),
or stops publishing it with `--off`, and waits until the change is applied: it restarts the app's
services only when their address settings follow a link that changed, and otherwise recreates at most
the app's Caddy.
The `publish`
these commands and `list-apps --json` print includes `inPane`, and both the commands' line
and `list-apps` say when an app published with a link opens in its own tab rather than in its pane. With `--json`, one JSON object on stdout and logs on stderr, as `create-owner` does.
