import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const credential = "synthetic-agent-key-for-test";
async function cli(url: string, args: string[], input?: string) {
  const proc = spawn(process.execPath, [fileURLToPath(new URL("../src/index.ts", import.meta.url)), "agent", ...args, "--json"], {
    env: { PATH: process.env.PATH, YOUR_SPACE_URL: url, YOUR_SPACE_AGENT_KEY: credential },
  });
  let out = "", err = "";
  proc.stdout.on("data", chunk => { out += chunk; });
  proc.stderr.on("data", chunk => { err += chunk; });
  proc.stdin.end(input);
  const [code] = await once(proc, "close");
  expect(out + err).not.toContain(credential);
  return { code, json: JSON.parse(out) };
}

it("uses agent credentials without an installation folder and passes exact input and revision", async () => {
  let sent: unknown;
  let authorization: string | undefined;
  const server = createServer(async (req, res) => {
    authorization = req.headers.authorization;
    if (req.url === "/api/agent/invoke") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      sent = JSON.parse(Buffer.concat(chunks).toString());
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/api/agent/actions" ? { actions: [] } : { id: "request", status: "pending" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  try {
    expect((await cli(url, ["actions"])).json.actions).toEqual([]);
    expect((await cli(url, ["invoke", "install", "edit", "--input-stdin", "--operation-id", "op", "--expected-revision", "2"],
      '{"body":{"title":"example"}}')).json.status).toBe("pending");
    expect(authorization).toBe("Bearer " + credential);
    expect(sent).toEqual({ installationId: "install", actionId: "edit", operationId: "op", expectedRevision: "2", input: { body: { title: "example" } } });
  } finally { server.close(); }
});

it("rejects insecure remote origins before sending the key", async () => {
  expect((await cli("http://example.test", ["actions"])).json.error).toBe("usage");
});
