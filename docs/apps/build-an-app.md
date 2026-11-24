---
title: "Build a dashboard app"
---

An agent with an authorized shell can make an ordinary web app, install it and let its owner choose it as Home. Start with a working workspace and the Your Space CLI. See [agent setup](../install/agent-setup.md) for the one-command installation.

```sh
your-space app new morning-board
# Edit morning-board/index.html
your-space app pack morning-board
your-space --workdir ./workspace app install-local morning-board
```

Open **Home settings**, choose Morning Board, select the apps and read roles it can use, and save. Open Home. The starter lists the available reads and renders the selected result. Edit the HTML to give the data the presentation you want. The built-in Home and its settings remain accessible outside the app frame.

The starter has three files. `index.html` holds the interface. `kit.yaml` is the app's kit: it identifies the app and its web service. `app pack` embeds that HTML in the generated `compose.yaml` so a new commit can deploy without a separate image build. To share it on GitHub, commit `index.html` and `compose.yaml`, then add a `source` to `kit.yaml` that names `compose.yaml` and that commit, and commit the kit. Others install it from the GitHub link to its `kit.yaml`, and Your Space reads `compose.yaml` at exactly that commit. An app with a backend can bring its own Compose file and published images, with a kit that names them.

## Read another app from Home

The parent sends `{type:"your-space:home:ready",version:1}` to the selected frame at its exact origin. In the child, check that `event.source === window.parent`, remember that sender origin, then use the same origin as the target of each message. Each request carries a unique `requestId` and `version:1`. Check the parent window, origin, version and matching request ID when receiving a reply.

| Request type | Fields | Success result |
| --- | --- | --- |
| `your-space:home:actions` | Common fields | `{actions:[…]}` with installation ID, app name, action ID and declared inputs |
| `your-space:home:read` | Common fields plus `installationId`, `actionId`, `input` | The authorized route's bounded result |

Replies have type `your-space:home:result`, the matching request ID and either `ok:true,result` or `ok:false,error`. See the generated `index.html` for a complete example. The server uses the current owner selection, installation identities and read grants for every call. App credentials stay on the server. Routes requiring approval remain available through the separate agent approval flow.

## Replace the installed version

Create or import the app repository in **Repositories** and edit its source. To update the starter, pull the latest commit into a local copy of the repository, run `your-space app pack <folder>` on the folder that holds its `index.html`, and commit the regenerated `compose.yaml`, for example by pushing it with git or pasting it into the repository's file editor; Repositories can't repack it. For an app with a custom image, build that image using its existing project workflow and reference the resulting digest in Compose. Choose **Update installed app**, select the installation, review the exact commit and image digests, and apply. See [managed repositories](managed-repositories.md).
