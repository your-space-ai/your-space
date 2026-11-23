# Resizable app panes

We use react-resizable-panels 4.24.1 to give nested horizontal and vertical groups pointer, touch and keyboard resizing. The existing two-column CSS grid has a fixed divider. Maintaining custom drag and keyboard behavior in every arrangement would duplicate the library.

The web client bundles the unmodified MIT library. It uses the React packages the client already ships, adds no runtime dependencies and uses no hosted service. The release is pinned in the npm lockfile. We preserve the complete copyright, permission and warranty notice in the web distribution at `/licenses/react-resizable-panels.txt`. The MIT terms permit use, distribution, modification and commercial hosting with the notice retained. Recheck the license, bundled contents, dependency graph and input behavior when upgrading.

[Upstream release source](https://github.com/bvaughn/react-resizable-panels/tree/85a6dfb626fae5e35f7748093dd76b4503fe7c05) · [npm release archive](https://registry.npmjs.org/react-resizable-panels/-/react-resizable-panels-4.24.1.tgz) · [Shipped license](https://github.com/your-space-ai/your-space/blob/main/web/public/licenses/react-resizable-panels.txt)

Verified npm archive integrity: `sha512-K2xXKRXGyIxKipmDV2Zuj6UAJQNWWbKNmkIf/hZU6/3NGTNoiQz5Zc2oBWBk3MFgqf8QoqCEIqZCPrkZmRa/hg==`.
