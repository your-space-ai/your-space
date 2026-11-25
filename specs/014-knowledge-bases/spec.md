# 014 · Let my apps share a knowledge base

An owner creates knowledge bases in Your Space: named folders of files that Your Space keeps in
volumes of its own. An installed app whose kit asks for knowledge gets the knowledge bases the owner
picks, mounted as folders in its file system, and reads and writes them as ordinary files. A
knowledge base can also be kept in two-way sync with a folder in Google Drive, so the same files are
on Drive, in every app that mounts them, and on the owner's other devices.

**Status: draft, 2026-11-25.** This rewrite replaces the 2026-11-24 draft of views over Drive read
through an SDK. Decisions below were made with the owner on 2026-11-25. Open questions are listed at
the end.

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

## Decisions (2026-11-25)

- **A knowledge base is a volume Your Space owns.** It is a named volume that belongs to Your Space,
  not to any app, and it is the one kind of shared volume an app may mount. Apps' Compose files still
  can't name external volumes or host folders; Your Space adds the mounts itself.
- **Two kinds, one volume.** A *local* knowledge base is only the volume. A *synced* one is the same
  volume kept in sync with a remote folder. A local knowledge base can be connected to a remote
  later. Apps can't tell the two apart.
- **Sync is rclone two-way sync, not a live mount.** Your Space runs `rclone bisync` between the
  volume and the remote folder: unprivileged, with no FUSE, no volume plugin and no engine access.
  Apps read the local volume, so they work offline and at local speed. Your Space serves the files
  from rclone's copy, never by calling the Google API for an app.
- **One sync service that is always on.** A single long-running Your Space service syncs every
  synced knowledge base continuously, rather than a new container for each run. It talks only to the
  server, over a private socket, and holds the Google tokens in memory only. The owner: "rclone just
  constantly bisync the contents". The design it replaces is under [Considered](#considered).
- **Google Drive is the first remote, through the operator's own OAuth client.** rclone's shared
  client ID stops working during 2026, so each operator registers a client. The setup guide says to
  set the OAuth app to *In production*: an app left in *Testing* gets refresh tokens that expire
  after seven days. Other rclone remotes are accepted direction, each listed only once it passes the
  same both-sides-edit and conflict check.
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
- **File ownership.** A new knowledge base's folder belongs to user and group 1000, is writable by
  everyone, and gives new files its group. Sync runs as user 1000. An app that runs as another user
  can create files but may not be able to change files another user wrote; most self-hosted images
  default to user 1000.
- **Sync safety.** Deleting the owner's files on Drive is the worst failure here, so every run uses
  bisync's own checks and stops for the owner rather than guess:
  - A marker file at both roots (`--check-access`), so an empty or replaced volume, or an unreachable
    folder, never reads as "everything was deleted".
  - The default limit on deletions per run (`--max-delete 50`, half the files). A run over it stops
    and lists the deletions it would make.
  - bisync's refusal to sync with an empty side outside the first run.
  - Only one run per knowledge base at a time, with a lock that expires if a run dies
    (`--resilient --recover --max-lock 2m`).
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
    one the owner confirmed, it doesn't run and shows the new list for confirmation.
  - Overwrites keep the replaced copy. A local file replaced by a sync is moved to a backup folder
    of that run in Your Space's sync state, outside the knowledge base (`--backup-dir1` with a folder
    per run), so a file replaced in several runs keeps each earlier copy. Backups are kept for 30
    days. A Drive file replaced by a sync keeps its earlier version only in Drive's own version
    history, for as long as Drive keeps it (by default 30 days or 100 versions); Your Space keeps no
    copy of it. The knowledge base's page lists the backed-up files of recent runs.
- **Conflicts.** When a file changed on both sides since the last run, bisync keeps both: the remote's
  copy is renamed with a conflict suffix. Your Space lists conflict copies on the knowledge base's
  page. Two apps writing the same file locally is not detected: the last write wins, and Drive's
  version history is the fallback.
- **Scope of a sync.** A sync covers exactly the chosen Drive folder, never the whole Drive. Native
  Google Docs, Sheets and Slides are skipped (`--drive-skip-gdocs`): they have no file to edit
  locally and stay in Drive only. Empty folders sync too.
- **The sync service.** One container for all synced knowledge bases, run by the runtime manager for
  Your Space: unprivileged, with no engine access and no FUSE. It mounts each synced knowledge base's
  volume and a state volume of its own, and talks only to the server, over a Unix socket in a volume
  only the two of them share, as the runtime manager does. Connecting or disconnecting a knowledge
  base changes its mounts, so the runtime manager recreates it then; a run under way is stopped
  first, as below. The service keeps each knowledge base's status, last run, stopped run with its
  deletion list, conflicts and backups in its state volume, so a server restart loses none of them:
  the server reads them when it starts and records the runs it missed.
- **When it syncs.** Continuously. A change in a knowledge base's folder starts a sync a few seconds
  after the changes stop. Drive can't notify a self-hosted server, so the service checks Drive about
  once a minute. Runs of one knowledge base never overlap (bisync's lock); **Sync now** starts one
  at once, or right after the one under way. A run stopped by the safety checks stops the automatic
  runs of that knowledge base until the owner chooses an action.
- **Stopping.** Stopping Your Space signals the service, which interrupts runs under way the way
  bisync expects (an interrupt, then `--recover` on the next run), so the next start resumes cleanly.
  Restarting only the server doesn't stop a run.
- **Credentials.** The Google token is encrypted with the data key ([journey 009](../009-encrypt-stored-data/spec.md))
  and moved with app settings when the data key changes, so rotating the key doesn't break sync. The
  server hands each knowledge base's client and token to the sync service over its socket when the
  service starts and when they change. The service keeps them in memory and gives them only to the
  rclone process of a run. They are never written to a file, never put in a container's environment
  or configuration, and never given to an app. A restarted service has none until the server hands
  them over again.
- **Network.** The sync service reaches only Google's sign-in and Drive hosts, through an outbound
  proxy of its own. Apps reach nothing new.
- **Failure.** When Google refuses the token or the client changes, the knowledge base shows sync as
  disconnected with **Reconnect**; the files stay, and apps keep working on the local copy.
- **The actual actor.** Creating, deleting, connecting and granting a knowledge base is recorded
  against the owner; each sync run that changed files, stopped or failed against Your Space. Runs
  that change nothing aren't recorded one by one; the page shows when the last one finished.

## Acceptance

- Create two knowledge bases. Install two fixture apps given the first, and one given both. A file one
  app writes in `/knowledge/<first>` is in the others; the app given only the first doesn't have the
  second.
- An app installed without a knowledge declaration gets no mount. A kit with an unknown `knowledge`
  field, or a `path` that is relative, `/` or contains `..`, is refused in the review.
- Remove an app and delete its data: its knowledge bases and their files remain. Delete a knowledge
  base: it leaves the apps that had it.
- Sync, run in tests against a fixture remote that production can't select: a file created, changed
  or deleted on either side reaches the other; a file changed on both sides leaves a conflict copy
  that the page lists.
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
- Without **Sync now**: a file an app writes reaches the fixture remote within seconds, and a file
  added to the remote reaches the apps on the next Drive check (tests shorten the interval).
- Restart only the server during a run: the run finishes, and the page then shows its result and its
  events are recorded. Stop Your Space during a run: the next start finishes it without a resync.
- The token is in no file in the sync service's volumes, and in no container's environment or
  configuration (`docker inspect`). Restart the sync service: it syncs again once the server has
  handed it the token.
- Rotate the data key: the connection still syncs.
- With the operator's own client against real Google Drive, on a throwaway folder: connect, sync both
  ways, restart Your Space and sync again after the access token expires, then revoke access in Google
  and see **Reconnect**.

## Delivery slices

Each slice is one reviewable PR with an owner-visible result checked in a browser, stacked in this
order.

1. **Local knowledge bases and mounts.** The Knowledge page, the runtime's knowledge volumes, the kit
   field, the install review's picker, the app page's editor and the mounts. Result: two fixture apps
   see each other's files.
2. **Synced knowledge bases.** The Google connection with the operator's client, the encrypted token
   and its key rotation, the sync service and how it hands over tokens, continuous sync, status,
   conflicts, Sync now, Resync and Apply these deletions, and the operator guide. Result: a knowledge base syncs with a fixture remote in tests, and the page
   shows its status and conflicts.

## Considered

- **A new sync container for each run, every five minutes** (the first implementation, 2026-11-25).
  Not chosen, at the owner's decision: the token was in the container's environment, which the
  engine keeps in the container's configuration while it exists; a container started every five
  minutes for each knowledge base; edits took up to five minutes to arrive; and a run's result was
  lost when the server restarted during it, since only the server kept it.
- **A live mount** (`rclone mount`). Not chosen: it needs FUSE and extra privileges in a container,
  and leaves apps without their files when the remote is unreachable.

## Later direction

These are recorded, not scheduled. Each is opt-in, so a v1 kit never breaks.

- **Write controls.** `readOnly: true` or `write: <folder>` in the kit's `knowledge`, and owner
  controls on the app's page.
- **Many writers.** A copy per writer merged with git: a worktree per writer, `git merge-file` or
  `merge=union` for Markdown, a conflict copy for binary files, and possibly gitwatch to commit
  automatically.
- **Live same-file editing.** An SDK or CRDTs, for apps that edit the same file at once.
- **More remotes.** Any rclone remote, each listed once it passes the both-sides-edit and conflict
  check. Uploading files from the browser.
- **Layers.** Search, summaries and other functions over a knowledge base's files, and showing
  knowledge bases to agents (journey 005).

## Open questions

- Which of Google's redirect addresses work for each way Your Space is reached (`localhost`, an HTTPS
  domain, a private address), and what the guide says for the ones Google refuses.
- Per-knowledge-base size limits, and how a first sync of a large folder shows progress.
- The Obsidian kit's Compose file: a kit pins a public Compose file, and the image's maintainers
  publish none. [Journey 015](../015-private-sources/spec.md) lets a kit pin a Compose file in a
  private repository; until it lands, the Obsidian demo waits.
