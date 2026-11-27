# Feature Specification: Agent Access per App

**Feature Branch**: `018-app-access`

**Created**: 2026-11-27

**Status**: Proposed. The owner set the model on 2026-11-27 (decisions 1 to 5); five details are
open, each with a recommendation. Nothing is built.

**Input**: The owner, on 2026-11-27, after the first live run of journey 017: 017's per-route model
is too granular to start with. Start broad and add granularity only when it's needed. "access is per
app, and we can define the api key used by that agent for that app in the config, and your space
applies the actual api key, agent never sees the api key."

**Related**: [journey 017](../017-agent-writes/spec.md), which this simplifies, and journey
[005](../005-owner-agent/spec.md); [decision record](../../docs/architecture/decisions.md#agent-writes);
[Give an external agent access to one app](../../docs/apps/agent-access.md).

## At a Glance

- **Who:** an owner who gives an external agent an app's API, through Your Space, with the app's own
  key held by Your Space.
- **Done when:** a kit says where the app's API lives and how its key is sent, with no roles or
  routes; the owner grants an agent an app and picks which bound app key it uses; the agent calls any
  method and path under the API, and the app key's role in the app is the limit; nothing asks first
  unless the owner adds a route that does; a kit change keeps app keys and grants; and 017's grants
  carry over.
- **Not covered:** checking what a call does beyond its path and size; per-route grants; anything the
  bound app key can't already do. In-place kit updates are another spec's; this one makes sure grants
  and app keys survive them.

## Decisions

| # | Question | Decision or recommendation |
| --- | --- | --- |
| 1 | What does an agent get access to? | **Decided:** an app. A grant gives the agent the app's API, under the path the kit names, with the bound app key the owner picks for that agent. The kit lists no roles or routes. Owner: "access is per app, and we can define the api key used by that agent for that app in the config, and your space applies the actual api key, agent never sees the api key." |
| 2 | What limits an agent's calls? | **Decided:** the app key's own role in the app. For an agent that should do less, the owner makes a narrower key in the app and picks it for that agent |
| 3 | What stays from 017? | **Decided:** the agent's own Your Space key, Your Space attaching the app's key, the response check, per-agent revocation, and Activity |
| 4 | When does a call ask the owner first? | **Decided:** never, unless the owner adds a route that asks. Owner: "start with a blank list by default, allow all routes and api key determines access. and if usr wants they can define specific route that triggers approval request." |
| 5 | What does a kit change do to app keys and grants? | **Decided:** keeps them. A grant is to the app, so a new kit, source, commit or Compose file leaves it and the bound keys in place |
| 6 | How is a route that asks written? | Open. Recommended: a method and a path, where `*` stands for one path segment, such as `DELETE /rest/companies/*` |
| 7 | Whose list is it? | Open. Recommended: each agent's, per app, beside the key it uses |
| 8 | What happens to 017's grants and Ask settings? | Open. Recommended: each grant keeps its key and its routes that asked, and waits for the owner to confirm it before it works, since a 018 grant reaches the whole API on that key |
| 9 | Does removing an app keep its agent access? | Open. Recommended: no. Removing an app, even keeping its data, ends its grants and app keys, as today; only a kit change keeps them |
| 10 | What about kits that still list roles and routes? | Open. Recommended: they keep installing; Your Space ignores the lists and takes the API's path from the routes' common prefix until the kit names it |

## What Exists Today

After journey 017 (PRs #141–#143):

- **Kit.** `agentAccess` names one `credential` or several `credentials`, roles of routes, and routes
  with a method, a path template, declared path and query fields, an optional `credential` and an
  optional `approval`. A role's routes all use one credential.
- **Binding.** The owner binds each named credential for an installation and enables kit roles for
  delegation. Bound credentials live in `agent_credential`.
- **Grant.** Per agent and installation: a set of enabled roles, and Ask or Allow per route. A write
  nobody set asks first; a read runs directly.
- **Call.** `your-space agent invoke <installation> <route-id>` with `path`, `query` and `body`
  input. The gateway renders the route, attaches the route's credential, and checks the response.
- **Kit change.** The `retire_agent_binding` trigger deletes an installation's grants and app keys
  and stales its pending requests whenever its kit, source, commit, Compose file or images change,
  or it is removed. The owner binds and grants again.
- **The owner's live setup** has one agent granted the Editor role on a `records` credential, with
  every Editor route set to Allow.

## What Changes

1. **Kit.** `agentAccess` has `api`, the path the app's API lives under, and one `credential` or
   several `credentials`, as today. No roles, no routes.
2. **Grant.** Per agent and installation: access or none, the name of the bound credential it uses,
   and its routes that ask (decisions 6 and 7). Bindings enable no roles.
3. **Call.** The agent names an installation, a method (`GET`, `POST`, `PATCH`, `PUT` or `DELETE`)
   and a path under the API, with an optional query and a JSON body of at most 32 KiB. The gateway
   checks the path is under the API and well formed, attaches the grant's credential, and checks the
   response as today. The CLI command is `your-space agent call <installation-id> <METHOD> <path>`,
   with the body on standard input; `your-space agent apps` lists what the agent can reach.
4. **Approvals.** A call runs unless it matches one of the grant's routes that ask; then it waits for
   the owner as today, for 15 minutes.
5. **Kit change.** The trigger keeps grants and app keys on a kit, source, commit, Compose file or
   image change, and only stales pending requests. A grant whose credential the new kit no longer
   names is unavailable until the owner picks another.
6. **Migration** of 017's grants and settings (decision 8).
7. **Docs, the fixture kits and the owner's Twenty kit** move to the new format.

## 6. How a Route That Asks Is Written

**Recommended:** a method and a path. Each path segment is literal or `*`, which matches any one
segment; the query isn't matched. `DELETE /rest/companies/*` asks before deleting any company;
`POST /rest/metadata/*` asks before creating any object or field. The owner adds and removes them in
**Agents**.

**Considered:** a path prefix, such as `/rest/metadata`, matching everything under it, with or
without a method. Shorter, but it can't single out a delete of one kind of record.

## 7. Whose List It Is

**Recommended:** each agent's, per app: a grant holds the key the agent uses and its routes that ask.
One agent can run freely while another asks before the same call.

**Considered:** one list per app, for every agent. Fewer settings, but every agent of the app would
ask the same way.

## 8. 017's Grants and Ask Settings

**Recommended:** a 017 grant reached only its roles' routes, while a 018 grant reaches the whole API
on its key, so an upgrade must not widen it unseen: a read-only grant on a key that can also write
would otherwise gain those writes. So each migrated grant waits for the owner:

- It takes the credential its roles used. A grant whose roles used more than one credential, such as
  a record role and a setup role, takes none, and the owner picks the app key that agent uses.
- Every route that asked under 017, by the owner's setting, the kit's recommendation or a write's
  default, becomes a route that asks on the grant, with its path template's parameters as `*`. A
  route set to Allow, or a read that ran directly, becomes nothing.
- It is unavailable until the owner confirms it in **Agents**, which says the agent will reach the
  app's whole API with that key, and shows the routes that ask. Confirming is one click per grant.

The owner's live setup has one grant, with every route on Allow: it becomes Twenty access with the
`records` key and no routes that ask, working once the owner confirms it.

**Considered:** carrying grants over working, with their routes that asked (the earlier
recommendation): a grant's reach would grow to the whole API without the owner seeing it.
**Considered:** starting every grant blank and working, as the new default: a write that waited for
the owner yesterday would run directly after an upgrade.

## 9. Removing an App

**Recommended:** removing an app ends its grants and app keys, as today, whether or not its data is
kept; installing it again starts with no agent access. Only a change to the installed app (decision
5) keeps them.

**Considered:** keeping them with kept data, so a reinstall with reuse restores them. It brings back
keys the owner may have meant to retire with the app.

## 10. Kits That Still List Roles and Routes

**Recommended:** they keep installing. Your Space ignores `roles` and `routes`, takes the API's path
from the routes' longest common prefix of literal segments when the kit names no `api`, stopping at
the first `{parameter}` segment (`/rest` for the owner's Twenty kit; `/items` for a kit whose one
route is `/items/{id}`), or `/` when no literal segment is common, and ignores per-route `credential`
and `approval`. A kit that
names `api` is used as it says. Stored kits read the same way.

**Considered:** refusing them with a message to add `api`. Clean, but every kit written for 017 would
need changing before its app could install again.

## Requirements

- **FR-001**: A version 2 kit's `agentAccess` has `api`, a path starting with `/`, and one
  `credential` or one to eight named `credentials`, as journey 017 has them. A kit may still list
  `roles` and `routes`; they grant nothing (decision 10).
- **FR-002**: The owner binds each credential separately, as today; a binding enables no roles.
- **FR-003**: A grant for an agent and installation names one bound credential, and holds its routes
  that ask (decisions 6 and 7). Without a grant the agent can't reach the app.
- **FR-004**: An agent's call names an installation, a method among `GET`, `POST`, `PATCH`, `PUT` and
  `DELETE`, and a path under the kit's `api`, with an optional query and an optional JSON body of at
  most 32 KiB; a `GET` has no body. The path is up to 2048 characters of RFC 3986 path characters
  (unreserved, sub-delimiters other than `;`, `:`, `@` and percent-encoded octets) and `/`. A `;`,
  which some apps read as starting path parameters they strip before routing, is refused, so the
  gateway and the app see the same path. Percent-encoding is
  decoded once to check and match the path: a segment that decodes to `.` or `..`, or contains an
  encoded `/`, `\` or NUL, is refused, as is an empty segment other than a trailing one. The path is
  sent as given, and is under the `api` and matched against routes that ask by its decoded segments,
  so an encoding can't move a call outside the API or past a route that asks. A segment that still
  contains `%` after that one decode is refused, so an app that decodes again can't be led to a path
  the gateway didn't check. A route that asks matches its literal segments ignoring letter case and
  a trailing `/`, so an app that routes case-insensitively or ignores a trailing slash can't be
  reached past it; matching too much only asks the owner once more. Query names and values
  are text, encoded by the gateway.
- **FR-005**: The gateway sends the call with the grant's credential only. The response check, the
  outcomes and the result are journey 017's.
- **FR-006**: A call that matches a route that asks waits for the owner, as a pending request does
  today; any other call runs directly.
- **FR-007**: A change to an installed app's kit, source, commit, Compose file or images keeps its
  bound credentials and grants, and stales its pending requests. A grant whose credential isn't bound
  is unavailable until the owner picks another; a credential the new kit no longer names stays
  stored, not deleted. Bound credentials no longer depend on a stamp of the kit they were bound under.
  Removing an app ends them (decision 9). Journey 019's in-place kit updates rely on this and change
  no trigger of their own.
- **FR-008**: The migration gives each 017 grant the credential its roles used, or none when they
  used several, turns its routes that asked into routes that ask, and leaves it unavailable until the
  owner confirms it, picking a key where it has none (decision 8). No grant reaches a route after an
  upgrade that it couldn't reach before, until the owner confirms it. Bindings' enabled roles, grants' roles and route
  overrides stay in the database, unread.
- **FR-009**: Activity records each call's method and path, without its query.
- **FR-010**: The CLI has `your-space agent apps`, `your-space agent call <installation-id> <METHOD>
  <path> [--body-stdin]` and `your-space agent request <id>`; `invoke` and `actions` are gone.
- **FR-011**: Tests cover a call under and outside the API, malformed paths, a route that asks and
  one that doesn't, the grant's credential sent alone, a kit change that keeps the grant, removal
  that ends it, the migration from a 017 grant, including a read-only grant on a key that can also
  write, which reaches nothing until the owner confirms it, and an old kit's derived API path.
- **FR-012**: The agent access guide, 005's contracts, the decision record, the roadmap, the fixture
  kits and the owner's Twenty kit describe the new model.
- **FR-013**: Acceptance repeats journey 017's live run on the owner's installation through `agent
  call`, after the upgrade carried its grant over.

## Sources

- This repository after PR #143: `server/src/apps/agent-kit.ts`, `server/src/agents/*.ts`,
  `server/drizzle/0010_app_replacement.sql` and `0018_agent_credentials.sql` (`retire_agent_binding`),
  `web/src/components/AgentAccess.tsx`, `cli/src/commands/agent.ts`.
- The owner's live setup, read on 2026-11-27: one grant, role `editor`, credential `records`, every
  Editor route on Allow.
