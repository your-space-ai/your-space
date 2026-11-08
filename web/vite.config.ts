import { defineConfig } from "vite";

// The web client is served by Caddy in production. In development, Vite proxies
// `/api` to the server so the client and API share one origin, as they do behind Caddy.
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
    rolldownOptions: {
      onLog(level, log, handler) {
        // React libraries mark modules "use client" for server components; it means nothing here.
        if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
        handler(level, log);
      },
    },
  },
});
