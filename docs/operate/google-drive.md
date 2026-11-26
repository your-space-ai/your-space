---
title: "Sync knowledge bases with Google Drive"
---

A [knowledge base](../apps/knowledge-bases.md) can be kept in two-way sync with a folder in Google
Drive, so the same files are on Drive, in every app that uses the knowledge base, and on your other
devices. Your Space runs the sync itself with [rclone](https://rclone.org/bisync/); apps read and
write the local copy and never reach Drive.

Your Space signs in to Google with an OAuth client you create in your own Google Cloud project. It
has no client of its own, and rclone's shared client stops working during 2026
([rclone's Drive documentation](https://rclone.org/drive/)). You set this up once for the
installation; each knowledge base then connects to a folder by its link.

## 1. Create the OAuth client

In the [Google Cloud console](https://console.cloud.google.com/), as in rclone's own
[guide to making a client ID](https://rclone.org/drive/#making-your-own-client-id), except for the
client's type: Your Space's server finishes the sign-in itself, so it is a **Web application**.

1. Create a project for Your Space, or pick one of yours.
2. Under **APIs & Services**, **Library**, open **Google Drive API** and choose **Enable**.
3. Open **Google Auth Platform** (called **OAuth consent screen** in older consoles) and set it up:
   - **Branding:** an app name, such as "Your Space", and your email as the support and developer
     contact.
   - **Audience:** user type **External**, unless your Google account belongs to a Google Workspace
     organization and you choose **Internal**. Set the publishing status to **In production**.
     Leave it in **Testing** and Google's refresh tokens expire after seven days, so the sync stops
     every week until you reconnect. If Google doesn't let you publish yet, it first asks for a home
     page and a privacy policy address under **Branding**, and an authorized domain. You don't need
     to submit the app for verification to use it yourself.
   - **Data access:** you can add the scope `https://www.googleapis.com/auth/drive`. Your Space asks
     for it when you sign in either way.
4. Under **Clients**, create a client with application type **Web application**. Under
   **Authorized redirect URIs**, add the address the **Knowledge** page shows under **Google
   Drive**: Your Space's own address followed by `/api/google-drive/callback`, such as
   `https://space.example.com/api/google-drive/callback`.
5. Create it, and copy its **Client ID** and **Client secret**.

Google accepts a redirect URI over HTTPS, or `http://` on `localhost`. With
[your own domain or proxy](../install/other-devices.md), Your Space's address is HTTPS and works.
Whether Google accepts the address of a workspace on this machine only, `http://space.localhost`, is
not verified yet; if Google refuses it, reach Your Space over HTTPS to connect.

## 2. Save the client and sign in

1. In Your Space, open **Knowledge**. Under **Google Drive**, paste the client ID and secret and
   choose **Save client**. Your Space keeps the secret encrypted with the
   [data key](index.md#what-your-space-encrypts) and never shows it again.
2. Choose **Sign in with Google**, and sign in with the Google account whose Drive you want to sync.
3. Google says it hasn't verified the app, since it is yours: choose **Advanced**, then go on to
   your app. Allow it to see, edit, create and delete your Google Drive files. A knowledge base
   syncs a folder you already have, which Drive's narrower access can't see.
4. Google sends you back to **Knowledge**, which says you are signed in.

Your Space's server exchanges Google's answer for a token itself, with a one-time state and PKCE,
so only the browser session that started the sign-in can finish it. It keeps the token encrypted
with the data key too.

## 3. Connect a knowledge base to a folder

Open the knowledge base on the **Knowledge** page. Under **Google Drive**, paste the link of the
Drive folder, as Drive's address bar shows it or **Share**, **Copy link** gives it, and choose
**Connect**. A knowledge base that already has files can be connected; so can an empty one, or one
whose folder already has files.

The first sync copies both ways and deletes nothing: a file on one side only is copied to the other,
and where both sides have a file, the newer copy wins. When both copies have the same modification
time but different content, the knowledge base's copy replaces Drive's, which Drive keeps in the
file's version history, and the page lists those files. The first sync also puts Your Space's
marker file, `.your-space-sync`, at the top of the knowledge base and of the Drive folder. Leave it
there: a sync that can't find it on both sides stops.

From then on Your Space syncs about once a minute while it runs, and at once when you choose
**Sync now**. A change on either side arrives at the next sync: Drive can't tell a self-hosted
server about a change, so Your Space doesn't watch for them.
The knowledge base's page shows when it last synced, and what to do when a sync stops. See
[Share files between apps](../apps/knowledge-bases.md#sync-with-google-drive) for what it shows.

## What a sync does

- It covers exactly the chosen folder and the folders in it, never the rest of your Drive.
- Shortcuts in the folder are skipped, and stay in Drive only: a shortcut points to a file or
  folder somewhere else in your Drive, which the sync would otherwise copy, change and delete there.
  To sync such a folder, move it into the chosen folder, or connect another knowledge base to it.
- Google Docs, Sheets and Slides are skipped: they have no file to edit locally, and stay in Drive.
  Empty folders sync too.
- A file changed on both sides between two syncs keeps both copies: the knowledge base's keeps its
  name, and Drive's is saved beside it with `.conflict1` (then `.conflict2`, and so on) at the end,
  on both sides. The page lists them until you delete one.
- A file a sync replaces or deletes in the knowledge base is kept for 30 days in the sync's own
  storage, outside the knowledge base, where apps don't see it. The page lists them. A Drive file a
  sync replaces is kept in that file's version history in Drive, for as long as Drive keeps it.
- Two apps writing the same file in the knowledge base aren't detected: the last write wins.
- The sync runs as user 1000. Apps that write into a synced knowledge base should run as user
  1000, as most self-hosted images do, or keep the files and folders they make writable by their
  group. A umask of 002 does that for files and folders made with the usual modes, but not for a
  mode the app sets itself, like `0700`. Otherwise the sync can't change such an app's files or
  write into the folders it made: that sync fails with a permission error and is tried again a
  minute later, and nothing is deleted.

## When a sync stops

Deleting your files on Drive is the worst thing a sync could do, so it stops and waits for you
rather than guess. Your files stay as they are on both sides, and apps keep working on the local copy.

- **More than half of the files were deleted** on one side since the last sync. The page lists the
  deletions, the first 500 of them by name and how many more. **Resync** copies them back from the
  other side and deletes nothing. **Apply these deletions** deletes all of them on the other side
  too, for this one sync, once you confirm: just before, Your Space checks the list again, and if
  more files were deleted since, it deletes nothing and shows you the new list. Over 10,000
  deletions are more than Your Space lists for you to confirm: then only **Resync** is offered, and
  to delete the files, delete them on the other side too.
- **The knowledge base or the folder is empty**, or **the marker file is missing** on one side, as
  when a folder was replaced, emptied or moved. **Resync** puts the marker back and copies both
  ways, deleting nothing.
- **Google refused Your Space's access**, for example because you removed it in your
  [Google account](https://myaccount.google.com/permissions), the client's secret changed, or the
  app was left in **Testing**. **Knowledge** and the knowledge base's page show **Reconnect**, which
  signs in with Google again. Syncs resume after it.

A sync that fails for another reason, such as no internet connection, or that was interrupted, as
when Your Space stopped during it, is tried again a minute later, or at once after an interruption,
and carries on from where it stopped. When the sync after an interruption can carry on only with a
resync, as when the first sync after connecting was cut off without a graceful stop, such as by a
power cut, Your Space runs that resync itself rather than wait for you: it copies both ways and
deletes nothing, the newer copy winning, so at worst a file deleted on one side comes back from the
other. It does this once for each interruption, and never without the marker file on both sides;
otherwise the sync stops and waits for **Resync**. Each knowledge base syncs on its own, so a long
first sync of one doesn't hold up the others. **Sync now** during a sync of the same knowledge base runs once
more after it. Disconnecting or deleting a synced knowledge base stops its sync under way; no sync
of it starts meanwhile.

## Disconnect, change or remove

- **Disconnect** on a knowledge base's page stops its sync. Both keep their files: the knowledge
  base and the Drive folder. The sync's own storage goes with it, and with it the replaced files
  Your Space kept, however recent: copy any you need out of it first, as
  [How it runs](#how-it-runs) shows. Connecting again, to the same folder or another, starts with a
  first sync that deletes nothing.
- **Change client** on the **Knowledge** page saves another OAuth client; sign in with Google again
  afterwards.
- **Remove connection** forgets the client and the token, once no knowledge base syncs. To revoke
  the token at Google too, remove Your Space's access in your
  [Google account](https://myaccount.google.com/permissions).
- Deleting a knowledge base deletes its sync too; the Drive folder keeps its files.

Replacing the data key ([Replace a Secret](recovery.md#replace-a-secret)) moves the client secret
and the token to the new key with apps' settings, so syncs go on.

## How it runs

Each synced knowledge base has a container of its own: rclone's official image, version 1.75.2,
pinned to its digest for every processor it is published for, running rclone's own remote control
(`rclone rcd`). Your Space adds no sync program of its own. The runtime manager runs each container
as user 1000, without capabilities, with a read-only file system, no access to the Docker engine and
no FUSE. It mounts only its own knowledge base, that knowledge base's sync state, and its own folder
of a volume, `ys-sync`, that only Your Space's server mounts whole, where rclone's remote control
listens on a Unix socket only user 1000 opens; apps never mount it. As each container sees one
knowledge base only, a symbolic link an app makes in a knowledge base can't lead a sync into
another. Their only network is one whose way out is an outbound proxy of the sync's own, which lets
through only Google's token endpoint (`oauth2.googleapis.com`) and the Drive API
(`www.googleapis.com`).

rclone keeps its configuration in memory only. The server creates each knowledge base's Drive
remote in that knowledge base's rclone over its socket, with the client and the token, and starts
each sync there. Saving another OAuth client removes the remotes from rclone's memory. The
client secret and the token are never written to a file, never put in a container's environment
or configuration, and never given to an app; rclone renews the access token from the refresh token
as it needs, in memory, and Your Space keeps the refresh token it got at sign-in. When an rclone
container restarts, it has no remote until the server creates it again, which it does before the
next sync. One that stops answering for a minute is restarted.

rclone keeps a finished sync's result for an hour. A sync goes on when only the server restarts, as
during an update, and the server records its result, and what it changed, when it starts again.
Stopping your apps (`docker compose exec runtime stop-apps`, which `your-space stop` runs) stops
each rclone as Ctrl+C stops it, so a sync under way shuts down gracefully, and the next sync carries
on from there; the knowledge base's page shows the interrupted sync as one that didn't finish. A
sync cut off without that graceful stop during the first sync after connecting can carry on only
with a resync, which Your Space then runs itself, as [When a sync stops](#when-a-sync-stops) says.
Connecting a knowledge base starts its container; disconnecting or deleting it stops and removes
it; the other containers run on.

On the Docker engine:

- `ys-knowledge.<installation>.<name>.sync`: a knowledge base's sync state, rclone's listings and
  the replaced files of the last 30 days, in its `backups` folder: a folder for each sync, named
  by its time, with the files that sync replaced at their paths in the knowledge base.
  Disconnecting or deleting the knowledge base deletes it; removing an app or deleting its data
  never does. To keep the replaced files before you disconnect or delete it, copy them out into an
  archive in the current folder, here for the knowledge base `notes`. The archive is written under
  another name first, so a copy that fails keeps an earlier archive; list it before you disconnect
  or delete the knowledge base:

  ```sh
  docker run --rm -v ys-knowledge.your-space.notes.sync:/sync:ro alpine tar -cf - -C /sync backups > notes-backups.tar.part && mv notes-backups.tar.part notes-backups.tar
  tar -tf notes-backups.tar
  ```
- `<installation>_knowledge-sync`: the Compose project of the sync: each knowledge base's rclone
  container, `<installation>_knowledge-sync-rclone-<name>-1`, and their outbound proxy. It starts with
  the first synced knowledge base, stops with your apps, and is removed when no knowledge base syncs;
  [Remove Your Space](index.md#remove-your-space) removes it.
- `<installation>_ys-sync`: the volume of rclone's sockets, a folder for each knowledge base. It
  holds nothing durable.

`<installation>` is your installation's Compose project name, `your-space` unless you changed it.

A sync that runs longer than two hours, as the first sync of a very large folder can, is stopped
as Ctrl+C stops rclone, the page says so, and the next sync carries on with the files it didn't
copy. A file that is being copied when a sync stops is copied again from the start, so a single file
that takes longer than two hours to copy, as a very large one on a slow connection can, never
finishes. Keep files that large out of a synced folder.

Each sync compares files by size, modification time and checksum, so it reads every file of the
knowledge base each time, about once a minute: a large knowledge base on a slow disk keeps its
container busy, and its syncs come further apart than a minute.
