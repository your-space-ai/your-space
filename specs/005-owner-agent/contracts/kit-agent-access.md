# Installation kit extension for agent access

Extend the [002 installation kit](../../002-install-an-app/contracts/kit-format.md). Version 1 keeps its current behavior and grants zero agent routes. A new version adds declarative role and route tables. Older servers reject unsupported versions atomically. Registration stores the exact source revision or local digest. App-specific declarations live in the independent kits repository.

To add these declarations to an installed app, remove the app, keeping its data, and install it again with the version 2 kit. (Superseded 2026-11-23: `your-space app upgrade-agent-kit` upgraded a local version 1 kit in place, a one-off for installs from before version 2 kits and labelled interfaces. It left the alpha with no release depending on it; see the [alpha scope](../../../docs/architecture/decisions.md#alpha-scope).)


Illustrative format for a neutral fixture. A role refers to route IDs so a method/path definition and approval setting are shared by all roles.

```yaml
kit: 2
agentAccess:
  credential:
    binding: app-api
    inject: {location: header, name: Authorization, scheme: Bearer}
  roles:
    viewer: {title: Viewer, routes: [list-items]}
    inspector: {title: Inspector, routes: [list-items, show-item]}
  routes:
    list-items:
      method: GET
      path: /items
      effect: read
      approval: allow
      queryFields: {limit: integer}
    show-item:
      method: GET
      path: /items/{id}
      effect: read
      approval: ask
      pathParams: {id: uuid}
```

The credential entry is a binding name and injection recipe. The owner supplies or authorizes the credential through the platform. Resolve it only for this installation and registered service. Accept reviewed authentication header names/schemes; reject routing, cookie and hop-by-hop headers, arbitrary hosts, redirects, raw paths and caller-supplied headers. Match one canonical method and relative path template; validate and encode each parameter and allowlisted query field. Reject ambiguous routes, unknown role references and unsupported fields. Pass the app's JSON response to the agent unchanged, and refuse one that contains the app credential; never pass on provider errors.

Present kit origin and review status separately from owner authorization. Vetted status requires evidence tied to the exact revision from a trusted review source, never a self-asserted kit flag. Use the recorded kit recommendations as initial preferences; expose effective policy and overrides in ordinary language. An owner must review permission expansions and weaker defaults on upgrade. Previously issued grants stay bound to their accepted route set pending that decision.

Agents only read (2026-11-23, [alpha scope](../../../docs/architecture/decisions.md#alpha-scope)). A route that declares `effect: write`, a method other than GET, `bodyFields`, `operationId`, `expectedRevision` or `receipt` is refused, and the message says agents only read. A kit stored before then keeps its write routes on record, but the gateway leaves them out of every role. (Superseded: write routes declared an upstream operation ID, an edit's expected revision and an optional receipt lookup, which only a fixture ever exercised.)


## Supported declarations

Use a distinct lowercase ID for each role and route. Every route is `method: GET` with `effect: read`. A role references route IDs in its own installation. Define scalar fields as `string`, `uuid`, `integer` or `boolean`. Path parameters are required, limited to one URL segment and declared in `pathParams`; query fields are optional and allowlisted.

The credential recipe supports an Authorization bearer token or a raw key in `X-API-Key`, `API-Key` or `SecretKey`. Choose a mechanism the target service actually supports. Configure the credential value separately in Your Space. The agent gets the app's JSON response as the app returned it: any shape, of at most 256 KiB. A response that isn't JSON, is larger, or contains the app credential, raw or JSON-escaped, fails with a generic error and nothing is saved. Additional credential formats require a contract change.

A route declares no output (2026-11-24, [decision](../../../docs/architecture/decisions.md#kit-defined-roles-server-held-credentials-and-approvals)). A route that declares `outputFields` is refused, and the message says the app's response is passed through. A kit stored before then keeps `outputFields` on record, and the gateway ignores it. Limit what a granted route returns with the bound credential's scope in the app. (Superseded 2026-11-24: each route listed `outputFields`, and the gateway returned only those top-level scalar fields of a record or a list of records. Real REST APIs such as Twenty's wrap lists, as in `{data: {companies: [...]}, pageInfo, totalCount}`, and nest fields such as `name.firstName`, which flat scalar fields can't describe, so the gateway returned empty rows or refused the response.)

Your Space doesn't look up reviews of a kit. (Superseded 2026-11-23: a kit directory set with `YS_KITS_REPOSITORY` could hold review records under `reviews/sha256/<kit-file-sha256>.json`, and Agents showed a link to a matching record or "No verified review for this kit revision." No directory or review records exist, so the line suggested vetting that isn't there. Both left the alpha; see the [alpha scope](../../../docs/architecture/decisions.md#alpha-scope).)
