// Only the newest set-password or reset link works (auth.ts, cancelEarlierLinks). Each command
// stores its link before it cancels the earlier ones, so two commands at once can each see the
// other's link; these tests set up that moment directly.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cancelEarlierLinks, storedIdentifier } from "../src/auth.ts";
import { verification } from "../src/db/auth-schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";

let t: TestDatabase;
beforeEach(async () => {
  t = await createTestDatabase();
});
afterEach(async () => {
  await t?.destroy();
});

const OWNER = "00000000-0000-4000-8000-000000000001";
const SOMEONE_ELSE = "00000000-0000-4000-8000-000000000002";
const EARLIER = new Date("2026-11-10T10:00:00Z");
const LATER = new Date("2026-11-10T10:00:01Z");

const linkId = (token: string) => storedIdentifier(`reset-password:${token}`);

async function store(identifier: string, createdAt: Date, value = OWNER): Promise<void> {
  const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000);
  await t.db.insert(verification).values({ identifier, value, expiresAt, createdAt, updatedAt: createdAt });
}

async function remaining(): Promise<string[]> {
  const rows = await t.db.select({ identifier: verification.identifier }).from(verification);
  return rows.map((row) => row.identifier).sort();
}

describe("cancelEarlierLinks", () => {
  it("keeps the newer of two links stored before either cancels the other, in either order", async () => {
    for (const order of [
      ["first", "second"],
      ["second", "first"],
    ]) {
      await t.db.delete(verification);
      await store(linkId("first"), EARLIER);
      await store(linkId("second"), LATER);
      for (const token of order) await cancelEarlierLinks(t.db, OWNER, token);
      expect(await remaining()).toEqual([linkId("second")]);
    }
  });

  it("keeps exactly one of two links created at the same moment", async () => {
    await store(linkId("first"), EARLIER);
    await store(linkId("second"), EARLIER);
    await cancelEarlierLinks(t.db, OWNER, "first");
    await cancelEarlierLinks(t.db, OWNER, "second");
    expect(await remaining()).toHaveLength(1);
  });

  it("leaves other accounts' links and other kinds of verification alone", async () => {
    await store(linkId("old"), EARLIER);
    await store(linkId("theirs"), EARLIER, SOMEONE_ELSE);
    await store("email-verification:abc", EARLIER);
    await store(linkId("new"), LATER);
    await cancelEarlierLinks(t.db, OWNER, "new");
    expect(await remaining()).toEqual([linkId("new"), linkId("theirs"), "email-verification:abc"].sort());
  });
});
