---
title: "Prepare a versioned release"
---

## What a release ships

| File or package | Platforms | Published to | For |
| --- | --- | --- | --- |
| Server, web and runtime images, tagged with the version | Linux AMD64 and ARM64 | GHCR | Every installation |
| `your-space.tar.gz`, the Compose bundle | Any | GitHub release | `your-space init` and manual installs |
| `your-space-ai-cli-<version>.tgz`, the CLI npm package `@your-space-ai/cli` | Any machine with Node 22.12 or newer | npm, and the same file on the GitHub release | Mac and Linux users with Node, and agents |
| `your-space-linux-x64`, `your-space-linux-arm64`, the standalone CLI | Linux Intel/AMD and ARM64 | GitHub release | Servers without Node |
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
| [Release publish](https://github.com/your-space-ai/your-space/blob/main/.github/workflows/release-publish.yml) | When the draft is published, publishes the npm package and moves the images' `latest` tag |

## Release steps

1. **Merge to main** once CI is green.
2. **Tag the tip of main** with its version (for example `v0.1.0`) and push the tag. The tag must still point to the tip of main when the draft workflow starts.
3. **Run Release draft** on main with that tag. It verifies the tag, pushes the versioned images, builds the CLI files, installs a fresh workspace from them on Linux x64 and ARM64 and resumes it, signs and notarizes both DMGs, and creates a draft GitHub release with the six files and `SHA256SUMS`. Only the versioned images are public at this point; configure their GHCR packages for public pulls. A failed run creates no draft; if an upload leaves a partial draft, inspect it before deleting it and retrying.
4. **Review the draft** against the checks below. Mark preview versions as prereleases.
5. **Publish the draft.** Publishing runs Release publish, which checks the npm tarball against `SHA256SUMS`, publishes that exact file to npm (`next` for prereleases, otherwise `latest`) and points the images' `latest` tag at the version (not for prereleases). It needs the `NPM_TOKEN` repository secret. An npm version can never be reused, so publishing is one-way.
6. **Check the result from a clean machine:** install with `npx @your-space-ai/cli@<version>`, with a Linux executable and with a DMG, and confirm each reports the version.

Signing needs the protected `macos-release` environment and its five secrets, described in the [desktop guide](../install/macos-desktop.md#build-and-verify-a-private-candidate). The environment requires the owner's approval and only accepts deployments from `main`, so a draft waits for that approval before it signs.

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

- Run the automated build and behavior checks for the candidate. Review security boundaries for setup, recovery, app isolation and credentials. Check the default network exposure, outbound requests, update opt-out, dependencies and images. Inspect the distributable files and logs for secrets or private data.
- Test and document supported upgrades and rollback with existing data, including what to preserve before a migration. Check that the installation, recovery and troubleshooting instructions match the tested paths.
- Confirm distribution rights and notices for the code, binaries, images and other assets that ship. Review the [desktop notices](https://github.com/your-space-ai/your-space/blob/main/desktop/THIRD-PARTY.md) and [license and trademark decision](../architecture/decisions.md#project-license-and-business-model), including the legal review for the packaged release.
- Give the owner the candidate reference, checks performed, open blockers and limitations for a release decision. With approval, publish the reviewed draft. [Release draft](https://github.com/your-space-ai/your-space/blob/main/.github/workflows/release-draft.yml) prepares the draft before publication. Verify that GitHub Releases serves the matching install files, DMGs and checksums, and that npm serves the matching package. Record the release URL, tested versions and unsupported configurations in the release notes.

The Linux rehearsal uses Docker’s [setup-docker-action v5.7.0](https://github.com/docker/setup-docker-action/tree/3f1ab1ab0e29231562e4db4ca600c1a49653bac6) (Apache-2.0) to provide Docker Engine 29.10.0 on disposable hosted runners. This keeps the install test above the product’s minimum supported engine version.
