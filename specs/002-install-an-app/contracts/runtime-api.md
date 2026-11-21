# Runtime Manager API

HTTP with JSON bodies over the Unix socket `/run/ys-runtime/runtime.sock` in the `ys-runtime` volume.
Only the server mounts the volume; the runtime manager has no network interface. The API speaks in
Your Space's concepts (apps, services, interface, egress hosts, limits); requests never name Docker
settings.

An **app spec**, sent with every request that resolves or applies an app:

```json
{
  "project": "ys-sure",
  "app": "sure",
  "compose": "<the app's file, unchanged>",
  "env": { "SECRET_KEY_BASE": "…" },
  "pins": { "ghcr.io/we-promise/sure:stable": "sha256:…" },
  "interface": { "service": "web", "port": 3000 },
  "limits": { "web": { "memory": 1073741824, "cpus": 1 } },
  "egress": ["api.openai.com"],
  "publish": { "port": 3000, "bind": "127.0.0.1", "frame": true }
}
```

`publish` (optional, decision 2026-11-19) adds `ys-publish`, a Caddy of Your Space's that runs Your
Space's own Caddy's image with `deploy/published.caddyfile`. It listens on `bind:port` of this
machine, proxies to the interface, and passes the app's responses on unchanged; the app's own
services publish nothing. Checking or applying a published app while Your Space's Caddy isn't
running is refused; an apply waits up to two minutes for it first. With `frame: true` (decision
2026-11-20), which the server sends only for an app that its pane shows at its link, the Caddy lets
only Your Space's origin frame the app: it gets `YS_FRAME=on` and
`YS_ORIGIN`, the origin Your Space's own Caddy has, removes the app's `X-Frame-Options`, and sets its
policy's `frame-ancestors`, or a policy of its own, to that origin; it is labelled
`ai.your-space.frame-origin` with the origin. Without `frame`, or with `false`, it gets
`YS_FRAME=off` and changes nothing. `frame: true` while Your Space's Caddy has no origin is refused.

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /engine` | | `{ reachable, version, os, arch, cpus, memory, connection, stopping }`; `stopping` is true after `/stop-all` |
| `POST /check` | app spec, `pins` optional | `{ ok, services: [{ name, image, interface, ports, published: [{ target, host }], volumes, dependsOn }], variables: [{ name, required, default }], adaptations: [...], refusals: [{ service, setting, reason }], images: [{ ref, digest, runsHere, platforms }] }` |
| `POST /apply` | app spec | NDJSON stream: `{ "step": "pull", "image" }`, `{ "step": "start" }`, …, then `{ "done": true }` or `{ "error": "…" }`; a published port something else took since it was checked gives an error naming it. While the app runs, a one-time service that finished and is unchanged isn't started again |
| `POST /apps/{project}/down` | | Removes containers, networks and the anonymous volumes the containers mounted; keeps named volumes |
| `DELETE /apps/{project}/volumes` | | Removes the app's volumes |
| `GET /apps` | | `[{ project, app, services: [{ name, role, state, health, exitCode, oomKilled, outdated, framing }] }]` for every app this installation manages; `role` is `app`, `egress` or `publish`; `outdated` marks a `publish` service that doesn't run Your Space's Caddy's current image, or lets another origin than that Caddy's frame the app; `framing`, on a `publish` service that runs and lets that Caddy's origin frame the app, is its container's ID, shortened to 12 characters, which changes whenever the service is recreated |
| `GET /apps/{project}/interface?id=&service=&port=` | | `{ address }` with the exact installed service's current IPv4 on the app's sealed bridge. Journey 005 uses this private socket endpoint before agent dispatch. The runtime checks the app row UUID, workspace installation, Compose project and service, declared interface port, running container ID and membership of the labeled network. An absent, ambiguous or mismatched endpoint is refused. |
| `GET /apps/{project}/logs?service=&tail=` | | `{ lines: [...] }` |
| `GET /apps/{project}/stats` | | `{ services: [{ name, memory, memoryLimit, cpuPercent }] }` |
| `GET /apps/{project}/denials` | | `{ hosts: [{ host, attempts, lastSeen }] }` from the egress proxy's log |
| `POST /apps/{project}/port` | `{ publish: { port, bind } }` | `{ inUse, by? }`: whether the app can be published on `bind:port`. `by` names a running container that publishes it (the app's own Caddy doesn't count); otherwise a short-lived container of Your Space's Caddy's image tries to publish it, and `inUse` without `by` means another program uses it. 502 when the check itself fails, 503 when Your Space's Caddy isn't running |
| `POST /stop-all` | | Stops every managed app and refuses `/apply` until the runtime manager restarts |

Errors: `{ "error": "<code>", "message": "…" }` with status 400 (the spec is refused), 404, 409
(stopping), 502 (the engine answered with an error) or 503 (the engine can't be reached). Messages
never include `env` values.
