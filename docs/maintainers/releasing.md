---
title: "Prepare a versioned release"
---

## What a release ships

| File or package | Platforms | Published to | For |
| --- | --- | --- | --- |
| Server, web and runtime images, tagged with the version | Linux AMD64 and ARM64 | GHCR | Every installation |
| `your-space.tar.gz`, the Compose bundle | Any | GitHub release | `your-space init` and manual installs |
| `your-space-ai-cli-<version>.tgz`, the CLI npm package `@your-space-ai/cli`, with its README and the project's license | Any machine with Node 22.12 or newer | npm, and the same file on the GitHub release | Mac and Linux users with Node, and agents |
| `your-space-linux-x64`, `your-space-linux-arm64`, the standalone CLI | Linux Intel/AMD and ARM64 | GitHub release | Servers without Node |
| `your-space-linux-licenses.txt`, the licenses of Your Space and of the Node runtime and JavaScript packages inside the standalone CLI | Any | GitHub release | Anyone redistributing or reviewing the standalone CLI |
| `your-space-macos-arm64-<version>.dmg`, `your-space-macos-x64-<version>.dmg`, signed and notarized, with the CLI inside | macOS Apple Silicon and Intel | GitHub release | Mac users |
| `SHA256SUMS` | — | GitHub release | Checking any download |

Not shipped: `.deb` and `.rpm` packages, standalone macOS CLI downloads, Homebrew, the Linux desktop app and Windows. Add a new download as a new file; keep existing file names, the npm package name `@your-space-ai/cli` (published by the `your-space-ai` npm organization; the command it installs is `your-space`), the image names and the `SHA256SUMS` format stable, because install guides, scripts and the CLI depend on them.

Each piece has its own workflow:

| Workflow | What it does |
| --- | --- |
| [Release draft](https://github.com/your-space-ai/your-space/blob/main/.github/workflows/release-draft.yml) | Checks the tag, runs the workflows below and creates the draft release with `SHA256SUMS` |
| [Release images](https://github.com/your-space-ai/your-space/blob/main/.github/workflows/release-images.yml) | Builds and pushes the versioned images to GHCR |
| [Release CLI](https://github.com/your-space-ai/your-space/blob/main/.github/workflows/release-cli.yml) | Builds the npm package, the Linux executables and the Compose bundle |
| [Release macOS app](https://github.com/your-space-ai/your-space/blob/main/.github/workflows/release-macos-app.yml) | Calls Build macOS app, then signs and notarizes both DMGs on a GitHub-hosted runner in the protected `macos-release` environment |
| [Build macOS app](https://github.com/your-space-ai/your-space/blob/main/.github/workflows/macos-app-build.yml) | Builds and install-tests both DMGs without signing; also runs on pull requests that touch the desktop app |
| [Release install test](https://github.com/your-space-ai/your-space/blob/main/.github/workflows/release-install-test.yml) | Installs from the built files on fresh Linux x64 and ARM64 runners and installs the npm package |
| [Release publish](https://github.com/your-space-ai/your-space/blob/main/.github/workflows/release-publish.yml) | When the draft is published, installs from the public release without credentials, then publishes the npm package and moves the images' `latest` tag |

## Release steps

1. **Merge to main** once CI is green.
2. **Tag the tip of main** with its version (for example `v0.1.0`) and push the tag. The tag must still point to the tip of main when the draft workflow starts.
3. **Run Release draft** on main with that tag once every check on that commit has passed, including the ones that run only after the merge: CircleCI's browser tests in Chromium, Firefox and WebKit, and its Arm tests. Release draft refuses to start until every commit status and check run on the tagged commit has passed, and lists the ones that haven't. Skipped and neutral check runs count as passed, as they do for required checks; its own runs, including an earlier failed one, are left out. It then verifies the tag, pushes the versioned images, builds the CLI files, installs a fresh workspace from them on Linux x64 and ARM64 and resumes it, signs and notarizes both DMGs, opens each notarized app on a Mac of its architecture, and creates a draft GitHub release with the seven files and `SHA256SUMS`. The versioned images are on GHCR at this point; if their packages aren't public yet, make the `your-space-server`, `your-space-web` and `your-space-runtime` packages public in each package's settings. Release publish checks this before npm. A failed run creates no draft; if an upload leaves a partial draft, inspect it before deleting it and retrying.
4. **Review the draft** against the checks below. Mark preview versions as prereleases.
5. **Publish the draft.** Publishing runs Release publish. It first installs from the published release as a stranger would, on fresh Linux x64 and ARM64 runners with no GHCR sign-in and no token: it downloads every file from the release's public links and checks it against `SHA256SUMS`, reads the three images for AMD64 and ARM64 without signing in, and sets up a workspace with the standalone executable, which downloads the Compose bundle and pulls the images itself. If an image package is still private, this fails with a message saying so; make the packages public and re-run the failed jobs. The release is already public by then, so if the check fails for any other reason, take it back to a draft with `gh release edit <tag> --draft` while you fix the cause. npm and `latest` haven't changed, so after fixing main you can delete the draft, move the tag and run Release draft again. Only when this check passes does Release publish check the npm tarball against `SHA256SUMS`, publish that exact file to npm (`next` for prereleases, otherwise `latest`) and point the images' `latest` tag at the version (not for prereleases). It needs the `NPM_TOKEN` repository secret. An npm version can never be reused, so publishing is one-way.
6. **Check the result from a clean machine:** install with `npx @your-space-ai/cli@<version>`, with a Linux executable and with a DMG, and confirm each reports the version.

## The unscoped your-space package

The npm name `your-space`, without a scope, holds a small package from [`npm/your-space`](https://github.com/your-space-ai/your-space/tree/main/npm/your-space), so nobody else can publish code that runs as `npx your-space`. Its `your-space` command runs nothing: it prints that Your Space is published by the [`your-space-ai` organization](https://www.npmjs.com/org/your-space-ai), the pinned `npx @your-space-ai/cli@<version>` install and a link to the installation guide, then exits with status 1. npm also refuses new names that differ from an existing one only in punctuation, such as `yourspace` and `your_space` ([npm's rule](https://blog.npmjs.org/post/168978377570/new-package-moniker-rules)).

The release workflows don't publish it: the repository's `NPM_TOKEN` only covers the `@your-space-ai` scope, and an unscoped name can't belong to it. A maintainer publishes it by hand from a checkout of main, signed in to npm on an account with two-factor authentication:

```sh
cd npm/your-space
npm whoami
npm pack --dry-run           # bin.js, LICENSE, README.md and package.json, nothing else
npm publish --access public
```

`npm pack` and `npm publish` first copy the project's license into the folder. The package doesn't depend on the CLI or its version, so it rarely needs republishing: only when its message, README or links change, after raising `version` in its `package.json`, since an npm version can never be reused. When the release workflows move from `NPM_TOKEN` to npm's trusted publishing, add a trusted publisher for this package too and publish it from a workflow instead of by hand.

## Sign the Mac app

Signing runs on a GitHub-hosted macOS runner, never on a maintainer's machine, in a job bound to the protected `macos-release` environment. Only Release draft reaches it, and nothing in the signing workflow runs on pull requests, so code from a fork never sees its secrets. The environment requires the owner's approval and only accepts deployments from `main`, so a draft waits for that approval before it signs. It holds five secrets:

| Secret | Contents |
| --- | --- |
| `MACOS_CERT_P12_BASE64` | The Developer ID Application certificate and its private key, as a base64-encoded `.p12` |
| `MACOS_CERT_PASSWORD` | The `.p12` export password |
| `APPLE_API_KEY_P8_BASE64` | An App Store Connect Team API key with the Developer role, as a base64-encoded `.p8` |
| `APPLE_API_KEY_ID` | That key's ID |
| `APPLE_API_ISSUER` | Its issuer ID |

Protect the environment with the owner as required reviewer and deployments limited to `main`, and store the secrets on the environment only, not on the repository. The job imports the certificate into a temporary keychain with a random password, decodes the API key to the runner's temporary folder, and deletes both when it ends, whether it succeeds or not.

If a secret leaks, revoke what it exposes and replace every secret that belongs to it. For the certificate, ask Apple to revoke it by emailing product-security@apple.com (Developer ID certificates can't be revoked from the developer account), create a new Developer ID Application certificate, and replace `MACOS_CERT_P12_BASE64` and `MACOS_CERT_PASSWORD`. Revoking it means DMGs signed with it can no longer be installed, and copies already installed may stop opening. Recover by publishing a new release, signed and notarized with the new certificate, with its own `SHA256SUMS`; remove the old DMGs from earlier releases, and tell people to download and reinstall the new version. For the API key, revoke it in App Store Connect under Users and Access › Integrations, create a new one, and replace `APPLE_API_KEY_P8_BASE64` and `APPLE_API_KEY_ID`; `APPLE_API_ISSUER` stays the same.

The release job signs the app and its nested code with Developer ID and hardened runtime. Before the first submission to Apple, it runs the app's CLI under that signature and checks the version it reports, on the runner's own Apple Silicon only, so a signature that stops the CLI from starting fails in minutes rather than after Apple's review. It runs a copy of the CLI as the unprivileged `nobody` user with an empty environment, so the CLI can't reach the job's keychain, API key or secrets; **Build macOS app** runs the same check on pull requests. It then notarizes and staples the app, packages the stapled app and an Applications shortcut in a read-only DMG, signs the image, and submits the image to Apple for notarization. After stapling and assessing the final image and checking the app it contains, a job without the signing secrets installs each DMG on a Mac of its architecture, Apple Silicon and Intel: the image and the installed app must pass Gatekeeper with their stapled tickets, the packaged native smoke test opens the app, and its CLI must report the version. The Intel CLI first runs under its release signature there, after notarization. If any of these checks fails, the run stops without a draft; otherwise the workflow attaches both DMGs to the draft release.

A new Apple team's first submissions can be held for review for hours or longer, so the signing job may run for six hours, GitHub's limit for a hosted job. If it times out or waits too long for the environment's approval, re-run the failed jobs: the unsigned DMGs it signs and the CLI files are kept for seven days, so a re-run within that time doesn't rebuild them. `xcrun notarytool history` lists the team's submissions and their status.

The packager puts the launcher in `Contents/Resources/app.asar` and records its SHA-256 header digest in the app’s signed property list. Electron requires this archive and checks its integrity. The build disables Electron’s RunAsNode mode, Node environment options and Node inspector command-line switches. After extracting a candidate built with the [Mac source steps](../install/macos-desktop.md#build-from-source), run `node desktop/scripts/seal-macos.mjs verify "/path/to/Your Space.app"` from the same checkout to verify the five fuses, the header digest and each bundled launcher file. The packaged native smoke opens a test workspace through the browser debugging protocol on loopback.

The **Build macOS app** workflow builds, packs and install-tests an Apple Silicon and an Intel candidate on pull requests that touch the desktop app or what it bundles; those runs keep no download. To exercise installation on the target architecture with a local candidate, extract the preview app, run `desktop/scripts/create-dmg.sh "/path/to/Your Space.app" candidate.dmg`, then run `desktop/scripts/test-dmg-install.sh candidate.dmg arm64` (or `x64`). The install test uses a disposable destination and launches the copy after ejecting the image. Add the version as a third argument to check the installed CLI reports it, and `--notarized` before the image to require Gatekeeper's approval of a released DMG.

## Install the candidate

- Follow the [headless installation guide](../install/index.md) on a local machine and a server. Check that the CLI and Compose files select the matching images. Exercise the images on ARM64 and AMD64. Claim the workspace, sign in, restart with storage retained and recover the owner. Open the dashboard on localhost, behind an existing proxy and at a domain with a real certificate.
- Follow the [Mac installation guide](../install/macos-desktop.md) on Apple Silicon and Intel hardware. For each DMG, verify its checksum, the Developer ID signatures, stapled notarization and Gatekeeper assessments for the image and app. Drag the app into Applications in Finder, eject the image, then launch the installed copy and verify its CLI.
- Try the detected Docker engine, an owner-selected alternative and recovery from a missing or stopped engine. On a Mac without Docker, sign in to an existing HTTPS workspace. From each desktop path, apply a kit and open the installed app. Keep the [private preview results](https://github.com/your-space-ai/your-space/blob/main/specs/008-desktop-entry/verification.md) identifiable by their tested version and hardware.

## Exercise the owner journeys

- Install an independent app from its real source. Review the pinned images and kit revision, confirm installation and verify app limits, network isolation and persistent storage. Follow the [app installation acceptance checks](https://github.com/your-space-ai/your-space/blob/main/specs/002-install-an-app/tasks.md).
- Grant an external agent kit-defined roles. Use synthetic data to list, create and edit a recurring record through the gateway. Check approval, attribution and the upstream result. Try an ungranted action, change the role, rotate the credential and revoke access. Follow the [agent access specification](https://github.com/your-space-ai/your-space/blob/main/specs/005-owner-agent/spec.md).
- Run [agent-led setup](../install/agent-setup.md) and install an [agent-built Home](../apps/build-an-app.md) with owner-selected reads. Use a disposable GitHub account to exercise public and authorized private sources, a direct kit URL, and a fork with an edit. Confirm the exact commit and storage changes before replacement. Verify retained data and denied access after revocation. Follow the [managed repository guide](../apps/managed-repositories.md).
- Exercise the [roadmap’s appearance and layout journeys](../roadmap.md#dashboard-and-desktop). Test keyboard navigation, focus, labels and error recovery during setup and in the dashboard at the screen sizes claimed for release.

## Review and publish

- Run the automated build and behavior checks for the candidate. Review security boundaries for setup, recovery, app isolation and credentials. Check the default network exposure, outbound requests, dependencies and images. Inspect the distributable files and logs for secrets or private data.
- Test and document supported upgrades and rollback with existing data, including what to preserve before a migration. Check that the installation, recovery and troubleshooting instructions match the tested paths.
- Confirm distribution rights and notices for the code, binaries, images and other assets that ship. The npm package carries the project's license, `your-space-linux-licenses.txt` covers the Linux executables, the web image serves its bundled packages' licenses at `/licenses/THIRD-PARTY.md`, and the DMG has them in `Contents/Resources/licenses`. Review the [desktop notices](https://github.com/your-space-ai/your-space/blob/main/desktop/THIRD-PARTY.md) and [license and trademark decision](../architecture/decisions.md#project-license-and-business-model).
- Give the owner the candidate reference, checks performed, open blockers and limitations for a release decision. With approval, publish the reviewed draft. [Release draft](https://github.com/your-space-ai/your-space/blob/main/.github/workflows/release-draft.yml) prepares the draft before publication. Verify that GitHub Releases serves the matching install files, DMGs and checksums, and that npm serves the matching package. Record the release URL, tested versions and unsupported configurations in the release notes.

The Linux rehearsal uses Docker’s [setup-docker-action v5.7.0](https://github.com/docker/setup-docker-action/tree/3f1ab1ab0e29231562e4db4ca600c1a49653bac6) (Apache-2.0) to provide Docker Engine 29.10.0 on disposable hosted runners. This keeps the install test above the product’s minimum supported engine version.
