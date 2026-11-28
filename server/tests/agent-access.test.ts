// Agent access per app (spec 018): a grant gives an agent an app's API with the bound app key the owner
// picks; nothing asks first unless the owner adds a route that does; a kit change keeps keys and grants.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { startServer, cookieHeader } from "./helpers/server.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { TEST_DATA_KEY as key } from "./helpers/env.ts";
import { parseAgentAccess, type AgentAccess } from "../src/apps/agent-kit.ts";
import { app } from "../src/db/schema.ts";
import { activity, dashboard, hash, identity, transaction } from "../src/agents/store.ts";
import { bind, createAgent, grant, manageKey } from "../src/agents/owner.ts";
import { decide, discover, invoke, requestOutcome } from "../src/agents/invoke.ts";
import { dispatchAppAction } from "../src/agents/transport.ts";
import { moveSettingsToDataKey } from "../src/apps/keys.ts";

vi.mock("../src/agents/transport.ts", () => ({ dispatchAppAction: vi.fn() }));
let t: TestDatabase;
let agent: string, installation: string, owner: string, verifier: string, credentialId: string;
const records = "synthetic-record-key";
const admin = "synthetic-admin-key";
const bearer = { location: "header", name: "Authorization", scheme: "Bearer" } as const;
// A wrapped, nested response, as REST APIs such as Twenty's return one; it reaches the agent unchanged.
const item = { data: { item: { id: "item-1", name: { firstName: "Ada" }, tags: ["x"] } }, totalCount: 1 };
const access = parseAgentAccess({ api: "/rest", credentials: { records: { inject: bearer }, setup: { inject: bearer } } });
async function install(name: string, agentAccess: AgentAccess | Record<string, unknown>) {
  const [row] = await t.db
    .insert(app)
    .values({
      name,
      title: name[0]!.toUpperCase() + name.slice(1),
      sourceUrl: "https://example.test/" + name,
      repo: "sample/" + name,
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
      kit: { kit: 2, agentAccess } as never,
    })
    .returning({ id: app.id });
  return row!.id;
}
const revisionOf = async (id = installation) =>
  (await t.pool.query("select revision from agent_binding where app_id=$1", [id])).rows[0]?.revision ?? 0;
async function setGrant(body: { credential: string | null; asks?: unknown[] }, who = agent, id = installation) {
  const prior = (await t.pool.query("select revision from agent_grant where agent_id=$1 and app_id=$2", [who, id])).rows[0];
  return transaction(t.db, async (c) =>
    grant(c, owner, who, id, { asks: [], ...body, revision: prior?.revision ?? 0, bindingRevision: await revisionOf(id) }),
  );
}
const call = (method: string, path: string, body?: unknown) => ({
  installationId: installation,
  method,
  path,
  ...(body === undefined ? {} : { body }),
});
const deleteAsks = [{ method: "DELETE", path: "/rest/items/*" }];
beforeEach(async () => {
  t = await createTestDatabase();
  await createOwnerWithPassword(t.db);
  owner = (await t.pool.query("select id from actor where kind='human'")).rows[0].id;
  installation = await install("example", access);
  await transaction(t.db, async (c) => {
    agent = (await createAgent(c, owner, "Test")).id;
    const cred = await manageKey(c, owner, agent);
    verifier = hash(cred.key!);
    credentialId = cred.id;
    await bind(c, installation, { revision: 0, credentials: { records, setup: admin } }, key);
  });
  vi.mocked(dispatchAppAction).mockReset().mockResolvedValue({ status: 200, body: item, usable: true });
});
afterEach(async () => {
  await t?.destroy();
});

it("reaches nothing without a grant, then the whole API with the grant's key, asking only where the owner said", async () => {
  expect(await transaction(t.db, async (c) => discover(c, await identity(c, verifier)))).toEqual({ apps: [] });
  expect((await invoke(t.db, key, verifier, call("GET", "/rest/items"))).status).toBe("denied");
  await setGrant({ credential: "records", asks: deleteAsks });
  expect(await transaction(t.db, async (c) => discover(c, await identity(c, verifier)))).toEqual({
    apps: [{ installationId: installation, appName: "Example", api: "/rest", available: true, asks: deleteAsks }],
  });
  const listed = await invoke(t.db, key, verifier, call("GET", "/rest/items?limit=2"));
  expect(listed).toEqual({ id: listed.id, status: "succeeded", result: item });
  expect(vi.mocked(dispatchAppAction).mock.calls[0]?.[0]).toMatchObject({
    method: "GET",
    path: "/rest/items?limit=2",
    headers: { Authorization: "Bearer " + records },
  });
  expect(vi.mocked(dispatchAppAction).mock.calls[0]?.[0]).not.toHaveProperty("body");

  // A write runs directly too: the key's role in the app is the limit. Its body goes as it is.
  const body = { name: "Acme", company: { create: { name: "Linked" } } };
  vi.mocked(dispatchAppAction).mockResolvedValueOnce({ status: 201, body: item, usable: true });
  expect((await invoke(t.db, key, verifier, call("POST", "/rest/items", body))).status).toBe("succeeded");
  expect(vi.mocked(dispatchAppAction).mock.calls[1]?.[0]).toMatchObject({ method: "POST", body: JSON.stringify(body) });

  // A route that asks waits; the owner sees the exact call; concurrent approvals send it once.
  const pending = await invoke(t.db, key, verifier, call("DELETE", "/rest/items/private-fixture-item"));
  expect(pending.status).toBe("pending");
  const saved = (await t.pool.query("select input, route from agent_request where id=$1", [pending.id])).rows[0];
  expect(saved.input).not.toContain("fixture");
  expect(saved.route).toBe("DELETE /rest/items/private-fixture-item");
  const preview = await transaction(t.db, (c) => dashboard(c, owner, key));
  expect(preview.requests[0]?.input).toEqual({ method: "DELETE", path: "/rest/items/private-fixture-item" });
  const approval = () => decide(t.db, key, owner, pending.id, { revision: 1, approve: true });
  const decisions = await Promise.allSettled([approval(), approval()]);
  expect(decisions.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(dispatchAppAction).toHaveBeenCalledTimes(3);
  expect(await requestOutcome(t.db, verifier, pending.id, key)).toEqual({ id: pending.id, status: "succeeded", result: item });

  // Outside the API, or a path an app could read as another, is refused before anything is sent.
  for (const path of ["/restricted", "/admin", "/rest/../admin", "/rest/%2561dmin", "/rest/a;v=1"])
    await expect(invoke(t.db, key, verifier, call("GET", path)), path).rejects.toMatchObject({ status: 400 });
  expect(dispatchAppAction).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(await transaction(t.db, (c) => activity(c, owner)))).not.toContain("limit=2");
});

it("sends only the grant's key, never another bound key back, and keeps a grant across a key replacement", async () => {
  await setGrant({ credential: "setup" });
  await invoke(t.db, key, verifier, call("POST", "/rest/metadata/fields", { name: "stage" }));
  expect(vi.mocked(dispatchAppAction).mock.calls[0]?.[0]).toMatchObject({ headers: { Authorization: "Bearer " + admin } });
  // A response that echoes any key bound to the app is withheld.
  vi.mocked(dispatchAppAction).mockResolvedValueOnce({ status: 200, body: { leaked: records }, usable: true });
  const read = await invoke(t.db, key, verifier, call("GET", "/rest/metadata/objects"));
  expect(read).toEqual({ id: read.id, status: "unknown" });
  // Replacing the key keeps the grant, on the new key.
  await transaction(t.db, async (c) => bind(c, installation, { revision: await revisionOf(), credentials: { setup: admin + "-2" } }, key));
  await invoke(t.db, key, verifier, call("GET", "/rest/metadata/objects"));
  expect(vi.mocked(dispatchAppAction).mock.calls.at(-1)?.[0]).toMatchObject({ headers: { Authorization: "Bearer " + admin + "-2" } });
  // Without its key bound, the grant is unavailable, and nothing falls back to the other key.
  await transaction(t.db, async (c) => bind(c, installation, { revision: await revisionOf(), credentials: { setup: null } }, key));
  await expect(invoke(t.db, key, verifier, call("GET", "/rest/x"))).rejects.toMatchObject({
    status: 403,
    message: expect.stringContaining("isn't bound"),
  });
  const offered = await transaction(t.db, async (c) => discover(c, await identity(c, verifier)));
  expect(offered.apps[0]).toMatchObject({ available: false, reason: expect.stringContaining("isn't bound") });
  await expect(setGrant({ credential: "setup" })).rejects.toMatchObject({ status: 400 });
});

it("never sends a call with a key replaced after the call was admitted", async () => {
  await setGrant({ credential: "records" });
  const query = t.db.$client.query.bind(t.db.$client);
  const spy = vi.spyOn(t.db.$client, "query").mockImplementation((async (text: unknown, values?: unknown) => {
    // Just before sending, the owner replaces the key the call was admitted with.
    if (typeof text === "string" && text.startsWith("select credential from agent_credential where app_id=$1 and name=$2")) {
      spy.mockRestore();
      await transaction(t.db, async (c) => bind(c, installation, { revision: await revisionOf(), credentials: { records: records + "-new" } }, key));
    }
    return query(text as string, values as unknown[]);
  }) as never);
  const outcome = await invoke(t.db, key, verifier, call("POST", "/rest/items", { name: "x" }));
  expect(outcome).toEqual({ id: outcome.id, status: "stale" });
  expect(dispatchAppAction).not.toHaveBeenCalled();
  // The grant carries over: the next call goes with the new key only.
  await invoke(t.db, key, verifier, call("GET", "/rest/items"));
  expect(vi.mocked(dispatchAppAction).mock.calls[0]?.[0]).toMatchObject({ headers: { Authorization: "Bearer " + records + "-new" } });
});

it("reports a write the app answered with 2xx as succeeded, and keeps no operation ID", async () => {
  await setGrant({ credential: "records" });
  for (const answer of [
    { status: 201, body: { data: { note: "key " + records } }, usable: true },
    { status: 201, body: null, usable: false },
  ]) {
    vi.mocked(dispatchAppAction).mockResolvedValueOnce(answer);
    const outcome = await invoke(t.db, key, verifier, call("POST", "/rest/items", { id: "x" }));
    expect(outcome).toEqual({ id: outcome.id, status: "succeeded" });
  }
  vi.mocked(dispatchAppAction).mockResolvedValueOnce({ status: 400, body: null, usable: false });
  expect((await invoke(t.db, key, verifier, call("POST", "/rest/items", { id: "x" }))).status).toBe("refused");
  vi.mocked(dispatchAppAction).mockResolvedValueOnce({ status: 202, body: null, usable: true });
  expect((await invoke(t.db, key, verifier, call("POST", "/rest/items"))).status).toBe("unknown");
  vi.mocked(dispatchAppAction).mockRejectedValueOnce(new Error("App transport unavailable"));
  expect((await invoke(t.db, key, verifier, call("PATCH", "/rest/items/x", {}))).status).toBe("unknown");
  expect(dispatchAppAction).toHaveBeenCalledTimes(5);
  // A read's response that can't be passed on stays unknown.
  for (const body of [{ text: "x".repeat(256 * 1024) }, { error: JSON.stringify({ header: "Authorization: Bearer " + records }) }]) {
    vi.mocked(dispatchAppAction).mockResolvedValueOnce({ status: 200, body, usable: true });
    expect((await invoke(t.db, key, verifier, call("GET", "/rest/items"))).status).toBe("unknown");
  }
  await expect(invoke(t.db, key, verifier, call("POST", "/rest/items", { text: "x".repeat(32 * 1024) }))).rejects.toThrow(/32 KiB/);
  await expect(invoke(t.db, key, verifier, call("GET", "/rest/items", {}))).rejects.toThrow(/A GET takes no body/);
});

it("keeps keys and grants across a kit change, staling pending calls, and leaves a 017 kit unavailable", async () => {
  await setGrant({ credential: "records", asks: deleteAsks });
  const pending = await invoke(t.db, key, verifier, call("DELETE", "/rest/items/1"));
  const changed = parseAgentAccess({ api: "/rest", credentials: { records: { inject: bearer }, setup: { inject: bearer } } });
  await t.pool.query("update app set kit=$2, commit=$3 where id=$1", [
    installation,
    JSON.stringify({ kit: 2, agentAccess: changed, title: "changed" }),
    "e".repeat(40),
  ]);
  const after = await transaction(t.db, (c) => dashboard(c, owner, key));
  expect(after.agents[0]!.grants).toMatchObject([{ installationId: installation, credential: "records", asks: deleteAsks }]);
  expect(after.installations[0]!.credentials).toEqual([
    { name: "records", bound: true },
    { name: "setup", bound: true },
  ]);
  expect(after.requests).toEqual([]);
  await expect(decide(t.db, key, owner, pending.id, { approve: true, revision: 1 })).rejects.toMatchObject({ status: 409 });
  expect((await invoke(t.db, key, verifier, call("GET", "/rest/items"))).status).toBe("succeeded");

  // A kit in 017's format gives no access, says why, and keeps the keys and grant for a rewritten kit.
  const old = { credentials: { records: { inject: bearer } }, roles: { editor: { title: "Editor", routes: ["list"] } }, routes: { list: { method: "GET", path: "/rest/items", effect: "read", credential: "records" } } };
  await t.pool.query("update app set kit=$2 where id=$1", [installation, JSON.stringify({ kit: 2, agentAccess: old })]);
  await expect(invoke(t.db, key, verifier, call("GET", "/rest/items"))).rejects.toMatchObject({
    status: 403,
    message: expect.stringContaining("format before agent access per app"),
  });
  const broken = await transaction(t.db, (c) => dashboard(c, owner, key));
  expect(broken.installations[0]).toMatchObject({ problem: "old_format", api: null });
  expect(broken.agents[0]!.grants).toHaveLength(1);
  await expect(transaction(t.db, async (c) => bind(c, installation, { revision: await revisionOf(), credentials: { records } }, key))).rejects.toMatchObject({ status: 400 });
  // The owner can still take access away while the kit is old; it doesn't come back with a new kit.
  await setGrant({ credential: null });
  expect((await transaction(t.db, (c) => dashboard(c, owner, key))).agents[0]!.grants).toEqual([]);
  await t.pool.query("update app set kit=$2 where id=$1", [installation, JSON.stringify({ kit: 2, agentAccess: changed })]);
  expect((await invoke(t.db, key, verifier, call("GET", "/rest/items"))).status).toBe("denied");
  await setGrant({ credential: "records" });
  expect((await invoke(t.db, key, verifier, call("GET", "/rest/items"))).status).toBe("succeeded");

  // Removing the app ends its grants and keys, even with its data kept.
  await t.pool.query("update app set desired='removed' where id=$1", [installation]);
  await t.pool.query("update app set desired='running' where id=$1", [installation]);
  expect((await t.pool.query("select count(*) from agent_grant")).rows[0].count).toBe("0");
  expect((await t.pool.query("select count(*) from agent_credential")).rows[0].count).toBe("0");
});

it("invalidates stale approvals on a grant change, key rotation and removal", async () => {
  await setGrant({ credential: "records", asks: deleteAsks });
  const first = await invoke(t.db, key, verifier, call("DELETE", "/rest/items/1"));
  await setGrant({ credential: "records", asks: [] });
  await expect(decide(t.db, key, owner, first.id, { approve: true, revision: 1 })).rejects.toMatchObject({ status: 409 });
  await setGrant({ credential: "records", asks: deleteAsks });
  const second = await invoke(t.db, key, verifier, call("DELETE", "/rest/items/2"));
  await transaction(t.db, (c) => manageKey(c, owner, agent, credentialId));
  await expect(decide(t.db, key, owner, second.id, { approve: true, revision: 1 })).rejects.toMatchObject({ status: 409 });
  await expect(transaction(t.db, (c) => identity(c, verifier))).rejects.toMatchObject({ status: 401 });
  expect(dispatchAppAction).not.toHaveBeenCalled();
});

it("keeps rejected requests terminal and pending previews readable after a data key replacement", async () => {
  await setGrant({ credential: "records", asks: deleteAsks });
  const pending = await invoke(t.db, key, verifier, call("DELETE", "/rest/items/1"));
  const next = key + "-new";
  await moveSettingsToDataKey(t.db, { dataKey: next, previousDataKey: key });
  expect((await transaction(t.db, (c) => dashboard(c, owner, next))).requests[0]?.input).toEqual({ method: "DELETE", path: "/rest/items/1" });
  expect((await decide(t.db, next, owner, pending.id, { approve: false, revision: 1 })).status).toBe("rejected");
  expect((await requestOutcome(t.db, verifier, pending.id, next)).status).toBe("rejected");
  await expect(decide(t.db, next, owner, pending.id, { approve: true, revision: 2 })).rejects.toMatchObject({ status: 409 });
  expect(dispatchAppAction).not.toHaveBeenCalled();
});

it("keeps owner cookies and agent keys on separate authority paths", async () => {
  const server = await startServer(t.db);
  try {
    const login = await server.request("/api/auth/sign-in/username", {
      method: "POST",
      body: JSON.stringify({ username: OWNER.username, password: OWNER.password }),
    });
    const cookie = cookieHeader(login);
    const keyPath = "/api/agents/" + agent + "/keys";
    expect((await server.request(keyPath, { method: "POST", headers: { cookie, origin: "https://other.example.test" }, body: "{}" })).status).toBe(403);
    const issue = await server.request(keyPath, { method: "POST", headers: { cookie }, body: "{}" });
    const token = ((await issue.json()) as { key: string }).key;
    expect((await server.request("/api/agent/apps", { headers: { cookie } })).status).toBe(401);
    expect((await server.request("/api/agent/apps", { headers: { authorization: "Bearer " + token } })).status).toBe(200);
    expect((await server.request(keyPath, { method: "POST", headers: { authorization: "Bearer " + token }, body: "{}" })).status).toBe(401);
    const outside = await server.request("/api/agent/call", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(call("GET", "/rest/items")),
    });
    expect(outside.status).toBe(403);
    const overview = await (await server.request("/api/agents/dashboard", { headers: { cookie } })).text();
    expect(overview).not.toContain(token);
    expect(overview).not.toContain(records);
  } finally {
    await server.close();
  }
});

it("isolates two agents and two apps through discovery, calls and request outcomes", async () => {
  const sensor = await install("sensor", parseAgentAccess({ api: "/", credential: { binding: "sensor", inject: bearer } }));
  await setGrant({ credential: "records" });
  const other = await transaction(t.db, async (c) => {
    const observer = await createAgent(c, owner, "Observer");
    const observerKey = await manageKey(c, owner, observer.id);
    await bind(c, sensor, { revision: 0, credential: "sensor-fixture" }, key);
    return { id: observer.id, verifier: hash(observerKey.key!) };
  });
  await setGrant({ credential: "sensor" }, other.id, sensor);
  const appsFor = async (token: string) =>
    (await transaction(t.db, async (c) => discover(c, await identity(c, token)))).apps.map((a) => a.installationId);
  expect(await appsFor(verifier)).toEqual([installation]);
  expect(await appsFor(other.verifier)).toEqual([sensor]);
  expect((await invoke(t.db, key, verifier, { installationId: sensor, method: "GET", path: "/observations" })).status).toBe("denied");
  expect((await invoke(t.db, key, other.verifier, call("GET", "/rest/items"))).status).toBe("denied");
  expect(dispatchAppAction).not.toHaveBeenCalled();
  vi.mocked(dispatchAppAction).mockResolvedValueOnce({ status: 200, body: [{ degrees: 19 }], usable: true });
  const outcome = await invoke(t.db, key, other.verifier, { installationId: sensor, method: "GET", path: "/observations" });
  expect(outcome).toMatchObject({ status: "succeeded", result: [{ degrees: 19 }] });
  expect(dispatchAppAction).toHaveBeenCalledWith(expect.objectContaining({ path: "/observations", headers: { Authorization: "Bearer sensor-fixture" } }));
  await expect(requestOutcome(t.db, verifier, outcome.id, key)).rejects.toMatchObject({ status: 403 });
  const { events } = await transaction(t.db, (c) => activity(c, owner));
  expect(events.find((event) => event.id === outcome.id)).toMatchObject({ installationId: sensor, actionId: "GET /observations", status: "succeeded" });
});

it("keeps an interrupted claim unknown after its deadline and never sends it again", async () => {
  await setGrant({ credential: "records", asks: deleteAsks });
  const pending = await invoke(t.db, key, verifier, call("DELETE", "/rest/items/1"));
  await t.pool.query("update agent_request set status='dispatching', input=null, expires_at=now() - interval '1 minute' where id=$1", [pending.id]);
  expect(await requestOutcome(t.db, verifier, pending.id, key)).toMatchObject({ status: "unknown" });
  await expect(decide(t.db, key, owner, pending.id, { approve: true, revision: 1 })).rejects.toMatchObject({ status: 409 });
  expect(dispatchAppAction).not.toHaveBeenCalled();
});

it("serializes removing a grant with an approval and refuses later calls", async () => {
  await setGrant({ credential: "records", asks: deleteAsks });
  const pending = await invoke(t.db, key, verifier, call("DELETE", "/rest/items/1"));
  const approve = () => decide(t.db, key, owner, pending.id, { approve: true, revision: 1 });
  const [approval, removal] = await Promise.allSettled([approve(), setGrant({ credential: null })]);
  expect(removal.status).toBe("fulfilled");
  const state = (await t.pool.query("select status from agent_request where id=$1", [pending.id])).rows[0].status;
  if (approval.status === "fulfilled") expect(state).toBe("succeeded");
  else {
    expect(approval.reason).toMatchObject({ status: 409 });
    expect(state).toBe("revoked");
  }
  expect((await invoke(t.db, key, verifier, call("GET", "/rest/items"))).status).toBe("denied");
  expect(dispatchAppAction).toHaveBeenCalledTimes(approval.status === "fulfilled" ? 1 : 0);
});

it("lists the apps it can still reach when one granted app has no interface, and stores a printable denial", async () => {
  const headless = await install("headless", access);
  await transaction(t.db, async (c) => bind(c, headless, { revision: 0, credentials: { records } }, key));
  await setGrant({ credential: "records" });
  await setGrant({ credential: "records" }, agent, headless);
  await t.pool.query("update app set interface=null where id=$1", [headless]);
  const offered = await transaction(t.db, async (c) => discover(c, await identity(c, verifier)));
  expect(offered.apps.map((a) => a.installationId)).toEqual([installation]);
  const other = await install("other", access);
  const denied = await invoke(t.db, key, verifier, { installationId: other, method: "GET", path: "/rest/a\u0000b" });
  expect(denied.status).toBe("denied");
  expect((await t.pool.query("select route from agent_request where id=$1", [denied.id])).rows[0].route).toBe("call");
});

it("refuses a grant on an unbound key and an invalid route that asks", async () => {
  await expect(setGrant({ credential: "missing" })).rejects.toMatchObject({ status: 400 });
  await expect(setGrant({ credential: "records", asks: [{ method: "GET", path: "/a;b" }] })).rejects.toMatchObject({ status: 400 });
  expect((await setGrant({ credential: "records" })).revision).toBe(1);
});
