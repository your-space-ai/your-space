# Tasks: Install an App and Use It

The pull requests follow the slices in the [spec](spec.md#slices-and-their-dependencies). A task is
checked when a pull request in the stack builds it and passes its tests; nothing is delivered until
it merges.

## Slice 1: Run an app from a link

- [x] T001 Runtime manager service with no network, on a Unix socket (`runtime/`, `deploy/stack.yaml`)
- [x] T002 Docker adapter: resolve with Compose, allowlist, adapted file (`runtime/src/adapter.ts`)
- [x] T003 Image pinning by digest without downloading; processor check (`runtime/src/engine.ts`)
- [x] T004 App records and migration (`server/src/db/schema.ts`, `server/drizzle/0002_apps.sql`)
- [x] T005 GitHub link to file at commit (`server/src/apps/github.ts`)
- [x] T006 `install-app` and `list-apps` commands with `--json`
- [x] T007 Reconcile at start and every 15 seconds; interrupted jobs end as failed
- [x] T008 `stop-apps`; restarts leave apps running
- [x] T009 GitHub stand-in and fixture apps for tests (`e2e/github`)

## Slice 2: Run Sure

- [x] T010 Installation kits: format, strict parsing, kits repository lookup (`server/src/apps/kits.ts`)
- [x] T011 Generated, derived and kit-set settings, encrypted at rest (`server/src/apps/settings.ts`)
- [x] T012 Sure installed from its own file with its kit (research R3)
- [x] T013 Publish Sure's and Twenty's kits in a separate repository

## Slice 3: Apps in Your Space

- [x] T014 Owner-only apps API (`server/src/apps/routes.ts`)
- [x] T015 Install jobs with progress
- [x] T016 Apps page: list, review with trust warning, install progress, kept data (`web/src/pages/Apps.tsx`)
- [x] T017 Engine page (`web/src/pages/Engine.tsx`)

## Slice 4: Open an app

- [x] T018 `space.localhost` as the local address; `localhost` redirects
- [x] T019 Caddy app sites, gate, handoff and pass; cookie and framing rules (`deploy/Caddyfile`, `server/src/apps/gate.ts`)
- [x] T020 Session cookies: `__Host-` over HTTPS, host-only on local HTTP
- [x] T021 Pane view and own-tab fallback when a browser blocks the pane's cookies
- [ ] T022 Check Safari on macOS with `*.localhost`

## Slice 5: Settings

- [x] T023 Settings on the app's page; saving restarts the app

## Slice 6: Outbound access

- [x] T024 Per-app egress proxy with health check and recreation on change
- [x] T025 Access requests from denials; approve, dismiss, remove

## Slice 7: Isolation, tested

- [x] T026 Isolation probes in the browser journey

## Slice 8: Limits, status and logs

- [x] T027 Limits per service, kit overrides, owner changes; apps stopped first when memory runs out
- [x] T028 Service states and logs under Advanced

## Slice 9: Remove and delete data

- [x] T029 Remove keeps data and settings; reinstall offers reuse; delete data confirmed

## Slice 10: A second app, side by side

- [x] T030 Twenty installed beside Sure (research R3)
- [x] T031 Two panes on large screens; one on a phone with the menu

## Across slices

- [x] T032 Install guide: apps, addresses, stop command, engine socket (`docs/install/README.md`)
- [x] T033 Decision record, roadmap, spec map, architecture overview and constitution 1.4.0
- [ ] T034 Fetch a real file from GitHub from the server container (this environment's containers have no internet)
- [ ] T035 Tailscale Services for apps (replaced 2026-11-19: on Tailscale, the owner publishes an app on a
  port and creates its Tailscale Service; see the decision record's "Running Apps and Reaching Them")
