// Behind the owner's own proxy, Your Space answers only to the name in YS_PROXY_URL and to its apps'
// names under it (docs/install/other-devices.md). A proxy that rewrites the Host header, as nginx
// does unless told otherwise, gets status 421 and a message that says what to fix, whichever path
// the request asks for. These requests go through Caddy, as the proxy's do.
import { request } from "node:http";
import { expect, test } from "@playwright/test";
import { compose, resetStack } from "./helpers/stack.ts";

test.skip(({ browserName }) => browserName !== "chromium", "These checks don't use a browser; run them once.");
test.describe.configure({ mode: "serial", timeout: 300_000 });

const PROXY = { YS_PROXY_URL: "https://space.example.test" };
// The proxy setup publishes 127.0.0.1:8080, or YS_PORT.
const PORT = Number(process.env.YS_PORT || 8080);
const FIX = "proxy_set_header Host $http_host";

/** One request to Your Space's port, naming the given Host, as a proxy sends it. */
function viaProxy(path: string, headers: Record<string, string>): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: PORT, path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await resetStack(PROXY);
});

test.afterAll(async () => {
  test.setTimeout(300_000);
  // The proxy setup's edge network isn't part of the other journeys' setup, so it goes now.
  await compose(["down", "-v", "--remove-orphans"], { env: PROXY, timeout: 120_000 });
});

test("a proxy that passes the original Host reaches Your Space, and app names reach the gate", async () => {
  const status = await viaProxy("/api/status", { host: "space.example.test" });
  expect(status.status).toBe(200);
  const page = await viaProxy("/", { host: "space.example.test" });
  expect(page.status).toBe(200);
  expect(page.type).toMatch(/^text\/html/);

  // A name under Your Space's is an app's address; with no app there, the gate says so.
  const noApp = await viaProxy("/", { host: "nope.space.example.test" });
  expect(noApp.status).toBe(404);
  expect(noApp.body).toBe("There is no app at this address.");
});

test("a proxy that rewrites Host gets 421 and a message that says to pass the original one", async () => {
  // 127.0.0.1:8080 is what nginx sends for a proxy on this machine, your-space:8080 for one in a
  // container on the edge network.
  for (const host of [`127.0.0.1:${PORT}`, "your-space:8080", "localhost"]) {
    const page = await viaProxy("/", { host });
    expect(page.status, host).toBe(421);
    expect(page.type).toMatch(/^text\/plain/);
    expect(page.body).toContain("Your Space is set up for https://space.example.test");
    expect(page.body).toContain(FIX);

    const api = await viaProxy("/api/status", { host });
    expect(api.status, host).toBe(421);
    const answer = JSON.parse(api.body) as { error: string; message: string };
    expect(answer).toEqual({ error: "wrong_host", message: page.body });
  }

  // The same proxy with X-Forwarded-Host set to Your Space's name: Caddy passes the header on from
  // a proxy at a private address, but the request still named another address.
  const forwarded = await viaProxy("/", { host: `127.0.0.1:${PORT}`, "x-forwarded-host": "space.example.test" });
  expect(forwarded.status).toBe(421);
  expect(forwarded.body).toContain(FIX);
});
