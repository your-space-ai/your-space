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
normalised, isn't `/` and isn't in `/proc`, `/sys` or `/dev`, or at or under `/etc/resolv.conf`,
`/etc/hosts` or `/etc/hostname`; names are 1 to 40 lower-case letters,
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
| `POST /stop-all` | | Stops every managed app and refuses `/apply` until the runtime manager restarts. The knowledge bases' sync too: rclone's container is stopped as Ctrl+C stops rclone (`SIGINT`, killed after 100 seconds), so a bisync under way shuts down gracefully and saves its state, then its proxy; `PUT /knowledge-sync` and `POST /knowledge-sync/restart` answer 409 from then on |
| `POST /knowledge` | `{ name }` | `{ created }`: creates the knowledge base's volume, labelled `ai.your-space.installation`, `ai.your-space.role=knowledge` and `ai.your-space.knowledge=<name>`, never with a Compose project's labels, and gives its folder to user and group 1000 with mode 2777 in a short-lived container of the runtime manager's own image (no network, only the CHOWN, FOWNER and FSETID capabilities). `created: false` keeps this installation's own volume of that name, with its files, and sets up its folder's owner and mode again, so a volume an earlier try made but didn't set up is set up now; a volume of that name Your Space didn't make is refused with 409. A new volume whose folder can't be set up is deleted |
| `GET /knowledge/{name}` | | `{ apps, syncing }`: the apps of this installation whose containers mount the knowledge base's volume, running or stopped, by their `ai.your-space.app` label, `[]` when there is no such volume; and whether the sync's container mounts it, or is being started with it. The server asks before deleting a knowledge base, so it applies each again without it, even one it has no grant for, and takes it out of the sync first. 409 when the volume isn't Your Space's |
| `DELETE /knowledge/{name}` | | Deletes the knowledge base's volume and its files, and its sync state volume when it has one. 409 while any container mounts it, running or stopped, the sync's included, or when either volume isn't Your Space's, before anything is deleted; a volume already gone is deleted. Removing an app (`/down`) or deleting its volumes (`DELETE /apps/{project}/volumes`) never deletes a knowledge base's, or its sync state |
| `GET /knowledge-sync` | | `{ running, knowledgeBases, fixture, socket }`: the knowledge bases' sync service (journey 014), whether its container runs, the knowledge bases it mounts, whether it syncs with the browser tests' stand-in for Drive, and where its remote control listens. See below |
| `PUT /knowledge-sync` | `{ knowledgeBases: [name] }` | The same, once the sync's container runs with exactly these knowledge bases mounted and its remote control answers. No other field is accepted: no remote, client or token. `[]` removes the container and its proxy. 404 for a knowledge base that isn't on the engine, 409 for a sync state volume Your Space didn't make, or one of them being deleted, and while stopping |
| `POST /knowledge-sync/restart` | | Stops rclone as Ctrl+C stops it, and starts it again: the server's limit on one run's time. 409 while stopping |
| `DELETE /knowledge/{name}/sync` | | Deletes the knowledge base's sync state volume; the knowledge base and the Drive folder keep their files. 409 while the sync's container mounts it |

Errors: `{ "error": "<code>", "message": "…" }` with status 400 (the spec is refused), 404, 409
(stopping), 502 (the engine answered with an error) or 503 (the engine can't be reached). Messages
never include `env` values.

## Knowledge base sync (journey 014)

One long-running container syncs every synced knowledge base: the service `rclone` of the Compose
project `<installation>_knowledge-sync`, stock `rclone/rclone` pinned to its index digest
(`YS_SYNC_IMAGE` in the runtime manager's environment, which `deploy/stack.yaml` sets, or 1.75.2's
without it; only `rclone/rclone` pinned by `sha256` is accepted). It runs `rclone rcd --config ''
--rc-addr unix:///run/ys-sync/rc.sock --rc-no-auth --rc-job-expire-duration 1h -v --use-json-log
--color NEVER`, after removing a socket an earlier container left there, as user 1000:1000 with a
read-only root, `/tmp` in memory, `CapDrop: ALL`, `no-new-privileges`, no engine socket, no devices
and no FUSE, and stops with `SIGINT` and 100 seconds' grace. Its environment is `HOME` and the
proxy's address only, and its command and labels hold no secret.

It mounts the volume `<installation>_ys-sync` of Your Space's own Compose file (labelled
`com.docker.compose.volume=ys-sync`) at `/run/ys-sync`, which the server alone mounts too; the
runtime manager gives its folder to user 1000 with mode 0700 before each start. For each synced
knowledge base it mounts the knowledge base's volume at `/knowledge/<name>` and its sync state volume,
`ys-knowledge.<installation>.<name>.sync` (labelled `ai.your-space.role=knowledge-sync`, mode 0700),
at `/state/<name>`. It joins the sealed network `<installation>_knowledge-sync_sync`, whose only way
out is the project's Squid, which lets through only `oauth2.googleapis.com` and `www.googleapis.com`.

The runtime manager never receives a remote, a client or a token: the server creates each knowledge
base's remote over the socket, and starts its runs there, as below. `PUT /knowledge-sync` holds the knowledge bases it names while the container is
started, so none of them, or its sync state, is deleted meanwhile; Compose recreates the container
when the mounts change, stopping it with `SIGINT` first. With `YS_E2E_SYNC_FIXTURE=1` in the runtime
manager's own environment, which only the browser tests' Compose file sets, the container also
mounts the volume `ys-sync-fixture.<installation>` at `/remote`, and `fixture` is true; nothing the
server sends selects it.

### What the server asks rclone

The server (`server/src/apps/knowledge-sync.ts`) is the only client of the socket, user 1000. It
asks the runtime manager for the service with every synced knowledge base, then, over the socket:

- `config/create` with `opt.nonInteractive`, for each knowledge base before its first run in this
  rclone (`job/list`'s `executeId` names it) and again after the Google connection changes: the
  remote `kb-<name>`, `type: drive` with `client_id`, `client_secret`, `token`, `scope: drive`,
  `root_folder_id`, `skip_gdocs` and `skip_shortcuts`. rclone answers with a question about signing
  in again for a new token, which is never answered, so it keeps the token given and the access
  tokens it renews in memory. In the browser tests (`fixture`), an `alias` remote to
  `/remote/<folderId>` with the same client and token.
- `sync/bisync` with `_async` and a `_group` of its own, between `kb-<name>:` (Path1) and
  `/knowledge/<name>` (Path2): `workdir: /state/<name>/bisync`, `checkAccess`, `checkFilename:
  .your-space-sync`, `maxDelete: 50`, `resilient`, `recover`, `maxLock: 2m`, `compare:
  size,modtime,checksum`, `conflictResolve: path2`, `createEmptySrcDirs`, and `backupDir2` set to a
  folder of the run in `/state/<name>/backups`. A resync adds `resync` and `resyncMode: newer`,
  after the marker is put at both roots (`operations/stat`, `operations/uploadfile`,
  `operations/copyfile`); applying deletions runs `force` with `dryRun` first, then `force` only if
  the dry run's deletions are exactly those the server kept. When a resync leaves only ties, files
  with the same size and time but different content, `sync/copy` from the knowledge base to the
  remote with `_config: { UpdateOlder: true, CheckSum: true }` and an anchored `_filter.IncludeRule`
  for each, at most 40 a copy, read back with `core/transferred`, then the same resync again.
- `job/status` for the job under way, which the knowledge base's row keeps (`knowledge_sync.job`),
  so a server that restarted reads it again; a job rclone no longer has, as after it restarted, was
  interrupted and nothing is recorded of it. The job's `output.output` is bisync's log at INFO, from
  which the server reads the deletions, ties and the reason a run stopped; rclone keeps one log for
  its whole process while a bisync runs, so the server runs one job at a time, whichever knowledge
  base it is for. `core/stats-delete` drops a finished job's counts.
- `operations/list` of `/knowledge/<name>` (filtered to `**.conflict[0-9]*`) and of
  `/state/<name>/backups` after a run that changed something, and at least hourly, and
  `operations/purge` of backup folders older than 30 days.

A job under way past two hours is stopped with `POST /knowledge-sync/restart`. The server never
stops a job with `job/stop`: rclone cancels it at once, and after the first run that follows a
resync that leaves listings bisync can't recover without a resync.
