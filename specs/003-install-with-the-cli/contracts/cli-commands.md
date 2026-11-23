# Contract: The `your-space` CLI

**Spec**: [spec.md](../spec.md) · **Plan**: [plan.md](../plan.md)

The desktop app (journey 008) and people's scripts drive these commands, so their options, JSON
output and exit statuses are a contract. Human output may change; JSON fields are only added.

```text
your-space engine check
your-space init       [--require-project-check] [--release-dir <folder>] [--this-machine | --domain <name> | --proxy-url <url>] [--port <n>] [--yes]
your-space start      [--owner-name <name>] [--owner-username <username>] [--owner-email <email>]
                      [--require-project-check] [--defer-owner] [--no-open] [--ignore-checks] [--new-secrets] [--yes]
your-space stop       [--yes]
your-space status     [--require-running]
your-space logs       [<service>] [--follow] [--tail <n>]
your-space owner create      --name <name> --username <username> [--email <email>]
your-space owner reset-link
your-space secrets show      [--reveal]
your-space secrets replace   <auth-secret | database-password> [--yes]
your-space configure  [--this-machine | --domain <name> | --proxy-url <url>] [--port <n>]
                      [--ignore-checks] [--yes]
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
| `permission_denied` | 2 | The person can't use the engine; the message says how to fix it |
| `port_in_use` | 2 | A port the setup needs is taken; `port` and, when known, `by` |
| `check_failed` | 2 | A domain's names don't resolve; `checks` lists each result |
| `not_running` | 2 | The command needs Your Space running |
| `start_failed` | 2 | Compose couldn't start Your Space; `service` and the message from its log |
| `lost_secrets` | 2 | The secrets are gone but the database is kept; run `start --new-secrets` |
| `no_owner` | 2 | `owner reset-link` without an owner |
| `owner_exists` | 2 | `owner create` with an owner |
| `secret_in_env` | 2 | `secrets replace` for a secret set in `.env` |
| `download_failed` | 3 | A release file could not be downloaded or read from the selected release folder |
| `checksum_mismatch` | 2 | The archive failed checksum verification or its packaged image version differs from the CLI version |
| `engine_unreachable` | 3 | The engine stopped answering |
| `storage_unavailable` | 3 | The server couldn't read its database |
| `app_failed` | 2 | A server command failed without a code of its own |
| `unexpected` | 4 | Anything else |

When a server command the CLI runs fails with a code this table doesn't have, the CLI reports that
code and the server's exit status, with the server's other fields. For example, `app install-local`
gives `refused` with `name` and `refusals` (`{ service, reason }`) when Your Space can't run a kit,
and its message lists them.

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
  "apps": [{ "name": "sure", "state": "running", "address": "http://sure.space.localhost" }],
  "forward": null,
  "certificate": null
}
```

- `setup.kind` is `this-machine`, `domain` or `proxy`; `address` is Your Space's address.
- `link` appears only from the `start` that created the owner.
- `apps` is `null` when Your Space isn't running. A published app (decision 2026-11-19) also has
  `"publish": { "port": 8081, "bind": "127.0.0.1", "link": "https://plane.example.com", "frame": true, "inPane": true }`,
  and its `address` is its link when it has one. `frame` is the owner's choice to show it inside Your
  Space, and `inPane` whether Your Space shows it in its pane at its link (decision 2026-11-20).
- `forward` (proxy setup): `{ "to": "http://127.0.0.1:8080", "network": "your-space_edge", "names": ["space.example.com", "sure.space.example.com"], "wildcard": "*.space.example.com" }`.
  An app with its own link isn't in `names`: the proxy or tunnel sends its link to its published port.
- `certificate` (domain setup): `{ "state": "valid" | "waiting" | "failed", "issuer": "...", "message": "..." }`.

### Noninteractive desktop setup

`engine check` works before an installation exists. It checks the selected local engine and Compose versions without starting containers. The desktop resolves a local context to a Unix socket and selects it with `DOCKER_HOST` in the child process.

`init --release-dir <folder>` reads `your-space.tar.gz` and `SHA256SUMS` from the supplied folder. It checks the archive hash and the version pins in `stack.yaml` before unpacking. Without this option, the CLI downloads the matching release.

`start --defer-owner` starts the stack and reports its owner state. An unclaimed installation stays available for `owner create`. This flag conflicts with the `--owner-name`, `--owner-username` and `--owner-email` options.

`init --require-project-check` and `start --require-project-check` require a successful Compose project listing before changing the installation or starting containers. The desktop uses this check to find an installation managed from another folder. Ordinary CLI calls continue with the requested operation if the optional listing is unavailable.

`status --require-running` verifies that the Compose project belongs to the installation folder, that its server is running, and that the server can read its owner state. A stopped server, mismatched project or unreadable owner state produces an error. In this mode a successful `owner: null` means the workspace is unclaimed.

### Other results

| Command | Result |
| --- | --- |
| `engine check` | `{ ok, engine: { version, os, arch, endpoint, compose } }` |
| `init` | `{ ok, folder, version, setup, env: ["YS_DOMAIN=space.example.com"] }`: the lines written |
| `stop` | `{ ok, stopped: ["sure"] }`: the apps stopped; `null` when Your Space couldn't list its apps, after `--yes` or a yes to the question |
| `owner create`, `owner reset-link` | The server command's own JSON (`username`, `url`, `token`, `expiresAt`) |
| `secrets show` | `{ ok, secrets: [{ name, source }] }`, with `value` only with `--reveal` |
| `secrets replace` | `{ ok, replaced: "auth-secret" }` |
| `configure` | `{ ok, setup, env, summary }` |

## What Each Command Runs

| Command | Compose and server commands, in the installation's folder |
| --- | --- |
| `engine check` | Reads the local Docker endpoint, `docker version --format json` and `docker compose version --short` |
| `init` | Downloads `your-space.tar.gz` and `SHA256SUMS` from the release of the CLI's version, checks the hash, `tar --no-same-owner -xzf`, copies `env.example` to `.env`, sets the setup's lines |
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
| `YS_E2E_RELEASES` | Base URL for release downloads instead of `https://github.com/your-space-ai/your-space/releases/download`, for the browser tests' local release |
