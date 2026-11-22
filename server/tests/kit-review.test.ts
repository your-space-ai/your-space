import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { findKit, kitFromFile } from "../src/apps/kits.ts";

const kit = "\uFEFF" + JSON.stringify({
  kit: 2,
  source: { repo: "example/app", path: "compose.yaml" },
  agentAccess: { credential: { binding: "service", inject: { location: "header", name: "X-API-Key" } }, roles: {}, routes: {} },
});
const revision = "a".repeat(40);
const digest = createHash("sha256").update(kit).digest("hex");
const pinned = `https://github.com/example/kits/blob/${revision}/app.yaml`;

it("recognizes only a registry review matching the kit digest and pinned source", async () => {
  for (const [directory, expectedKit, recordDigest, reviewed] of [
    ["community/catalog", pinned, digest, true],
    ["community/catalog", "https://example.test/other", digest, false],
    ["community/catalog", pinned, "wrong", false],
    [undefined, pinned, digest, false],
  ] as const) {
    const fetcher: typeof fetch = async (url) => {
      const path = new URL(String(url)).pathname;
      if (directory && path === "/repos/community/catalog/commits") {
        expect(new URL(String(url)).searchParams.get("per_page")).toBe("1");
        return Response.json([{ sha: revision }]);
      }
      if (path === "/repos/example/kits/commits/feature") return new Response(revision);
      if (path.endsWith("/app.yaml")) return new Response(kit);
      if (path === `/community/catalog/${revision}/reviews/sha256/${digest}.json`)
        return Response.json({ status: "reviewed", sha256: recordDigest, kit: expectedKit });
      throw Error("Unexpected GitHub URL: " + path);
    };
    const found = await findKit("example/app","compose.yaml","https://github.com/example/kits/blob/feature/app.yaml", directory,
      {api:"https://api.example.test",raw:"https://raw.example.test"},fetcher);
    expect(Boolean(found?.kit.agentReview)).toBe(reviewed);
  }
  expect(kitFromFile(kit,null).kit.agentReview).toBeUndefined();
  expect(() => kitFromFile(JSON.stringify({...JSON.parse(kit.trimStart()),agentReview:{source:pinned}}),null)).toThrow();
});

it("carries a later directory review only across identical bytes at the same path and repository", async () => {
  const later = "b".repeat(40);
  const directory = "community/catalog";
  const path = "apps/example/app.yaml";
  const oldPin = `https://github.com/${directory}/blob/${revision}/${path}`;
  for (const [attestedUrl, earlierText, reviewed, earlierReads] of [
    [oldPin, kit, true, 1],
    [oldPin, kit + "\n", false, 1],
    [oldPin.replace(directory, "other/catalog"), kit, false, 0],
    [oldPin.replace(path, "other.yaml"), kit, false, 0],
    [oldPin.replace(revision, "main"), kit, false, 0],
  ] as const) {
    let reads = 0;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === `/repos/${directory}/commits` && url.search === "?per_page=1") return Response.json([{ sha: later }]);
      if (url.pathname === `/${directory}/${later}/${path}`) return new Response(kit);
      if (url.pathname === `/${directory}/${revision}/${path}`) { reads++; return new Response(earlierText); }
      if (url.pathname === `/${directory}/${later}/reviews/sha256/${digest}.json`)
        return Response.json({ kit: attestedUrl, sha256: digest, status: "reviewed" });
      throw Error("Unexpected GitHub request: " + url.pathname);
    };
    const found = await findKit("example/app", "compose.yaml", undefined, directory,
      { api: "https://api.example.test", raw: "https://raw.example.test" }, fetcher);
    expect(found?.source).toBe(`https://github.com/${directory}/blob/${later}/${path}`);
    expect(Boolean(found?.kit.agentReview)).toBe(reviewed);
    expect(reads).toBe(earlierReads);
  }
});

it.each([undefined, "  \t "])("skips discovery without a directory or an explicit kit (%j)", async (link) => {
  const fetcher = () => { throw Error("Unexpected network access"); };
  expect(await findKit("example/app", "compose.yaml", link, undefined, undefined, fetcher)).toBeNull();
});

it("discovers a kit in the configured directory when the optional link is blank", async () => {
  const directory = "community/catalog";
  const path = "apps/example/app.yaml";
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === `/repos/${directory}/commits`) return Response.json([{ sha: revision }]);
    if (url.pathname === `/${directory}/${revision}/${path}`) {
      return new Response("kit: 1\nsource: { repo: example/app, path: compose.yaml }");
    }
    throw Error("Unexpected GitHub request: " + url.pathname);
  };
  const found = await findKit("example/app", "compose.yaml", "  \t ", directory, undefined, fetcher);
  expect(found?.source).toBe(`https://github.com/${directory}/blob/${revision}/${path}`);
});
