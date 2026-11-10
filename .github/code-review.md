# Code review guide

How the AI reviewer reviews pull requests in this repository. The review workflow
(`.github/workflows/code-review.yml`) points the reviewer here, and a human reviewer can use it
too.

## Scope

Your Space is a self-hosted workspace platform: an Express server, PostgreSQL through Drizzle,
Better Auth, and a React web client served by Caddy, all run with Docker Compose. A journey is
delivered as a stack of pull requests, each adding one layer on top of the one below, so review
each pull request on its own diff against its base branch.

Report bugs, security problems, data-integrity risks, and breaks of the rules below or of the
documents they come from. Don't comment on wording, naming or style, and don't suggest refactors
the change doesn't need. Skip `package-lock.json`, `server/drizzle/meta/**` and
`server/src/db/auth-schema.ts`, which are generated.

## Read first

- `.specify/memory/constitution.md`: the project's principles; every change must follow them.
- `AGENTS.md`: how specs, decisions, the roadmap and the architecture overview are kept in step.
- `docs/architecture/decisions.md`: accepted project-wide decisions and their reasons.
- For changes under `server/`, `web/`, `e2e/` or `deploy/`, the journey's `spec.md` and `plan.md`
  under `specs/`. The plan lists the libraries chosen and the custom code allowed.
- For `server/src/`, the journey's HTTP API contract in `contracts/http-api.md`; for
  `server/src/commands/` and `server/bin/`, the operator commands' contract in
  `contracts/operator-commands.md`.

## Rules

- **Code lands with its first use.** A file, top-level function or component, script or config
  entry belongs in a pull request only if something in that pull request runs it: code that runs,
  a test, CI or the deployment, or a developer who first needs it to run, develop or test the app.
- **No dependency the plan doesn't list.** A new package needs a decision and a plan change first.
- **Configuration is optional.** Every setting has a safe default; secrets are generated unless
  `.env` sets them; nothing reachable from the network opens without an explicit choice.
- **Never treat unreadable storage as "no owner yet".** A database outage is reported as storage
  unavailable, never as an empty or unclaimed installation.
- **Nothing sensitive in logs or responses:** no passwords, tokens, set-password or reset links,
  cookies, `Authorization` headers or request bodies.
- **Sign-up stays closed.** Only the operator's `create-owner` command can create the owner.
- **Docs state final decisions,** not the history of a pull request.
