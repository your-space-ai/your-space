---
title: "Try Your Space from source"
---

Run the dashboard on your computer, create its owner, and install a sample app. This walkthrough builds Your Space from your checkout. Its local GitHub stand-in serves the example app and kit. You can try them without a GitHub account.

## Start the dashboard

Use a local Docker engine on Linux or macOS that you can dedicate to the demo. You'll need Git, Docker Compose 2.26.0 or newer, internet access for the first build and image downloads, and a free local port (8081 below). On Linux, use Docker Engine 28.3.3 or newer. The containers provide Node.js and PostgreSQL. [Docker prerequisites](index.md#before-you-start)

Clone the project and enter the repository root, or open a terminal there if you already have a clean checkout.

```sh
git clone https://github.com/your-space-ai/your-space.git
cd your-space
```

Run the following in a shell such as Bash or Zsh. The `demo` function uses the same Compose files and project name for each command. Change `8081` if that port is in use. If your engine uses a different socket, also set `YS_ENGINE_SOCKET` to the socket path on the engine host.

```sh
export YS_PORT=8081
demo() {
  docker compose -p ys-source-demo --env-file e2e/stack.env \
    -f deploy/compose.yaml -f deploy/compose.build.yaml \
    -f e2e/compose.e2e.yaml "$@"
}
demo up -d --build --wait
```

Open `http://space.localhost:8081` (or the port you chose). The dashboard prompts you to create its owner.

## Sign in and install an app

```sh
demo exec server create-owner --username you --name "You"
```

Open the single-use link printed in your terminal, choose a password, and sign in as `you`. If the link expires, `demo exec server reset-link` prints a fresh one.

1. Open **Apps**. Paste this address into **Link to the app's Compose file** and select **Review**.

   ```text
   https://github.com/ys-fixtures/whoami/blob/main/compose.yaml
   ```

   This address works only inside the demo. No such repository exists on GitHub: the demo answers it with the [sample app's Compose file in this repository](https://github.com/your-space-ai/your-space/blob/main/e2e/github/fixtures/ys-fixtures/whoami/compose.yaml).

2. Read the kit details, including the removed host port and requested outbound access. Choose **Install** and wait for the app to finish starting.
3. Open **Who Am I**. Its pane shows the hostname and request headers received by the sample app. If your browser offers **Open in its own tab**, follow that link to view it.

The demo never reaches GitHub; it answers GitHub links from the [sample apps in this repository](https://github.com/your-space-ai/your-space/tree/main/e2e/github/fixtures). To try kits from real GitHub repositories with your own locally built images and CLI, use [operator setup from reviewed source](agent-setup.md#test-from-reviewed-source) to create a separate workspace. The [packaged installation guide](index.md) applies once a matching release is available.

## Stop and return later

From the same shell and checkout, stop the installed apps before stopping the dashboard.

```sh
demo exec runtime stop-apps
demo stop
```

Run `demo up -d --wait` to start the dashboard and its apps again with their saved data. In a new terminal, return to the repository root, set the same port, and define `demo` again first.
