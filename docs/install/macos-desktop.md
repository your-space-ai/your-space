# Download and run Your Space on a Mac

The first tagged desktop release is in preparation. For the current source preview, [build the Mac launcher](#build-and-verify-a-private-candidate). Once disk images are published, use the steps below.

1. Open [Your Space Releases](https://github.com/your-space-ai/your-space/releases) and choose the disk image for your Mac. In **Apple menu → About This Mac**, look for **Chip** (Apple Silicon) or **Processor** (Intel).

   | Mac | Download |
   | --- | --- |
   | Apple Silicon | `your-space-macos-arm64-<version>.dmg` |
   | Intel | `your-space-macos-x64-<version>.dmg` |

2. Open the downloaded DMG in Finder. Drag **Your Space** onto the **Applications** shortcut in the same window.
3. Wait for the copy to finish, eject **Your Space** from the Finder sidebar, then open **Your Space** from **Applications**.

The public release includes a single `SHA256SUMS` manifest. To verify a download, save both files in the same folder and run `grep -F "  <filename>.dmg" SHA256SUMS | shasum -a 256 -c -` there. The bundled CLI requires macOS 13.5 or later. The release notes list the macOS versions tested.

Choose **local setup** to run the server on this Mac. Set up or start a Docker-compatible engine and Docker Compose if prompted, or select a different local engine. Complete owner setup, then open the workspace dashboard. While the Mac is asleep or off, its workspace is unavailable to other devices and agents. Owners who choose Docker Desktop should check its [installation and licensing terms](https://docs.docker.com/desktop/setup/install/mac-install/).

Choose **connect to a server** to use an existing workspace without installing Docker on this Mac. Enter the HTTPS address supplied by its operator and sign in as usual. In either workspace, review and confirm an app's installation kit in the dashboard. The selected server runs the app. The [CLI and headless installation guide](README.md) covers server setup, owner recovery and proxies.

## Build and verify a private candidate

On the target Mac, from a clean checkout with Node 26 and npm installed, run `npm ci` and then `desktop/scripts/package-macos.sh 0.1.0 /tmp/your-space-build`, substituting the candidate version. A native build uses the existing CLI and Compose files from the same checkout. A local workspace also needs Your Space images of that exact version available to its Docker engine. The resulting `-preview.zip` has an ad-hoc signature for development. It may be blocked by Gatekeeper if downloaded. Follow the public-download flow above only for a notarized release.

The packager puts the launcher in `Contents/Resources/app.asar` and records its SHA-256 header digest in the app’s signed property list. Electron requires this archive and checks its integrity. The build disables Electron’s RunAsNode mode, Node environment options and Node inspector command-line switches. After extracting a candidate, run `node desktop/scripts/seal-macos.mjs verify "/path/to/Your Space.app"` from the same checkout to verify the five fuses, the header digest and each bundled launcher file. The packaged native smoke opens a test workspace through the browser debugging protocol on loopback.

For a source run, first build the CLI with `npm run build -w cli`, then run `deploy/release-files.sh 0.1.0 desktop/dist/release` with the same version. In that folder run `shasum -a 256 your-space.tar.gz > SHA256SUMS`. Start the launcher with `npm start -w desktop`. Set `YS_DESKTOP_RELEASE_DIR` to an absolute directory if the matching files are elsewhere.

The **Build macOS app** workflow builds an Apple Silicon and an Intel candidate on pull requests that touch the desktop app. Private previews are short-lived `-preview.zip` artifacts. To exercise installation on the target architecture, extract the preview app, run `desktop/scripts/create-dmg.sh "/path/to/Your Space.app" candidate.dmg`, then run `desktop/scripts/test-dmg-install.sh candidate.dmg arm64` (or `x64`). The install test uses a disposable destination and launches the copy after ejecting the image.

A maintainer starts the **Release draft** workflow on main before publication; see the [release guide](../maintainers/releasing.md). Signing runs on a GitHub-hosted macOS runner, never on a maintainer's machine, in a job bound to the protected `macos-release` environment. Only Release draft reaches it, and nothing in the signing workflow runs on pull requests, so code from a fork never sees its secrets. The environment holds five secrets:

| Secret | Contents |
| --- | --- |
| `MACOS_CERT_P12_BASE64` | The Developer ID Application certificate and its private key, as a base64-encoded `.p12` |
| `MACOS_CERT_PASSWORD` | The `.p12` export password |
| `APPLE_API_KEY_P8_BASE64` | An App Store Connect Team API key with the Developer role, as a base64-encoded `.p8` |
| `APPLE_API_KEY_ID` | That key's ID |
| `APPLE_API_ISSUER` | Its issuer ID |

Protect the environment with the owner as required reviewer and deployments limited to `main`, and store the secrets on the environment only, not on the repository. The job imports the certificate into a temporary keychain with a random password, decodes the API key to the runner's temporary folder, and deletes both when it ends, whether it succeeds or not.

If a secret leaks, revoke what it exposes and replace every secret that belongs to it. For the certificate, ask Apple to revoke it by emailing product-security@apple.com (Developer ID certificates can't be revoked from the developer account), create a new Developer ID Application certificate, and replace `MACOS_CERT_P12_BASE64` and `MACOS_CERT_PASSWORD`. Revoking it means DMGs signed with it can no longer be installed, and copies already installed may stop opening. Recover by publishing a new release, signed and notarized with the new certificate, with its own `SHA256SUMS`; remove the old DMGs from earlier releases, and tell people to download and reinstall the new version. For the API key, revoke it in App Store Connect under Users and Access › Integrations, create a new one, and replace `APPLE_API_KEY_P8_BASE64` and `APPLE_API_KEY_ID`; `APPLE_API_ISSUER` stays the same.

The release job signs the app and its nested code with Developer ID and hardened runtime, then notarizes and staples the app. It packages the stapled app and an Applications shortcut in a read-only DMG, signs the image, and submits the image to Apple for notarization. After stapling and assessing the final image and checking the app it contains, the workflow attaches both DMGs to the draft release. The CLI inside each app is the one the app uses for local setup; for a standalone CLI on a Mac, use the npm package. See the [distribution notices](../../desktop/THIRD-PARTY.md) for pinned upstream artifacts and source.
