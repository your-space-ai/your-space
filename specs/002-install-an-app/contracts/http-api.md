# Apps HTTP API and Commands

Every route below requires the signed-in owner (FR-010); others get 401 or 403 and nothing changes.
Errors use journey 001's shape `{ "error": "<code>", "message": "…" }`.

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/apps` | | `{ apps: [{ name, title, state, stateReason, origin, pane, hasInterface, pendingRequests, publish }], retained: [{ name, title, removedAt }] }` |
| `POST /api/apps/preview` | `{ link, kit? }` | The review: `{ previewId, name, title, source: { repo, path, commit }, kit, services, images, adaptations, settings: [{ name, secret, generated, value? }], outbound, publishPort, retained }`. Secret values are never included. `publishPort` is the port publishing uses by default, or null without an interface. |
| `POST /api/apps` | `{ previewId, settings?: { NAME: value }, reuseData?: boolean, publish?: { port?, bind?, link? } }` | `202 { name, jobId }`; `409 port_in_use` when another published app, a container or another program on this machine uses the port |
| `GET /api/apps/{name}` | | The app: state, services with state, settings (secrets as set or not set), outbound hosts, access requests, limits, the latest job |
| `GET /api/apps/{name}/logs?service=` | | `{ lines }` |
| `PUT /api/apps/{name}/settings` | `{ values: { NAME: value \| null } }` | `202 { jobId }`; the app is applied again |
| `PUT /api/apps/{name}/limits` | `{ limits: { service: { memory, cpus } } }` | `202 { jobId }` |
| `PUT /api/apps/{name}/publish` | `{ publish: { port?, bind?, link? } \| null }` | `202 { jobId }`; the app is applied again. `null` stops publishing; a field left out keeps its value, or its default the first time. `409 port_in_use` when another published app, a container or another program on this machine uses the port |
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

`publish` (decision 2026-11-19) is `{ port, bind, link }` or null: the app's interface on `bind:port`
of this machine, for the owner's own proxy or tunnel, outside the gate. `port` defaults to the port
the app's file publishes for its interface, else the interface's port; `bind` is an IP address,
`127.0.0.1` by default; `link` is an `http` or `https` origin, or null. With a link, the settings a kit
derives with `app_origin` and `app_host` take the link's values whenever the app starts.

## Commands

```bash
docker compose exec -T server install-app <github-link> [--kit <link | file | folder | ->] [--reuse-data] [--publish [--port <n>] [--bind <address>] [--link <url>]] [--json]
docker compose exec server publish-app <name> [--port <n>] [--bind <address>] [--link <url>] [--off] [--json]
docker compose exec server list-apps [--json]
docker compose exec runtime stop-apps
```

`install-app` prints the review, installs, and waits until the app is running or failed; exit status
0 or 1. `--kit` takes a kit's GitHub link, or a kit on this machine, which Your Space can't read
from GitHub when its repository is private: `-` reads it from standard input (`--kit - < kit.yaml`),
a folder is a kits repository with the app's kit at `apps/<owner>/<repo>.yaml`, and any other value
is the kit file. The command runs in the server's container, so a path is one inside it; standard
input is how a file on the host gets there. A kit on this machine is checked like one from GitHub
and recorded as `sha256:<digest>`. `publish-app` publishes an installed app, changes how (an option left out keeps its value),
or stops publishing it with `--off`, and waits until the app has restarted. With `--json`, one JSON object on stdout and logs on stderr, as `create-owner` does.
