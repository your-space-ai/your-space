# Prepare a versioned release

Choose a reviewed commit on main with passing CI. Tag it with its version (for example, `v0.1.0`) and push the tag. Run **Prepare draft release** on main with that tag. The workflow verifies that the tag resolves to the selected commit. It pushes versioned server, runtime and web images to GHCR for Linux AMD64 and ARM64. Configure those packages for public pulls.

The protected macOS signing runner requires an approved Developer ID Application identity, a notarytool profile, and the `macos-release` environment variables described in the [desktop guide](../install/macos-desktop.md). Limit the signing environment and runner group to the reviewed workflow on main.

The workflow checks the two DMGs, notarizes the standalone Mac CLIs, checks both Linux binaries into the checksum manifest, and uses the x64 download and Compose bundle to start a clean workspace. It then creates a GitHub draft containing seven payloads and SHA256SUMS. Inspect the asset list and release notes, including architecture instructions and OS requirements. Mark preview versions as prereleases. Publish the draft after review. A failed build does not publish a GitHub release. If an upload leaves a partial draft, inspect it before removing it and retrying.
