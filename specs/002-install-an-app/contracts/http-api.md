# Apps HTTP API and Commands

Every route below requires the signed-in owner (FR-010); others get 401 or 403 and nothing changes.
Errors use journey 001's shape `{ "error": "<code>", "message": "…" }`.

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/apps` | | `{ apps: [{ name, title, state, stateReason, origin, pane, hasInterface, pendingRequests, publish, framing }], retained: [{ name, title, removedAt }] }` |
| `POST /api/apps/preview` | `{ link, kit? }` | The review: `{ previewId, name, title, source: { repo, path, commit }, kit, services, images, adaptations, settings: [{ name, secret, generated, value? }], outbound, publishPort, retained }`. Secret values are never included. `publishPort` is the port publishing uses by default, or null without an interface. |
| `POST /api/apps` | `{ previewId, settings?: { NAME: value }, reuseData?: boolean, publish?: { port?, bind?, link?, frame? } }` | `202 { name, jobId }`; `409 port_in_use` when another published app, a container or another program on this machine uses the port |
| `GET /api/apps/{name}` | | The app: state, services with state, settings (secrets as set or not set), outbound hosts, access requests, limits, the latest job |
| `GET /api/apps/{name}/logs?service=` | | `{ lines }` |
| `PUT /api/apps/{name}/settings` | `{ values: { NAME: value \| null } }` | `202 { jobId }`; the app is applied again |
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
| `GET /gate` (with `X-Forwarded-Host`, `X-Forwarded-Uri`) | `200` with `X-YS-Upstream: ys-<app>-ui:<port>` for a valid pass; otherwise `302` to `/api/apps/<app>/open` on Your Space's origin |
| `GET /handoff?code=&return=` | Sets the pass cookie on the app's host and redirects to `return`, under the same rule as `/open`, with `Referrer-Policy: no-referrer`. The code works once, for 60 seconds, and isn't logged |
| `GET /tls-ask?domain=` | `200` for an installed app's name or Your Space's own, else `404` |

`publish` (decision 2026-11-19) is `{ port, bind, link, frame, inPane }` or null: the app's interface on
`bind:port` of this machine, for the owner's own proxy or tunnel, outside the gate. `port` defaults to
the port the app's file publishes for its interface, else the interface's port; `bind` is an IP
address, `127.0.0.1` by default; `link` is an `http` or `https` origin, or null. With a link, the
settings a kit derives with `app_origin` and `app_host` take the link's values whenever the app
starts, and the app's `origin` in `GET /api/apps` and `GET /api/apps/{name}` is the link; otherwise it
is the app's built-in address, `<app>.<Your Space's address>`. The gate, `/open` and the handoff
always use the built-in address. `frame` (decision 2026-11-20), `true` by default, is the owner's
choice to show the app at its link in Your Space's pane, where the app's Caddy lets only Your Space's
origin frame it. `inPane`, which the server only reports, says whether Your Space does: `frame` is on,
the app has a link, its kit lets it run in a pane, and the link isn't plain HTTP inside an HTTPS Your
Space (one on this machine, like `http://127.0.0.1:8081`, is fine). The server sends the same answer to
the runtime manager, so the Caddy replaces the app's framing rules exactly when the pane frames the
link; otherwise it passes the app's framing headers on unchanged, and the web client opens the app at
its link in its own tab. Like the other fields, `frame` is back to its default when the app is
published again after publishing stopped; any other value than `true` or `false` is refused with
`400 bad_frame`.

`framing`, for an app with `inPane`, is the short ID of the app's Caddy while it runs and lets Your
Space's origin frame the app, as the runtime manager reports it, and null until then: while a change
is applied, or while the runtime manager can't be reached. The web client frames the link only then,
at `<link>/?ys-pane=<framing>`. The Caddy gets a new ID whenever it is recreated, so a page the browser
cached at another address, such as the app's refusal to be framed before the change applied, is
never shown in the pane.

## Commands

```bash
docker compose exec -T server install-app <github-link> [--kit <link | file | folder | ->] [--reuse-data] [--publish [--port <n>] [--bind <address>] [--link <url>] [--no-frame]] [--json]
docker compose exec -T server install-app --compose <file | -> [--kit <file | ->] [--name <name>] [--reuse-data] [--publish [--port <n>] [--bind <address>] [--link <url>] [--no-frame]] [--json]
docker compose exec server publish-app <name> [--port <n>] [--bind <address>] [--link <url>] [--frame | --no-frame] [--off] [--json]
docker compose exec server list-apps [--json]
docker compose exec runtime stop-apps
```

`install-app` prints the review, installs, and waits until the app is running or failed; exit status
0 or 1. `--kit` takes a kit's GitHub link, or a kit on this machine, which Your Space can't read
from GitHub when its repository is private: `-` reads it from standard input (`--kit - < kit.yaml`),
a folder is a kits repository with the app's kit at `apps/<owner>/<repo>.yaml`, and any other value
is the kit file. The command runs in the server's container, so a path is one inside it; standard
input is how a file on the host gets there. A kit on this machine is checked like one from GitHub
and recorded as `sha256:<digest>`.

`--compose` installs from a Compose file on this machine instead of a GitHub link, for an app whose
own file doesn't fit Your Space's rules: `-` reads it from standard input, and any other value is the
file, at most 256 KB. It is checked and adapted like a file from GitHub, and recorded as
`sha256:<digest>` with its file name; Your Space reads nothing from GitHub for it, not even the kits
repository, and later starts use the stored text. Its kit is only the one `--kit <file | ->` gives:
giving both in one command is what binds them, so the kit's `source` isn't matched and may be left
out. The app's name is `--name`, else the kit's `name`; with neither, the command refuses. The two
share standard input, so only one of `--compose` and `--kit` can be `-`; put the other in the
server's container first, for example with `docker compose exec -T server sh -c 'cat > /tmp/kit.yaml'
< kit.yaml`. Data kept under the name can be reused with `--reuse-data` whichever source it came
from, since a file on this machine has no repository to compare. With `--json`, the result has
`source: "sha256:<digest>"` in place of `commit`, and `list-apps --json` gives each app's `source`:
the link as given, or the digest.

`publish-app` publishes an installed app, changes how (an option left out keeps its value),
or stops publishing it with `--off`, and waits until the change is applied: it restarts the app's
services only when their address settings follow a link that changed, and otherwise recreates at most
the app's Caddy.
`--no-frame` sets
`frame` to `false`, so Your Space opens the app at its link in its own tab, and `--frame` sets it to
`true` again; `install-app --publish --no-frame` installs an app published that way. The `publish`
these commands and `list-apps --json` print includes `frame` and `inPane`, and both the commands' line
and `list-apps` say when an app published with a link opens in its own tab rather than in its pane. With `--json`, one JSON object on stdout and logs on stderr, as `create-owner` does.
