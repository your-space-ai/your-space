import { expect, test } from "@playwright/test";
import { compose, composeWithInput, createOwner, docker, resetStack, sql } from "./helpers/stack.ts";

test("the private transport reaches only the registered interface of the selected installation", async () => {
  await resetStack();
  await createOwner();
  const kit = {
    kit: 2,
    source: { repo: "ys-fixtures/probe", path: "compose.yaml" },
    name: "probe",
    interface: { service: "web", port: 8080 },
    agentAccess: {
      credential: { binding: "fixture", inject: { location: "header", name: "X-API-Key" } },
      routes: { read: { method: "GET", path: "/record.json", effect: "read", outputFields: ["id"] } },
      roles: { reader: { title: "Reader", routes: ["read"] } },
    },
  };
  const source = "https://github.com/ys-fixtures/probe/blob/main/compose.yaml";
  await composeWithInput(["exec", "-T", "server", "install-app", source, "--kit", "-", "--json"], JSON.stringify(kit));
  await docker([
    "exec", "ys-probe-web-1", "sh", "-c", 'printf %s "$1" > /www/record.json',
    "sh", JSON.stringify({ id: "fixture" }),
  ], false);
  const [id] = await sql("select id from app where name='probe' and state='running' and publish is null");
  expect(id).toBeTruthy();
  const verify = `
    import assert from "node:assert/strict";
    import { randomUUID } from "node:crypto";
    import { dispatchAppAction } from "./src/agents/transport.ts";
    import { RuntimeError } from "./src/apps/runtime-client.ts";
    const call = (id) => dispatchAppAction({
      installation: { id, name: "probe", interfaceService: "web", interfacePort: 8080 },
      method: "GET", path: "/record.json", headers: {}
    });
    assert.deepEqual(await call(process.argv[1]), {status: 200, body: {id: "fixture"}});
    await assert.rejects(call(randomUUID()), error => error instanceof RuntimeError && error.status === 503);
  `;
  await compose(["exec", "-T", "server", "node", "--input-type=module", "-e", verify, id!]);
});
