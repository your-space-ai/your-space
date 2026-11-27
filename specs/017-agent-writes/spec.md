# Feature Specification: Agent Writes

**Feature Branch**: `017-agent-writes`

**Created**: 2026-11-26

**Status**: Decided. The owner settled every decision on 2026-11-26, with one rule throughout: a
role grants an agent a route at an HTTP method, with approvals, and Your Space adds nothing past that
without a reason. Two decisions were dropped under that rule, and a third, which release carries
it, as out of scope for a feature. Nothing is built.

**Input**: The owner, on 2026-11-26: an agent should be able to do real work in an app through Your
Space, never holding the app's own credential. The first case is onboarding records into a CRM:
create companies, opportunities and records of a custom object, link them to each other, and
update them later.

**Related**: [decision record](../../docs/architecture/decisions.md#agent-writes) (and the
2026-11-23 [cut of agent writes](../../docs/architecture/decisions.md#alpha-scope)), journey
[005](../005-owner-agent/spec.md) and its [kit contract](../005-owner-agent/contracts/kit-agent-access.md)
and [gateway contract](../005-owner-agent/contracts/gateway.md), and
[Give an external agent access to one app](../../docs/apps/agent-access.md).

## At a Glance

- **Who:** an owner who wants an external agent to create, change and delete records in an
  installed app, and, through a role of its own, to set up the app's data model, with the same key,
  roles, approvals and activity that reads use today.
- **Done when:** a version 2 kit can declare routes with `POST`, `PATCH`, `PUT` and `DELETE`; a role
  grants an agent those routes at their methods; the gateway sends the agent's JSON body to the app
  with the route's credential and returns the app's response; each route asks the owner first or
  runs directly, as the owner sets it; a setup role is sent with an admin credential that no record
  role carries; and a live external agent has added a field to a custom object and created, linked
  and updated records in a real Twenty installation through the kit's routes.
- **Not covered:** anything past a route at a method: checking or describing bodies, retry and
  duplicate handling, stale-edit detection, and keeping what a write sent. Those are the app's and
  the agent's, as for any API client.

## Decisions

| # | Question | Decision or recommendation |
| --- | --- | --- |
| 1 | Are schema and admin operations, such as creating a custom object, in scope? | **Decided:** in, through setup roles of their own. Each role's routes are sent with one named app credential, so a setup role uses an admin credential and a record role a narrower one. Owner: "should be separate roles that give separate access. could also have a role that give permission over the setup itself and control thingsl ike the data model." |
| 2 | Can a kit declare routes that delete? | **Decided:** yes, in roles of their own; whether a delete asks first is set like any route's. Owner: "this should be defined in the role permissions, it shouldn't always require an approval tho"; "there are some reasonable deletions" |
| 3 | How does a kit declare a write's body? | **Decided:** it doesn't. Owner: "lets not get granular like this, the role allows an agent access to a specific route + http verb, nothing more granular." |
| 4 | What makes a retried write safe? | **Decided:** nothing in Your Space. The gateway forwards each write and returns the app's response; retries and duplicates are the agent's and the app's. Owner: "what no please none of this machinery, no made up operation ids. agent just has access to the api route at a verb, we are not adding more machinery past that without a reaason" |
| 5 | What happens to an edit of a record that changed since the agent read it? | **Dropped:** the app applies it as it applies any client's edit |
| 6 | Does a write route ask the owner first when neither the kit nor the owner has set it? | **Decided:** yes, it asks; a read nobody set defaults to Allow. Owner: "default to ask." |
| 7 | What does the owner see of what a write changed? | **Dropped:** Activity stays as it is, and the app keeps its own history of its records |
| 8 | Where does the Twenty kit with write routes live? | **Decided:** in a private kits repository in the project's GitHub organization, installed through the GitHub connection (015). Owner: "twenty kit, put it in a private kit repo on the your space ai org" |
| 9 | Which release carries it? | **Dropped:** not a feature's decision. Owner: "has nothing to do with individual features, out of scope, but the way it works is canary is whats on main, and alpha is what is on main when we choose to cut the release." |

## What Exists Today

Agents read, with approvals (2026-11-23, [Alpha scope](../../docs/architecture/decisions.md#alpha-scope)):

- **Kit format.** `agentAccess` declares one credential recipe, roles and routes. Every route is a
  `GET` with `effect: read`, with scalar `pathParams` and `queryFields` (`string`, `uuid`,
  `integer`, `boolean`). The parser refuses `effect: write`, any method but `GET`, and `bodyFields`,
  `operationId`, `expectedRevision` and `receipt`, saying agents only read. A kit stored before then
  keeps its write routes on record, and `readsOnly()` in the gateway leaves them out of every role;
  `catalog()` reads the stored kit and doesn't parse it again.
- **Gateway.** `POST /api/agent/invoke` takes `installationId`, `actionId` and `input` with `path`
  and `query`, nothing else. It checks the key, the installation's binding and enabled roles, and
  the union of the agent's granted roles, then renders the declared route and sends it over the
  edge socket to the app's interface with the bound credential injected. The edge's private route
  passes any method and body, and `transport.ts` still carries a JSON body. The server's JSON body
  limit is 64 KiB; the CLI refuses input over 60 KiB.
- **Response check.** A 2xx response other than `202` must be JSON of at most 256 KiB and must not
  contain the app credential, raw or JSON-escaped; it then reaches the agent unchanged (2026-11-24).
  Otherwise the request's status is `unknown`. Other 4xx statuses are `refused`, and the app's error
  body is never passed on.
- **Approvals.** Per agent and installation, each route is Ask or Allow by the owner's override,
  then the kit's `approval`, else Allow. A pending request stores its input encrypted, binds a
  fingerprint of the rendered request, the key and the binding and grant revisions, and expires
  after 15 minutes. Approval re-admits it under current authority and dispatches it once. The
  owner's pending view shows the request's input.
- **Activity.** Each request records agent, key, installation, route, status and time. The owner
  sees request ID, actor, delegating owner, app, action and outcome, paged. A succeeded result is
  kept encrypted for the agent for a day.
- **CLI.** `your-space agent actions`, `invoke <installation-id> <action-id> --input-stdin` and
  `request <id>`.
- **The owner's Twenty kit** declares a Reader role over list and show routes for companies, people
  and opportunities, with Twenty's REST API under `/rest` and the bound API key as a bearer token.

### Why writes were cut, and what answers it

The 2026-11-23 cut gave two reasons:

1. **Writes had run only against a fixture.** Acceptance here requires a live external agent
   writing to a real Twenty installation at the kit's pinned release, and a check of the records in
   Twenty afterwards (FR-010).
2. **Most app APIs ignore `Idempotency-Key` and `If-Match`.** The removed design passed an operation
   ID and an expected revision to the app and relied on it to honor them; Twenty v2.62.0 ignores
   both. This spec no longer claims either guarantee (decision 4): the gateway forwards a write as
   any API client would send it, and what the app does with a repeat or a stale edit is the app's.

### Twenty's REST writes, checked live

Against a disposable Twenty v2.62.0, with an API key whose role reads and updates every object but
can't delete, destroy or change settings, and an Admin-role key (2026-11-26):

| Request | Result |
| --- | --- |
| `POST /rest/companies` with a body that sets `id` | `201`; the record has that ID |
| The same create again | `400`, "A duplicate entry was detected: unique constraint company.company_pkey was violated" |
| The same create with `?upsert=true` and another name | `201`; the existing record is changed |
| Two creates with the same `Idempotency-Key` | Two records |
| `PATCH /rest/companies/{id}` with `{"name": …}` | `200`; only `name` changes |
| `PATCH` with `If-Match: "stale"` | `200`; applied |
| `PATCH` of an unknown ID | `404` |
| `POST /rest/opportunities` with `companyId` | `201`; the opportunity links to that company |
| `POST /rest/opportunities` with `company: {create: {…}}` | `201`; a new company is created with it |
| `DELETE /rest/companies/{id}` with the record key | `403`, the role can't delete |
| `POST /rest/metadata/objects`, `POST /rest/metadata/fields`, `PATCH /rest/metadata/fields/{id}` with the record key | `403`; with the Admin-role key: `201`, `201`, `200` |
| `GET /rest/metadata/objects/{id}` with the record key | `200` |
| `POST /rest/<plural name>` for a custom object | `201`; a custom object has REST routes at its plural name |
| `POST /rest/batch/companies` with two records | `201`; both created |

A create's response is the whole record under `data.create<Object>`, and an update's under
`data.update<Object>`; Twenty records the API key's name as `createdBy`. A field the data model
doesn't have is refused with `400`.

## What's Missing

For an agent to write through a route at a method:

1. **Write methods in the kit.** A route may declare `POST`, `PATCH`, `PUT` or `DELETE`. The method
   says that it writes, so a write route declares no `effect`. A stored route with `effect: write`,
   from before the cut, stays out of every role, so a server upgrade never adds a write to a grant the
   owner made for reads; a new kit that declares it is refused.
2. **A body.** Input gains `body`, sent to the app as JSON, as the agent gave it (decision 3).
3. **Transport limits.** A body is JSON of at most 32 KiB, under the server's 64 KiB request limit.
   Path parameters and query fields stay declared and scalar, as for reads, since they render the
   route.
4. **Credentials per role.** Today an installation binds one app credential, used for every route.
   A setup role needs an admin credential that a record role never carries (decision 1), so a kit
   names its credentials, each route names the one it is sent with, a role's routes all use one,
   and the owner binds each separately. Binding more than one needs a migration:
   `agent_binding.credential` holds one. Each bound credential gets a row of its own, encrypted
   under the data key and moved by its rotation; the existing value becomes the row of the kit's only
   credential.
5. **The response check** applies to writes, and refuses a response that contains any credential
   bound to the installation, not only the one used. A 2xx whose response fails the check reports
   `succeeded` without a result, since the app applied the write; a read's stays `unknown`.
6. **Approval default.** A write route nobody set asks first (decision 6).
7. **Discovery and CLI.** `actions` already lists each route's method; `invoke`'s input file may
   have `body`.

Nothing else changes: approvals, the pending view, activity, keys, grants and revocation work for
writes as they do for reads. `agent_grant.ask_all_writes`, `agent_request.operation_id` and its
unique index stay unread.

## 1. Schema and Admin Operations

**Decided (2026-11-26):** in, through roles of their own. The owner: "should be separate roles that
give separate access. could also have a role that give permission over the setup itself and control
thingsl ike the data model." A kit declares setup routes, such as Twenty's metadata routes for
objects and fields, in a setup role apart from its record roles, and the owner grants each role to
an agent separately.

A record grant must never carry an admin credential, so a kit names each credential it uses, and
each route names the one it is sent with:

```yaml
agentAccess:
  credentials:
    records: {inject: {location: header, name: Authorization, scheme: Bearer}}
    setup:   {inject: {location: header, name: Authorization, scheme: Bearer}}
  roles:
    editor: {title: Editor, routes: [create-company, update-company]}
    setup:  {title: Setup, routes: [create-field, update-field]}
  routes:
    create-company: {method: POST, path: /rest/companies, credential: records}
    update-company: {method: PATCH, path: "/rest/companies/{id}", pathParams: {id: uuid}, credential: records}
    create-field:   {method: POST, path: /rest/metadata/fields, credential: setup}
    update-field:   {method: PATCH, path: "/rest/metadata/fields/{id}", pathParams: {id: uuid}, credential: setup}
```

- The owner binds each credential separately: for Twenty, a key whose role reads and writes records
  for `records`, and an Admin-role key for `setup`. A route whose credential isn't bound is
  unavailable; nothing falls back to another credential. A request carries only its route's
  credential.
- A role's routes all name one credential, and the dashboard shows each role's credential beside its
  routes, so the owner sees which key a grant uses. The parser refuses a role that mixes them.
- A kit with one credential keeps today's `credential` entry, and its routes name none. Stored kits
  keep working.

Checked live on Twenty v2.62.0: with the record key, creating or renaming a field got `403`; with
the Admin-role key, both succeeded.

**Considered:** schema operations out, with the owner shaping the data model in the app's own
settings (the recommendation).

## 2. Deleting

**Decided (2026-11-26):** deletes are in, and whether one asks first is set like any route's. The
owner: "this should be defined in the role permissions, it shouldn't always require an approval
tho", and "there are some reasonable deletions". A delete is a route with `method: DELETE`. A kit
puts deletes in roles of their own, such as a Remover beside the Editor, so the owner grants them on
purpose; deleting objects or fields goes the same way beside Setup. The Twenty kit declares no
deletes yet: onboarding doesn't need them.

**Considered:** deletes always asking, with no Allow (the recommendation).

## 3. A Write's Body

**Decided (2026-11-26):** a kit doesn't describe a body. The owner: "lets not get granular like
this, the role allows an agent access to a specific route + http verb, nothing more granular." The
agent's body passes through to the app, which validates it and refuses a bad one with a 4xx, which
the agent sees as `refused`. This matches the 2026-11-24 decision for responses.

Accepted with it:

- **Nested creates pass.** A body can create linked records along with its own: on Twenty, an
  opportunity created with `company: {create: {…}}` creates a company too, through a route granted
  to create opportunities. A body can set any field the app accepts. The credential's role in the app
  is the limit.
- **Query options pass only when declared.** Query fields are declared as they are for reads, so
  `?upsert=true`, which turns a Twenty create into an update of an existing record, can't be sent
  through a route that doesn't declare `upsert`. The Twenty kit declares none.

**Considered:** a list of the top-level fields each route accepts (the recommendation); typed nested
body schemas.

## 4. Retries and Duplicates

**Decided (2026-11-26):** Your Space adds nothing. The owner: "what no please none of this
machinery, no made up operation ids. agent just has access to the api route at a verb, we are not
adding more machinery past that without a reaason". The gateway forwards each write once and returns
the app's response, and keeps no operation IDs, no record of earlier writes to match against, and no
conflict status. A retry is a new request. An `unknown` outcome means Your Space doesn't know
whether the app applied the write; the agent finds out from the app, as any API client would. An app
that lets the client choose a record ID, as Twenty does, refuses a second create with the same ID,
which an agent can use, unless the request upserts: Twenty's `?upsert=true` updates the existing
record instead, so a repeat can overwrite another actor's edit.

**Considered:** an operation ID on every write, kept by Your Space, returning the first outcome for
a repeat (the recommendation); passing it to the app as `Idempotency-Key`, which Twenty ignores.

## 5. Stale Edits — Dropped

Dropped under the owner's rule for decision 4. An update reaches the app as any client's would, and
the app decides what a stale edit does; Twenty applies it, changing only the fields the body names.
Your Space claims nothing about it.

## 6. Approval for a Write Route Nobody Set

**Decided (2026-11-26):** it asks. The owner: "default to ask." A write route asks the owner first
when the owner hasn't set it and the kit doesn't recommend Allow; a read nobody set defaults to Allow. The
owner sets Ask or Allow per route as today, and a kit's `approval` is the default until then. This
is 005's FR-11 rule ("absent a recommendation ask on writes and allow reads"), kept.

Why it is Your Space's: an app can't ask the owner before an agent's request reaches it, and a kit
that leaves `approval` out shouldn't make an agent's writes run unseen on the first grant.

**Considered:** the same default as reads, Allow unless the kit or the owner says Ask.

## 7. What a Write Changed — Dropped

Dropped under the owner's rule for decision 4. Activity shows each write as it shows each read: the
agent, app, action, outcome and request ID. A pending write's view shows what it will send, as a
pending read's does. Your Space keeps no copy of what was sent; the app keeps its own history, and
Twenty records each change with the API key's name.

## 8. Where the Twenty Kit Lives

**Decided (2026-11-26):** in a private kits repository in the project's GitHub organization. The
owner: "twenty kit, put it in a private kit repo on the your space ai org". The workspace installs it
through the GitHub connection (015), pinned to a commit like any kit link. The kit holds the
custom object's own names, which stay out of this repository; this repository's tests use the
neutral fixture app, with write routes, and its docs a neutral example.

A fine-grained GitHub token has one resource owner, so the connection's token must be owned by that
organization, with Contents read on the kits repository; a token owned by another account can't
read it.

The kit adds:

- an **Editor** role, sent with the record credential: `create-` and `update-` routes for companies,
  opportunities and the custom object, and `list-` and `show-` routes for the custom object, also in
  the Reader role. The agent sets `id` on a create and links records with relation IDs such as
  `companyId`;
- a **Setup** role, sent with the setup credential: `create-` and `update-` routes for objects and
  fields under `/rest/metadata`, and reads of them.

No route declares `upsert`, a batch route or a delete. To move the installed app to the new kit, the
owner removes it, keeping its data, installs it again from the kit, binds both keys and grants the
agent again: a kit change retires agent access, as today.

**Considered:** the owner's own private kits repository (the recommendation); installing the kit
file from the server with `install-app --kit -`, with no repository; a Twenty kit in this repository
or the official kits repository.

## User Scenarios

1. **Let my agent set up the app.** The owner binds an Admin-role key as the kit's setup credential
   and grants an agent the Setup role. The agent adds a field to the custom object. Another agent
   with only the Editor role can't call that route, and its requests never carry the admin key.
2. **Let my agent add and link records.** The owner binds the record key and grants an agent the
   Editor role. The agent creates a company, then an opportunity with that company's ID, then a
   record of the custom object linked to both; in Twenty, the records show each other. A write the
   owner left on Ask waits; the owner sees what it will send, and approves or denies it. A denied
   write changes nothing in Twenty.
3. **Update a record.** The agent changes one field of the opportunity; Twenty changes only that
   field.
4. **Let it run.** The owner sets `create-company` to Allow; the agent's next creates run directly.
5. **Stop it.** The owner removes the Editor role while the agent runs; its next write is denied and
   nothing reaches Twenty. Key rotation, revocation and disabling work as for reads.

## Requirements

- **FR-001**: A version 2 kit route may declare `method: POST`, `PATCH`, `PUT` or `DELETE`, with no
  `effect`; a `GET` keeps `effect: read`. A route declares no body fields. A new kit that declares
  `effect: write` is refused; a stored route with it stays out of every role.
- **FR-002**: A kit declares either one `credential`, as today, or named `credentials`; with named
  credentials each route names one and a role's routes all name the same one. The owner binds each
  credential separately; each is stored encrypted under the data key and moved by its rotation. A
  route whose credential isn't bound is unavailable, and a request carries only its route's
  credential. The dashboard shows each role's credential.
- **FR-003**: Invocation input has `path`, `query` and `body`. A write's body is JSON of at most 32
  KiB, sent to the app as JSON and checked no further. A read has no body. Path parameters and query
  fields stay declared and scalar, and an undeclared one is refused.
- **FR-004**: The gateway sends each write once and returns the app's response. A write's outcome
  maps as a read's does, except that a 2xx whose response fails the response check is `succeeded`
  without a result.
- **FR-005**: The response check refuses a response that contains any credential bound to the
  installation.
- **FR-006**: Approvals work for writes as for reads: the owner's setting, then the kit's
  `approval`, else Ask for a write and Allow for a read.
- **FR-007**: `your-space agent invoke`'s input file may have `body`.
- **FR-008**: The neutral fixture app gains create, update and delete routes, and the server and
  browser tests cover them: a write that asks and is approved or denied, one set to Allow, a body
  over the limit or not JSON, an undeclared query field, a route on an unbound credential, a role that
  mixes credentials, a response that contains another bound credential, and a 2xx whose response
  fails the check.
- **FR-009**: [Give an external agent access to one app](../../docs/apps/agent-access.md), 005's
  contracts, the decision record and the roadmap describe writes when they ship, and say that
  retries, duplicates and stale edits are the app's and the agent's.
- **FR-010**: Acceptance needs a live run: a real external agent, with only its Your Space key, adds
  a field to a custom object through the Setup role, then creates a company, an opportunity and a
  custom object record in a Twenty installation at the kit's pinned release, links them, updates
  one, has one approved and one denied; the records are then checked in Twenty.

## Sources

- Twenty v2.62.0, commit `548ecf1376ab3424abdb178daa4c6590867298ce`, the release the owner's kit
  pins: [REST controller](https://github.com/twentyhq/twenty/blob/548ecf1376ab3424abdb178daa4c6590867298ce/packages/twenty-server/src/engine/api/rest/core/controllers/rest-api-core.controller.ts),
  [create handler](https://github.com/twentyhq/twenty/blob/548ecf1376ab3424abdb178daa4c6590867298ce/packages/twenty-server/src/engine/api/rest/core/handlers/rest-api-create-one.handler.ts),
  [update handler](https://github.com/twentyhq/twenty/blob/548ecf1376ab3424abdb178daa4c6590867298ce/packages/twenty-server/src/engine/api/rest/core/handlers/rest-api-update-one.handler.ts),
  [upsert parser](https://github.com/twentyhq/twenty/blob/548ecf1376ab3424abdb178daa4c6590867298ce/packages/twenty-server/src/engine/api/rest/input-request-parsers/upsert-parser-utils/parse-upsert-rest-request.util.ts),
  [API key roles](https://github.com/twentyhq/twenty/blob/548ecf1376ab3424abdb178daa4c6590867298ce/packages/twenty-server/src/engine/core-modules/api-key/api-key.resolver.ts).
  The table under [Twenty's REST writes, checked live](#twentys-rest-writes-checked-live) was run
  on 2026-11-26 against its Compose file with synthetic records.
- This repository: `server/src/apps/agent-kit.ts`, `server/src/agents/invoke.ts`,
  `server/src/agents/store.ts`, `server/src/agents/transport.ts`, `server/src/apps/keys.ts`,
  `deploy/Caddyfile`, `cli/src/commands/agent.ts`, and the cut of writes in commit `2ea4a71`.
