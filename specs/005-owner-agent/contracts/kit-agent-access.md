# Installation kit extension for agent access (proposed)

Extend the [002 installation kit](../../../specs/002-install-an-app/contracts/kit-format.md). Version 1 keeps its current behavior and grants zero agent routes. A new version adds declarative role and route tables. Older servers reject unsupported versions atomically. Registration stores the exact source revision or local digest. App-specific declarations live in the independent kits repository.

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
      outputFields: [id, title]
    update-item:
      method: PATCH
      path: /items/{id}
      effect: write
      approval: ask
      pathParams: {id: uuid}
      bodyFields: {title: string}
      outputFields: [id, title, revision]
```

The credential entry is a binding name and injection recipe. The owner supplies or authorizes the credential through the platform. Resolve it only for this installation and registered service. Accept reviewed authentication header names/schemes; reject routing, cookie and hop-by-hop headers, arbitrary hosts, redirects, raw paths and caller-supplied headers. Match one canonical method and relative path template; validate and encode each parameter, allowlisted query and body field. Reject ambiguous routes, unknown role references and unsupported fields. Filter provider results and errors to prevent disclosure of credentials or data outside the declared response.

Present kit origin and review status separately from owner authorization. Vetted status requires evidence tied to the exact revision from a trusted review source, never a self-asserted kit flag. Use the recorded kit recommendations as initial preferences; expose effective policy and overrides in ordinary language. An owner must review permission expansions and weaker defaults on upgrade. Previously issued grants stay bound to their accepted route set pending that decision.
