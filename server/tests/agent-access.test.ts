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
  // Saving the same upstream binding and changing approval preferences neither
  // dispatches another write nor strands its receipt when both routes remain allowed.
  await transaction(t.db, async (c) => {
    const updated = await bind(c, installation, { revision: 3, enabledRoles: ["manager"] }, key);
    await grant(c, owner, agent, installation, {
      revision: 1,
      bindingRevision: updated.revision,
      roles: ["manager"],
      askAllWrites: true,
      overrides: { lookup: "ask" },
    });
  });
  expect((await receipt(t.db, verifier, outcome.id, key)).status).toBe("unknown");
  expect(dispatchAppAction).toHaveBeenCalledTimes(1);
  await transaction(t.db, (c) =>
    grant(c, owner, agent, installation, {
      revision: 2,
      bindingRevision: 4,
      roles: ["manager"],
      askAllWrites: true,
      overrides: { lookup: "allow" },
    }),
  );
  expect((await invoke(t.db, key, verifier, write())).status).toBe("unknown");
  expect(dispatchAppAction).toHaveBeenCalledTimes(1);
  expect(await receipt(t.db, verifier, outcome.id, key)).toMatchObject({
    status: "succeeded",
    result: { id: "item-1" },
  });
  const [writeCall, lookupCall] = vi.mocked(dispatchAppAction).mock.calls;
  expect(lookupCall![0].method).toBe("GET");
  expect(lookupCall![0].path).toBe("/receipts/" + writeCall![0].headers["Idempotency-Key"]);
  await transaction(t.db, async (c) => {
    const changed = await bind(
      c,
      installation,
      { revision: 4, credential: "another-principal", enabledRoles: ["manager"] },
      key,
    );
    await grant(c, owner, agent, installation, {
      revision: 0,
      bindingRevision: changed.revision,
      roles: ["manager"],
      askAllWrites: false,
      overrides: {},
    });
  });
  await expect(receipt(t.db, verifier, outcome.id, key)).rejects.toMatchObject({ status: 403 });
  await expect(invoke(t.db, key, verifier, write())).rejects.toMatchObject({ status: 409 });
  expect(dispatchAppAction).toHaveBeenCalledTimes(2);
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
    const token = ((await issue.json()) as { key: string }).key;
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

it("cannot retrieve a previous receipt after removing and reinstalling an app with the same retained ID", async () => {
  await setGrant(0);
  const pending = await invoke(t.db, key, verifier, write());
  await decide(t.db, key, owner, pending.id, { approve: true, revision: 1 });
  await t.pool.query("update app set desired='removed' where id=$1", [installation]);
  await t.pool.query("update app set desired='running' where id=$1", [installation]);
  await transaction(t.db, async (c) => {
    const fresh = await bind(c, installation, { revision: 2, credential: secret, enabledRoles: ["manager"] }, key);
    await expect(
      grant(c, owner, agent, installation, {
        revision: 0,
        bindingRevision: 1,
        roles: ["manager"],
        askAllWrites: true,
        overrides: {},
      }),
    ).rejects.toMatchObject({ status: 409 });
    await grant(c, owner, agent, installation, {
      revision: 0,
      bindingRevision: fresh.revision,
      roles: ["manager"],
      askAllWrites: true,
      overrides: {},
    });
  });
  await expect(receipt(t.db, verifier, pending.id, key)).rejects.toMatchObject({ status: 403 });
  await expect(invoke(t.db, key, verifier, write())).rejects.toMatchObject({ status: 409 });
  expect(dispatchAppAction).toHaveBeenCalledTimes(1);
});

it("isolates two actors and unrelated installation catalogs through discovery, invocation and receipts", async () => {
  const telemetry = parseAgentAccess({
    credential: { binding: "sensor", inject: { location: "header", name: "Authorization", scheme: "Bearer" } },
    roles: { observer: { title: "Observer", routes: ["temperature"] } },
    routes: { temperature: { method: "GET", path: "/observations", effect: "read", outputFields: ["degrees"] } },
  });
  const [sensor] = await t.db
    .insert(app)
    .values({
      name: "sensor",
      title: "Sensor",
      sourceUrl: "https://example.test/sensor",
      repo: "sample/sensor",
      path: "compose.yaml",
      ref: "main",
      commit: "e".repeat(40),
      compose: "{}",
      images: {},
      adaptations: [],
      limits: {},
      installedBy: owner,
      state: "running",
      interface: { service: "sensor", port: 8080 },
      kit: { kit: 2, agentAccess: telemetry },
    })
    .returning({ id: app.id });
  const sensorId = sensor!.id;
  await setGrant(0, true);
  const secondVerifier = await transaction(t.db, async (c) => {
    const observer = await createAgent(c, owner, "Observer");
    const observerKey = await manageKey(c, owner, observer.id);
    await bind(c, sensorId, { revision: 0, enabledRoles: ["observer"], credential: "sensor-fixture" }, key);
    await grant(c, owner, observer.id, sensorId, {
      revision: 0,
      bindingRevision: 1,
      roles: ["observer"],
      askAllWrites: false,
      overrides: {},
    });
    return hash(observerKey.key!);
  });

  const actionsFor = (token: string) => transaction(t.db, async (c) => discover(c, await identity(c, token)));
  expect((await actionsFor(verifier)).actions).toMatchObject([{ installationId: installation, actionId: "list" }]);
  expect((await actionsFor(secondVerifier)).actions).toMatchObject([
    { installationId: sensorId, actionId: "temperature" },
  ]);
  const reading = { installationId: sensorId, actionId: "temperature" };
  expect((await invoke(t.db, key, verifier, reading)).status).toBe("denied");
  expect((await invoke(t.db, key, secondVerifier, { installationId: installation, actionId: "list" })).status).toBe(
    "denied",
  );
  expect(dispatchAppAction).not.toHaveBeenCalled();

  vi.mocked(dispatchAppAction).mockResolvedValueOnce({ status: 200, body: { degrees: 19, raw: "internal" } });
  const outcome = await invoke(t.db, key, secondVerifier, reading);
  expect(outcome).toMatchObject({ status: "succeeded", result: { degrees: 19 } });
  expect(dispatchAppAction).toHaveBeenCalledWith(
    expect.objectContaining({
      installation: expect.objectContaining({ id: sensorId, interfaceService: "sensor" }),
      method: "GET",
      path: "/observations",
      headers: { Authorization: "Bearer sensor-fixture" },
    }),
  );
  await expect(receipt(t.db, verifier, outcome.id, key)).rejects.toMatchObject({ status: 403 });
  const { events } = await transaction(t.db, (c) => activity(c, owner));
  expect(events.find((event) => event.id === outcome.id)).toMatchObject({
    ownerId: owner,
    installationId: sensorId,
    actionId: "temperature",
    status: "succeeded",
  });
});

it("keeps an interrupted claim unknown after its deadline and never re-dispatches the write", async () => {
  await setGrant(0);
  const pending = await invoke(t.db, key, verifier, write());
  // A stopped process can leave a committed dispatch claim without any upstream response.
  await t.pool.query(
    "update agent_request set status='dispatching', input=null, expires_at=now() - interval '1 minute' where id=$1",
    [pending.id],
  );
  expect(await receipt(t.db, verifier, pending.id, key)).toMatchObject({ status: "unknown" });
  expect(await invoke(t.db, key, verifier, write())).toEqual({ id: pending.id, status: "unknown" });
  expect(dispatchAppAction).not.toHaveBeenCalled();
});

it("serializes grant withdrawal with approval and prevents subsequent writes", async () => {
  await setGrant(0);
  const offered = await transaction(t.db, async (c) => discover(c, await identity(c, verifier)));
  expect(offered.actions.map((action) => action.actionId).sort()).toEqual(["create", "list"]);
  const pending = await invoke(t.db, key, verifier, write());
  expect(pending.status).toBe("pending");

  const approve = () => decide(t.db, key, owner, pending.id, { approve: true, revision: 1 });
  const [approval, withdrawal] = await Promise.allSettled([approve(), setGrant(1, true)]);
  expect(withdrawal.status).toBe("fulfilled");
  const state = (await t.pool.query("select status from agent_request where id=$1", [pending.id])).rows[0].status;
  const dispatched = approval.status === "fulfilled" ? 1 : 0;
  if (approval.status === "fulfilled") {
    expect(approval.value.status).toBe("succeeded");
    expect(state).toBe("succeeded");
  } else {
    expect(approval.reason).toMatchObject({ status: 409 });
    expect(state).toBe("stale");
  }
  expect(dispatchAppAction).toHaveBeenCalledTimes(dispatched);

  await expect(approve()).rejects.toMatchObject({ status: 409 });
  for (const operationId of [write().operationId, "later-write"]) {
    expect((await invoke(t.db, key, verifier, { ...write(), operationId })).status).toBe("denied");
  }
  expect(dispatchAppAction).toHaveBeenCalledTimes(dispatched);
});

it("retires the old grant, credential and pending approval when a kit changes its route", async () => {
  await setGrant(0);
  const pending = await invoke(t.db, key, verifier, write());
  const approve = (id: string) => decide(t.db, key, owner, id, { approve: true, revision: 1 });
  const revised = parseAgentAccess({
    ...access,
    routes: { ...access.routes, create: { ...access.routes.create, path: "/new-items" } },
  });
  await t.pool.query("update app set kit=$2 where id=$1", [
    installation, JSON.stringify({ kit: 2, agentAccess: revised }),
  ]);

  const afterChange = await transaction(t.db, (c) => dashboard(c, owner, key));
  expect(afterChange.agents[0]).toMatchObject({ grants: [] });
  expect(afterChange.installations[0]).toMatchObject({ id: installation, bound: false, enabledRoles: [] });
  expect(afterChange.requests).toEqual([]);
  expect(afterChange.events.find((event) => event.id === pending.id)?.status).toBe("stale");
  await expect(approve(pending.id)).rejects.toMatchObject({ status: 409 });
  expect((await invoke(t.db, key, verifier, write())).status).toBe("denied");

  const rebound = await transaction(t.db, (c) =>
    bind(c, installation, { revision: 2, credential: secret, enabledRoles: ["manager"] }, key),
  );
  expect((await invoke(t.db, key, verifier, write())).status).toBe("denied");
  await transaction(t.db, (c) =>
    grant(c, owner, agent, installation, {
      revision: 0, bindingRevision: rebound.revision, roles: ["manager"], askAllWrites: true, overrides: {},
    }),
  );
  await expect(approve(pending.id)).rejects.toMatchObject({ status: 409 });
  await expect(invoke(t.db, key, verifier, write())).rejects.toMatchObject({ status: 409 });
  expect(dispatchAppAction).not.toHaveBeenCalled();
  const fresh = await invoke(t.db, key, verifier, { ...write(), operationId: "revised-kit-write" });
  expect(fresh.status).toBe("pending");
  expect((await approve(fresh.id)).status).toBe("succeeded");
  expect(dispatchAppAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: "/new-items" }));
});
