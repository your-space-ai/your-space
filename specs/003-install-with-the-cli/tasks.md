# Tasks: Install and Run With the CLI

The pull requests follow the slices in the [spec](spec.md#slices-and-their-dependencies). A task is
checked when a pull request in the stack builds it and passes its tests; nothing is delivered until
it merges.

## Base: spec and plan

- [x] T001 Spec, plan, research, command contract and these tasks
- [x] T002 Decision record, roadmap, spec map and overview; constitution 1.4.1

## Slice 1: Init and start on this machine

- [x] T003 `cli/` workspace: Commander program, Clack output, `--json`, exit statuses (`cli/src/index.ts`, `cli/src/ui.ts`)
- [x] T004 Installation folder, `.env` editing and setups (`cli/src/installation.ts`, `cli/src/env-file.ts`, `cli/src/setup.ts`)
- [x] T005 Release download, checksum and unpack (`cli/src/release.ts`); `deploy/release-files.sh` shared with the release workflow
- [x] T006 Engine connection and Compose checks (`cli/src/engine.ts`, `cli/src/compose.ts`)
- [x] T007 Port check and offer of another port (`cli/src/checks.ts`)
- [x] T008 Server `show-owner` command (`server/src/commands/show-owner.ts`)
- [x] T009 `init` and `start` with owner creation, the summary and opening the link
- [x] T010 Bundle, standalone executable, `.deb` and `.rpm`, npm package (`cli/scripts/`, `.github/workflows/images.yml`)
- [x] T011 Browser test: CLI from a local release to signed in (`e2e/tests/cli.spec.ts`)

## Slice 2: Run it

- [x] T012 `stop`, `status`, `logs`; apps in the summary
- [x] T013 Browser test: stop and start with an app

## Slice 3: Recover the owner and manage secrets

- [x] T014 `owner create`, `owner reset-link`
- [x] T015 `secrets show`, `secrets replace`, `start --new-secrets`
- [x] T016 Browser test: reset link, replace both secrets, lost secrets

## Slice 4: Your own domain

- [x] T017 DNS checks, certificate wait and Caddy's log in plain words
- [x] T018 `configure`
- [x] T019 Browser test: a domain with HTTPS from Pebble (`e2e/pebble/`)
- [ ] T020 A real domain with Let's Encrypt (release gate, on a real server)

## Slice 5: Your own proxy or tunnel

- [x] T021 Names to forward in the summary
- [x] T022 Browser test: behind a proxy, with an app's name listed

## Slice 6: Another engine, and a folder set up by hand

- [x] T023 Engine endpoint and `YS_ENGINE_SOCKET`; remote engines refused; one installation per engine
- [x] T024 Browser test: a non-default Docker context, and a folder installed by hand

## Slice 7: The guide

- [x] T025 Installation guide: the CLI first, manual Compose as the advanced option
- [x] T026 Browser test follows the guide's CLI commands

## Slice 8: Upgrade (added 2026-11-23)

- [x] T028 `upgrade`: version order, release check, image download, database backup, file swap and start (`cli/src/commands/upgrade.ts`, `cli/src/version.ts`)
- [x] T029 Rollback: previous files and `.env` back, the backup restored when the new version migrated, the previous version started
- [x] T030 Server refuses a database a newer version migrated (`server/src/migrate.ts`), and `start` explains it
- [x] T031 Browser test: an earlier release installed by hand; a failed upgrade put back; a stopped installation whose new version migrated and failed, restored from its backup; then an upgrade with its owner, data and app (`e2e/tests/cli-upgrade.spec.ts`)
- [x] T032 Contract, guide (`docs/operate/index.md`), decision record and roadmap

## Later

- [ ] T027 macOS executables, Homebrew formula and `your-space-ai/homebrew-tap`, checks on a real Mac (macOS and Windows pass)
