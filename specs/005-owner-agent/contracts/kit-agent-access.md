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
      outputFields: [id, title]
    show-item:
      method: GET
      path: /items/{id}
      effect: read
      approval: ask
      pathParams: {id: uuid}
      outputFields: [id, title, revision]
```

The credential entry is a binding name and injection recipe. The owner supplies or authorizes the credential through the platform. Resolve it only for this installation and registered service. Accept reviewed authentication header names/schemes; reject routing, cookie and hop-by-hop headers, arbitrary hosts, redirects, raw paths and caller-supplied headers. Match one canonical method and relative path template; validate and encode each parameter and allowlisted query field. Reject ambiguous routes, unknown role references and unsupported fields. Filter provider results and errors to prevent disclosure of credentials or data outside the declared response.

Present kit origin and review status separately from owner authorization. Vetted status requires evidence tied to the exact revision from a trusted review source, never a self-asserted kit flag. Use the recorded kit recommendations as initial preferences; expose effective policy and overrides in ordinary language. An owner must review permission expansions and weaker defaults on upgrade. Previously issued grants stay bound to their accepted route set pending that decision.

Agents only read (2026-11-23, [alpha scope](../../../docs/architecture/decisions.md#alpha-scope)). A route that declares `effect: write`, a method other than GET, `bodyFields`, `operationId`, `expectedRevision` or `receipt` is refused, and the message says agents only read. A kit stored before then keeps its write routes on record, but the gateway leaves them out of every role. (Superseded: write routes declared an upstream operation ID, an edit's expected revision and an optional receipt lookup, which only a fixture ever exercised.)


## Supported declarations

Use a distinct lowercase ID for each role and route. Every route is `method: GET` with `effect: read`. A role references route IDs in its own installation. Define scalar fields as `string`, `uuid`, `integer` or `boolean`. Path parameters are required, limited to one URL segment and declared in `pathParams`; query fields are optional and allowlisted.

The credential recipe supports an Authorization bearer token or a raw key in `X-API-Key`, `API-Key` or `SecretKey`. Choose a mechanism the target service actually supports. Configure the credential value separately in Your Space. A result may be a record, a list of records or null; only declared scalar fields are returned. An invalid result fails with a generic error. Additional credential formats or richer response shapes require a contract change.

Your Space doesn't look up reviews of a kit. (Superseded 2026-11-23: a kit directory set with `YS_KITS_REPOSITORY` could hold review records under `reviews/sha256/<kit-file-sha256>.json`, and Agents showed a link to a matching record or "No verified review for this kit revision." No directory or review records exist, so the line suggested vetting that isn't there. Both left the alpha; see the [alpha scope](../../../docs/architecture/decisions.md#alpha-scope).)
