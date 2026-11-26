# Feature Specification: Agent Writes

**Feature Branch**: `017-agent-writes`

**Created**: 2026-11-26

**Status**: Proposed. Nine decisions are open, each with a recommendation. Nothing is built.

**Input**: The owner, on 2026-11-26: an agent should be able to do real work in an app through Your
Space, never holding the app's own credential. The first case is onboarding records into a CRM:
create companies, opportunities and records of a custom object, link them to each other, and
update them later.

**Related**: [decision record](../../docs/architecture/decisions.md#alpha-scope) (the 2026-11-23
cut of agent writes and the 2026-11-24 pass-through of an app's response), journey
[005](../005-owner-agent/spec.md) and its [kit contract](../005-owner-agent/contracts/kit-agent-access.md)
and [gateway contract](../005-owner-agent/contracts/gateway.md), and
[Give an external agent access to one app](../../docs/apps/agent-access.md).

## At a Glance

- **Who:** an owner who wants an external agent to create and change records in an installed app,
  with the same key, roles, approvals and activity that reads use today.
- **Done when:** a version 2 kit can declare routes that create and update records, with a JSON
  body; an agent invokes them through `your-space agent invoke` with only its Your Space key; writes
  ask the owner first unless the owner allows them; a retried write never applies twice through
  Your Space; the owner sees what each write sent and what it did; and a live external agent has
  created, linked and updated records in a real Twenty installation through the kit's routes.
- **Not covered:** changing an app's data model (custom objects and fields), batch writes, and
  anything an app's credential can't already do. Deleting records is decision 2.

## Decisions

Open. Each section below gives the options, the trade-offs and a recommendation.

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | Are schema and admin operations, such as creating a custom object, in scope? | Out. Agents change records; the owner shapes the app's data model in the app |
| 2 | Can a kit declare routes that delete records? | Not yet. Create and update only; delete waits for a case that needs it |
| 3 | How does a kit declare a write's body? | The top-level field names the route accepts, each value any JSON; the app validates the values |
| 4 | What makes a retried write safe? | An operation ID on every write, kept by Your Space: the same ID returns the first outcome and never sends the write again |
| 5 | What happens to an edit made on a record that changed since the agent read it? | The later write wins, and only the fields it names change. Refusing a stale edit needs the app's support, which Twenty lacks |
| 6 | When does a write ask the owner first? | Always, unless the owner sets the route to Allow; Ask for all writes comes back; a pending write waits 24 hours |
| 7 | What does the owner see of what a write changed? | Activity shows each write, its record and its outcome; the owner can open the exact body sent for 30 days |
| 8 | Where does the Twenty kit with write routes live? | In the owner's own kits repository, private, installed through the GitHub connection (015), not in this repository |
| 9 | Which release carries it? | Canary as each pull request merges, and alpha.2; the owner's workspace follows Canary until then |

## What Exists Today

Agents read, with approvals (2026-11-23, [Alpha scope](../../docs/architecture/decisions.md#alpha-scope)):

- **Kit format.** `agentAccess` declares a credential recipe, roles and routes. Every route is a
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
- **Response check.** A 2xx response must be JSON of at most 256 KiB and must not contain the app
  credential, raw or JSON-escaped; it then reaches the agent unchanged (2026-11-24). Otherwise the
  request's status is `unknown`. Other 4xx statuses are `refused`, and the app's error body is
  never passed on.
- **Approvals.** Per agent and installation, each route is Ask or Allow by the owner's override,
  then the kit's `approval`, else Allow. A pending request stores its input encrypted, binds a
  fingerprint of the rendered request, the key and the binding and grant revisions, and expires
  after 15 minutes. Approval re-admits it under current authority and dispatches it once.
- **Activity.** Each request records agent, key, installation, route, status and time. The owner
  sees request ID, actor, delegating owner, app, action and outcome, paged. A succeeded result is
  kept encrypted for the agent for a day.
- **Storage left from before the cut.** `agent_grant.ask_all_writes`, `agent_request.operation_id`
  and the unique index on agent, app, route and operation ID still exist, unread. The data-key
  rotation already moves `agent_request.input` and `result`.
- **CLI.** `your-space agent actions`, `invoke <installation-id> <action-id> --input-stdin` and
  `request <id>`. No operation ID.
- **The owner's Twenty kit** declares a Reader role over list and show routes for companies, people
  and opportunities, with Twenty's REST API under `/rest` and the bound API key as a bearer token.

### Why writes were cut, and what answers it

The 2026-11-23 cut gave two reasons. Each needs an answer before writes return:

1. **Writes had run only against a fixture.** Acceptance here requires a live external agent
   writing to a real Twenty installation at the kit's pinned release, and a check of the records in
   Twenty afterwards (FR-014).
2. **Most app APIs ignore `Idempotency-Key` and `If-Match`.** The removed design passed an operation
   ID to the app as `Idempotency-Key` and an expected revision as `If-Match`, and relied on the app
   to honor both. Twenty v2.62.0 ignores both: two creates with the same `Idempotency-Key` made two
   records, and a `PATCH` with a stale `If-Match` was applied. So this spec makes the retry
   guarantee Your Space's own, never resending a write (decision 4), and doesn't claim stale-edit
   refusal for an app that can't provide it (decision 5).

### Twenty's REST writes, checked live

Against a disposable Twenty v2.62.0, with an API key whose role reads and updates every object but
can't delete, destroy or change settings (2026-11-26):

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
| `DELETE /rest/companies/{id}` | `403`, the role can't delete |
| `POST /rest/metadata/objects` with that key | `403`; an admin's token creates the object |
| `POST /rest/<plural name>` for a custom object | `201`; a custom object has REST routes at its plural name |
| `POST /rest/batch/companies` with two records | `201`; both created |

A create's response is the whole record under `data.create<Object>`, and an update's under
`data.update<Object>`; Twenty records the API key's name as `createdBy`. A field the data model
doesn't have is refused with `400`. These shape the decisions: Twenty honors a client-chosen record
ID (decision 4), `upsert` and nested relation input make a route do more than its name says
(decision 3), and an API key's role can already exclude deletes and the data model (decisions 1
and 2).

## What's Missing

For an agent to create and update records:

1. **Write effects in the kit.** Routes with `POST`, `PATCH` or `PUT` that declare what they do,
   told apart from the legacy `effect: write` routes stored before the cut, so an upgrade never
   widens a grant the owner made for reads. Proposed: `effect: create` and `effect: update`, new
   names a stored legacy route can't have, and the gateway keeps leaving `effect: write` out.
2. **Request bodies.** Input gains `body`. Twenty's bodies are nested (`name`, `domainName:
   {primaryLinkUrl}`, `amount: {amountMicros, currencyCode}`), like the responses that ended
   `outputFields`, so flat scalar body fields don't fit (decision 3).
3. **Body checks and limits.** A JSON object of at most 32 KiB and 16 levels deep, with only the
   declared top-level fields. A route can't carry an agent-supplied `upsert` or any other undeclared
   query field, and its body names only the fields the kit lists, so `company: {create: …}` is
   refused unless the kit lists `company`.
4. **Retries.** An operation ID required on every write, scoped to the agent, installation and
   route and bound to a fingerprint of the request (decision 4). An outcome that isn't known is
   never resent.
5. **Outcomes for writes.** A 2xx other than `202` means the app applied the write, even when the
   response is then refused for its size or for containing the credential: that is `succeeded`
   with the result withheld, not `unknown`, so the agent doesn't retry an applied write. A `202`
   only says the app accepted the work, so it is `unknown`, as it is for reads today. `409` and
   `412` are `conflict`. A timeout or a 5xx is `unknown`.
6. **Approvals that show the change.** A pending write shows the owner the method, the route with
   its path values, every query value, and the body, formatted, before anything reaches the app. Writes ask first by
   default, and the per-agent Ask for all writes switch returns (decision 6).
7. **What changed.** The owner sees each write's record and outcome, and can open what it sent
   (decision 7).
8. **Discovery and CLI.** `actions` lists each route's effect and body fields;
   `invoke --operation-id <id>` is required for a write; `request <id>` shows a write's outcome.
9. **Roles.** No new mechanism: a kit groups write routes into their own roles, such as an Editor
   beside the Reader, and the owner grants them per agent and installation as today.
10. **The response check** stays as it is for reads and applies to writes' responses too.
11. **The Twenty kit's routes** (decision 8): create and update for companies, opportunities and
    the custom object, with each body's fields named, `id` among a create's, and relation IDs such
    as `companyId` for links; list and show for the custom object, so an agent can look a record up
    before creating it and after an outcome it doesn't know.

Storage needs no migration: `ask_all_writes`, `operation_id` and its unique index are there, and
`input` and `result` are already covered by the data-key rotation.

## 1. Schema and Admin Operations

**Recommended:** out. A kit declares routes that create and change records; it doesn't declare
routes that change an app's data model, and the owner creates a custom object and its fields in the
app, once, as an admin. The owner binds an app credential whose role can't change the data model;
Twenty's API key roles do this today (a key without settings permission got `403` creating an
object).

Why: a schema change affects every user of the app and its own interface, can't be undone the way
a record edit can, and is rare: for onboarding it happens once, before any records. Your Space
can't tell an admin route from a record route by its path; the credential's role can.

**Considered:** schema routes in the kit, always asking first. The approval would show an object
definition the owner would rather make in the app's own settings, and the agent's credential would
need admin rights for every other route too.

## 2. Deleting Records

**Recommended:** not in this spec. The parser accepts `effect: create` and `effect: update` and
refuses `DELETE` and `effect: delete`, saying delete isn't supported yet. Onboarding doesn't need
it, a delete is the one write an agent can't correct with another write, and Twenty's API key role
can exclude it. A later change can add `effect: delete`, always asking first.

**Considered:** `effect: delete` now, always asking first, with no Allow. It adds a third approval
rule and a route no current kit would use.

## 3. A Write's Body

**Recommended:** a route lists the top-level fields its body accepts, and each value is any JSON:

```yaml
create-company:
  method: POST
  path: /rest/companies
  effect: create
  bodyFields: [id, name, domainName, linkedinLink, address]
  required: [id]
```

The gateway refuses a body that isn't a JSON object, is over 32 KiB, nests deeper than 16 levels,
or has a field the route doesn't list. It doesn't check values: the app validates them and refuses
a bad one with a 4xx, which the agent sees as `refused`. `required` lists fields the body must have.
This mirrors the 2026-11-24 decision for responses: describing a real API's nested shapes in the
kit didn't work, so the kit names what may be sent and the app's own rules and the credential's role
limit what it does. Naming top-level fields still matters: it keeps a route to what its name says,
since Twenty's `company: {create: …}` would create another record, and a field such as
`createdBy` or `position` can be left out.

**Considered:** typed nested body schemas (JSON Schema). Exact, but every custom field and composite
type would need declaring, the kit would break when the app's model changes, and the gateway would
repeat validation the app already does. **Considered:** any JSON object, with no field list. Simpler,
but a create route could then also create linked records or set fields the owner didn't mean to
delegate.

## 4. Retrying a Write

**Recommended:** every write carries an operation ID the agent chooses, up to 128 printable
characters, and Your Space keeps it with the request, unique per agent, installation and route:

- The same operation ID with the same input returns the first request's ID and its outcome,
  pending, succeeded, refused or unknown, and sends nothing.
- The same operation ID with other input is a `409` conflict.
- Your Space never sends a write again on its own, and an `unknown` outcome stays unknown.
- A read that finds no record doesn't prove a create failed: the app may still be applying it. So a
  create is sent again, under a new operation ID, only on a route whose `required` fields include a
  record ID the app keeps unique, as Twenty does: the agent picks the ID once and reuses it, and a
  second create with it is refused by the app (Twenty answers `400`, a duplicate entry) instead of
  making a second record. On a create route without one, the agent doesn't resend after an
  `unknown` outcome; it reports the request ID for the owner to check in the app. The kit guide
  says which routes are which.
- An update names the fields it sets, so sending it again sets the same values; the agent may
  resend it under a new operation ID after reading the record.

This needs nothing from the app beyond what Twenty does today. Operation IDs aren't sent to the
app.

**Considered:** sending the operation ID as `Idempotency-Key`, as before the cut. Twenty ignores it,
as most APIs do, so it would promise what the app doesn't keep. **Considered:** reconciling an
unknown outcome automatically with a kit-declared read (the removed `receipt`). It needs a lookup by
operation ID that apps don't have; with a client-chosen ID the agent's own read does the same.

## 5. Stale Edits

**Recommended:** an update is applied as the app applies it: the fields the body names change, and
the others stay as they are. When the record changed since the agent read it, the later write wins.
Your Space doesn't claim to refuse a stale edit for an app that can't, and Twenty can't: it has no
revision or ETag, and ignored `If-Match`. The approval shows exactly which fields change, and an
agent sends only the fields it means to change. A later change can add an optional
`expectedRevision` for apps that refuse a stale `If-Match`.

**Considered:** Your Space reading the record before an update and refusing the write when its
`updatedAt` moved. It narrows the window without closing it, costs a read per write, and needs a
declared read and field for each route.

## 6. Approvals

**Recommended:**

- **Writes ask first.** A write route without an override asks the owner, whatever the kit
  recommends, until the owner sets it to Allow for that agent and installation. A kit may recommend
  `approval: allow` for a write; the dashboard shows the recommendation, and the owner applies it.
- **Ask for all writes comes back**, per agent and installation, and overrides a write route set to
  Allow, as the owner confirmed on 2026-11-21.
- **A pending write waits 24 hours**, not 15 minutes, so a batch of onboarding requests can wait for
  the owner. A read keeps 15 minutes. An agent checks with `your-space agent request <id>`.
- **One decision per request.** Approving one write doesn't approve another; for a batch, the owner
  sets the route to Allow, then back to Ask.

**Considered:** following the kit's recommendation for writes, as reads do. A kit from anywhere
could then make an agent's creates run unseen on the first grant. **Considered:** keeping 15
minutes, which makes the owner approve onboarding as it runs.

## 7. What a Write Changed

**Recommended:** each write in Activity shows the action, the record (the path's ID for an update,
the response's `id` for a create, when it has one), and its outcome. The owner can open the exact
request sent, its method, path and body, for 30 days, encrypted under the data key and readable only
by the owner; after that it is deleted and the entry keeps its metadata. The agent's result is kept
for a day, as for reads. The app keeps its own history of the record: Twenty shows each change with
the API key's name.

This revises 005's FR-08, which kept record contents out of activity: the owner asked to see what an
agent changed, and a body kept encrypted, owner-only and for a bounded time keeps that safe.

**Considered:** metadata only, pointing to the app's own history. It shows what changed only in apps
that keep history. **Considered:** keeping bodies as long as the activity entry. It keeps every
onboarded record's contents twice, indefinitely.

## 8. The Twenty Kit

**Recommended:** the kit's write routes live with the owner's own kits, in a private repository the
owner creates, and the owner's workspace installs it through the GitHub connection (015). This
repository stays generic: its tests use the neutral fixture app, now with create and update routes,
and its docs show a neutral example. A custom object's routes are the owner's own, since its name
and fields are.

The kit adds an Editor role with:

- `create-company`, `update-company`, `create-opportunity`, `update-opportunity`,
  `create-<object>` and `update-<object>`, each with its body's fields, `id` required on creates,
  and relation IDs (`companyId` and the custom object's relation fields) for links;
- `list-<object>` and `show-<object>` for the custom object, also in the Reader role.

No route declares `upsert`, a batch route or a delete. The owner binds a Twenty API key whose role
reads and updates those objects and can't delete, destroy or change settings. To move the installed
app to the new kit, the owner removes it, keeping its data, installs it again from the kit, binds the
key and grants the agent again: a kit change retires agent access, as today.

**Considered:** publishing a Twenty kit in this repository or in the official kits repository.
Twenty is a third-party app, and the owner's custom object is theirs.

## 9. Which Release Carries It

**Recommended:** each pull request merges to `main` and reaches Canary as it merges; alpha.2 carries
all of it. The owner's workspace moves to Canary with `your-space upgrade --channel canary` to use
agent writes before alpha.2, and the onboarding runs there.

**Considered:** waiting for alpha.2; holding the rest of alpha.2 for this.

## User Scenarios

1. **Let my agent add records.** The owner installs the Twenty kit with write routes, binds a key,
   and grants an agent the Editor role. The agent lists its actions and sees each write's effect and
   fields. It creates a company with an ID it chose; the request waits for the owner, who sees the
   body and approves. The agent reads the outcome and the new record.
2. **Link records.** The agent creates an opportunity with that company's ID, and a record of the
   custom object linked to both. In Twenty, the records show each other.
3. **Update a record.** The agent changes one field of the opportunity. Only that field changes.
4. **Let it run.** The owner sets `create-company` to Allow; the agent's next creates run directly.
   The owner turns on Ask for all writes; the next create waits again.
5. **Retry safely.** The agent resends a create with the same operation ID and gets the first
   outcome; nothing is sent. With a new operation ID and the same record ID, Twenty refuses the
   duplicate and the agent sees `refused`.
6. **See what it did.** In Activity, the owner opens a write and sees what was sent and which record
   it made. A request the owner denied changed nothing in Twenty.
7. **Stop it.** The owner removes the Editor role while the agent runs; its next write is denied and
   nothing reaches Twenty. Key rotation, revocation and disabling work as for reads.

## Requirements

- **FR-001**: A version 2 kit route may declare `method: POST`, `PATCH` or `PUT` with `effect:
  create` or `effect: update`, a `bodyFields` list of top-level field names and an optional
  `required` list drawn from it. `GET` stays `effect: read`. `DELETE`, `effect: delete` and
  `effect: write` are refused with a message saying which writes are supported. A stored route with
  `effect: write`, from before the cut, stays out of every role.
- **FR-002**: Invocation input has `path`, `query` and `body`. A write's body is a JSON object of at
  most 32 KiB and 16 levels deep, with only the route's `bodyFields` and all its `required` fields.
  A read has no body. Query fields stay scalar and declared. The gateway sends the body as JSON.
- **FR-003**: Every write carries an operation ID of 1 to 128 printable characters. The same ID for
  the same agent, installation and route returns the first request and its outcome, and sends
  nothing; with other input it is a `409` conflict. Your Space never resends a write. The agent
  guide says a create is resent after an `unknown` outcome only on a route that requires a record
  ID the app keeps unique.
- **FR-004**: A write's outcome is `succeeded` for a 2xx other than `202`, `conflict` for a `409`
  or `412`, `refused` for another 4xx, and `unknown` for a `202`, a timeout, a 5xx or a broken
  connection. A 2xx whose
  response fails the response check is `succeeded` with the result withheld, saying why.
- **FR-005**: A write route asks the owner unless the owner set it to Allow for that agent and
  installation. Ask for all writes, per agent and installation, makes every write ask. A pending
  write waits 24 hours; a read 15 minutes. Approval re-checks current authority and dispatches the
  exact request once.
- **FR-006**: The pending request shows the owner the agent, app, action, method, path, every
  query value and the body, formatted.
- **FR-007**: Activity shows each write's action, record ID when known, and outcome. The owner can
  open the request sent for 30 days; it is stored encrypted under the data key, moved by its
  rotation, and then deleted.
- **FR-008**: `GET /api/agent/actions` lists each route's effect, body fields and required fields.
  `your-space agent invoke` takes `--operation-id`, required for a write, and its input file may
  have `body`.
- **FR-009**: The response check applies to writes as to reads: JSON, at most 256 KiB, never
  containing the app credential.
- **FR-010**: Nothing in this spec changes an app's data model; the docs say to bind a credential
  whose role can't.
- **FR-011**: The neutral fixture app gains create and update routes, and the server and browser
  tests cover writes: approval with the body shown, denial with no change, Allow, Ask for all
  writes, operation ID replay and conflict, an unknown outcome not resent, a refused body field, a
  refused undeclared query field, and the outcome of a 2xx whose response fails the check.
- **FR-012**: The Twenty kit (decision 8) declares the Editor role and routes above and passes the
  parser.
- **FR-013**: [Give an external agent access to one app](../../docs/apps/agent-access.md), 005's
  contracts, the decision record and the roadmap describe writes when they ship.
- **FR-014**: Acceptance needs a live run: a real external agent, with only its Your Space key,
  creates a company, an opportunity and a custom object record in a Twenty installation at the
  kit's pinned release, links them, updates one, has one approved and one denied, and retries one
  with the same operation ID; the records are then checked in Twenty.

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
