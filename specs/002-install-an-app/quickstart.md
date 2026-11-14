# Quickstart: Install an App and Use It

Try the journey on a development machine, with a stand-in for GitHub that serves fixture apps.

```bash
docker compose -p ys-e2e --env-file e2e/stack.env -f deploy/compose.yaml -f deploy/compose.build.yaml -f e2e/compose.e2e.yaml up -d --build --wait
```

```bash
docker compose -p ys-e2e --env-file e2e/stack.env -f deploy/compose.yaml -f deploy/compose.build.yaml -f e2e/compose.e2e.yaml exec server create-owner --username you --name "You"
```

1. Open the printed link, set a password, and sign in at `http://space.localhost`.
2. In Apps, paste `https://github.com/ys-fixtures/whoami/blob/main/compose.yaml`, choose Review,
   then Install. The stand-in serves it with its installation kit.
3. Open it: `whoami` shows the request it received, at `http://whoami.space.localhost`, with none of
   Your Space's cookies.
4. Install `https://github.com/ys-fixtures/probe/blob/main/compose.yaml` too, open both side by side,
   and try the probes in `e2e/tests/apps.spec.ts` against its container.

To run a real app, put its Compose file and a kit under `e2e/github/fixtures/<owner>/<repo>/` and
`e2e/github/fixtures/your-space-ai/your-space-app-kits/apps/<owner>/<repo>.yaml`, as research R3 did for
Sure and Twenty; with internet access, use the real link instead.

The browser journey:

```bash
npx playwright test tests/apps.spec.ts
```

Run it from `e2e/`. Add the test names to `/etc/hosts` first (see `.circleci/config.yml`), because
Node doesn't resolve `*.localhost`.
