# Tasks: Encrypt Your Space's Stored Data

One pull request, the last in journey 003's stack. A task is checked when that pull request builds it
and passes its tests; nothing is delivered until it merges.

- [x] T001 Spec and plan; decision record
- [x] T002 The data key in the secrets step, with `--new data-key` and `--forget previous-data-key` (`server/src/secrets.ts`, `server/src/commands/secrets-step.ts`)
- [x] T003 The data key in the server's configuration (`server/src/config.ts`)
- [x] T004 Apps' settings encrypted with the data key; the move at start (`server/src/apps/settings.ts`, `server/src/apps/keys.ts`, `server/src/index.ts`)
- [x] T005 A clear message for an app whose settings no key can read (`server/src/apps/service.ts`)
- [x] T006 `your-space secrets replace data-key` (`cli/`)
- [x] T007 The guide: three secrets, "What Your Space Encrypts", replacing and losing the data key
- [x] T008 Tests: server unit tests and the CLI's browser test
