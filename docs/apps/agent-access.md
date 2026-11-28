---
title: "Give an external agent access to one app"
---

Agent access is per app. Granting an agent an app lets it call that app's API through Your Space,
with an app key you bind. Your Space attaches the key to each call; the agent never sees it, and uses
only its own Your Space key. What the agent can do is what that app key's role in the app allows:
for an agent that should do less, make a narrower key in the app.

## Kit

A version 2 kit says where the app's API lives and how its key is sent:

```yaml
agentAccess:
  api: /rest
  credential:
    binding: api-key
    inject: {location: header, name: Authorization, scheme: Bearer}
```

`api` is the path the agent's calls must be under; `/` is the whole app. A kit can name several
keys instead, which you bind separately and pick from for each agent, such as a record key and an
admin key:

```yaml
agentAccess:
  api: /rest
  credentials:
    records: {inject: {location: header, name: Authorization, scheme: Bearer}}
    admin: {inject: {location: header, name: Authorization, scheme: Bearer}}
```

The key header can be `Authorization` with `Bearer`, or `X-API-Key`, `API-Key` or `SecretKey`. A
kit lists no roles or routes; one that does, from before agent access per app, is refused, and an
app installed from one shows that its agent access is unavailable until it runs a kit that names
`api`. An installed app without `agentAccess` stays available through its usual web interface.

## Bind the app's keys

Open **Agents**, then **App connections**, choose the app and paste each key. Replacing a key keeps
the agents that use it, on the new key. **Disconnect** forgets the keys here; delete them in the app
too.

## Give an agent the app

Create a named agent. Under its app access, pick the app key it uses. Nothing asks you first unless
you add a route that does: a method and a path, where `*` stands for one path segment, such as
`DELETE /rest/people/*`. Matching ignores letter case, a trailing slash and the query. Each agent
has its own list for each app. **Remove access** ends it.

Issue a key and store it in the external agent’s secret environment as `YOUR_SPACE_AGENT_KEY`. Set
`YOUR_SPACE_URL` to the workspace HTTPS origin (or HTTP on localhost for a local test). Run these
commands on the agent machine:

```sh
your-space agent apps --json
your-space agent call <installation-id> GET '/rest/companies?limit=5' --json
your-space agent call <installation-id> POST /rest/companies --body-stdin --json < body.json
your-space agent request <request-id> --json
```

A call is `GET`, `POST`, `PATCH`, `PUT` or `DELETE` and a path under the app's `api`, with a query
after `?` and, except for a `GET`, a JSON body of at most 32 KiB, sent to the app as it is. A body
can do anything the app accepts there, such as creating a linked record along with its own. Your
Space refuses a path outside the API, one with `;`, an empty, `.` or `..` segment, or an escaped `/`,
`\` or `%`, so the app sees the path Your Space checked. A call that asks you first returns a pending
request ID; check it with `your-space agent request` once you have decided.

Your Space sends each call once and doesn't match a retry to an earlier one. When an outcome is
`unknown`, the app may or may not have applied it: check in the app before sending it again. An app
that lets a create choose its record ID, applies a create as a whole or not at all, and refuses a
second create of the same ID before changing anything, lets an agent retry a create safely. Stale
edits are the app's to handle.

A call returns the app's JSON response under `result`, unchanged, up to 256 KiB. Your Space
withholds a response that isn't JSON, is larger, or contains any key bound to the app. A read's
status is then `unknown`; a write the app answered with a 2xx status is `succeeded`, without a
result. `succeeded` means only that the app answered with a 2xx status other than `202 Accepted`,
which is `unknown`; when it matters that the work finished, check in the app.

Review pending calls in **Agents**. Approve or deny the exact call and check its activity entry,
which shows the method and path without the query. Rotate or revoke an agent's key, remove its
access to an app, or disable the agent there.

## When a kit changes, or an app is removed

A new kit, source, commit or Compose file for an installed app keeps its keys and its agents'
access; pending calls go stale. A key the new kit no longer names stays stored, and an agent using
it can't reach the app until you pick another. Removing an app, even keeping its data, ends its
agents' access and forgets its keys; installing it again starts with none.
