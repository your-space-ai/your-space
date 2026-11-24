---
title: "Give an external agent access to one app"
---

Install an app with a version 2 kit that declares agent routes. Open **Agents**, choose the installation, and inspect its kit source, roles, and allowed methods and routes. Bind a scoped app credential and select the roles available for delegation. The app checks that credential when it receives a request. An installed app without agent routes remains available through its usual web interface.

To add agent routes to an app that is already installed, remove it from **Apps** and keep its data, then install it again from its version 2 kit with **Reuse kept data**.

## Grant access to an agent

Agents only read. A kit declares GET routes with `effect: read`, and Your Space refuses a kit that
declares a route that creates or changes records.

Create a named agent. Grant it roles for this installation and choose when each route asks you
first. A route set to Ask or Allow here overrides the kit's recommendation; otherwise the kit's
recommendation applies, and a route without one runs directly.

Issue a key and store it in the external agent’s secret environment as `YOUR_SPACE_AGENT_KEY`. Set `YOUR_SPACE_URL` to the workspace HTTPS origin (or HTTP on localhost for a local test). Run these commands on the agent machine:

```sh
your-space agent actions --json
your-space agent invoke <installation-id> <action-id> --input-stdin --json < input.json
your-space agent request <request-id> --json
```

Use the fields declared by the action under `path` and `query` in the input file. A read that asks
you first returns a pending request ID; check it with `your-space agent request` once you have
decided.

Review pending requests in **Agents**. Approve or deny the exact request and check the activity entry. Rotate or revoke a key there, narrow the grant, or disable the agent. Your Space keeps the app credential on the server.
