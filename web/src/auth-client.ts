// Better Auth's React client with the organization plugin (T021). Same origin as the page, so
// requests go to /api/auth through Caddy (or Vite's proxy in development).
import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [organizationClient()],
});
