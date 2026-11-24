---
title: "Connect a GitHub account to Your Space"
---

Your Space reads a kit in a private repository, and the Compose file it names in that repository, through the owner's GitHub connection. Kits in public repositories install without one. The connection only reads: kits, the Compose files they name and the [kit directory](install-apps.md). Apps and agents never use it.

The operator registers an OAuth app for their own Your Space installation in GitHub's Developer settings. Give it a recognizable name and the workspace's homepage URL. GitHub also asks for an authorization callback URL when registering an OAuth app. Use the workspace's HTTPS URL. This integration uses the device flow and does not direct GitHub to that callback. Enable **Device Flow** in the GitHub app settings. See [GitHub's OAuth app registration guide](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) and [device authorization instructions](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow).

Copy the app's **public client ID** into `GITHUB_OAUTH_CLIENT_ID` in the installation's `.env`, then run `your-space start --workdir <folder> --no-open` to recreate the server with that configuration. Device authorization requires no client secret or personal access token.

On the **GitHub** page of the signed-in workspace, choose **Connect GitHub**. For a public-repository connection the OAuth scope is `public_repo`. Explicitly opting into private repositories requests GitHub's broader `repo` scope, which can cover other public and private repositories the GitHub account can access. Both scopes also allow changes to those repositories, since GitHub has no read-only OAuth scope for private repositories; Your Space only reads with the token. Review GitHub's consent screen and organization policies before approving. GitHub enforces its own repository visibility, organization policies and account permissions. [GitHub OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)

The owner visits GitHub's device page, enters the short code shown by Your Space and approves directly on GitHub. Keep that short code private. Return to the same signed-in workspace session to finish. An expired request can be restarted. Your Space encrypts the device code and resulting account token on the server. Apps and agents receive neither.

**Disconnect** removes this installation's saved credential and pending authorization. To revoke the authorization at GitHub as well, open GitHub Settings → Applications → Authorized OAuth Apps and revoke this OAuth app. When switching from private to public access, review or revoke the broader authorization in GitHub if it keeps returning the previous scope. [Review authorized OAuth apps](https://docs.github.com/en/apps/oauth-apps/using-oauth-apps/reviewing-your-authorized-oauth-apps)
