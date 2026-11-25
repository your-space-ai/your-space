# Runtime Manager API

HTTP with JSON bodies over the Unix socket `/run/ys-runtime/runtime.sock` in the `ys-runtime` volume.
Only the server mounts the volume; the runtime manager has no network interface. The API speaks in
Your Space's concepts (apps, services, interface, egress hosts, limits); requests never name Docker
settings.

An **app spec**, sent with every request that resolves or applies an app:

```json
{
  "project": "ys-finance",
  "app": "finance",
  "compose": "<the app's file, unchanged>",
  "env": { "SECRET_KEY_BASE": "…" },
  "pins": { "registry.example.com/finance:stable": "sha256:…" },
  "interface": { "service": "web", "port": 3000 },
  "limits": { "web": { "memory": 1073741824, "cpus": 1 } },
  "egress": ["api.openai.com"],
  "publish": { "port": 3000, "bind": "127.0.0.1", "frame": true },
  "knowledge": { "path": "/knowledge", "bases": ["course-notes"] }
}
```

`knowledge` (optional, journey 014) mounts the knowledge bases the owner gave an app whose kit asks
for knowledge, by name, in its interface service at `<path>/<name>`, read-write, with `nocopy` so an
image's files are never copied into one. Each is the external volume
`ys-knowledge.<installation>.<name>`, which `/apply` first checks is this installation's own; a
missing one, or one Your Space didn't make, stops the apply with a message. `path` is absolute and
normalised, isn't `/` and isn't in `/proc`, `/sys` or `/dev`; names are 1 to 40 lower-case letters,
digits and dashes, each given once. `/check` takes the path with no bases, so the review refuses a
file whose interface service mounts anything of its own at or inside it. An app's file can never name
a knowledge base's volume, as a key, a volume's `name` or a mount's source, with or without
`knowledge`.

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

`placeholders` (optional, for `/check`): with `true`, each setting the file requires, with
`${NAME:?…}` or `${NAME?…}`, that `env` has no value for gets a placeholder, so the server can
review the file before the owner fills those settings in; `variables` marks them `required`. An
image named with a placeholder isn't looked up and has no digest; the server checks the file again
with the owner's values before installing it. `/apply` ignores `placeholders` and refuses a file
whose required settings have no value, so a placeholder never reaches a running app.

`registryCredentials` (optional, journey 015): `[{ registry, username, secret, images }]`. Each
signs the engine in to `registry`, an exact host such as `ghcr.io`, for the `images` it names alone:
the runtime manager sends it as Docker's `X-Registry-Auth` on the lookup (`/check`) or download
(`/apply`) of an image whose reference names that registry and the same repository, and on no other
request. It writes no Docker config file and never repeats a credential in an answer or a log. The
server sends one only for images a check without it found private. The engine's distribution
lookup takes `X-Registry-Auth` (checked on Docker Engine 29.6.2, API 1.55), so a private image is
pinned to its digest without downloading it.

`env` (2026-11-23) is how settings reach the app: the server sends exactly the variables the app's
kit defines that have a value, and Compose resolves the file with them as its environment. Before it resolves anything, the runtime manager has Compose read the file as written
(`config` with interpolation, settings files, normalization and paths turned off, every profile
included), so it can check every `env_file` and `label_file` before Compose would read one. It tells
Compose to read none of them, with a second Compose file that resets each, and writes no settings
file. A service whose `env_file` names only `.env` (or `./.env`), required or not, gets every `env`
value as its environment, under the environment its file sets, and `adaptations` reports it.
`variables` marks `unset` each variable Compose had no value and no default for, and so left blank,
which Compose tells apart from one whose default is empty only in its warning; the server refuses
each one, and each `required` one, that the kit doesn't define. Any
other `env_file`, such as an absolute path, `../x` or a second file, and any `label_file`, is a
refusal naming the file, unless its service is left out with its profile. A file Compose can't read
as written is refused with Compose's error, as an unreadable file always was. Compose reads the
other Compose files a file names, with `include` (and an include's own `env_file`) or with
`extends: { file }`, even as written, so the server refuses such a file, `400 refused`, before it
sends it to `/check` or `/apply` (2026-11-24).

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /engine` | | `{ reachable, version, os, arch, cpus, memory, connection, stopping }`; `stopping` is true after `/stop-all` |
| `POST /check` | app spec, `pins`, `placeholders` and `registryCredentials` optional | `{ ok, services: [{ name, image, interface, ports, published: [{ target, host }], volumes, dependsOn }], variables: [{ name, required, default, unset }], adaptations: [...], refusals: [{ service, setting, reason }], images: [{ ref, registry, digest, runsHere, platforms, private, signIn }] }`. `registry` is the one the reference names (`docker.io` when it names none); `private` marks an image its registry gave only with a credential; `signIn` is `needed` when its registry wants a sign-in the spec has no credential for, or `refused` when it refused the one given. Such an image is never looked up on the engine instead, has no refusal of its own, which the server words, and makes `ok` false |
| `POST /apply` | app spec | NDJSON stream: `{ "step": "pull", "image" }`, `{ "step": "start" }`, …, then `{ "done": true }` or `{ "error": "…" }`, with `"code": "sign_in"` when a registry asked for a sign-in to download an image, or refused the one given; a published port something else took since it was checked gives an error naming it. While the app runs, a one-time service that finished and is unchanged isn't started again |
| `POST /apps/{project}/down` | | Removes containers, networks and the anonymous volumes the containers mounted; keeps named volumes |
| `DELETE /apps/{project}/volumes` | | Removes the app's volumes |
| `GET /apps` | | `[{ project, app, services: [{ name, role, state, health, exitCode, oomKilled, outdated, framing }] }]` for every app this installation manages; `role` is `app`, `egress` or `publish`; `outdated` marks a `publish` service that doesn't run Your Space's Caddy's current image, or lets another origin than that Caddy's frame the app; `framing`, on a `publish` service that runs and lets that Caddy's origin frame the app, is its container's ID, shortened to 12 characters, which changes whenever the service is recreated |
| `GET /apps/{project}/interface?id=&service=&port=` | | `{ address }` with the exact installed service's current IPv4 on the app's sealed bridge. Journey 005 uses this private socket endpoint before agent dispatch. The runtime checks the app row UUID, workspace installation, Compose project and service, declared interface port, running container ID and membership of the labeled network. An absent, ambiguous or mismatched endpoint is refused. |
| `GET /apps/{project}/logs?service=&tail=` | | `{ lines: [...] }` |
| `GET /apps/{project}/stats` | | `{ services: [{ name, memory, memoryLimit, cpuPercent }] }` |
| `GET /apps/{project}/denials` | | `{ hosts: [{ host, attempts, lastSeen }] }` from the egress proxy's log |
| `POST /apps/{project}/port` | `{ publish: { port, bind } }` | `{ inUse, by? }`: whether the app can be published on `bind:port`. `by` names a running container that publishes it (the app's own Caddy doesn't count); otherwise a short-lived container of Your Space's Caddy's image tries to publish it, and `inUse` without `by` means another program uses it. 502 when the check itself fails, 503 when Your Space's Caddy isn't running |
| `POST /stop-all` | | Stops every managed app and refuses `/apply` until the runtime manager restarts |
| `POST /knowledge` | `{ name }` | `{ created }`: creates the knowledge base's volume, labelled `ai.your-space.installation`, `ai.your-space.role=knowledge` and `ai.your-space.knowledge=<name>`, never with a Compose project's labels, and gives its folder to user and group 1000 with mode 2777 in a short-lived container of the runtime manager's own image (no network, only the CHOWN, FOWNER and FSETID capabilities). `created: false` keeps this installation's own volume of that name, with its files; a volume of that name Your Space didn't make is refused with 409 |
| `DELETE /knowledge/{name}` | | Deletes the knowledge base's volume and its files. 409 while any container mounts it, running or stopped, or when the volume isn't Your Space's; a volume already gone is deleted. Removing an app (`/down`) or deleting its volumes (`DELETE /apps/{project}/volumes`) never deletes a knowledge base's |

Errors: `{ "error": "<code>", "message": "…" }` with status 400 (the spec is refused), 404, 409
(stopping), 502 (the engine answered with an error) or 503 (the engine can't be reached). Messages
never include `env` values.
