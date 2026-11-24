import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { startServer, cookieHeader, type TestServer } from "./helpers/server.ts";
import { FakeRuntime, fakeGithub } from "./helpers/runtime.ts";
import { OWNER, createOwnerWithPassword } from "./helpers/owner.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";

// The kit directory's listing (GET /api/kits/catalog), read from public GitHub, and reviewing one of
// its entries in the web client (POST /api/kits/preview) (decision 2026-11-23).
let db: TestDatabase, server: TestServer, cookie: string;
const commit = "a".repeat(40);
/** An older commit, which kits pin their Compose files to. */
const pinned = "c".repeat(40);
const fixture = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const meta = (id: number, full_name: string, hidden = false) => ({
  id,
  full_name,
  default_branch: "main",
  private: hidden,
});
const call = (path: string, method = "GET", body?: unknown) =>
  server.request(path, {
    method,
    headers: { cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeEach(async () => {
  db = await createTestDatabase();
  await createOwnerWithPassword(db.db);
  server = await startServer(db.db, { apps: { runtime: new FakeRuntime(), fetch: fakeGithub({}) } });
  cookie = cookieHeader(
    await server.request("/api/auth/sign-in/username", {
      method: "POST",
      body: JSON.stringify({ username: OWNER.username, password: OWNER.password }),
    }),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await server.close();
  await db.destroy();
});

it("returns an empty directory without contacting GitHub on a fresh install", async () => {
  const fetcher = vi.fn<typeof fetch>(() => { throw Error("Unexpected GitHub request"); });
  vi.stubGlobal("fetch", fetcher);
  expect(await (await call("/api/kits/catalog")).json()).toEqual({ kits: [], commit: null });
  expect(fetcher).not.toHaveBeenCalled();
});

it("pins catalog entries to the directory's commit, and reviews an entry at the Compose commit its kit pins", async () => {
  const registry = "ys-fixtures/catalog";
  server.apps!.config.kitsRepository = registry;
  const listed = vi.fn<typeof fetch>(async (url, init) => {
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    const path = new URL(String(url)).pathname;
    if (path === "/repos/" + registry) return fixture({ ...meta(11, registry), default_branch: "catalog/stable" });
    if (path === "/repositories/11/commits/catalog%2Fstable") return fixture({ sha: commit });
    if (path === "/repositories/11/git/trees/" + commit)
      return fixture({
        truncated: false,
        tree: [
          { mode: "100644", type: "blob", path: "apps/fixture/dashboard.yaml" },
          { mode: "100644", type: "blob", path: "README.md" },
        ],
      });
    return fixture({}, 404);
  });
  vi.stubGlobal("fetch", listed);
  const listing = (await (await call("/api/kits/catalog")).json()) as { commit: string; kits: { title: string; kitUrl: string }[] };
  expect(listing).toEqual({
    commit,
    kits: [
      {
        title: "dashboard",
        repo: "fixture/dashboard",
        path: "apps/fixture/dashboard.yaml",
        kitUrl: "https://github.com/" + registry + "/blob/" + commit + "/apps/fixture/dashboard.yaml",
      },
    ],
  });
  // The review reads the entry at the directory's commit, and the Compose file at the commit the kit pins.
  server.apps!.config.fetch = fakeGithub({
    [`${registry}@${commit}/apps/fixture/dashboard.yaml`]: `kit: 1\nname: morning-board\nsource: { repo: fixture/dashboard, path: compose.yaml, commit: ${pinned} }\n`,
    [`fixture/dashboard@${pinned}/compose.yaml`]: "services:\n  web: { image: example/web:1 }\n",
  });
  const response = await call("/api/kits/preview", "POST", { kitUrl: listing.kits[0]!.kitUrl });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    name: "morning-board",
    source: { repo: "fixture/dashboard", commit: pinned },
    kit: { repo: registry, path: "apps/fixture/dashboard.yaml", commit },
  });
  expect((await call("/api/kits/preview", "POST", { kitUrl: "https://unrelated.invalid/kit.yaml" })).status).toBe(400);
});

it("says a directory GitHub doesn't show this machine must be public", async () => {
  server.apps!.config.kitsRepository = "owner/private-kits";
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => fixture({}, 404)));
  const response = await call("/api/kits/catalog");
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: "github_not_found", message: expect.stringMatching(/must be a public repository/) });
});
