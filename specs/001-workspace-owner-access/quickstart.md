# Quickstart Validation: Workspace Setup and Owner Access

**Feature**: [001 Workspace Setup and Owner Access](spec.md) · **Plan**: [plan.md](plan.md)

This guide proves the feature works end to end on a real host. It is the manual check behind the
automated tests and the evidence for SC-010. Endpoint and command details are in
[contracts/](contracts/); the tables are in [data-model.md](data-model.md).

## Prerequisites

- A supported host from the [plan's support matrix](plan.md#technical-context) with Docker and
  Docker Compose v2.
- For the HTTPS scenario: a domain whose DNS points at the host, with inbound ports 80 and 443 open.
- A second device with a browser, for remote access.

## 1. Install and Create the Owner (Story 1)

```sh
mkdir your-space && cd your-space
curl -fsSL https://github.com/your-space-ai/your-space/releases/latest/download/your-space.tar.gz | tar -xz
cp env.example .env
# .env can stay as it is for this machine (http://localhost); the first start generates the secrets.
docker compose up -d
docker compose ps           # every service healthy
```

Expected:

- `http://localhost` (or your domain) says there is no owner yet and explains `create-owner`. It has
  no form.
- `docker compose exec server create-owner --email you@example.com --name "Sam Rivera"` prints a
  set-password link. With `--json`, it prints JSON, including the link and token, and exits 0.
- Opening the link and setting a password takes you to sign-in. After signing in, the home screen
  shows "&lt;name&gt;'s space", your name and email, and sign out, and nothing else.
- Running `create-owner` again exits 2 with `owner_exists`.

Negative checks:

- `POST /api/auth/sign-up/email` is refused before and after the owner exists.
- Opening the same link a second time fails.
- Killing `create-owner` partway, then rerunning it with the same email, gives one owner and one
  workspace.

## 2. HTTPS With a Domain (Story 1, scenario 9)

Add `YS_DOMAIN=space.example.com` to `.env` and run `docker compose up -d`.

Expected: Caddy obtains a certificate (see `docker compose logs caddy`), `https://space.example.com`
loads with a valid certificate, and `http://space.example.com` redirects to HTTPS. With DNS pointing
elsewhere, the Caddy log names the failure and nothing is served over plain HTTP. With
`YS_DOMAIN=192.168.1.20` or `YS_DOMAIN=myserver.tail1234.ts.net`, `docker compose up -d` fails, the
server log says what to write instead, and `docker compose ps` shows no published ports.

## 3. Sign In, Remote Access, Sign Out (Story 2)

- Sign out, then sign in with the wrong password (refused) and the right one (home screen).
- Open the HTTPS address on a second device and sign in: same workspace, nothing to set up.
- `curl -i https://space.example.com/api/auth/get-session` without a cookie returns no session.
- In browser dev tools, the session cookie has no `Domain` attribute (host-only) and is `Secure`.
- Copy the session cookie, sign out, then replay it with curl: no session.

## 4. Restart and Recreate (Story 3)

```sh
docker compose restart
docker compose down && docker compose up -d     # recreates containers, keeps volumes
```

Expected: after each, the same account and workspace IDs exist, an existing browser session still
works, and `create-owner` still reports `owner_exists`.

Storage failure: `docker compose stop postgres`, then load the app. It shows "storage unavailable",
not "no owner yet". `/api/status` returns 503. `create-owner` and `reset-link` exit 3. Start Postgres again and
everything returns unchanged.

Never run `docker compose down -v`: `-v` deletes the volumes and the workspace with them.

## 5. Recover the Owner (Story 4)

```sh
docker compose exec server reset-link
```

Expected: the printed link opens a "choose a new password" page. After saving, every other signed-in
device is signed out, the new password works, and the old one does not. Opening the same link
again fails. A link older than 30 minutes fails.

## 6. Cross-Cutting Checks

- `docker compose logs` contains no passwords, set-password or reset tokens, or session values.
- `docker compose exec postgres psql -U yourspace -c 'select type, actor_id from event'` shows
  `owner.created` and `recovery.*` rows pointing at actor IDs.
- On both an ARM host and an Intel/AMD host, `docker compose up` pulls native images and
  section 1 passes.
- With outbound traffic captured during sections 1, 3, and 5, the only outbound connections are
  Caddy's certificate requests for the configured domain.
- Upgrading to a build with a new migration keeps all records, and the new migration appears in
  `drizzle.__drizzle_migrations`.
