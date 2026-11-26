---
title: "Download and run Your Space on a Mac"
---

Your Space 0.1.0-alpha.1 is an alpha, for trying Your Space out. Read the [alpha limits](index.md#alpha-limits) first.

1. Open the [0.1.0-alpha.1 release](https://github.com/your-space-ai/your-space/releases/tag/v0.1.0-alpha.1) and choose the disk image for your Mac. In **Apple menu → About This Mac**, look for **Chip** (Apple Silicon) or **Processor** (Intel).

   | Mac | Download |
   | --- | --- |
   | Apple Silicon | `your-space-macos-arm64-0.1.0-alpha.1.dmg` |
   | Intel | `your-space-macos-x64-0.1.0-alpha.1.dmg` |

2. Open the downloaded DMG in Finder. Drag **Your Space** onto the **Applications** shortcut in the same window.
3. Wait for the copy to finish, eject **Your Space** from the Finder sidebar, then open **Your Space** from **Applications**.

The public release includes a single `SHA256SUMS` manifest. To verify a download, save both files in the same folder and run `grep -F "  <filename>.dmg" SHA256SUMS | shasum -a 256 -c -` there. The bundled CLI requires macOS 13.5 or later. The release notes list the macOS versions tested.

Choose **Run on this Mac** to run the server on this Mac. Set up or start a Docker-compatible engine and Docker Compose if prompted, or select a different local engine. Select **Open local workspace**, complete owner setup, then open the workspace dashboard. The launcher sets up the workspace at `http://space.localhost:8081`, which only this Mac can reach, and it is unavailable while the Mac is asleep or off. Owners who choose Docker Desktop should check its [installation and licensing terms](https://docs.docker.com/desktop/setup/install/mac-install/).

To use that workspace from other devices, give it an HTTPS address with `your-space configure`, as [Use Your Space from other devices](other-devices.md) describes. Run it against the launcher's installation folder, `~/Library/Application Support/ai.your-space.desktop/local`, and the engine the launcher uses: the `socket` value in that folder's `.desktop-engine.json`. For example, with the app in Applications:

```sh
env -u DOCKER_CONTEXT DOCKER_HOST="unix://<socket>" \
  "/Applications/Your Space.app/Contents/Resources/bin/your-space" configure \
  --workdir "$HOME/Library/Application Support/ai.your-space.desktop/local"
```

From a source checkout, run `node cli/dist/your-space.cjs` in the repository root in place of the app's CLI. Then open the new address with **Add a server**, as [Saved connections](#saved-connections) describes.

Choose **Connect to a server**, or **Add a server** once the launcher lists your connections, to use an existing workspace without installing Docker on this Mac. Enter the HTTPS address supplied by its operator and sign in as usual. In either workspace, review and confirm an app's installation kit in the dashboard. The selected server runs the app. The [CLI and headless installation guide](index.md) covers server setup, owner recovery and proxies.

Closing a workspace's window keeps Your Space in the Dock and the local workspace running; click the Dock icon to show the window you used last again. Quitting the app with **Your Space › Quit Your Space** (⌘Q) stops the local workspace and its apps, keeping their data. Opening **This Mac** starts them again, which the app does as it opens when This Mac is the workspace you used last. If it can't stop them within 2 minutes, the app quits anyway and tells you they may still be running. A workspace on a server keeps running when you quit.

The app updates itself from [Your Space Releases](https://github.com/your-space-ai/your-space/releases), from the feed of its update channel. Choose **Your Space › Check for Updates…** at any time. It also checks shortly after it opens and then once a day; **Your Space › Check for Updates Automatically** turns that off, and then the app makes no request you didn't ask for. A newer version downloads only when you agree. **Restart Now** stops the local workspace, updates the app, then opens the workspace you used last; if that is This Mac, the local workspace starts again on the new version. **Later** installs it when you quit. While macOS checks the update before installing it, which takes a few seconds, the Dock icon shows a progress bar. The first time the workspace starts after an update, the app brings the local workspace to the app's version with its CLI's `upgrade` command. If that upgrade fails, the app says whether it put the previous version back, and then tries again the next time it starts the workspace, or stopped for you to finish by hand, as [Update Your Space](../operate/index.md#update-your-space) describes. A workspace newer than the app doesn't start until the app's channel has a build at least that new.

**Your Space › Update Channel** chooses the builds the app is offered, from 0.1.0-alpha.2: **Alpha**, the published releases, or **Canary**, a daily build of the newest code, which [Run the canary build](canary.md#the-mac-app) describes. Canaries aren't supported and may change your data in ways the next alpha doesn't expect, so the app asks first. The channel is kept in `updates.json` in `~/Library/Application Support/ai.your-space.desktop`, and updates keep it. With none stored yet, in a new installation or one updated from 0.1.0-alpha.1, the app stores its own build's channel the first time it starts, Alpha for a release and Canary for a canary; after that only you change it. If `updates.json` can't be read, the app leaves it as it is and follows Alpha until you choose a setting again. The app is offered only its channel's builds, and only ones newer than itself. Changing the channel drops an update found or downloaded from the other channel, which then isn't installed, not even when you quit. Once you choose **Restart Now**, the channel can't change until the app has restarted, unless macOS refuses the update. To leave Canary, choose Alpha: the app stays on its canary, says "You'll move to Alpha with the next alpha", and moves to the first alpha newer than it. If the channel's feed can't be read, **Check for Updates…** says the app couldn't check, and offers nothing.

The CLI inside each app is the one the app uses for local setup; for a standalone CLI on a Mac, use the npm package. See the [distribution notices](https://github.com/your-space-ai/your-space/blob/main/desktop/THIRD-PARTY.md) for pinned upstream artifacts and source.

## Saved connections

Each workspace you open is saved as a connection, a name and an address, and the app opens the connection you used last when it starts. With at least one saved, the launcher shows the list as **Open a connection**: choose a row to open that workspace. **Add a server** opens the address form, which also takes an optional name; without one, the list shows the server's host name. **This Mac** is the connection to the workspace the app runs on this Mac, and its row says **Running** while it runs. **Run on this Mac** stays below the list until This Mac is in it.

Each connection opens in its own window, and several can be open at once. The **Connections** menu lists the saved connections in order, the first nine with ⌘1 to ⌘9, with a check next to the one in front. Choosing one shows its window, or opens it. **Connections › Add a server…** opens the address form, and **Connections › Manage connections…** (⇧⌘O) shows the list.

To rename a connection or remove it, use the **⋯** button on its row in the list. Removing only takes it off the list: its server, apps and data stay as they are, and removing This Mac doesn't stop or uninstall the workspace on this Mac. **Run on this Mac** or **Add a server** brings it back.

The list is kept in `connections.json` in `~/Library/Application Support/ai.your-space.desktop`. If the app finds that file damaged, it renames it to `connections.json.corrupt-` followed by the time, and starts a new list.

A saved connection is a name and an address, nothing more. The app doesn't open SSH sessions, VPNs or tunnels; reaching a server is up to your network. If you can reach a computer only over SSH and Your Space there answers at `http://space.localhost:<port>`, forward that same port on this Mac to it yourself with `ssh -N -L <port>:localhost:<port> <computer>`, keep it running, and add `http://space.localhost:<port>`. The port on this Mac has to match: Your Space there accepts only requests that name its own address, and its apps' addresses carry the same port, so the one forward reaches them too. Pick a port that is free on this Mac; This Mac's own workspace uses 8081. If Your Space on that computer has no port in its address, give it one first by running `your-space configure --workdir <folder> --this-machine --port <port>` there.

## Logs and recovery

To check on the local workspace or recover it, run the bundled CLI against the launcher's installation folder and engine, as for `configure` above. For example, to see what is running and its address:

```sh
env -u DOCKER_CONTEXT DOCKER_HOST="unix://<socket>" \
  "/Applications/Your Space.app/Contents/Resources/bin/your-space" status \
  --workdir "$HOME/Library/Application Support/ai.your-space.desktop/local"
```

Put another command in place of `status`:

| To | Command |
| --- | --- |
| Read the server's logs | `logs server`, or `logs` for every service |
| Get a new set-password link | `owner reset-link` |

A set-password link works once, for 30 minutes. Open it in a browser on this Mac, choose your password, then sign in in the app.

## Remove Your Space from a Mac

There is no uninstall yet. If you only use **Connect to a server**, removing the app leaves that server's workspace and apps as they are: quit the app, move it to the Trash and delete `~/Library/Application Support/ai.your-space.desktop`, and the folders whose names start with `ai.your-space.desktop` in `~/Library/Caches`, where updates are downloaded.

To also remove the workspace this Mac runs, with its apps and their data:

1. Open **This Mac** in the app, which starts the local workspace again if you quit the app. In that local workspace, select **Remove app**, then **Delete data**, for each app in **Apps**. Do this only in the workspace this Mac runs, at `http://space.localhost:8081` or the address you gave it with `configure`: in a workspace on a server, it would delete that server's apps.
2. Quit the app, which stops the local workspace. Opening the app again would start it if This Mac was the workspace you used last.
3. In Terminal, run `unset DOCKER_CONTEXT` and `export DOCKER_HOST="unix://<socket>"`, then follow the rest of [Remove Your Space](../operate/index.md#remove-your-space) in the installation folder above, in the same window.
4. Move the app to the Trash, and delete `~/Library/Application Support/ai.your-space.desktop` and the folders whose names start with `ai.your-space.desktop` in `~/Library/Caches`.

## Build from source

On the target Mac, use a clean checkout with Node 26 and npm, and a running Docker-compatible engine. **Connect to a server** works with the launcher alone. **Run on this Mac** also needs the Your Space server, web and runtime images in the engine the launcher uses, tagged with the exact version of the launcher's CLI. Published images exist only for released versions, so build them yourself for your checkout; without them it stops with "The local workspace could not start."

1. In the repository root, run the first block of [Test from reviewed source](agent-setup.md#test-from-reviewed-source), with the same Docker engine. It runs `npm ci`, builds the CLI, sets `cli_version` to the CLI's version, and builds and tags the three images with it. Stop before that page's `setup` step: there is one Your Space per Docker engine, so a workspace set up there would stop the launcher from setting up its own.
2. In the same shell, either package the launcher or run it from the checkout.
   - To package it, run `desktop/scripts/package-macos.sh "$cli_version" /tmp/your-space-build`. It bundles the CLI and Compose files from the same checkout, stamped with that version, and writes `your-space-macos-<arch>-<version>-preview.zip`. Extract it and open the app. It has an ad-hoc signature for development and may be blocked by Gatekeeper if downloaded. Follow the download steps above only for a notarized release.
   - To run it from the checkout, run `deploy/release-files.sh "$cli_version" desktop/dist/release`, then in `desktop/dist/release` run `shasum -a 256 your-space.tar.gz > SHA256SUMS`. Back in the repository root, start the launcher with `npm start -w desktop`. Set `YS_DESKTOP_RELEASE_DIR` to an absolute directory if the matching files are elsewhere.

Signing, notarization and the checks for a release candidate are in the [release guide](../maintainers/releasing.md#sign-the-mac-app).
