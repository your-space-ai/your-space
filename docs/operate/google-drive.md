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

From then on Your Space syncs every five minutes while it runs, and when you choose **Sync now**.
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

A sync that fails for another reason, such as no internet connection, is tried again five minutes
later. Only one sync of a knowledge base runs at a time; **Sync now** during one runs once more
after it. A knowledge base can't be deleted or disconnected while it syncs, and no sync starts
while it is being deleted or disconnected.

## Disconnect, change or remove

- **Disconnect** on a knowledge base's page stops its sync. Both keep their files: the knowledge
  base and the Drive folder. The sync's own storage goes with it, and with it the replaced files
  Your Space kept, however recent: copy any you need out of it first (see below). Connecting again,
  to the same folder or another, starts with a first sync that deletes nothing.
- **Change client** on the **Knowledge** page saves another OAuth client; sign in with Google again
  afterwards.
- **Remove connection** forgets the client and the token, once no knowledge base syncs. To revoke
  the token at Google too, remove Your Space's access in your
  [Google account](https://myaccount.google.com/permissions).
- Deleting a knowledge base deletes its sync too; the Drive folder keeps its files.

Replacing the data key ([Replace a Secret](recovery.md#replace-a-secret)) moves the client secret
and the token to the new key with apps' settings, so syncs go on.

## How it runs

Each step of a sync is a container the runtime manager starts and removes when the step ends:
rclone's official image, version 1.75.2, pinned to its digest. It runs as user 1000, without
capabilities, with a read-only file system, no access to the Docker engine and no FUSE, and mounts
only the knowledge base's volume and its sync state. Its only network is one whose way out is an
outbound proxy of the sync's own, which lets through only Google's token endpoint
(`oauth2.googleapis.com`) and the Drive API (`www.googleapis.com`). rclone gets the client and the
token as that container's environment, for that step, and keeps its configuration in memory: Your
Space never writes them to a file, logs them or gives them to an app. The Docker engine keeps a
container's environment in that container's configuration for as long as the container exists, so
each step's container is removed when the step ends, and one left behind, as when the runtime
manager restarts in the middle of a step, is removed when it starts again. rclone renews the access
token from the refresh token as it needs, in memory; Your Space keeps the refresh token it got at
sign-in.

On the Docker engine:

- `ys-knowledge.<installation>.<name>.sync`: a knowledge base's sync state, rclone's listings and
  the replaced files of the last 30 days, in its `backups` folder: a folder for each sync, named
  by its time, with the files that sync replaced at their paths in the knowledge base.
  Disconnecting or deleting the knowledge base deletes it; removing an app or deleting its data
  never does.
- `<installation>_knowledge-sync`: the Compose project of the sync's outbound proxy. It starts with
  the first sync and stops with your apps (`docker compose exec runtime stop-apps`), which also
  stops a sync under way as Ctrl+C stops rclone, so it saves its state, and waits for it: the next
  sync carries on. Deleting knowledge bases leaves it; [Remove Your Space](index.md#remove-your-space)
  removes it.
- `<installation>.knowledge-sync.<name>`: the container of a step that is running now. The runtime
  manager removes one left behind when it starts, and before it deletes the knowledge base or its
  sync.

`<installation>` is your installation's Compose project name, `your-space` unless you changed it.

A step that runs longer than 25 minutes, as the first sync of a very large folder can, is stopped,
and the next sync carries on; so is a sync that runs longer than two hours in all.
