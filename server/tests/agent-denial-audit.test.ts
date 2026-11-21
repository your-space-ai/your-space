import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createAgent, manageKey } from "../src/agents/owner.ts";
import { transaction } from "../src/agents/store.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword } from "./helpers/owner.ts";
import { startServer } from "./helpers/server.ts";

it("samples concurrent denials per agent, caps history, and omits unusable receipts from 403s", async () => {
  const test = await createTestDatabase();
  const server = await startServer(test.db);
  try {
    await createOwnerWithPassword(test.db);
    const owner = (await test.pool.query("select id from actor where kind='human'")).rows[0].id;
    const create = (name: string) =>
      transaction(test.db, async (client) => {
        const { id } = await createAgent(client, owner, name);
        return { agentId: id, ...(await manageKey(client, owner, id)) };
      });
    const first = await create("First");
    const second = await create("Second");
    const deny = async (key: string, route: string) => {
      const response = await server.request("/api/agent/invoke", {
        method: "POST",
        headers: { Authorization: "Bearer " + key },
        body: JSON.stringify({ installationId: randomUUID(), actionId: route, input: {} }),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "denied", status: "denied" });
    };
    // Historical samples from earlier windows. This also models the previous
    // unbounded denial history, which the next sample reduces to the cap.
    await test.pool.query(
      `insert into agent_request(agent_id,key_id,app_id,route,status,binding_revision,grant_revision,created_at,expires_at)
       select $1,$2,gen_random_uuid(),'old','denied',0,0,now()-n*interval '2 minutes',now()
       from generate_series(1,40) as n`,
      [first.agentId, first.id],
    );
    await Promise.all([
      deny(first.key!, "first-route"),
      deny(first.key!, "second-route"),
      deny(first.key!, "third-route"),
      deny(second.key!, "separate-agent"),
    ]);
    const samples = await test.pool.query<{ route: string }>(
      "select route from agent_request where agent_id=$1 and status='denied'",
      [first.agentId],
    );
    expect(samples.rowCount).toBe(32);
    expect(samples.rows.filter((row) => row.route !== "old")).toHaveLength(1);
    const other = await test.pool.query("select route from agent_request where agent_id=$1", [second.agentId]);
    expect(other.rows).toEqual([{ route: "separate-agent" }]);
  } finally {
    await server.close();
    await test.destroy();
  }
});
