---
title: "Give an external agent access to one app"
---

Install an app with a version 2 kit that declares agent routes. Open **Agents**, choose the installation, and inspect its kit source, roles, and allowed methods and routes. Bind a scoped app credential and select the roles available for delegation. The app checks that credential when it receives a request. An installed app without agent routes remains available through its usual web interface.

To add agent routes to an app that is already installed, remove it from **Apps** and keep its data, then install it again from its version 2 kit with **Reuse kept data**.

## Grant access to an agent

A role grants an agent routes, each at its HTTP method. A read is a `GET` with `effect: read`; a
write is a `POST`, `PATCH`, `PUT` or `DELETE` and declares no effect. Your Space checks the route and
its method, not what a write sends: the app checks the body, so bind a credential whose role in the
app can do only what you want agents to do. A body can do anything the app accepts on that route,
such as creating a linked record along with its own.

```yaml
routes:
  create-item: {method: POST, path: /items}
  edit-item: {method: PATCH, path: "/items/{id}", pathParams: {id: uuid}}
```

Put writes in roles of their own, and deletes in roles apart from creates and edits, so you grant
each on purpose.

Create a named agent. Grant it roles for this installation and choose when each route asks you
first. A route set to Ask or Allow here overrides the kit's recommendation; otherwise the kit's
recommendation applies. A write without one asks you first, and a read without one runs directly.

Issue a key and store it in the external agent’s secret environment as `YOUR_SPACE_AGENT_KEY`. Set `YOUR_SPACE_URL` to the workspace HTTPS origin (or HTTP on localhost for a local test). Run these commands on the agent machine:

```sh
your-space agent actions --json
your-space agent invoke <installation-id> <action-id> --input-stdin --json < input.json
your-space agent request <request-id> --json
```

Use the fields declared by the action under `path` and `query` in the input file, and put a write's
body under `body`, as JSON of at most 32 KiB; Your Space sends it to the app as it is. A request that
asks you first returns a pending request ID; check it with `your-space agent request` once you have
decided.

Your Space sends each write once and doesn't match a retry to an earlier write. When a write's
outcome is `unknown`, the app may or may not have applied it: check in the app before sending it
again. An app that lets a create choose its record ID, and refuses a second create of the same ID
before changing anything else, lets an agent retry a create safely.

A request returns the app's JSON response under `result`, unchanged: the shape its API gives, up to
256 KiB. Your Space withholds a response that isn't JSON, is larger, or contains the app credential.
A read's status is then `unknown`; a write the app answered with success is `succeeded`, without a
result, since the app applied it. A kit doesn't name the fields an agent gets back, so
the app credential's scope limits what a granted route returns: bind a credential that can see only
what you want agents to read.

Review pending requests in **Agents**. Approve or deny the exact request and check the activity entry. Rotate or revoke a key there, narrow the grant, or disable the agent. Your Space keeps the app credential on the server.
