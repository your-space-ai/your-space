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
    manager: {title: Manager, routes: [list-items, update-item]}
  routes:
    list-items:
      method: GET
      path: /items
      effect: read
      approval: allow
      queryFields: {limit: integer}
      outputFields: [id, title]
    update-item:
      method: PATCH
      path: /items/{id}
      effect: write
      approval: ask
      pathParams: {id: uuid}
      bodyFields: {title: string}
      operationId: {in: header, name: Idempotency-Key}
      expectedRevision: {in: header, name: If-Match}
      outputFields: [id, title, revision]
```

The credential entry is a binding name and injection recipe. The owner supplies or authorizes the credential through the platform. Resolve it only for this installation and registered service. Accept reviewed authentication header names/schemes; reject routing, cookie and hop-by-hop headers, arbitrary hosts, redirects, raw paths and caller-supplied headers. Match one canonical method and relative path template; validate and encode each parameter, allowlisted query and body field. Reject ambiguous routes, unknown role references and unsupported fields. Filter provider results and errors to prevent disclosure of credentials or data outside the declared response.

Present kit origin and review status separately from owner authorization. Vetted status requires evidence tied to the exact revision from a trusted review source, never a self-asserted kit flag. Use the recorded kit recommendations as initial preferences; expose effective policy and overrides in ordinary language. An owner must review permission expansions and weaker defaults on upgrade. Previously issued grants stay bound to their accepted route set pending that decision.

A write route declares where its supported upstream operation ID goes. An edit route also declares where its expected revision goes. Allow a dedicated validated header or typed body field for each; reserve those names against agent input and authentication/routing headers. The server inserts the stored values after approval. A declaration alone proves no semantics: qualify conflict handling, receipt lookup and safe retry against the pinned API or an independent app-side handler before enabling writes.


## Supported declarations

Use a distinct lowercase ID for each role and route. Supported methods are GET, POST, PUT, PATCH and DELETE; only GET may be marked read. A role references route IDs in its own installation. Define scalar fields as `string`, `uuid`, `integer` or `boolean`. Path parameters are required, limited to one URL segment and declared in `pathParams`; query and body fields are optional and allowlisted. Write routes bind `operationId` to a body field or the `Idempotency-Key` header. PUT, PATCH and DELETE also require `expectedRevision`, bound to a body field or `If-Match` (one quoted strong ETag).

The credential recipe supports an Authorization bearer token or a raw key in `X-API-Key`, `API-Key` or `SecretKey`. Choose a mechanism the target service actually supports. Configure the credential value separately in Your Space. A result may be a record, a list of records or null; only declared scalar fields are returned. An invalid result fails with a generic error. Additional credential formats or richer response shapes require a contract change.

A write may declare `receipt: {route: lookup-operation, param: op}`. The lookup must be a GET read with exactly one string path parameter for the original operation ID. A role granting the write must also grant its receipt route. Lookup can then use the unchanged operation ID to reconcile an uncertain outcome within the original installation and actor scope.

Your Space doesn't look up reviews of a kit. (Superseded 2026-11-23: a kit directory set with `YS_KITS_REPOSITORY` could hold review records under `reviews/sha256/<kit-file-sha256>.json`, and Agents showed a link to a matching record or "No verified review for this kit revision." No directory or review records exist, so the line suggested vetting that isn't there. Both left the alpha; see the [alpha scope](../../../docs/architecture/decisions.md#alpha-scope).)
