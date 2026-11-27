// Spec 017: a role grants a route at its HTTP method. The gateway sends the agent's body to the app
// as it is, asks the owner first for a write nobody set, sends each write once and keeps no operation
// ID, and reports a write the app answered with 2xx as succeeded even when its response can't be passed on.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword } from "./helpers/owner.ts";
import { TEST_DATA_KEY as key } from "./helpers/env.ts";
import { parseAgentAccess } from "../src/apps/agent-kit.ts";
import { app } from "../src/db/schema.ts";
import { dashboard, hash, identity, transaction } from "../src/agents/store.ts";
import { bind, createAgent, grant, manageKey } from "../src/agents/owner.ts";
import { decide, discover, invoke, requestOutcome } from "../src/agents/invoke.ts";
import { dispatchAppAction } from "../src/agents/transport.ts";

vi.mock("../src/agents/transport.ts", () => ({ dispatchAppAction: vi.fn() }));
let t: TestDatabase;
let agent: string, installation: string, owner: string, verifier: string;
const secret = "synthetic-app-key-2";
const record = { data: { createItem: { id: "0b7e2f4c-9a1d-4c3e-8f6b-2d5a7c9e1f30", title: "Plan the week" } } };
const access = parseAgentAccess({
  credential: { binding: "service", inject: { location: "header", name: "X-API-Key" } },
  routes: {
    list: { method: "GET", path: "/items", effect: "read" },
    create: { method: "POST", path: "/items", queryFields: { depth: "integer" } },
    edit: { method: "PATCH", path: "/items/{id}", pathParams: { id: "uuid" }, approval: "allow" },
    remove: { method: "DELETE", path: "/items/{id}", pathParams: { id: "uuid" } },
  },
  roles: {
    reader: { title: "Reader", routes: ["list"] },
    editor: { title: "Editor", routes: ["list", "create", "edit"] },
    remover: { title: "Remover", routes: ["remove"] },
  },
});
const id = "0b7e2f4c-9a1d-4c3e-8f6b-2d5a7c9e1f30";
const create = (body: unknown = { title: "Plan the week", assignee: { create: { name: "Sam" } } }) => ({
  installationId: installation,
  actionId: "create",
  input: { body },
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
    agent = (await createAgent(c, owner, "Writer")).id;
    verifier = hash((await manageKey(c, owner, agent)).key!);
    await bind(c, installation, { revision: 0, enabledRoles: ["reader", "editor", "remover"], credential: secret }, key);
    await grant(c, owner, agent, installation, { revision: 0, bindingRevision: 1, roles: ["editor"], overrides: {} });
  });
  vi.mocked(dispatchAppAction).mockReset().mockResolvedValue({ status: 201, body: record, usable: true });
});
afterEach(async () => {
  await t?.destroy();
});
const allow = (overrides: Record<string, string>, roles = ["editor"], revision = 1) =>
  transaction(t.db, (c) => grant(c, owner, agent, installation, { revision, bindingRevision: 1, roles, overrides }));

it("lists write routes by method, with no effect, beside reads", async () => {
  const { actions } = await transaction(t.db, async (c) => discover(c, await identity(c, verifier)));
  expect(actions.map((a) => [a.actionId, a.method, a.effect]).sort()).toEqual([
    ["create", "POST", undefined],
    ["edit", "PATCH", undefined],
    ["list", "GET", "read"],
  ]);
});

it("asks first for a write nobody set, shows its body and sends it once, as JSON, when approved", async () => {
  const pending = await invoke(t.db, key, verifier, create());
  expect(pending.status).toBe("pending");
  expect(dispatchAppAction).not.toHaveBeenCalled();
  const overview = await transaction(t.db, (c) => dashboard(c, owner, key));
  expect(overview.requests[0]?.input).toEqual(create().input);
  const approval = () => decide(t.db, key, owner, pending.id, { revision: 1, approve: true });
  const settled = await Promise.allSettled([approval(), approval()]);
  expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(dispatchAppAction).toHaveBeenCalledTimes(1);
  // The body reaches the app as the agent sent it, nested create included: the app checks it.
  expect(vi.mocked(dispatchAppAction).mock.calls[0]?.[0]).toMatchObject({
    method: "POST",
    path: "/items",
    headers: { "X-API-Key": secret },
    body: JSON.stringify(create().input.body),
  });
  expect(await requestOutcome(t.db, verifier, pending.id, key)).toEqual({
    id: pending.id,
    status: "succeeded",
    result: record,
  });
});

it("changes nothing in the app for a denied write", async () => {
  const pending = await invoke(t.db, key, verifier, create());
  expect(await decide(t.db, key, owner, pending.id, { revision: 1, approve: false })).toMatchObject({ status: "rejected" });
  expect(dispatchAppAction).not.toHaveBeenCalled();
});

it("runs a write the kit or the owner set to Allow, and a delete only through its own role", async () => {
  vi.mocked(dispatchAppAction).mockResolvedValueOnce({ status: 200, body: record, usable: true });
  const edit = { installationId: installation, actionId: "edit", input: { path: { id }, body: { title: "Rest" } } };
  expect(await invoke(t.db, key, verifier, edit)).toMatchObject({ status: "succeeded", result: record });
  expect(vi.mocked(dispatchAppAction).mock.calls[0]?.[0]).toMatchObject({ method: "PATCH", path: "/items/" + id });

  const remove = { installationId: installation, actionId: "remove", input: { path: { id } } };
  expect((await invoke(t.db, key, verifier, remove)).status).toBe("denied");
  await allow({ remove: "allow" }, ["editor", "remover"]);
  vi.mocked(dispatchAppAction).mockResolvedValueOnce({ status: 204, body: null, usable: true });
  expect(await invoke(t.db, key, verifier, remove)).toMatchObject({ status: "succeeded" });
  const sent = vi.mocked(dispatchAppAction).mock.calls[1]?.[0];
  expect(sent).toMatchObject({ method: "DELETE", path: "/items/" + id });
  expect(sent).not.toHaveProperty("body");
});

it("sends a repeated write again: Your Space keeps no operation ID", async () => {
  await allow({ create: "allow" });
  const body = { id, title: "Plan the week" };
  vi.mocked(dispatchAppAction)
    .mockResolvedValueOnce({ status: 201, body: record, usable: true })
    .mockResolvedValueOnce({ status: 400, body: null, usable: false });
  expect((await invoke(t.db, key, verifier, create(body))).status).toBe("succeeded");
  // The app refuses the second create of the same record ID; the agent sees that, as any client would.
  expect((await invoke(t.db, key, verifier, create(body))).status).toBe("refused");
  expect(dispatchAppAction).toHaveBeenCalledTimes(2);
  expect((await t.pool.query("select count(*) from agent_request where operation_id is not null")).rows[0].count).toBe("0");
});

it("reports a write the app answered with 2xx as succeeded, without a result it can't pass on", async () => {
  await allow({ create: "allow" });
  for (const answer of [
    { status: 201, body: { data: { note: "key " + secret } }, usable: true },
    { status: 201, body: null, usable: false },
  ]) {
    vi.mocked(dispatchAppAction).mockResolvedValueOnce(answer);
    const outcome = await invoke(t.db, key, verifier, create());
    expect(outcome).toEqual({ id: outcome.id, status: "succeeded" });
    expect(JSON.stringify(await requestOutcome(t.db, verifier, outcome.id, key))).not.toContain(secret);
  }
  vi.mocked(dispatchAppAction).mockResolvedValueOnce({ status: 202, body: null, usable: true });
  expect((await invoke(t.db, key, verifier, create())).status).toBe("unknown");
  vi.mocked(dispatchAppAction).mockRejectedValueOnce(new Error("App transport unavailable"));
  expect((await invoke(t.db, key, verifier, create())).status).toBe("unknown");
});

it("refuses a body over 32 KiB, a body on a read and an undeclared query option", async () => {
  await allow({ create: "allow" });
  await expect(invoke(t.db, key, verifier, create({ text: "x".repeat(32 * 1024) }))).rejects.toThrow(/32 KiB/);
  const list = { installationId: installation, actionId: "list", input: { body: {} } };
  await expect(invoke(t.db, key, verifier, list)).rejects.toThrow(/A read takes no body/);
  const upsert = { ...create(), input: { query: { upsert: true }, body: {} } };
  await expect(invoke(t.db, key, verifier, upsert)).rejects.toThrow(/Undeclared input field/);
  await invoke(t.db, key, verifier, { ...create(), input: { query: { depth: 1 }, body: {} } });
  expect(vi.mocked(dispatchAppAction).mock.calls[0]?.[0]).toMatchObject({ path: "/items?depth=1", body: "{}" });
});
