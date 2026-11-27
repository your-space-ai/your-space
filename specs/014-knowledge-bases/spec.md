# 014 · Let my apps share a knowledge base

An owner creates knowledge bases in Your Space: named folders of files that Your Space keeps in
volumes of its own. An installed app whose kit asks for knowledge gets the knowledge bases the owner
picks, mounted as folders in its file system, and reads and writes them as ordinary files. A
knowledge base can also be kept in two-way sync with a folder in Google Drive, so the same files are
on Drive, in every app that mounts them, and on the owner's other devices.

**Status: draft, 2026-11-27.** This rewrite replaces the 2026-11-24 draft of views over Drive read
through an SDK. Decisions below were made with the owner from 2026-11-25 to 2026-11-27. Open
questions are listed at the end.

**Motivating use case (later, out of scope here).** A flashcard app links each card to the source
file it came from in a knowledge base, so an answer can bring that source along as context. Journey
014 gives such an app the files; the app itself comes later.

## Owner journey

1. Open **Knowledge** and create a knowledge base: give it a name, such as `course-notes`. The name is
   fixed once it is created and becomes the folder name inside apps; its title can change.
2. Optionally, connect it to a folder in Google Drive. The first time, Your Space shows the redirect
   address to register; the owner creates an OAuth client in their own Google Cloud project, pastes
   its client ID and secret, and signs in with the Google account. Then they paste the link of the
   Drive folder to sync. Your Space keeps the two in sync from then on and shows when it last synced,
   any conflict copies it made, and **Sync now**.
3. Install an app whose kit declares knowledge access. The install review says the app wants
   knowledge and lets the owner pick one or more knowledge bases, or none.
4. Open the app. Each knowledge base it was given is a folder under its knowledge path, such as
   `/knowledge/course-notes`, and the app reads and writes files there.
5. On the app's page, add or remove knowledge bases at any time. Your Space restarts the app with the
   new folders.
6. Deleting a knowledge base asks first, names the apps that use it, and removes it from them. A
   synced knowledge base's Drive folder is left as it is.

## App developer journey

Declare knowledge access in the kit:

```yaml
knowledge: { path: /knowledge }   # path is optional; /knowledge is the default
```

Your Space mounts each knowledge base the owner gives the app at `<path>/<name>` in the app's
interface service, always one folder per knowledge base, even when there is only one. The app finds
them by listing `<path>`. The kit names no volume, token or address. An app like Obsidian opens
`/knowledge` as its vault, and each knowledge base is a top-level folder in it.

## Decisions (2026-11-25 to 2026-11-27)

- **A knowledge base is a volume Your Space owns.** It is a named volume that belongs to Your Space,
  not to any app, and it is the one kind of shared volume an app may mount. Apps' Compose files still
  can't name external volumes or host folders; Your Space adds the mounts itself.
- **Two kinds, one volume.** A *local* knowledge base is only the volume. A *synced* one is the same
  volume kept in sync with a remote folder. A local knowledge base can be connected to a remote
  later. Apps can't tell the two apart.
- **Sync is rclone two-way sync, not a live mount.** Your Space runs `rclone bisync` between the
  volume and the remote folder: with only two file capabilities, no FUSE, no volume plugin and no
  engine access. Apps read the local volume, so they work offline and at local speed. Your Space
  serves the files from rclone's copy, never by calling the Google API for an app.
- **One rclone for each synced knowledge base, always on, and nothing else.** Each synced knowledge
  base has a long-running container of its own that runs stock rclone's remote-control server
  (`rclone rcd`), with its configuration in memory only, listening on a private socket only the
  server can reach. It mounts only that knowledge base, so no run can reach another knowledge base
  (2026-11-26). The server drives each through rclone's own remote control API:
  it creates the knowledge base's Drive remote there, so tokens stay in rclone's memory, and starts
  each bisync there. Your Space adds no sync daemon or file watcher of its own.
  The owner: "rclone just constantly bisync the contents", and "can that be achieved natively with
  rclone or are we adding more infra for this?". The designs it replaces are under
  [Considered](#considered).
- **Google Drive is the first remote, through the operator's own OAuth client.** rclone's shared
  client ID stops working during 2026, so each operator registers a client. The setup guide says to
  set the OAuth app to *In production*: an app left in *Testing* gets refresh tokens that expire
  after seven days. Other rclone remotes are accepted direction, each listed only once it passes the
  same both-sides-edit and conflict check.
- **Links sync as links (2026-11-26).** rclone's `links` option is set on the knowledge base's side
  of every sync, so a symbolic link is never followed out of the knowledge base: it is kept in Drive
  as a small `<name>.rclonelink` file holding the link's target, and such a file from Drive becomes
  a link here. A Drive folder at the path of a link out of the knowledge base stops it, naming the
  path, until the owner removes the folder or the link (see **Links**). The owner adopted this once
  it was checked against the pinned stock rclone.
- **Taking a knowledge base away finishes after a restart (2026-11-26).** The owner asked for a
  guarantee that it finishes when Your Space is back. Your Space compares the knowledge bases each
  running app's containers mount, as the runtime manager reports them, with the app's grants, and
  applies again any app that mounts one it isn't given (see **Finishing after a restart**). No
  pending change is saved and the schema doesn't change, as the owner preferred.
- **Your Space owns the files, apps lease them (2026-11-27).** The owner: "all the files should be
  owned and managed by your space, they are essentially leased to the apps, but the apps dont own
  the files and shouldn't prevent sync". No owner or permission an app sets ever stops Your Space's
  sync, and apps can still read and edit what the sync writes: each sync container reads and writes
  any file of its knowledge base, and writes files every app can change (see **Files the sync reads
  and writes**). This replaces the 2026-11-26 rule that apps writing into a knowledge base run as
  user 1000 or with a umask of 002, and that a run failing on their permissions stops for the
  owner's Resync.
- **No permissioning in v1.** Every mount is read-write, for every app given the knowledge base. There
  is no writer role, read-only mount or folder ownership yet. The owner: "i dont want to build a
  solution before we've run into a problem here".
- **No SDK and no knowledge API in v1.** Apps use files. Search and other layers come later, on top of
  the same files.

## Behavior and boundaries

- **Mounts.** Your Space adds each granted knowledge base to the app's interface service at
  `<path>/<name>`, where `path` is an absolute path that isn't `/` and names no `..`, and `name` is
  lowercase letters, digits and hyphens. Changing an app's knowledge bases recreates its interface
  service. Removing an app, and deleting its data, never deletes a knowledge base.
- **Taking a knowledge base away.** A knowledge base taken from an app, or deleted, leaves the app
  once the apply that recreates it without the folder works. When that apply fails, the app keeps
  the knowledge bases its containers still mount, as the runtime manager reports them. Deleting a
  knowledge base applies again every app whose containers mount it, running or not, since Docker
  keeps a volume that any container mounts: a stopped app is started without it. When an app can't
  be applied without it, nothing is deleted, that app keeps it, and the refusal names the app.
- **Finishing after a restart (2026-11-26).** When Your Space stops or restarts before that apply
  ends, it finishes the change once it is back. Each time it checks its apps, at start once the
  runtime manager answers and about every 15 seconds after, it compares the knowledge bases each
  running app's containers mount, as the runtime manager reports them, with the app's grants. An
  app that mounts one it isn't given is applied again, with only its grants, until it no longer
  mounts it. An app the owner asked to remove, whose removal didn't finish, is removed instead, as
  deleting a knowledge base does. An apply that fails is tried again later: after a minute, then
  twice as long each time, up to an hour. A stopped app is left as it is: it gets its current
  grants when it next starts, or when deleting the knowledge base applies it again, as above.
  Nothing new is saved for this: the containers' mounts are the record.
- **File ownership.** A knowledge base and its files belong to Your Space; apps lease them
  (2026-11-27, see **Your Space owns the files**). A new knowledge base's folder belongs to user and
  group 1000, Your Space's, is writable by everyone, and gives new files its group. A short-lived
  container of the runtime manager's own image sets it up. Creating the knowledge base fails when
  that container can't be removed after, since it still mounts the volume; deleting the knowledge
  base removes such a container first.
- **Files the sync reads and writes (2026-11-27).** Apps may run as any user, with any umask, and
  make files and folders with any mode: nothing they set stops a sync. Each sync container runs as
  root in its container with only two capabilities, `DAC_OVERRIDE` and `FOWNER`, so it reads and
  writes every file and folder of its knowledge base, and sets their times, whoever made them and
  whatever their mode, such as a folder an app made `0755` or a file it made `0600`. Docker makes
  capabilities it adds effective only for a container's root user, never for user 1000 (checked
  on Docker 28.3.3 and 29). The sync writes with a umask of 0, so the files and folders it makes
  are readable and writable by everyone (`0666`, `0777`) and owned by the sync's user: an app
  running as any user can read them, change them, replace them and delete them, where the folders
  above them let it. In a folder an app made `0700`, other apps reach nothing; in one it made
  `0755`, they can change its files but not replace or delete them. That is the lease's limit: an
  app can't change the mode of a file the sync wrote, or set its time to anything but now. A file
  that changed in Drive is replaced by such a copy, even where the app had made it readable only by
  itself. The sync never changes the owner or mode of a file an app made. Between
  apps nothing changes (see **No permissioning in v1**): a file keeps the owner and mode the app
  that made it gave it, so another app running as another user may not be able to change it.
  Checked on rclone 1.75.2.
- **A run that fails on a local write.** Permissions an app sets no longer cause one (2026-11-27).
  When a run still can't write in the knowledge base, as on a full disk, it may already have made
  its changes in Drive: bisync changes the Drive folder first, so files deleted here are deleted in
  Drive too. Here it deletes nothing: a file deleted in Drive is still here. bisync then asks for a
  resync, so the knowledge base stops (`resync`) until the owner chooses **Resync**, which copies
  both ways and deletes nothing: a file whose deletion here didn't happen goes back to Drive.
- **Sync safety.** Deleting the owner's files on Drive is the worst failure here, so every run uses
  bisync's own checks and stops for the owner rather than guess, with one exception: the resync Your
  Space runs by itself to finish an interrupted run (see **Interrupted runs**). The checks:
  - A marker file at both roots (`--check-access`), so an empty or replaced volume, or an unreachable
    folder, never reads as "everything was deleted". bisync compares the marker files it finds on
    the two sides at any depth, so a root marker missing on one side stops the run (checked on
    rclone 1.75.2).
  - The default limit on deletions per run (`--max-delete 50`, half the files). A run over it stops
    and lists the deletions it would make. Over 10,000 of them are more than the owner is asked to
    confirm: none is listed, and only **Resync** is offered.
  - bisync's refusal to sync with an empty side outside the first run.
  - Only one run per knowledge base at a time, with a lock that expires if a run dies
    (`--resilient --recover --max-lock 2m`). A run that finds the lock held changes nothing and is
    tried again a minute later. An owner's **Resync** or **Apply these deletions** that finds it
    held, or that can't start, as when rclone doesn't answer, is kept for that next run, with the
    deletions to apply, which are listed again first, as below.
  - The first run copies both ways and deletes nothing (`--resync --resync-mode newer`): a file on
    only one side is copied to the other, and where both sides have a file, the newer copy wins.
    Files are compared by size, modification time and checksum (`--compare size,modtime,checksum`),
    so a same-size file with different content isn't taken as unchanged. When both copies have the
    same modification time but different content, the local copy wins and the Drive copy is
    replaced, as below.
  - After a stopped run the owner chooses one of two actions. **Resync** runs the same way as the
    first run, so files deleted on one side come back from the other. **Apply these deletions**
    shows the listed deletions and, once the owner confirms, runs that one sync past the limit
    (`--force`); the next run has the limit again. Just before the forced run, Your Space
    lists the deletions again without changing anything (`--dry-run`); if the list differs from the
    one the owner confirmed, it doesn't run and shows the new list for confirmation. The forced run
    then lists both sides again itself, so a file deleted in the seconds between that check and the
    run is deleted on the other side too. This is accepted for v1 (owner decision, 2026-11-26).
  - Overwrites keep the replaced copy. A local file replaced by a sync is moved to a backup folder
    of that run in Your Space's sync state, outside the knowledge base and on a mount of its own
    (see **Links** for why it must be). The knowledge base is
    bisync's Path2 and the Drive folder its Path1, so this is `--backup-dir2`, with a folder per run.
    A file replaced in several runs keeps each earlier copy. Backups are kept for 30 days. A Drive
    file replaced by a sync keeps its earlier version only in Drive's own version history, for as
    long as Drive keeps it (by default 30 days or 100 versions); Your Space keeps no copy of it. The
    knowledge base's page lists the backed-up files of recent runs.
- **Conflicts.** When a file changed on both sides since the last run, bisync keeps both: the
  knowledge base's copy keeps the name (`--conflict-resolve path2`), and the remote's copy is renamed
  with a conflict suffix. Your Space lists conflict copies on the knowledge base's page. Two apps
  writing the same file locally is not detected: the last write wins, and Drive's version history is
  the fallback.
- **Scope of a sync.** A sync covers exactly the chosen Drive folder, never the whole Drive: the
  folder is the root of the knowledge base's Drive remote. Native Google Docs, Sheets and Slides are
  skipped (`skip_gdocs`): they have no file to edit locally and stay in Drive only. Drive shortcuts
  are skipped too (`skip_shortcuts`): a shortcut to a folder lists that folder's files, wherever they
  are in the Drive, so following it would copy files from outside the chosen folder into the
  knowledge base. The OAuth scope is `drive`, because with `drive.file` rclone sees only the files it
  created itself, not those already in the folder. Empty folders sync too.
- **Links.** Every fs rclone is given on the knowledge base's side, the knowledge base itself and
  its backup folders, is `:local,links:<path>` (2026-11-26). A symbolic link an app makes in the
  knowledge base syncs to Drive as a `<name>.rclonelink` file holding the link's target, and a
  `.rclonelink` file in the Drive folder becomes a link here, with whatever target it holds. rclone
  never writes through a link that leads out of the knowledge base, or through any absolute link:
  - A Drive folder at such a link's path, or under it, stops the knowledge base with its own reason
    (`link`), naming the path. Nothing is written where the link leads, such as the knowledge base's
    own sync state. bisync then needs a resync, and Your Space doesn't run one by itself for it.
  - An empty Drive folder there stops it the same way. rclone reports that run as successful and
    logs no error, keeping it only in the job's stats, so for a run that succeeded the server reads
    those too: when rclone's last error says the path escapes from its parent, the knowledge base
    stops with `link`, naming the path, whatever bisync reported (default picked 2026-11-26).
  - It stays stopped until the owner removes the Drive folder, or removes the link here and its
    `.rclonelink` file in Drive, which would otherwise bring the link back, then chooses
    **Resync**. A resync while the folder and the link are both there stops the same way.
  - A Drive file at a link's path never writes into the link's target. It replaces the link here, as
    when the link's `.rclonelink` file in Drive is replaced by a file of the link's own name. rclone
    then can't keep the replaced link in the run's backups, so that run fails and stops (`resync`),
    with the Drive file on both sides; **Resync** syncs again (checked on rclone 1.75.2). This holds
    because the backups are on a mount of their own: with them on the knowledge base's own mount,
    rclone moves the new file into the backups instead, reports success, and the next run deletes it
    in Drive.
  - The one link rclone follows is a link written relative to where it is, to a folder in the
    knowledge base itself (default picked 2026-11-26). A Drive folder at its path is written into
    the folder it leads to, still inside the knowledge base, and later runs move those files to that
    folder in Drive too. No link is ever followed out of the knowledge base.
  - A file, not a link, whose name ends in `.rclonelink` is read as a link of the name without the
    suffix, so it stops the sync until it is renamed (checked on rclone 1.75.2, open question
    below): by the app that made it, by another app that can write in its folder, or by the owner on
    the machine Your Space runs on. Nothing is deleted or overwritten on either side. A normal run
    fails while listing, before anything changes, and the next run tries again a minute later;
    rclone's error names the file, the page's message doesn't. A resync, as the first run after
    connecting is, copies the other files and then stops (`resync`), and **Resync** stops the same
    way. When a link of the name without the suffix is there too, the file is skipped and the link
    syncs as above, until that link is gone.
- **The sync containers.** One container for each synced knowledge base, run by the runtime
  manager for Your Space: the stock rclone image running `rclone rcd`, as root in the container
  with only `DAC_OVERRIDE` and `FOWNER` (see **Files the sync reads and writes**), every other
  capability dropped, no new privileges, a read-only root, no engine access and no FUSE. Each runs
  in Your Space's server's user name space, since root's capabilities reach only files of users its
  own name space maps: its root is the engine's own root, with only those two capabilities, unless
  the engine remaps containers' users and the server's are remapped too, when the sync's root is
  remapped like the apps'. It mounts only that knowledge base's volume, its own sync state
  (bisync's listings and the backups) and its own socket's folder. Links aren't followed out of the
  knowledge base (see **Links**); the container is defence in depth besides, as it limits what any
  run can reach to that knowledge base, its state and its socket. Its remote control listens only on
  a Unix socket in that folder, in a volume only the server mounts whole, protected by file
  permissions, as the runtime manager's socket is. Connecting or disconnecting a knowledge base adds
  or removes its container only; the others keep running. The server and the sync containers share
  the sockets' volume, so knowledge bases sync only when apps run on the engine Your Space's server
  runs on: with `YS_ENGINE_SOCKET` set to another engine, connecting one is refused with `503`.
- **When it syncs.** About once a minute for each synced knowledge base, on its own timer, and at
  once on **Sync now**: the server starts each run through that knowledge base's remote control
  (`sync/bisync`, run in the background), with the options listed under sync safety. Runs of one
  knowledge base never overlap: the server starts none while one is under way, and bisync's lock is
  the backstop. Different knowledge bases sync side by side. Drive can't notify a self-hosted
  server, and rclone has no built-in watcher of local files, so a change waits for the next run. A
  run stopped by the safety checks stops the automatic runs of that knowledge base until the owner
  chooses an action, and a **Sync now** asked for while that run was under way is dropped with it.
- **Run results.** The server records each run's result, conflicts and backups, reading them from
  the knowledge base's rclone over its socket. A run keeps going when only the server restarts;
  rclone keeps a finished run's result for an hour, and the server reads the runs it missed when it
  starts.
- **Stopping.** Stopping Your Space stops each sync container with SIGINT, which starts bisync's
  graceful shutdown: it finishes or cancels the transfers under way and saves its state for the next
  run. The server doesn't stop runs through the remote control (`job/stop`). Disconnecting a
  knowledge base stops its container the same way. A container killed without that shutdown, or a
  power cut, can leave a run that bisync can finish only with a resync (see **Interrupted runs**).
- **Interrupted runs.** A run that was interrupted, as when Your Space or its sync container
  stopped, is recorded as failed, and the next run carries on from where it was (`--recover`).
  Sometimes bisync can finish an interrupted run only with a resync. This is seen when the first run
  after connecting is killed without a graceful shutdown, or the power is cut. Then Your Space
  resyncs by itself (`--resync --resync-mode newer`, with the same checks) instead of stopping for
  the owner (2026-11-26). The newer copy of each file wins, so nothing is lost; at worst a file
  deleted on one side comes back from the other. Your Space does this once for each interruption.
  If its own resync fails, the next run that still needs one stops for the owner.
- **Credentials.** The Google token is encrypted with the data key ([journey 009](../009-encrypt-stored-data/spec.md))
  and moved with app settings when the data key changes, so rotating the key doesn't break sync. The
  server creates each knowledge base's Drive remote in its rclone's in-memory configuration over its
  socket (`config/create`), with the client and token, when that container starts and when they
  change. rclone keeps them and the access tokens it refreshes in memory only. They are never written
  to a file, never put in a container's environment or configuration, and never given to an app. A
  restarted sync container has none until the server creates its remote again.
- **Network.** The sync containers reach only Google's sign-in and Drive hosts, through an outbound
  proxy of their own. Apps reach nothing new.
- **Failure.** When Google refuses the token or the client changes, the knowledge base shows sync as
  disconnected with **Reconnect**; the files stay, and apps keep working on the local copy.
- **The actual actor.** Creating, deleting, connecting and granting a knowledge base, and applying
  deletions the owner confirmed, are recorded against the owner; each sync run that changed files,
  stopped or failed against Your Space. An interrupted run may have changed files, so it is recorded
  as failed. An interrupted **Apply these deletions** is still recorded as the owner's applied
  deletions, since some may have been made, and so is one that failed or stopped once its log shows
  it deleted any of them. Your Space's own resync of an interrupted run is recorded
  as `knowledge.resync_requested` against Your Space. Its own apply that finishes taking a knowledge
  base from an app after a restart is recorded as `knowledge.revoked` against Your Space when that
  apply works, unless the runtime manager then still reports the app mounting it. Runs that change
  nothing aren't recorded one by one; the page shows when the last one finished.

## Acceptance

- Create two knowledge bases. Install two fixture apps given the first, and one given both. A file one
  app writes in `/knowledge/<first>` is in the others; the app given only the first doesn't have the
  second.
- An app installed without a knowledge declaration gets no mount. A kit with an unknown `knowledge`
  field, or a `path` that is relative, `/` or contains `..`, is refused in the review.
- Remove an app and delete its data: its knowledge bases and their files remain. Delete a knowledge
  base: it leaves the apps that had it, or whose containers still mount it, a stopped app too, which
  is started without it. When an app can't be applied without it, nothing is deleted, that app keeps
  it, and the refusal names the app.
- Take a knowledge base from a running app, and stop the runtime manager and the server before the
  apply ends: the app's container still mounts it and has no grant for it. Start them again: once
  Your Space is back, the app's container no longer mounts it. A stopped app isn't started for it.
- Sync, run in tests against a fixture remote that production can't select: a file created, changed
  or deleted on either side reaches the other; a file changed on both sides leaves a conflict copy
  that the page lists.
- An app running as another user than the sync's, with a umask of 022 (user 1234 in the tests),
  makes a folder and a file only it can read (`0600`) in a synced knowledge base: both reach the
  fixture remote. A file the remote adds to that folder, and one it deletes there, reach the
  knowledge base on the next runs, which don't stop, and the app can still edit a file the sync
  wrote.
- Sync refuses to delete: empty the volume, or remove the marker, or delete over half the files, and
  the run stops with a message and the remote is unchanged.
- After a run stopped by deleting over half the files: **Resync** brings the deleted files back from
  the other side and deletes nothing; **Apply these deletions**, confirmed, deletes them on the other
  side, and the next run stops again over the limit.
- A resync where both sides changed a file keeps the newer copy, and the replaced local copy is in
  that run's backup folder. A file replaced locally in two runs has both earlier copies backed up.
  Two same-size copies with equal modification times and different content end with the local copy
  on both sides.
- **Apply these deletions** doesn't run when another file was deleted after the owner confirmed, and
  shows the new list instead.
- Without **Sync now**: a file an app writes reaches the fixture remote, and a file added to the
  remote reaches the apps, on the next timed run (tests shorten the interval).
- Restart only the server during a run: the run finishes, and the page then shows its result and its
  events are recorded. Stop Your Space during a run: the run is recorded as failed, and the next
  start finishes it, resyncing by itself if bisync needs that.
- Two synced knowledge bases sync through containers of their own, each mounting only its own
  knowledge base, sync state and socket's folder.
- A link an app makes in a synced knowledge base is in the fixture remote as a `.rclonelink` file,
  and a `.rclonelink` file added there becomes a link. A link out of the knowledge base is never
  followed: an app links to the knowledge base's own sync state and the fixture remote has a folder
  at the link's path; the run stops with reason `link`, naming the path, nothing is written into the
  sync state, and Your Space runs no resync of its own. With the link and its `.rclonelink` file
  removed, **Resync** syncs again. An empty folder at the link's path stops the run the same way.
- A link's `.rclonelink` file in the fixture remote replaced by a file of the link's name: that run
  doesn't read as synced, the file is in the knowledge base and the remote, and **Resync** syncs
  again.
- The token is in no file in the sync containers' volumes, and in no container's environment or
  configuration (`docker inspect`). Restart a knowledge base's sync container: it syncs again once
  the server has created its remote again.
- Rotate the data key: the connection still syncs.
- With the operator's own client against real Google Drive, on a throwaway folder: connect, sync both
  ways, see that a shortcut in the folder to a folder outside it isn't synced, restart Your Space and
  sync again after the access token expires, then revoke access in Google and see **Reconnect**.

## Delivery slices

Each slice is one reviewable PR with an owner-visible result checked in a browser, stacked in this
order.

1. **Local knowledge bases and mounts.** The Knowledge page, the runtime's knowledge volumes, the kit
   field, the install review's picker, the app page's editor, the mounts, and finishing a knowledge
   base's removal after a restart. Result: two fixture apps see each other's files.
2. **Synced knowledge bases.** The Google connection with the operator's client, the encrypted token
   and its key rotation, the rclone sync containers and the remotes the server creates in them, the
   timed runs, status, conflicts, Sync now, Resync and Apply these deletions, and the operator
   guide. Result: a knowledge base syncs with a fixture remote in tests, and the page shows its
   status and conflicts.

## Considered

- **A new sync container for each run, every five minutes** (the first implementation, 2026-11-25).
  Not chosen, at the owner's decision: the token was in the container's environment, which the
  engine keeps in the container's configuration while it exists; a container started every five
  minutes for each knowledge base; edits took up to five minutes to arrive; and a run's result was
  lost when the server restarted during it, since only the server kept it.
- **A sync service of Your Space's own**, with a file watcher that starts a run seconds after a
  local change (the second design, 2026-11-25). Not chosen: it adds a daemon to build and maintain
  where stock `rclone rcd` already runs bisync, holds remotes in memory and reports jobs. A local
  watcher stays later direction.
- **One `rclone rcd` container for all synced knowledge bases** (the third design, 2026-11-25).
  Replaced on 2026-11-26 by a container for each: without `links`, rclone wrote through a symbolic
  link to a folder, so an app given one knowledge base could link to where another was mounted in
  the shared container and have a sync write into it, or over its sync state. And connecting or
  disconnecting any knowledge base changed the container's mounts, so it was recreated and every run
  under way was stopped. Links now sync as links, and the container for each stays as defence in
  depth.
- **rclone's default for links, or refusing a run while the knowledge base has a link to a folder**
  (2026-11-26). Not chosen, at the owner's decision. By default rclone skips a link when it reads the
  knowledge base but writes through a link to a folder, so an app could have a sync write into its
  knowledge base's own sync state. Refusing every run while a link is there would stop knowledge
  bases whose apps use links for their own files.
- **A live mount** (`rclone mount`). Not chosen: it needs FUSE and extra privileges in a container,
  and leaves apps without their files when the remote is unreachable.

## Later direction

These are recorded, not scheduled. Each is opt-in, so a v1 kit never breaks.

- **Write controls.** `readOnly: true` or `write: <folder>` in the kit's `knowledge`, and owner
  controls on the app's page.
- **Many writers.** A copy per writer merged with git: a worktree per writer, `git merge-file` or
  `merge=union` for Markdown, a conflict copy for binary files, and possibly gitwatch to commit
  automatically.
- **Faster local changes.** Starting a run seconds after an app changes a file, with a watcher of the
  knowledge base's folder, if a minute proves too slow.
- **Live same-file editing.** An SDK or CRDTs, for apps that edit the same file at once.
- **More remotes.** Any rclone remote, each listed once it passes the both-sides-edit and conflict
  check. Uploading files from the browser.
- **Layers.** Search, summaries and other functions over a knowledge base's files, and showing
  knowledge bases to agents (journey 005).

## Open questions

- Which of Google's redirect addresses work for each way Your Space is reached (`localhost`, an HTTPS
  domain, a private address), and what the guide says for the ones Google refuses.
- Per-knowledge-base size limits, and how a first sync of a large folder shows progress.
- A file, not a link, named with `.rclonelink` at the end stops the sync until it is renamed (see
  **Links**). An app can make one whatever its permissions, but only an app that can write in its
  folder, or the owner on the machine Your Space runs on, can rename it. Whether Your Space should
  sync such a file, skip it, or stop with a reason of its own that names it, is the owner's to
  decide; no fixture-remote acceptance case is added for it until then.
- The Obsidian kit's Compose file: a kit pins a public Compose file, and the image's maintainers
  publish none. [Journey 015](../015-private-sources/spec.md) lets a kit pin a Compose file in a
  private repository; until it lands, the Obsidian demo waits.
