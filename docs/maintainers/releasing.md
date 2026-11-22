# Prepare a versioned release

Choose a reviewed commit on main with passing CI. Tag it with its version (for example, `v0.1.0`) and push the tag. Run **Prepare draft release** on main with that tag. The workflow verifies that the tag resolves to the selected commit. It pushes versioned server, runtime and web images to GHCR for Linux AMD64 and ARM64. Configure those packages for public pulls.

The protected macOS signing runner requires an approved Developer ID Application identity, a notarytool profile, and the `macos-release` environment variables described in the [desktop guide](../install/macos-desktop.md). Limit the signing environment and runner group to the reviewed workflow on main.

The workflow checks the two DMGs, notarizes the standalone Mac CLIs, checks both Linux binaries into the checksum manifest, and uses each native Linux download and the Compose bundle to start a clean workspace. It then creates a GitHub draft containing seven payloads and SHA256SUMS. Inspect the asset list and release notes, including architecture instructions and OS requirements. Mark preview versions as prereleases. Publish the draft after review. A failed build does not publish a GitHub release. If an upload leaves a partial draft, inspect it before removing it and retrying.

## Install the candidate

- Follow the [headless installation guide](../install/README.md) on a local machine and a server. Check that the CLI and Compose files select the matching images. Exercise the images on ARM64 and AMD64. Claim the workspace, sign in, restart with storage retained and recover the owner. Open the dashboard on localhost, behind an existing proxy and at a domain with a real certificate.
- Follow the [Mac installation guide](../install/macos-desktop.md) on Apple Silicon and Intel hardware. For each DMG, verify its checksum, the Developer ID signatures, stapled notarization and Gatekeeper assessments for the image and app. Drag the app into Applications in Finder, eject the image, then launch the installed copy and verify its CLI.
- Try the detected Docker engine, an owner-selected alternative and recovery from a missing or stopped engine. On a Mac without Docker, sign in to an existing HTTPS workspace. From each desktop path, apply a kit and open the installed app. Keep the [private preview results](../../specs/008-desktop-entry/verification.md) identifiable by their tested version and hardware.

## Exercise the owner journeys

- Install an independent app from its real source. Review the pinned images and kit revision, confirm installation and verify app limits, network isolation and persistent storage. Follow the [app installation acceptance checks](../../specs/002-install-an-app/tasks.md).
- Grant an external agent kit-defined roles. Use synthetic data to list, create and edit a recurring record through the gateway. Check approval, attribution and the upstream result. Try an ungranted action, change the role, rotate the credential and revoke access. Follow the [agent access specification](../../specs/005-owner-agent/spec.md).
- Run [agent-led setup](../install/agent-setup.md) and install an [agent-built Home](../apps/build-an-app.md) with owner-selected reads. Use a disposable GitHub account to exercise public and authorized private sources, a direct kit URL, and a fork with an edit. Confirm the exact commit and storage changes before replacement. Verify retained data and denied access after revocation. Follow the [managed repository guide](../apps/managed-repositories.md).
- Exercise the [roadmap’s appearance and layout journeys](../roadmap.md#dashboard-and-desktop). Test keyboard navigation, focus, labels and error recovery during setup and in the dashboard at the screen sizes claimed for release.

## Review and publish

- Run the automated build and behavior checks for the candidate. Review security boundaries for setup, recovery, app isolation and credentials. Check the default network exposure, outbound requests, update opt-out, dependencies and images. Inspect the distributable files and logs for secrets or private data.
- Test and document supported upgrades and rollback with existing data, including what to preserve before a migration. Check that the installation, recovery and troubleshooting instructions match the tested paths.
- Confirm distribution rights and notices for the code, binaries, images and other assets that ship. Review the [desktop notices](../../desktop/THIRD-PARTY.md) and [license and trademark decision](../architecture/decisions.md#project-license-and-business-model), including the legal review for the packaged release.
- Give the owner the candidate reference, checks performed, open blockers and limitations for a release decision. With approval, publish a GitHub Release for the reviewed tag. The [image and install-file workflow](../../.github/workflows/images.yml) and [Mac distribution workflow](../../.github/workflows/macos-desktop.yml) prepare the draft before publication. Verify that GitHub Releases serves the matching install files, DMGs and checksums. Record the release URL, tested versions and unsupported configurations in the release notes.
