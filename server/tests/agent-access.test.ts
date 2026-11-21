import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { startServer, cookieHeader } from "./helpers/server.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { TEST_DATA_KEY as key } from "./helpers/env.ts";
import { parseAgentAccess } from "../src/apps/agent-kit.ts";
import { app } from "../src/db/schema.ts";
import { activity, dashboard, hash, identity, transaction } from "../src/agents/store.ts";
import { bind, createAgent, grant, manageKey } from "../src/agents/owner.ts";
import { decide, discover, invoke, receipt } from "../src/agents/invoke.ts";
import { dispatchAppAction } from "../src/agents/transport.ts";
import { moveSettingsToDataKey } from "../src/apps/keys.ts";

vi.mock("../src/agents/transport.ts", () => ({ dispatchAppAction: vi.fn() }));
let t: TestDatabase;
let agent: string, installation: string, owner: string, verifier: string, credentialId: string;
const secret = "synthetic-app-key-1";
const access = parseAgentAccess({
  credential: { binding: "service", inject: { location: "header", name: "X-API-Key" } },
  routes: {
    list: { method: "GET", path: "/items", effect: "read", outputFields: ["id"] },
    create: {
      method: "POST",
      path: "/items",
      effect: "write",
      operationId: { in: "header", name: "Idempotency-Key" },
      bodyFields: { title: "string" },
      outputFields: ["id"],
    },
  },
  roles: { manager: { title: "Manager", routes: ["list", "create"] }, reader: { title: "Reader", routes: ["list"] } },
});
beforeEach(async () => {
  t = await createTestDatabase();
  await createOwnerWithPassword(t.db);
  owner = (await t.pool.query("select id from actor where kind='human'")).rows[0].id;
  const [row] = await t.db
    .insert(app)
    .values({
      name: "example",
      title: "Example",
      sourceUrl: "https://example.test/app",
      repo: "sample/app",
      path: "compose.yaml",
      ref: "main",
      commit: "f".repeat(40),
      compose: "{}",
      images: {},
      adaptations: [],
      limits: {},
      installedBy: owner,
      state: "running",
      interface: { service: "app", port: 1234 },
      kit: { kit: 2, agentAccess: access },
    })
    .returning({ id: app.id });
  installation = row!.id;
  await transaction(t.db, async (c) => {
    agent = (await createAgent(c, owner, "Test")).id;
    const cred = await manageKey(c, owner, agent);
    verifier = hash(cred.key!);
    credentialId = cred.id;
    await bind(c, installation, { revision: 0, enabledRoles: ["manager", "reader"], credential: secret }, key);
  });
  vi.mocked(dispatchAppAction)
    .mockReset()
    .mockResolvedValue({ status: 200, body: { id: "item-1", internal: "ignored" } });
});
afterEach(async () => {
  await t?.destroy();
});
const write = () => ({
  installationId: installation,
  actionId: "create",
  operationId: "op-001",
  input: { body: { title: "private fixture title" } },
});
async function setGrant(revision: number, isRead = false) {
  return transaction(t.db, (c) =>
    grant(c, owner, agent, installation, {
      revision,
      roles: isRead ? ["reader"] : ["manager", "reader"],
      bindingRevision: 1,
      askAllWrites: true,
      overrides: { create: "allow" },
    }),
  );
}
it("admits only active granted routes, persists exact approval and dispatches one time under concurrent decisions", async () => {
  expect(await transaction(t.db, async (c) => discover(c, await identity(c, verifier)))).toEqual({ actions: [] });
  expect((await invoke(t.db, key, verifier, write())).status).toBe("denied");
  await setGrant(0);
  const first = await invoke(t.db, key, verifier, write());
  expect(first.status).toBe("pending");
  expect(await invoke(t.db, key, verifier, write())).toEqual(first);
  expect(dispatchAppAction).not.toHaveBeenCalled();
  const saved = (await t.pool.query("select input from agent_request where id=$1", [first.id])).rows[0].input;
  expect(saved).not.toContain("fixture");
  const preview = await transaction(t.db, (c) => dashboard(c, owner, key));
  expect(preview.requests[0]?.input).toEqual(write().input);
  const approval = () => decide(t.db, key, owner, first.id, { revision: 1, approve: true });
  const decisions = await Promise.allSettled([approval(), approval()]);
  expect(decisions.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(dispatchAppAction).toHaveBeenCalledTimes(1);
  expect(vi.mocked(dispatchAppAction).mock.calls[0]?.[0].headers["X-API-Key"]).toBe(secret);
  expect(await invoke(t.db, key, verifier, write())).toEqual({
    id: first.id,
    status: "succeeded",
    result: { id: "item-1" },
  });
  expect(dispatchAppAction).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(await transaction(t.db, (c) => activity(c, owner)))).not.toContain("private fixture");
});
it("invalidates stale approvals on role narrowing, key rotation, and uninstall including retained app rows", async () => {
  await setGrant(0);
  const first = await invoke(t.db, key, verifier, write());
  await setGrant(1, true);
  await expect(decide(t.db, key, owner, first.id, { approve: true, revision: 1 })).rejects.toMatchObject({
    status: 409,
  });
  await expect(receipt(t.db, verifier, first.id, key)).rejects.toMatchObject({ status: 403 });
  await transaction(t.db, (c) => manageKey(c, owner, agent, credentialId));
  await expect(transaction(t.db, (c) => identity(c, verifier))).rejects.toMatchObject({ status: 401 });
  await t.pool.query("update app set desired='removed' where id=$1", [installation]);
  await t.pool.query("update app set desired='running' where id=$1", [installation]);
  expect((await t.pool.query("select count(*) from agent_grant")).rows[0].count).toBe("0");
  expect((await t.pool.query("select count(*) from agent_binding where credential is not null")).rows[0].count).toBe(
    "0",
  );
  expect(dispatchAppAction).not.toHaveBeenCalled();
});
it("keeps rejected writes terminal and pending previews readable after installation key replacement", async () => {
  await setGrant(0);
  const pending = await invoke(t.db, key, verifier, write());
  const next = key + "-new";
  await moveSettingsToDataKey(t.db, { authSecret: "test", dataKey: next, previousDataKey: key });
  expect((await transaction(t.db, (c) => dashboard(c, owner, next))).requests[0]?.input).toEqual(write().input);
  expect((await decide(t.db, next, owner, pending.id, { approve: false, revision: 1 })).status).toBe("rejected");
  expect((await invoke(t.db, next, verifier, write())).status).toBe("rejected");
  expect(dispatchAppAction).not.toHaveBeenCalled();
});

it("reconciles an unknown write using its scoped upstream receipt and never repeats the write", async () => {
  const catalog = parseAgentAccess({
    ...access,
    roles: { manager: { title: "Manager", routes: ["create", "lookup"] } },
    routes: {
      create: { ...access.routes.create, receipt: { route: "lookup", param: "operation" } },
      lookup: {
        method: "GET",
        path: "/receipts/{operation}",
        pathParams: { operation: "string" },
        effect: "read",
        outputFields: ["id"],
      },
    },
  });
  await t.pool.query("update app set kit=$2 where id=$1", [
    installation,
    JSON.stringify({ kit: 2, agentAccess: catalog }),
  ]);
  await transaction(t.db, async (c) => {
    await bind(c, installation, { revision: 2, enabledRoles: ["manager"], credential: secret }, key);
    await grant(c, owner, agent, installation, {
      revision: 0,
      roles: ["manager"],
      bindingRevision: 3,
      askAllWrites: false,
      overrides: { create: "allow" },
    });
  });
  vi.mocked(dispatchAppAction).mockRejectedValueOnce(new Error("Lost response"));
  const outcome = await invoke(t.db, key, verifier, write());
  expect(outcome.status).toBe("unknown");
  expect((await invoke(t.db, key, verifier, write())).status).toBe("unknown");
  expect(dispatchAppAction).toHaveBeenCalledTimes(1);
  expect(await receipt(t.db, verifier, outcome.id, key)).toMatchObject({
    status: "succeeded",
    result: { id: "item-1" },
  });
  const [writeCall, lookupCall] = vi.mocked(dispatchAppAction).mock.calls;
  expect(lookupCall![0].method).toBe("GET");
  expect(lookupCall![0].path).toBe("/receipts/" + writeCall![0].headers["Idempotency-Key"]);
});

it("keeps owner cookies and agent credentials on separate authority paths", async () => {
  const server = await startServer(t.db);
  try {
    const login = await server.request("/api/auth/sign-in/username", {
      method: "POST",
      body: JSON.stringify({ username: OWNER.username, password: OWNER.password }),
    });
    const cookie = cookieHeader(login);
    const keyPath = "/api/agents/" + agent + "/keys";
    expect(
      (
        await server.request(keyPath, {
          method: "POST",
          headers: { cookie, origin: "https://other.example.test" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    const issue = await server.request(keyPath, { method: "POST", headers: { cookie }, body: "{}" });
    expect(issue.status).toBe(200);
    const token = ((await issue.json()) as {key:string}).key;
    expect((await server.request("/api/agent/actions", { headers: { cookie } })).status).toBe(401);
    expect((await server.request("/api/agent/actions", { headers: { authorization: "Bearer " + token } })).status).toBe(
      200,
    );
    expect(
      (await server.request(keyPath, { method: "POST", headers: { authorization: "Bearer " + token }, body: "{}" }))
        .status,
    ).toBe(401);
    const overview = await (await server.request("/api/agents/dashboard", { headers: { cookie } })).text();
    expect(overview).not.toContain(token);
    expect(overview).not.toContain(secret);
  } finally {
    await server.close();
  }
});
