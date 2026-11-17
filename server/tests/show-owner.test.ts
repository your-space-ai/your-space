// Journey 003: show-owner reports the owner without changing anything (research R8;
// specs/003-install-with-the-cli/contracts/cli-commands.md).
import { afterEach, beforeEach, expect, it } from "vitest";
import { runCommand } from "./helpers/commands.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { counts } from "./helpers/state.ts";

let t: TestDatabase;
beforeEach(async () => {
  t = await createTestDatabase();
});
afterEach(async () => {
  await t?.destroy();
});

const showOwner = (args = ["--json"]) => runCommand("show-owner", args, { databaseUrl: t.url });

it("says there is no owner yet", async () => {
  const result = await showOwner();
  expect(result.code).toBe(0);
  expect(result.json).toEqual({ ok: true, owner: null });
});

it("names the owner once there is one, and changes nothing", async () => {
  const created = await runCommand("create-owner", ["--username", "sam", "--name", "Sam Rivera", "--json"], { databaseUrl: t.url });
  expect(created.code).toBe(0);
  const before = await counts(t.db);
  const result = await showOwner();
  expect(result.code).toBe(0);
  expect(result.json).toEqual({ ok: true, owner: { username: "sam", name: "Sam Rivera" } });
  expect(await counts(t.db)).toEqual(before);
});

it("prints a line for a person, and refuses unknown options", async () => {
  expect((await showOwner([])).stdout).toBe("This installation has no owner yet.\n");
  const wrong = await showOwner(["--json", "--x"]);
  expect(wrong.code).toBe(1);
  expect(wrong.json.error).toBe("usage");
});

it("reports a database it can't read", async () => {
  const result = await runCommand("show-owner", ["--json"], { databaseUrl: "postgres://nobody:wrong@127.0.0.1:1/none" });
  expect(result.code).toBe(3);
  expect(result.json).toEqual({ ok: false, error: "storage_unavailable", message: "The database could not be read." });
});
