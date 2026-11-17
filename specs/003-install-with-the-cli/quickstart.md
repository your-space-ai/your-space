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

To run it by hand once a release exists:

```bash
npx your-space init
```

```bash
npx your-space start
```
