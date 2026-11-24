---
title: "Download and run Your Space on a Mac"
---

The first tagged desktop release is in preparation. For the current source preview, [build the Mac launcher from source](#build-from-source). Once disk images are published, use the steps below.

1. Open [Your Space Releases](https://github.com/your-space-ai/your-space/releases) and choose the disk image for your Mac. In **Apple menu → About This Mac**, look for **Chip** (Apple Silicon) or **Processor** (Intel).

   | Mac | Download |
   | --- | --- |
   | Apple Silicon | `your-space-macos-arm64-<version>.dmg` |
   | Intel | `your-space-macos-x64-<version>.dmg` |

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

From a source checkout, run `node cli/dist/your-space.cjs` in the repository root in place of the app's CLI. Then open the new address with **Connect to a server**.

Choose **Connect to a server** to use an existing workspace without installing Docker on this Mac. Enter the HTTPS address supplied by its operator and sign in as usual. In either workspace, review and confirm an app's installation kit in the dashboard. The selected server runs the app. The [CLI and headless installation guide](index.md) covers server setup, owner recovery and proxies.

Closing the window keeps Your Space in the Dock and the local workspace running; click the Dock icon to show it again. Quitting the app with **Your Space › Quit Your Space** (⌘Q) stops the local workspace and its apps, keeping their data, and opening the app starts them again. If it can't stop them within 2 minutes, the app quits anyway and tells you they may still be running. A workspace you open with **Connect to a server** keeps running when you quit.

The app updates itself from [Your Space Releases](https://github.com/your-space-ai/your-space/releases). Choose **Your Space › Check for Updates…** at any time. It also checks shortly after it opens and then once a day; **Your Space › Check for Updates Automatically** turns that off, and then the app makes no request you didn't ask for. A newer version downloads and installs only when you agree, and restarting stops the local workspace, updates the app, then starts the workspace again on the new version. An alpha is also offered later alphas and betas, and a beta later betas. The first time the workspace starts after an update, the app brings the local workspace to the app's version with its CLI's `upgrade` command.

The CLI inside each app is the one the app uses for local setup; for a standalone CLI on a Mac, use the npm package. See the [distribution notices](https://github.com/your-space-ai/your-space/blob/main/desktop/THIRD-PARTY.md) for pinned upstream artifacts and source.

## Build from source

On the target Mac, use a clean checkout with Node 26 and npm, and a running Docker-compatible engine. **Connect to a server** works with the launcher alone. **Run on this Mac** also needs the Your Space server, web and runtime images in the engine the launcher uses, tagged with the exact version of the launcher's CLI. Until those images are published, build them yourself; without them it stops with "The local workspace could not start."

1. In the repository root, run the first block of [Test from reviewed source](agent-setup.md#test-from-reviewed-source), with the same Docker engine. It runs `npm ci`, builds the CLI, sets `cli_version` to the CLI's version, and builds and tags the three images with it. Stop before that page's `setup` step: there is one Your Space per Docker engine, so a workspace set up there would stop the launcher from setting up its own.
2. In the same shell, either package the launcher or run it from the checkout.
   - To package it, run `desktop/scripts/package-macos.sh "$cli_version" /tmp/your-space-build`. It bundles the CLI and Compose files from the same checkout, stamped with that version, and writes `your-space-macos-<arch>-<version>-preview.zip`. Extract it and open the app. It has an ad-hoc signature for development and may be blocked by Gatekeeper if downloaded. Follow the download steps above only for a notarized release.
   - To run it from the checkout, run `deploy/release-files.sh "$cli_version" desktop/dist/release`, then in `desktop/dist/release` run `shasum -a 256 your-space.tar.gz > SHA256SUMS`. Back in the repository root, start the launcher with `npm start -w desktop`. Set `YS_DESKTOP_RELEASE_DIR` to an absolute directory if the matching files are elsewhere.

Signing, notarization and the checks for a release candidate are in the [release guide](../maintainers/releasing.md#sign-the-mac-app).
