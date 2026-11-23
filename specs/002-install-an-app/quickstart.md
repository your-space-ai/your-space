# Quickstart: Install an App and Use It

Follow [Try Your Space from source](../../docs/install/from-source.md) to build the fixture workspace, sign in, and install **Who Am I**.

## Check the install journey

1. Open **Who Am I** and inspect the headers it echoes. Its host is `whoami.space.localhost` with the demo port, and the request carries none of Your Space's session or app-pass cookies.
2. In **Apps**, review and install the probe app from its kit's link, `https://github.com/ys-fixtures/catalog/blob/main/apps/ys-fixtures/probe.yaml`. Open both apps side by side. The [browser tests](../../e2e/tests/apps.spec.ts) exercise the probe's network access and verify that the two apps stay isolated.

## Run the browser tests

Use a disposable Docker engine for the suite. It resets its `ys-e2e` workspace and creates app containers with the example names. From the repository root, use Node.js 26 and install the dependencies and browsers. On Linux, Playwright may need system packages (`npx playwright install --with-deps`).

```sh
npm ci
cd e2e
npx playwright install
npx playwright test tests/apps.spec.ts
```

Before running the tests, make sure the Node.js process can resolve `space.localhost`, `app.space.localhost`, `whoami.space.localhost`, and `probe.space.localhost` to `127.0.0.1`. The [CircleCI configuration](../../.circleci/config.yml) shows the hosts entry. The suite uses port 80 by default, or the port set in `YS_PORT`.
