import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { findKit, kitFromFile } from "../src/apps/kits.ts";

const kit = JSON.stringify({
  kit: 2,
  source: { repo: "example/app", path: "compose.yaml" },
  agentAccess: { credential: { binding: "service", inject: { location: "header", name: "X-API-Key" } }, roles: {}, routes: {} },
});
const revision = "a".repeat(40);
const digest = createHash("sha256").update(kit).digest("hex");
const pinned = `https://github.com/example/kits/blob/${revision}/app.yaml`;

it("recognizes only a registry review matching the kit digest and pinned source", async () => {
  for (const expectedKit of [pinned, "https://example.test/other"]) {
    const fetcher: typeof fetch = async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/commits/main")) return new Response(revision);
      if (path.endsWith("/app.yaml")) return new Response(kit);
      if (path === `/your-space-ai/your-space-app-kits/${revision}/reviews/sha256/${digest}.json`)
        return Response.json({ status: "reviewed", sha256: digest, kit: expectedKit });
      return new Response(null, {status:404});
    };
    const found = await findKit("example/app","compose.yaml","https://github.com/example/kits/blob/main/app.yaml",
      {api:"https://api.example.test",raw:"https://raw.example.test"},fetcher);
    expect(Boolean(found?.kit.agentReview)).toBe(expectedKit === pinned);
  }
  expect(kitFromFile(kit,null).kit.agentReview).toBeUndefined();
  expect(() => kitFromFile(JSON.stringify({...JSON.parse(kit),agentReview:{source:pinned}}),null)).toThrow();
});
