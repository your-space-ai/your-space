import { defineConfig } from "vite";

// The web client is served by Caddy in production. In development, Vite proxies
// `/api` to the server so the client and API share one origin, as they do behind Caddy.
// The server answers only to its public address, and Better Auth accepts only that origin,
// so the proxy sends each request as if it came from there: http://localhost, or the
// YS_PORT the server was started with.
const publicUrl = new URL(process.env.YS_PORT ? `http://localhost:${process.env.YS_PORT}` : "http://localhost");

export default defineConfig({
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        configure(proxy) {
          proxy.on("proxyReq", (request) => {
            request.setHeader("host", publicUrl.host);
            if (request.getHeader("origin")) request.setHeader("origin", publicUrl.origin);
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
    // The license of every package bundled into the client, as MIT and similar terms require,
    // served at /licenses/THIRD-PARTY.md.
    license: { fileName: "licenses/THIRD-PARTY.md" },
    rolldownOptions: {
      onLog(level, log, handler) {
        // React libraries mark modules "use client" for server components; it means nothing here.
        if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
        handler(level, log);
      },
    },
  },
});
