import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { bundledFonts } from "../shared/appearance/theme.mjs";

const notices = "licenses/THIRD-PARTY.md";

// The fonts in public/fonts aren't npm packages, so Vite's license file doesn't list them. Add each
// bundled family's license, the SIL Open Font License, from the text that ships beside the font.
function fontNotices(): Plugin {
  return {
    name: "your-space:font-notices",
    generateBundle: {
      order: "post",
      handler(_, bundle) {
        const file = bundle[notices];
        if (file?.type !== "asset") return this.error(`${notices} was not generated, so the font licenses have no place.`);
        const fonts = bundledFonts.map((family) => {
          const license = readFileSync(new URL(`public/fonts/OFL-${family.replaceAll(" ", "")}.txt`, import.meta.url), "utf8");
          return `\n## ${family} font (OFL-1.1)\n\n${license.trim()}\n`;
        });
        file.source = `${String(file.source).trimEnd()}\n\nThe app also serves these fonts from /fonts/ (credits in /fonts/CREDITS.txt):\n${fonts.join("")}`;
      },
    },
  };
}

// The web client is served by Caddy in production. In development, Vite proxies
// `/api` to the server so the client and API share one origin, as they do behind Caddy.
// The server answers only to its public address, and Better Auth accepts only that origin,
// so the proxy sends each request as if it came from there: http://localhost, or the
// YS_PORT the server was started with.
const publicUrl = new URL(process.env.YS_PORT ? `http://localhost:${process.env.YS_PORT}` : "http://localhost");

export default defineConfig({
  plugins: [fontNotices()],
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
    // The license of every package bundled into the client, as MIT and similar terms require, and
    // of the bundled fonts (fontNotices), served at /licenses/THIRD-PARTY.md.
    license: { fileName: notices },
    rolldownOptions: {
      onLog(level, log, handler) {
        // React libraries mark modules "use client" for server components; it means nothing here.
        if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
        handler(level, log);
      },
    },
  },
});
