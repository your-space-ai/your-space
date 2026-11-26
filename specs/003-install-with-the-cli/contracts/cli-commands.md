# Contract: The `your-space` CLI

**Spec**: [spec.md](../spec.md) · **Plan**: [plan.md](../plan.md)

The desktop app (journey 008) and people's scripts drive these commands, so their options, JSON
output and exit statuses are a contract. Human output may change; JSON fields are only added,
except for a removal this contract records.

```text
your-space engine check
your-space init       [--require-project-check] [--release-dir <folder>] [--this-machine | --domain <name> | --proxy-url <url>] [--port <n>] [--yes]
your-space start      [--owner-name <name>] [--owner-username <username>]
                      [--require-project-check] [--defer-owner] [--no-open] [--ignore-checks] [--new-secrets] [--yes]
your-space stop       [--yes]
your-space status     [--require-running]
your-space logs       [<service>] [--follow] [--tail <n>]
your-space owner create      --name <name> --username <username>
your-space owner reset-link
your-space secrets show      [--reveal]
your-space secrets replace   <auth-secret | database-password> [--yes]
your-space configure  [--this-machine | --domain <name> | --proxy-url <url>] [--port <n>]
                      [--ignore-checks] [--yes]
your-space upgrade    [--release-dir <folder> | --channel <alpha | canary>] [--yes]
```

Every command also takes:

| Option | Meaning |
| --- | --- |
| `--workdir <folder>` | The installation's folder. Default: the current folder |
| `--json` | One JSON object on stdout for the result; questions are never asked, so each needs its flag |
| `--verbose` | Show Compose's and the engine's own output |
| `--version`, `--help` | The CLI's version, or help for a command |

`logs` streams Compose's own output and has no `--json`.

## Exit Statuses

They follow the [operator commands](../../001-workspace-owner-access/contracts/operator-commands.md).

| Status | Meaning |
| --- | --- |
| 0 | Done |
| 1 | Invalid usage or input: an unknown option, a missing answer without a terminal, a name that fails the account rules |
| 2 | The current state stops it: not an installation, a port in use, a check failed, a missing prerequisite, no owner yet, a secret set in `.env` |
| 3 | The engine, a download or the database couldn't be reached; nothing was changed by this step |
| 4 | Something unexpected went wrong; nothing was reported as done |

A person pressing Ctrl-C at a question ends the command with status 1 and changes nothing more.

## JSON

Success is `{"ok": true, ...}`; failure is
`{"ok": false, "error": "<code>", "message": "<what happened and what to do>"}`, with the output
Compose or the engine gave in `detail` when there was any.

| `error` | Status | When |
| --- | --- | --- |
| `usage` | 1 | Invalid options, or a question with no answer and no terminal (the message names the flag) |
| `invalid_input` | 1 | An answer that fails a rule: a domain, a proxy address, a port, an owner's name or username |
| `cancelled` | 1 | The person cancelled a question |
| `not_an_installation` | 2 | The folder has no Your Space files; run `init` |
| `already_initialised` | 2 | `init` in an installation; use `configure` |
| `folder_not_empty` | 2 | `init` in a folder with other files, without confirming |
| `another_installation` | 2 | The engine already runs Your Space from another folder, named in `folder` |
| `engine_missing` | 2 | No Docker CLI, or no engine running |
| `engine_unsupported` | 2 | The engine is too old, or on another machine |
| `compose_missing` | 2 | No Compose plugin, or one older than 2.26.0 |
| `permission_denied` | 2 | The person can't use the engine, or, for `upgrade` and the commands that hold `.your-space.lock`, can't write to the installation's folder; for `upgrade --channel`, also the build's CLI couldn't run from the temporary folder (`TMPDIR`). The message says how to fix it |
| `port_in_use` | 2 | A port the setup needs is taken; `port` and, when known, `by` |
| `check_failed` | 2 | A domain's names don't resolve; `checks` lists each result |
| `not_running` | 2 | The command needs Your Space running |
| `start_failed` | 2 | Compose couldn't start Your Space; `service` and the message from its log |
| `lost_secrets` | 2 | The secrets are gone but the database is kept; run `start --new-secrets` |
| `no_owner` | 2 | `owner reset-link` without an owner |
| `owner_exists` | 2 | `owner create` with an owner |
| `secret_in_env` | 2 | `secrets replace` for a secret set in `.env` |
| `download_failed` | 3 | A release file could not be downloaded or read from the selected release folder; for `upgrade --channel`, also the channel's `channel.json`, with `channel` |
| `checksum_mismatch` | 2 | The archive failed checksum verification or its packaged image version differs from the CLI version, as when the canary prerelease holds a newer canary build than the CLI's. For `upgrade --channel`: the channel's `channel.json` isn't in its form (with `channel`), or the build's CLI isn't listed in or doesn't match its release's `SHA256SUMS`, or isn't the version `channel.json` names |
| `downgrade_refused` | 2 | `upgrade` in an installation newer than the CLI; `from` and `to` name both versions |
| `version_unknown` | 2 | `upgrade` in an installation whose `stack.yaml` names no release version |
| `backup_failed` | 2 | `upgrade` couldn't back up the database; nothing was replaced, and Your Space is started again as before, or, when that fails too, `running: false` and the message says so |
| `installation_busy` | 2 | Another command that starts, stops, changes or upgrades the installation is running, named in `command`, as `pid`. `upgrade`, `start`, `stop`, `configure` and `secrets replace` each hold `.your-space.lock` in the folder while they run, so they never overlap. A lock whose process is gone is taken over. They need to write to the folder for it: in a folder the user can't write, they fail with `permission_denied` and don't run |
| `upgrade_interrupted` | 2 | An earlier `upgrade` was killed part way and left the previous release files in the `.upgrade-*` `folder`, or left `.upgrade-restore`: its files and database may not match. `upgrade`, `start` and `configure` refuse until a person has put the right files back or restored the backup, and deleted the marker |
| `engine_unreachable` | 3 | The engine stopped answering |
| `storage_unavailable` | 3 | The server couldn't read its database |
| `app_failed` | 2 | A server command exited 2 without a code of its own |
| `unexpected` | 4 | Anything else |

When `upgrade` fails after it replaced the release files and before the new server was ready, it
reports the failure's own code and status (such as `start_failed`), with `from`, `to`, `backup`,
`rolledBack` (the previous files are back) and `restored` (the database was restored from the
backup), with `keptDatabase` naming the database the new version left, kept beside it, when it was
restored. Its message says where the installation was left. Once the new server is ready the
upgrade stands: if Caddy then doesn't start, it reports that failure's code with `upgraded: true`,
and the owner fixes it and runs `start`.

When a server command the CLI runs fails with a code this table doesn't have, the CLI reports that
code and the server's exit status, with the server's other fields.

### The summary (`start`, `status`)

```json
{
  "ok": true,
  "version": "0.3.0",
  "folder": "/home/sam/your-space",
  "setup": { "kind": "this-machine", "address": "http://space.localhost", "port": 80 },
  "running": true,
  "services": [{ "name": "server", "state": "running", "health": "healthy" }],
  "engine": { "version": "29.1.0", "os": "linux", "arch": "x86_64", "endpoint": "unix:///var/run/docker.sock" },
  "owner": { "username": "sam", "name": "Sam Rivera" },
  "link": { "url": "http://space.localhost/reset-password#token=...", "expiresAt": "2026-11-17T12:30:00Z" },
  "apps": [{ "name": "notes", "state": "running", "address": "http://notes.space.localhost" }],
  "forward": null,
  "certificate": null
}
```

- `setup.kind` is `this-machine`, `domain` or `proxy`; `address` is Your Space's address.
- `link` appears only from the `start` that created the owner.
- `apps` is `null` when Your Space isn't running. A published app (decision 2026-11-19) also has
  `"publish": { "port": 8081, "bind": "127.0.0.1", "link": "https://notes.example.com", "inPane": true }`,
  and its `address` is its link when it has one. `inPane` is whether Your Space shows it in its pane
  at its link (decision 2026-11-20). `publish.frame`, the owner's switch to show the app inside Your
  Space, was removed with the alpha scope (2026-11-23).
- `forward` (proxy setup): `{ "to": "http://127.0.0.1:8080", "network": "your-space_edge", "names": ["space.example.com", "notes.space.example.com"], "wildcard": "*.space.example.com" }`.
  An app with its own link isn't in `names`: the proxy or tunnel sends its link to its published port.
- `certificate` (domain setup): `{ "state": "valid" | "waiting" | "failed", "issuer": "...", "message": "..." }`.

### Noninteractive desktop setup

`engine check` works before an installation exists. It checks the selected local engine and Compose versions without starting containers. The desktop resolves a local context to a Unix socket and selects it with `DOCKER_HOST` in the child process.

`init --release-dir <folder>` reads `your-space.tar.gz` and `SHA256SUMS` from the supplied folder. It checks the archive hash and the version pins in `stack.yaml` before unpacking. Without this option, the CLI downloads the matching release.

`start --defer-owner` starts the stack and reports its owner state. An unclaimed installation stays available for `owner create`. This flag conflicts with the `--owner-name` and `--owner-username` options.

`init --require-project-check` and `start --require-project-check` require a successful Compose project listing before changing the installation or starting containers. The desktop uses this check to find an installation managed from another folder. Ordinary CLI calls continue with the requested operation if the optional listing is unavailable.

`status --require-running` verifies that the Compose project belongs to the installation folder, that its server is running, and that the server can read its owner state. A stopped server, mismatched project or unreadable owner state produces an error. In this mode a successful `owner: null` means the workspace is unclaimed.

`upgrade --release-dir <folder>` reads the release files of the CLI's version from the folder, as
`init --release-dir` does. SIGINT or SIGTERM during `upgrade`, before the new server starts, stops it
at its next step and puts the previous version back (`cancelled`); once the new server is starting,
the upgrade runs to its result. The desktop app runs `upgrade --json` on its local installation after it
updates itself; `--json` answers the question as `--yes` does.

`upgrade --channel <alpha | canary>` (spec 016) moves the installation to the newest build of that
release channel, which the channel's `channel.json` names, by running that build's own CLI. It
conflicts with `--release-dir`, and `init` and `setup` don't take it. It stores nothing; `upgrade`
without it is unchanged. When the installation already runs that build, or a newer one, it changes
nothing and reports `upToDate`. When the build is the CLI's own version, it upgrades as `upgrade`
does. Otherwise it downloads the build's CLI, runs its `upgrade` with `--workdir` and the `--yes`,
`--json` and `--verbose` it was given, and ends with that command's output and exit status. The
standalone macOS CLI, the one inside the Mac app, refuses it with `usage`: the app moves its own
local workspace. SIGINT or SIGTERM while it downloads or checks the build's CLI stops it with
`cancelled`, with nothing changed; while the build's `upgrade` runs, they go to that command. With
`--json`, the build's JSON object is printed once its `upgrade` has ended. When a signal ends the
build's `upgrade`, whatever it printed first, or with `--json` it prints nothing, the command fails
with `cancelled` for SIGINT or SIGTERM and `unexpected` otherwise, with `channel`, `from` and `to`,
and says to see where the installation was left with `your-space status`. A build's CLI that matches
`SHA256SUMS` but whose `--version` fails, such as one that needs a newer Node.js, fails with
`unexpected` and what it printed in `detail`.

### Other results

| Command | Result |
| --- | --- |
| `engine check` | `{ ok, engine: { version, os, arch, endpoint, compose } }` |
| `init` | `{ ok, folder, version, setup, env: ["YS_DOMAIN=space.example.com"] }`: the lines written |
| `stop` | `{ ok, stopped: ["notes"] }`: the apps stopped; `null` when Your Space couldn't list its apps, after `--yes` or a yes to the question |
| `owner create`, `owner reset-link` | The server command's own JSON (`username`, `url`, `token`, `expiresAt`). `owner create`'s `email` was removed with the alpha scope (2026-11-23), with the owner's optional email |
| `secrets show` | `{ ok, secrets: [{ name, source }] }`, with `value` only with `--reveal` |
| `secrets replace` | `{ ok, replaced: "auth-secret" }` |
| `configure` | `{ ok, setup, env, summary }` |
| `upgrade` | `{ ok, from, to, backup }`: the versions, and the absolute path of the database backup; `{ ok, from, to, upToDate: true }` when the installation already runs the CLI's version, with nothing changed |
| `upgrade --channel` | The `upgrade` result of the build's CLI. `{ ok, channel, newest, from, to, upToDate: true }` when nothing changed: `newest` is the version `channel.json` names, and `from` and `to` the installation's, the same as `newest` or newer than it, as on a canary waiting for the next alpha. When the build's `upgrade` gave no result, a `cancelled` or `unexpected` failure with `channel`, `from` (the installation's version) and `to` (the build's) |

## What Each Command Runs

| Command | Compose and server commands, in the installation's folder |
| --- | --- |
| `engine check` | Reads the local Docker endpoint, `docker version --format json` and `docker compose version --short` |
| `init` | Downloads `your-space.tar.gz` and `SHA256SUMS` from the release of the CLI's version (for a canary build, such as `0.1.0-alpha.1.canary.20261125.42`, from the rolling `canary` prerelease), checks the hash and that `stack.yaml` runs the CLI's version, `tar --no-same-owner -xzf`, copies `env.example` to `.env`, sets the setup's lines |
| `start` | `docker compose up -d --wait`; then `show-owner --json`, and `create-owner --json` when there is none and owner creation is enabled; `list-apps --json` |
| `stop` | `docker compose exec -T runtime stop-apps`, then `docker compose stop` |
| `status` | `docker compose ps --format json`, `show-owner --json`, `list-apps --json` |
| `logs` | `docker compose logs [--follow] [--tail n] [service]` |
| `owner create`, `owner reset-link` | `create-owner --json`, `reset-link --json` |
| `secrets show` | `show-secrets --json` |
| `secrets replace auth-secret` | `docker compose run --rm secrets --new auth-secret`, then `docker compose restart server` |
| `secrets replace database-password` | `docker compose run --rm secrets --new database-password`, the guide's `psql` step, then `docker compose restart server` |
| `start --new-secrets` | `start`; only when it stops with `lost_secrets`: `docker compose run --rm secrets --new auth-secret --new database-password`, `docker compose up -d --wait postgres`, the `psql` step, then `start` again. Secrets that aren't lost are kept |
| `configure` | Sets the setup's lines in `.env`, then `docker compose up -d --wait` |
| `upgrade --channel <name>` | Reads the installation's version from `stack.yaml`, holding `.your-space.lock` while it does, then `<releases>/<name>/channel.json` with one request: `{"channel","version","commit"}`, where Alpha's `version` is never a canary and Canary's always is. When that version is later than the installation's and isn't the CLI's own, it downloads `SHA256SUMS`, then, when that lists it, the build's CLI from the build's release (`v<version>`, or `canary`): `your-space-linux-<arch>` when the running CLI is the Linux executable, otherwise `your-space-ai-cli-<version>.tgz`, whose `package/package.json` must name the version and whose `package/dist/your-space.cjs` runs with Node. It checks the file against `SHA256SUMS`, in a temporary folder only its owner can read (`TMPDIR`), removed afterwards. It runs `<cli> --version`, which must print the version within a minute, then `<cli> upgrade --workdir <folder>` with the terminal, passing on SIGINT and SIGTERM |
| `upgrade` | Reads the installation's version from `stack.yaml`. When the CLI's is later: downloads and checks the release files as `init` does, into a folder beside the installation; `docker compose --project-directory <new release folder> --env-file .env -f <new release folder>/compose.yaml pull --policy missing`; `docker compose up -d --wait postgres` when the database is stopped; `docker compose stop caddy server`; `pg_dump` in the `postgres` service into `backups/<time>-<version>.sql` (mode 0600); replaces `compose.yaml`, `stack.yaml`, `modes/` and `env.example`, adds any setting the new `env.example` sets that `.env` lacks; `docker compose up -d --wait server`, then `docker compose up -d --wait`, so Caddy starts last. When the first of those fails, it stops the server and Caddy, moves the previous files back, restores the backup when a second `pg_dump` differs from it, the new version having changed the database (into a new database, swapped in with `ALTER DATABASE ... RENAME` in one transaction, keeping the replaced one as `yourspace_upgrade_failed_<time>`), and runs `docker compose up -d --wait`. It stops early, leaving `.upgrade-restore` and saying what is left to do by hand, when the new server can't be stopped (nothing is moved back), when the previous files can't be put back, or when the database can't be read or restored (the previous version isn't started). It holds `.your-space.lock` throughout, and from the first file moved until the files and the database are known to match, `.upgrade-restore` |

## The Server's `show-owner` Command

```sh
docker compose exec -T server show-owner --json
```

```json
{ "ok": true, "owner": { "username": "sam", "name": "Sam Rivera" } }
{ "ok": true, "owner": null }
```

Exit statuses as the other operator commands: 0, 1 for usage, 3 when the database can't be read, 4
when unexpected. It changes nothing.

## Test-Only Settings

| Variable | Meaning |
| --- | --- |
| `YS_E2E_RELEASES` | Base URL for release downloads instead of `https://github.com/your-space-ai/your-space/releases/download`, for the browser tests' local release; `upgrade --channel` reads `channel.json` from it too |
