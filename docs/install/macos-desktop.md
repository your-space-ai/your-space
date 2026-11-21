# Download and run Your Space on a Mac

1. Open [Your Space Releases](https://github.com/your-space-ai/your-space/releases) and choose the disk image for your Mac. In **Apple menu → About This Mac**, look for **Chip** (Apple Silicon) or **Processor** (Intel).

   | Mac | Download |
   | --- | --- |
   | Apple Silicon | `your-space-macos-arm64-<version>.dmg` |
   | Intel | `your-space-macos-x64-<version>.dmg` |

2. Open the downloaded DMG in Finder. Drag **Your Space** onto the **Applications** shortcut in the same window.
3. Wait for the copy to finish, eject **Your Space** from the Finder sidebar, then open **Your Space** from **Applications**.

The public release includes a matching `.dmg.sha256` file for each image. To verify a download, save both files in the same folder and run `shasum -a 256 -c <filename>.dmg.sha256` there. The bundled CLI requires macOS 13.5 or later. The release notes list the macOS versions tested.

Choose **local setup** to run the server on this Mac. Set up or start a Docker-compatible engine and Docker Compose if prompted, or select a different local engine. Complete owner setup, then open the workspace dashboard. While the Mac is asleep or off, its workspace is unavailable to other devices and agents. Owners who choose Docker Desktop should check its [installation and licensing terms](https://docs.docker.com/desktop/setup/install/mac-install/).

Choose **connect to a server** to use an existing workspace without installing Docker on this Mac. Enter the HTTPS address supplied by its operator and sign in as usual. In either workspace, review and confirm an app's installation kit in the dashboard. The selected server runs the app. The [CLI and headless installation guide](README.md) covers server setup, owner recovery and proxies.

## Build and verify a private candidate

On the target Mac, from a clean checkout with Node 26 and npm installed, run `npm ci` and then `desktop/scripts/package-macos.sh 0.1.0 /tmp/your-space-build`, substituting the candidate version. A native build uses the existing CLI and Compose files from the same checkout. A local workspace also needs Your Space images of that exact version available to its Docker engine. The resulting `-preview.zip` has an ad-hoc signature for development. It may be blocked by Gatekeeper if downloaded. Follow the public-download flow above only for a notarized release.

The packager puts the launcher in `Contents/Resources/app.asar` and records its SHA-256 header digest in the app’s signed property list. Electron requires this archive and checks its integrity. The build disables Electron’s RunAsNode mode, Node environment options and Node inspector command-line switches. After extracting a candidate, run `node desktop/scripts/seal-macos.mjs verify "/path/to/Your Space.app"` from the same checkout to verify the five fuses, the header digest and each bundled launcher file. The packaged native smoke opens a test workspace through the browser debugging protocol on loopback.

For a source run, first build the CLI with `npm run build -w cli`, then run `deploy/release-files.sh 0.1.0 desktop/dist/release` with the same version. In that folder run `shasum -a 256 your-space.tar.gz > SHA256SUMS`. Start the launcher with `npm start -w desktop`. Set `YS_DESKTOP_RELEASE_DIR` to an absolute directory if the matching files are elsewhere.

The macOS desktop workflow builds an Apple Silicon and an Intel candidate. Private previews are short-lived `-preview.zip` artifacts. To exercise installation on the target architecture, extract the preview app, run `desktop/scripts/create-dmg.sh "/path/to/Your Space.app" candidate.dmg`, then run `desktop/scripts/test-dmg-install.sh candidate.dmg arm64` (or `x64`). The install test uses a disposable destination and launches the copy after ejecting the image.

A published project release triggers signing after its matching server images and install files are available. The protected `macos-release` environment uses a dedicated macOS runner labelled `your-space-release-signing`. Configure its pre-authorized Developer ID Application identity and notarytool keychain profile through `MACOS_SIGN_IDENTITY` and `MACOS_NOTARY_PROFILE` in GitHub environment variables. Restrict the runner group to the reviewed release workflow on protected release refs.

The release job signs the app and its nested code with Developer ID and hardened runtime, then notarizes and staples the app. It packages the stapled app and an Applications shortcut in a read-only DMG, signs the image, and submits the image to Apple for notarization. After stapling and assessing the final image and checking the app it contains, the workflow attaches both DMGs and their SHA-256 files to the GitHub release. See the [distribution notices](../../desktop/THIRD-PARTY.md) for pinned upstream artifacts and source.
