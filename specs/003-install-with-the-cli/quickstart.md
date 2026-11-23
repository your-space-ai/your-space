# Quickstart: Install and Run With the CLI

Try the CLI from this repository against locally built images, as the browser test does.

```bash
npm ci && npm run build --workspace cli
```

```bash
npx playwright test tests/cli.spec.ts --project chromium
```

Run the second command in `e2e/`. It builds the images, makes a release from `deploy/`, serves it
locally, and runs `init`, `start`, `status`, `stop` and the rest in a temporary folder.

To run the source preview by hand, follow [operator setup from reviewed source](../../docs/install/agent-setup.md#test-from-reviewed-source).
When a tagged release includes the CLI and matching images, [install the CLI for that release](../../docs/install/index.md#1-get-the-your-space-command), then run these commands in an empty folder:

```bash
your-space init
your-space start
```
