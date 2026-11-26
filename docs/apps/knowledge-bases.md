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
kept. If that restart fails, the app keeps the knowledge bases you took away, as it still has their
folders, and its page still lists them; save again once the app starts.

Each knowledge base is its own folder under the app's knowledge path, `/knowledge` unless the kit
names another, even when the app has only one. An app given one knowledge base doesn't see the
others.

## Files and users

Your Space mounts a knowledge base read-write in every app given it. What an app can do with each
file there depends on the file's permissions and the user the app runs as. A new knowledge base's
folder belongs to user and group 1000, is writable by everyone, and gives new files its group, so
apps running as different users can all create files there. An app running as another user than
1000 may not be able to change a file another user wrote; most self-hosted images run as user 1000.

When two apps change the same file, the last one to write it wins. Your Space doesn't merge them.

## Removing apps and deleting knowledge bases

Removing an app, and deleting its data, never deletes a knowledge base: its files stay for the other
apps, and for the app if you install it again and give it the knowledge base.

To delete a knowledge base, choose **Delete** on the Knowledge page. Your Space asks first and names
the apps that use it. Deleting it takes it from those apps, which restart without its folder, then
deletes its files. An app you asked to remove, whose removal didn't finish, is removed instead of
restarted. This can't be undone.

If an app can't restart without the knowledge base, Your Space keeps the knowledge base and its
files, the app keeps it too, and the message names the app. Fix the app, then delete the knowledge
base again.

Knowledge bases are Docker volumes named `ys-knowledge.<installation>.<name>`, labelled
`ai.your-space.role=knowledge`. `docker compose down -v` of Your Space doesn't delete them, as it
doesn't delete apps' volumes.

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

Keeping a knowledge base in sync with a Google Drive folder is
[planned](../roadmap.md#knowledge-bases).
