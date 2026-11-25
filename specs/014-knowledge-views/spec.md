# 014 · Let my apps learn from my files

An owner connects a knowledge source, such as Google Drive, once. They define views over it that
each cover only the folders they choose. An installed app that asks for knowledge access gets the
views the owner grants it, and reads their files through the Your Space SDK. The app never holds
the source's credential and never sees files outside its views.

**Status: draft, 2026-11-24.** Decisions below were made with the owner on that date. Open questions
are listed at the end.

## Owner journey

1. In **Settings › Connections**, add Google Drive. Your Space shows the redirect URI to register.
   Create an OAuth client in your own Google Cloud project, paste its client ID and secret, and sign
   in with the Google account whose files you want to use.
2. In **Knowledge**, create a view: give it a name, such as "Course notes", and pick one or more
   folders from the connected Drive. Create as many views as you like over the same connection.
3. Install an app whose kit declares knowledge access. The install review says the app wants to read
   from your knowledge and lets you pick one or more views to grant. You can grant none.
4. Open the app. It lists and reads files from the views you granted, and nothing else.
5. On the app's page, add or remove views at any time. Removing a view, deleting it or disconnecting
   Drive stops the app's access on its next request.

## App developer journey

1. Declare knowledge access in the kit:

   ```yaml
   knowledge: { purpose: Study from your notes }
   ```

   That is all the kit says. Your Space wires the app to its knowledge API itself; the kit names no
   token, URL or environment variable.
2. Use the SDK:

   ```ts
   import { yourSpace } from "@your-space-ai/sdk";

   const views = await yourSpace.knowledge.views();
   // [{ id, name: "Course notes", files: { list(), read(fileId) } }]
   const files = await views[0].files.list();
   const text = await views[0].files.read(files[0].id);
   ```

   The SDK finds Your Space and the app's credential on its own when the app runs as an installed
   app. Outside Your Space, it says so clearly instead of failing obscurely.

## Decisions (2026-11-24)

- **Installed apps first.** v1 serves apps Your Space installs from a kit. External apps, and Your
  Space acting as an OpenID Connect provider ("Sign in with Your Space") for them, come later.
- **OAuth only, operator's own client.** Each operator registers their own Google OAuth client.
  This is accepted, unavoidable setup; it lets Your Space read with full read access without Google's
  app verification. The setup guide tells operators to set the OAuth app to *In production*
  (unverified): an app left in *Testing* gets refresh tokens that expire after seven days.
- **Views are the boundary.** The connection has broad read access; an app never gets the
  connection, only views. Your Space enforces a view's folders on every request.
- **Raw files first, layers later.** v1 lists and reads files. Search, summaries and other functions
  come later as further layers on the same views and the same grant, so the SDK gains methods
  without new permissions or a new install review.
- **Read-only in v1.** Writing to a source is later direction.
- **Transparent wiring.** The kit only declares knowledge access; the owner picks views at install;
  the SDK returns the granted views.

## Layers

| Layer | What | v1 |
| --- | --- | --- |
| Connection | A source account; its credential stays in Your Space, encrypted (journey 009) | Google Drive |
| View | A named set of folders in one connection | Yes |
| Files | List, read (Google Docs, Sheets and Slides exported to text formats), changes since | List, read |
| Functions | Search, summaries and more over a view | Later |

## Behavior and boundaries

- **Folder enforcement.** A file belongs to a view when any of its parent chains reaches one of the
  view's folders. Your Space checks this on every read, not only when the view is granted, so moving
  a folder or file out of a view takes effect at once. A shortcut resolves to its target and the
  target must be in the view too. A folder in a shared drive records its drive, and queries include
  shared drives.
- **Credentials.** The Google token never leaves the server. Each installation has its own
  credential for the knowledge API, scoped to its granted views, revocable from the app's page and
  rotated when the app is reinstalled.
- **Reaching Your Space.** An installed app reaches the knowledge API over Your Space's internal
  network, without an egress approval. Other installations can't use its credential.
- **Activity.** Each list and read is recorded against the installation that made it.
- **Failure.** When Google revokes the token or the client secret changes, the connection shows as
  disconnected with a reconnect action, and apps get a clear "knowledge source unavailable" error.
- **Concepts, not technologies.** Google Drive is one adapter behind a knowledge-source concept, so
  other sources (local folders, Notion, Dropbox) fit the same views and API.

## Acceptance

- Connect Drive with an operator-registered client in *In production* status. Restart Your Space and
  confirm the connection still works after the access token's expiry.
- Create two views over different folders. Install a fixture app granted only the first. Verify it
  lists and reads files in the first view, including a nested file and a Google Doc, and gets a not
  found error for a file ID from the second view, a file outside both, and a shortcut pointing
  outside the view.
- Move a file out of the view's folder in Drive and verify the next read is refused.
- Remove the grant and verify the app's next request fails. Disconnect Drive and verify the error the
  app sees.
- Verify one installation's credential is refused for another installation's views.
- Verify the kit format refuses unknown knowledge fields, and that an app without the declaration
  gets no credential.

## Delivery slices

Each slice is one reviewable PR with an owner-visible result checked in a browser. Each needs only
the slices before it.

1. **Knowledge-source concept and Drive connection.** Settings › Connections adds Google Drive with
   the operator's client, stores the token encrypted and refreshes it. Result: the owner connects
   Drive, sees it connected after a restart, and sees it marked disconnected after revoking access
   in Google.
2. **Views.** Create, rename and delete views by picking folders from the connected Drive. Result:
   the owner creates a view and sees its folders and file count.
3. **Kit declaration and grants.** The kit's `knowledge` field, the install review's view picker and
   the app page's grant editor, with a per-installation credential. Result: installing a fixture
   kit shows the picker, and the app page lists the granted views.
4. **Knowledge API and folder enforcement.** List and read for granted views, with every boundary
   rule above and an activity record per request. Result: the fixture app lists and reads a granted
   view, and is refused outside it.
5. **TypeScript SDK.** `knowledge.views()`, `files.list()` and `files.read()`, finding Your Space
   inside an installed app. Result: a sample app built on the SDK shows a view's files in its pane.

## Open questions

- Which SDK packages ship first: TypeScript only, or TypeScript and Python together (decisions.md
  requires both before publication).
- How the SDK finds Your Space inside an app's containers (an injected variable the kit never sees,
  a fixed internal name, or a mounted file), and how it behaves in local development outside Your
  Space.
- Whether read returns text only, or also the original bytes (PDFs, images).
- Per-file size limits and pagination for large folders.
- Whether views are shown to agents too (journey 005), through the same grants.
- Where the "AI resources" direction (the owner's models and keys offered to apps) fits, which the
  search layer will need.
