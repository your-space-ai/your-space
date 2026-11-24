---
title: "Give an external agent access to one app"
---

Install an app with a version 2 kit that declares agent routes. Open **Agents**, choose the installation, and inspect its kit source, roles, and allowed methods and routes. Bind a scoped app credential and select the roles available for delegation. The app checks that credential when it receives a request. An installed app without agent routes remains available through its usual web interface.

## Add agent routes to an existing local kit

For an app installed with a version 1 kit file, start in your installation folder. Inspect the app to get its `installation` token and the full `sha256:` digest of the installed kit. Copy both values from this output.

```sh
your-space app upgrade-agent-kit <app-name> --inspect --json
your-space app upgrade-agent-kit <app-name> --kit ./kit-v2.yaml \
  --expect-installation <installation> --expect-kit <kitSource>
```

Start with the original file, change `kit: 1` to `kit: 2` and add its `agentAccess` declaration. Keep its existing interface, environment, limits and other installation fields. A kit from before kits gave the environment in `env` names the same values there: its `generate`, `derive` and `set` entries, and each name in `secrets` as `{ ask: optional }`. To pipe the file, use `--kit - < kit-v2.yaml`. The upgrade preserves the app’s installation ID and data. A running installation refreshes its interface if needed. A stopped installation stays stopped. The owner still needs to bind a credential, enable eligible roles and grant agent access in **Agents**.

If the interface refresh fails after the kit is saved, run `--inspect` again. Retry the refresh with the inspected installation token and the **new** kit digest:

```sh
your-space app upgrade-agent-kit <app-name> --refresh \
  --expect-installation <installation> --expect-kit <new-kitSource>
```

## Grant access to an agent

Create a named agent. Grant it roles for this installation and choose the approval settings. **Ask for all writes** overrides an individual route set to Allow. Otherwise the route override takes precedence over the kit recommendation. With neither setting, the kit recommendation applies. A route without a recommendation runs reads directly and asks for writes. A community review link refers to the exact kit revision reviewed.

Issue a key and store it in the external agent’s secret environment as `YOUR_SPACE_AGENT_KEY`. Set `YOUR_SPACE_URL` to the workspace HTTPS origin (or HTTP on localhost for a local test). Run these commands on the agent machine:

```sh
your-space agent actions --json
your-space agent invoke <installation-id> <action-id> --input-stdin --json < input.json
your-space agent request <request-id> --json
```

Use the fields declared by the action under `path`, `query` and `body` in the input file. For writes, supply a persistent `--operation-id` for each logical operation and the action’s `--expected-revision` when requested. For a kit that uses the HTTP `If-Match` header, pass the app’s quoted entity tag, for example `--expected-revision '"1"'`. Keep the original operation ID if the response is lost. An uncertain outcome needs reconciliation before another attempt.

Review pending requests in **Agents**. Approve or reject the exact change and check the activity entry and resulting app state. Rotate or revoke a key there, narrow the grant, or disable the agent. Your Space keeps the app credential on the server.
