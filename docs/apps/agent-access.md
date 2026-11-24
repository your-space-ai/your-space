---
title: "Give an external agent access to one app"
---

Install an app with a version 2 kit that declares agent routes. Open **Agents**, choose the installation, and inspect its kit source, roles, and allowed methods and routes. Bind a scoped app credential and select the roles available for delegation. The app checks that credential when it receives a request. An installed app without agent routes remains available through its usual web interface.

To add agent routes to an app that is already installed, remove it from **Apps** and keep its data, then install it again from its version 2 kit with **Reuse kept data**.

## Grant access to an agent

Create a named agent. Grant it roles for this installation and choose the approval settings. **Ask for all writes** overrides an individual route set to Allow. Otherwise the route override takes precedence over the kit recommendation. With neither setting, the kit recommendation applies. A route without a recommendation runs reads directly and asks for writes.

Issue a key and store it in the external agent’s secret environment as `YOUR_SPACE_AGENT_KEY`. Set `YOUR_SPACE_URL` to the workspace HTTPS origin (or HTTP on localhost for a local test). Run these commands on the agent machine:

```sh
your-space agent actions --json
your-space agent invoke <installation-id> <action-id> --input-stdin --json < input.json
your-space agent request <request-id> --json
```

Use the fields declared by the action under `path`, `query` and `body` in the input file. For writes, supply a persistent `--operation-id` for each logical operation and the action’s `--expected-revision` when requested. For a kit that uses the HTTP `If-Match` header, pass the app’s quoted entity tag, for example `--expected-revision '"1"'`. Keep the original operation ID if the response is lost. An uncertain outcome needs reconciliation before another attempt.

Review pending requests in **Agents**. Approve or reject the exact change and check the activity entry and resulting app state. Rotate or revoke a key there, narrow the grant, or disable the agent. Your Space keeps the app credential on the server.
