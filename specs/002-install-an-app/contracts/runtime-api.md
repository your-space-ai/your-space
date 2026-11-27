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
| `POST /stop-all` | | Stops every managed app and refuses `/apply` until the runtime manager restarts. The knowledge bases' sync too: each knowledge base's rclone container is stopped as Ctrl+C stops rclone (`SIGINT`, killed after 100 seconds), all together, which gives a bisync under way time to shut down gracefully and save its state, then their proxy. That is best effort: a bisync killed after the 100 seconds, or that couldn't save its state, is finished by the next run as an interrupted one; `PUT /knowledge-sync` and `POST /knowledge-sync/{name}/restart` answer 409 from then on. 502 when the sync's Compose project can't be stopped, after the apps were, so `stop-apps` exits 1 |
| `POST /knowledge` | `{ name }` | `{ created }`: creates the knowledge base's volume, labelled `ai.your-space.installation`, `ai.your-space.role=knowledge` and `ai.your-space.knowledge=<name>`, never with a Compose project's labels, and gives its folder to user and group 1000 with mode 2777 in a short-lived container of the runtime manager's own image (no network, only the CHOWN, FOWNER and FSETID capabilities). `created: false` keeps this installation's own volume of that name, with its files, and sets up its folder's owner and mode again, so a volume an earlier try made but didn't set up is set up now; a volume of that name Your Space didn't make is refused with 409. A new volume whose folder can't be set up is deleted |
| `GET /knowledge/{name}` | | `{ apps, syncing }`: the apps of this installation whose containers mount the knowledge base's volume, running or stopped, by their `ai.your-space.app` label, `[]` when there is no such volume; and whether it has a sync container, or is being started with one. The server asks before deleting a knowledge base, so it applies each again without it, even one it has no grant for, and takes it out of the sync first. 409 when the volume isn't Your Space's |
| `DELETE /knowledge/{name}` | | Deletes the knowledge base's volume and its files, and its sync state volume when it has one. 409 while any container mounts it, running or stopped, the sync's included, or when either volume isn't Your Space's, before anything is deleted; a volume already gone is deleted. The sync state is deleted first: when the engine then refuses to delete the knowledge base's volume (409, as for a container that began mounting it meanwhile), the knowledge base keeps its files, but its sync state is gone, with bisync's listings and the replaced files kept, and its next connection starts with a first run that deletes nothing. Removing an app (`/down`) or deleting its volumes (`DELETE /apps/{project}/volumes`) never deletes a knowledge base's, or its sync state |
| `GET /knowledge-sync` | | `{ knowledgeBases, running, fixture }`: the knowledge bases' sync (journey 014): those that have a sync container, those whose container runs, and whether they sync with the browser tests' stand-in for Drive. See below |
| `PUT /knowledge-sync` | `{ knowledgeBases: [name] }` | The same, once there is a sync container for exactly each of these knowledge bases and each new one's remote control answers. A knowledge base no longer named has its container stopped as Ctrl+C stops rclone, then removed; the others' containers run on, unless their configuration changed, as with a new image; stopped ones are started. Nothing waits for a container that was there before, so one that doesn't answer holds up no other. No other field is accepted: no remote, client or token. `[]` removes the containers and their proxy. A new sync state volume is set up for user 1000, mode 0700, by a short-lived container as `POST /knowledge` sets up a knowledge base's folder, and the change fails when that container can't be removed after. 404 for a knowledge base that isn't on the engine, 409 for a sync state volume Your Space didn't make, or one of them being deleted, and while stopping; 503 when Your Space's server doesn't run on this engine, as with `YS_ENGINE_SOCKET` set to another, since the server reaches the containers' sockets through a volume it mounts, or when Your Space's Compose files have no `ys-sync` volume |
| `POST /knowledge-sync/{name}/restart` | | Stops that knowledge base's rclone as Ctrl+C stops it, and starts it again (a stopped one is started): for a run past its time, or an rclone that hasn't answered for a minute. 404 when it has no sync container, 409 while stopping |
| `DELETE /knowledge/{name}/sync` | | Deletes the knowledge base's sync state volume; the knowledge base and the Drive folder keep their files. 409 while it has a sync container |

Errors: `{ "error": "<code>", "message": "…" }` with status 400 (the spec is refused), 404, 409
(stopping), 502 (the engine answered with an error) or 503 (the engine can't be reached). Messages
never include `env` values.

## Knowledge base sync (journey 014)

Each synced knowledge base has a long-running container of its own: the service `rclone-<name>` of
the Compose project `<installation>_knowledge-sync`, stock `rclone/rclone` pinned to its index digest
(`YS_SYNC_IMAGE` in the runtime manager's environment, which `deploy/stack.yaml` sets, or 1.75.2's
without it; only `rclone/rclone` pinned by `sha256` is accepted). It runs `rclone rcd --config ''
--rc-addr unix:///run/ys-sync/rc.sock --rc-no-auth --rc-job-expire-duration 1h -v --use-json-log
--color NEVER` with a umask of 0, after removing whatever an earlier container left at the socket's
path, as user `0:0` with `CapDrop: ALL` and `CapAdd: [DAC_OVERRIDE, FOWNER]` only, a read-only root,
`/tmp` in memory, `no-new-privileges`, no engine socket, no devices and no FUSE, and stops with
`SIGINT` and 100 seconds' grace. Root, as Docker makes the capabilities it adds effective only for a
container's root user, with exactly these two, so no owner or mode an app gives its files stops a
sync (decision 2026-11-27): it reads and writes every file and folder of its knowledge base and
sets their times. What it writes there is `0666` and `0777`, for apps of any user to change; it
never changes the owner or mode of a file an app made, though a file changed in Drive is replaced by
its own copy. Each rclone runs in the server's user name space, as root's capabilities reach only
files of users its own name space maps: with `userns_mode: host` when the server runs in the
engine's own on an engine that remaps containers' users, and remapped like the apps when the
server is. Its root is the engine's own, with only these two capabilities, unless the server runs
remapped. Its environment is
`HOME` and the proxy's address only, and its command and labels hold no secret; its labels name its
knowledge base only (`ai.your-space.knowledge`), so another knowledge base's change leaves its
container as it is.

It mounts only its own knowledge base's volume at `/knowledge/<name>`, its sync state volume,
`ys-knowledge.<installation>.<name>.sync` (labelled `ai.your-space.role=knowledge-sync`, mode 0700),
at `/state/<name>`, and the folder `<name>` of the volume `<installation>_ys-sync` of Your Space's own
Compose file (labelled `com.docker.compose.volume=ys-sync`), as a volume subpath, at `/run/ys-sync`.
The server alone mounts that volume whole, at `/run/ys-sync`, and reaches each knowledge base's
remote control at `/run/ys-sync/<name>/rc.sock`; before each start the runtime manager gives the
volume and each knowledge base's folder in it to user 1000 with mode 0700: the socket itself is
root's and, with the umask of 0, writable by everyone, so that folder is what keeps it to the
server, user 1000, and rclone's root, which `DAC_OVERRIDE` lets in. The server gives rclone
the knowledge base with the local backend's `links` option (below), so a symbolic link syncs as a
link and is never followed out of it; the container for each is defence in depth besides, as
whatever a run does reaches nothing of another knowledge base, its listings or its socket. The
containers join the sealed network `<installation>_knowledge-sync_sync`, whose only way out is the project's
Squid, which lets through only `oauth2.googleapis.com` and `www.googleapis.com`.

The runtime manager never receives a remote, a client or a token: the server creates each knowledge
base's remote over its socket, and starts its runs there, as below. `PUT /knowledge-sync` holds the knowledge bases it names while the containers are
started, so none of them, or its sync state, is deleted meanwhile. With `YS_E2E_SYNC_FIXTURE=1` in the runtime
manager's own environment, which only the browser tests' Compose file sets, each container also
mounts the volume `ys-sync-fixture.<installation>` at `/remote`, and `fixture` is true; nothing the
server sends selects it.

### What the server asks rclone

The server (`server/src/apps/knowledge-sync.ts`), user 1000, is the only client of the sockets. It
asks the runtime manager for a container for every synced knowledge base, then, over each one's
socket, for that knowledge base only:

- `config/create` with `opt.nonInteractive`, before the knowledge base's first run in this rclone
  (`job/list`'s `executeId` names it) and again after the Google connection changes: the
  remote `kb-<name>`, `type: drive` with `client_id`, `client_secret`, `token`, `scope: drive`,
  `root_folder_id`, `skip_gdocs` and `skip_shortcuts`. rclone answers with a question about signing
  in again for a new token, which is never answered, so it keeps the token given and the access
  tokens it renews in memory. In the browser tests (`fixture`), an `alias` remote to
  `/remote/<folderId>` with the same client and token. `config/delete` when the OAuth client is
  saved again, so rclone's memory keeps no earlier secret or token.
- `sync/bisync` with `_async` and a `_group` of its own, between `kb-<name>:` (Path1) and
  `:local,links:/knowledge/<name>` (Path2): `workdir: /state/<name>/bisync`, `checkAccess`,
  `checkFilename: .your-space-sync`, `maxDelete: 50`, `resilient`, `recover`, `maxLock: 2m`, `compare:
  size,modtime,checksum`, `conflictResolve: path2`, `createEmptySrcDirs`, and `backupDir2` set to a
  folder of the run in `:local,links:/state/<name>/backups`, which bisync wants on the same remote as
  Path2, by the same string. A resync adds `resync` and `resyncMode: newer`. Every fs of the local
  side, in every call below too, is `:local,links:<path>` (journey 014, 2026-11-26): rclone reads a
  symbolic link as a `<name>.rclonelink` file holding its target and writes such a file as a link,
  never writing through a link that leads out of the folder, or an absolute one. The Drive remote
  has no such option, and needs none: there a `.rclonelink` file is a file. bisync names its listings
  after Path1 and Path2, so every step of a run gives them the same strings.
  The first run's and the owner's Resync come after the marker is put at both roots
  (`operations/stat`, `operations/uploadfile`, `operations/copyfile`); the resync the server runs
  itself to finish an interrupted run puts none back, and starts only when `operations/stat` finds
  it at both. Applying deletions runs `force` with `dryRun` first, then `force` only if
  the dry run's deletions are exactly those the server kept. The `force` run itself isn't limited to
  those paths: it lists both sides again as it starts, so a file deleted in the seconds between the
  dry run and that listing is deleted on the other side too. A file it deletes in the Drive folder
  goes to Drive's trash, and one it deletes in the knowledge base to that run's backup folder. When a resync leaves only ties, files
  with the same size and time but different content, `sync/copy` from the knowledge base to the
  remote with `_config: { UpdateOlder: true, CheckSum: true }` and an anchored `_filter.IncludeRule`
  for each, at most 40 a copy, read back with `core/transferred`, then the same resync again.
- `job/list`, and `job/status` of each job it says is running, before a run starts and before each
  later step of a run (a resync's tie copies and its second pass, applying deletions after their dry
  run, the resync that finishes an interrupted run): every call is a job of rclone's, and a run's job
  is in a `knowledge/` group, so no run, and no next step of one, starts while a job the server
  doesn't follow is under way, as one a server started just before it stopped, or while rclone can't
  say whether one is; the step is taken again at a later tick.
- `job/status` for the job under way, which the knowledge base's row keeps (`knowledge_sync.job`),
  so a server that restarted reads it again. A job rclone no longer has, as after it restarted,
  was interrupted: it is recorded as a failed run, except a dry run before applying deletions,
  which leaves the deletions for the owner. When the next run's bisync then needs a resync
  (`cannot find prior Path1 or Path2 listings`, `Must run --resync`), the server runs that resync
  itself as the run's next step, once for each interruption (journey 014, 2026-11-26). An answer
  that fails otherwise than with `job not found` leaves the job to be asked about again. The job's
  `output.output` is bisync's log at INFO, from which the server reads the deletions, ties and the
  reason a run stopped. bisync's `Bisync critical error: … path escapes from parent`, when the Drive
  side has a folder at the path of a link that rclone doesn't write through, is read first, as its
  path is the app's: the run stops with reason `link`, which needs a resync the server never runs
  itself, and keeps that line, which names the path. For an empty Drive folder there, bisync makes
  no folder, logs no error and reports success (rclone 1.75.2), so for a job that succeeded the
  server reads `core/stats` of its group too, before deleting the counts: a `lastError` of
  `… path escapes from parent` stops the run with reason `link` the same way, keeping that error; when
  that stats call fails, the job stays on its row and its stats are read again on the next tick,
  so the run is never recorded as synced unread. Google's refusal
  (`unauthorized`) is read only from a line that starts with rclone's own words and the request the
  token was for, `… Get "https://…": couldn't fetch token: invalid_grant` (or `invalid_client`,
  `unauthorized_client`, `deleted_client`), or `googleapi: Error 401: …`, never from words further
  into a line, where an error of the local file system holds a path the app named, and keeps
  Google's words alone. rclone keeps one log for its whole process
  while a bisync runs, so each knowledge base's rclone runs one bisync at a time; the knowledge
  bases' runs go on side by side.
  `core/stats-delete` then drops a finished job's counts. Calls about jobs, remotes and rclone itself
  wait 30 seconds; listings and copies wait five minutes.
- `operations/list` of `:local,links:/knowledge/<name>` (filtered to `**.conflict[0-9]*`) after a
  run that changed something, and at least hourly; of `:local,links:/state/<name>/backups`'s run
  folders (`dirsOnly`), then of each, newest first, until 500 files are listed, as rclone keeps every answer for an hour;
  and `operations/purge` of backup folders older than 30 days.

A job under way past two hours is stopped with `POST /knowledge-sync/{name}/restart`, and recorded
as failed, saying so; an rclone that hasn't answered for a minute is restarted the same way.
Disconnecting or deleting a knowledge base stops its rclone with `SIGINT`, which stops a run under
way, and removes the container; no other knowledge base's container changes. Nothing stops a job
with `job/stop`, which cancels a bisync at once and always leaves listings only `recover` can use;
stopping rclone with `SIGINT` lets bisync shut down gracefully first, and the runtime manager, which
doesn't mount the sockets, can do it. A run cut off before bisync has a backup of its listings, as
when rclone is killed during the first run after connecting, needs a resync, which the server then
runs itself, as above.
