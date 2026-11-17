import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { portAnswers } from "../src/checks.ts";

describe("ports", () => {
  it("finds a port something listens on", async () => {
    const server = createServer().listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    expect(await portAnswers(port)).toBe(true);
    server.close();
    await new Promise((r) => server.once("close", r));
    expect(await portAnswers(port)).toBe(false);
  });
});
