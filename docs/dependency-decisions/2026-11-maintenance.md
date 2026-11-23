# November dependency maintenance

The npm lockfile records the registry tarball and integrity digest for each package. These updates retain the existing package roles and licenses.

| Package | Version | Use | License |
| --- | --- | --- | --- |
| better-auth and its matching auth schema CLI | 1.7.27 | Server and web authentication, development schema generation | MIT |
| @tanstack/react-query | 5.108.2 | Web data access | MIT |
| vite | 8.3.8 | Web build | MIT |
| vitest | 5.1.1 | Workspace tests | MIT |
| @playwright/test | 1.65.1 | Browser tests | Apache-2.0 |
| @argos-ci/playwright | 7.10.0 | Existing visual test integration | MIT |
| esbuild | 0.28.2 | Override the vulnerable compiler under Drizzle Kit's legacy loader | MIT |
| express-rate-limit | 8.7.5 | Bound requests at the private app access gate before querying the database | MIT |

The rate limiter uses its in-process store on the workspace's single server. It requires no external service. Its ip-address dependency groups IPv6 clients. Both packages ship their MIT notices in the server installation. Build and test tools retain their upstream licenses. The exact GitHub Actions revisions are pinned beside their release versions in each workflow. The actions maintained by GitHub use MIT and those maintained by Docker use Apache-2.0.

The scheduled image scan uses Aqua Security's Apache-2.0 Trivy 0.76.2 and trivy-action 0.36.0 to inspect local images. GitHub's MIT codeql-action 4.39.4 sends the SARIF findings to this repository's security dashboard. These tools run only in CI. They do not publish images or require a new hosted service.

The scan reports only findings with a fix available, so the dashboard lists what can be acted on; an unfixed finding returns once its distribution or module ships a fix. Upstream Go binaries are checked with `govulncheck -mode=binary`, which looks at the code a binary can reach rather than its module versions alone. Findings it shows are never reached are listed with their reasons and an expiry date in `.trivyignore.yaml`: gosu in the official PostgreSQL image, and Docker Compose's HTML parser in the runtime image.

The web image builds Caddy 2.11.9 from its Apache-2.0 source with the official `caddy:2.11-builder` toolchain, raising golang.org/x/net (BSD-3-Clause) to 0.62.0 and github.com/klauspost/compress (BSD-3-Clause and Apache-2.0) to 1.20.2. Caddy's own release reaches vulnerabilities fixed in those versions and in the newer Go standard library. The build uses Caddy's standard modules only, the same set the official image lists, and keeps the image's file capability. Remove that build stage once a `caddy:2.11` release includes the fixes.
