---
title: "Share files between apps"
---

A knowledge base is a folder of files that Your Space keeps and gives to the apps you choose. Each
app you give it finds it as a folder of its own, such as `/knowledge/course-notes`, and reads and
writes its files there as ordinary files. Two apps given the same knowledge base see each other's
files, so notes written in one app are there in the other.

Only apps whose kit asks for knowledge can be given knowledge bases. Your Space mounts them itself:
an app's own Compose file can't name a knowledge base, another app's volume or a folder of this
machine.

## Create a knowledge base

Open **Knowledge** in Your Space's navigation, give the knowledge base a name, such as
`course-notes`, and choose **Create**. The name is its folder in every app, so it is lower-case
letters, digits and dashes, and it can't change later. Its title, which Your Space shows, is
optional and you can change it with **Rename**.

The list shows each knowledge base with the apps that use it.

## Give knowledge bases to an app

When you install an app whose kit asks for knowledge, the review has a **Knowledge** section with
your knowledge bases. Pick any of them, or none. On the app's page, **Knowledge** adds or removes
them at any time: saving restarts the app's interface service with the new folders, and its data is
kept. If that restart fails, the app keeps the knowledge bases whose folders it still has, and its
page lists those; save again once the app starts.

If Your Space stops or restarts before the app has restarted with the knowledge bases you saved, it
finishes that once it is back: while the app runs with a folder you didn't give it, or without one
you gave it, Your Space restarts its interface service with the knowledge bases it has, and tries
again later, waiting longer each time, if that fails. An app that isn't running gets the knowledge
bases it has when it next starts.

Each knowledge base is its own folder under the app's knowledge path, `/knowledge` unless the kit
names another, even when the app has only one. An app given one knowledge base doesn't see the
others.

## Files and users

A knowledge base and its files belong to Your Space, which lends them to the apps you give it: the
apps use the files but don't own them. Your Space mounts a knowledge base read-write in every app
given it. A new knowledge base's folder belongs to user and group 1000, Your Space's, is writable by
everyone, and gives new files its group, so apps running as any user can create files there.
Between apps, a file keeps the permissions the app that wrote it gave it: an app running as another
user may not be able to change it.

When two apps change the same file, the last one to write it wins. Your Space doesn't merge them.

## Removing apps and deleting knowledge bases

Removing an app, and deleting its data, never deletes a knowledge base: its files stay for the other
apps, and for the app if you install it again and give it the knowledge base.

To delete a knowledge base, choose **Delete** on the Knowledge page. Your Space asks first and names
the apps that use it. Deleting it takes it from those apps, which restart without its folder, then
deletes its files. A stopped app that has it, or whose containers still mount it, is started
without it, as Docker keeps a knowledge base any container mounts. An app you asked to remove,
whose removal didn't finish, is removed instead of restarted. This can't be undone.

If an app can't restart without the knowledge base, Your Space keeps the knowledge base and its
files, the app keeps it too, and the message names the app. Fix the app, then delete the knowledge
base again. If Your Space stops during a deletion, the knowledge base and its files stay, and the
running apps it was taken from restart without its folder once Your Space is back, or are removed if
you asked to remove them; delete it again. A stopped app keeps the folder until it next starts, or
until you delete the knowledge base again, which starts it without the folder.

Knowledge bases are Docker volumes named `ys-knowledge.<installation>.<name>`, labelled
`ai.your-space.role=knowledge`. `docker compose down -v` of Your Space doesn't delete them, as it
doesn't delete apps' volumes. Deleting a synced knowledge base deletes its sync too; the Drive folder
keeps its files.

## Sync with Google Drive

A knowledge base can be kept in two-way sync with a folder in Google Drive. The operator sets up the
Google connection once, with an OAuth client of their own: see
[Sync knowledge bases with Google Drive](../operate/google-drive.md). Then open a knowledge base on
the **Knowledge** page, paste the link of a Drive folder under **Google Drive**, and choose
**Connect**. The first sync copies both ways and deletes nothing; after it, Your Space syncs about
once a minute and when you choose **Sync now**. Apps keep reading and writing the local copy, so they
work offline too, and can't tell a synced knowledge base from a local one. A sync covers only the
chosen folder: shortcuts in it, and Google Docs, Sheets and Slides, stay in Drive only.

The knowledge base's page shows:

- When it last synced, and the Drive folder it syncs with.
- **Conflict copies:** files changed on both sides between two syncs. The copy here kept the file's
  name, and Drive's copy is beside it with `.conflict` and a number at the end. Keep what you want
  and delete the other copy.
- **Replaced files:** files a sync replaced or deleted here, kept for 30 days outside the knowledge
  base.
- Why a sync stopped, when it did, with **Resync**, which copies both ways and deletes nothing, and,
  after more than half of the files were deleted on one side, the deletions (the first 500 by name,
  and how many more) and **Apply these deletions**. Where both sides changed a file, Resync keeps
  the newer copy rather than both: a copy it replaced here is under **Replaced files**, and one it
  replaced in Drive is in the file's version history there.
- **Reconnect**, when Google refused Your Space's access.
- **Disconnect**, which stops the sync. The knowledge base and the Drive folder both keep their
  files, but the replaced files Your Space kept go with the sync: copy any you need first (see
  [How it runs](../operate/google-drive.md#how-it-runs)).

## For app developers

Declare knowledge access in the app's kit:

```yaml
interface: { service: web, port: 8080 }
knowledge: { path: /knowledge }   # path is optional; /knowledge is the default
```

Your Space mounts each knowledge base the owner gives the app at `<path>/<name>` in its interface
service. The app finds them by listing `<path>`. The path must be absolute, isn't `/`, and names no
`..`. It is at most 8 folders deep, each 1 to 64 letters, digits, dots, dashes and underscores,
starting with a letter, digit or underscore. The app's own file can't mount anything at or inside it. See the
[kit format](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/contracts/kit-format.md).

