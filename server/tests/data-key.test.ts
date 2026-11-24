// Spec 009: apps' settings are encrypted with the data key, not the auth secret, and the server moves
// values onto a replacement data key when it starts (FR-005).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { operatorActorId } from "../src/actors.ts";
import { moveSettingsToDataKey } from "../src/apps/keys.ts";
import { decrypt, encrypt } from "../src/apps/settings.ts";
import { app, appSetting } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";

const KEY = "data-key-for-these-tests-only-0123456789abc";
const NEXT = "next-data-key-for-these-tests-only-01234567";

let t: TestDatabase;
beforeEach(async () => {
  t = await createTestDatabase();
});
afterEach(async () => {
  await t?.destroy();
});

async function appWith(settings: Record<string, string | null>): Promise<string> {
  const [row] = await t.db
    .insert(app)
    .values({
      name: "sure",
      title: "Sure",
      sourceUrl: "https://github.com/we-promise/sure/blob/main/compose.example.yml",
      repo: "we-promise/sure",
      path: "compose.example.yml",
      ref: "main",
      commit: "0".repeat(40),
      compose: "{}",
      images: {},
      adaptations: [],
      limits: {},
      installedBy: await operatorActorId(t.db),
    })
    .returning({ id: app.id });
  for (const [name, value] of Object.entries(settings)) {
    await t.db.insert(appSetting).values({ appId: row!.id, name, value, secret: true });
  }
  return row!.id;
}

async function stored(): Promise<Record<string, string | null>> {
  const rows = await t.db.select({ name: appSetting.name, value: appSetting.value }).from(appSetting);
  return Object.fromEntries(rows.map((r) => [r.name, r.value]));
}

describe("moving apps' settings onto the data key", () => {
  it("leaves values already on the data key, and doesn't read a value from before the data key", async () => {
    // No release wrote one: values from before the data key were encrypted with the auth secret.
    const before = "v1.aXY.dGFn.ZGF0YQ";
    await appWith({ SECRET_KEY_BASE: before, DB_PASSWORD: encrypt(KEY, "already"), EMPTY: null });
    expect(await moveSettingsToDataKey(t.db, { dataKey: KEY })).toEqual({ moved: 0, current: 1, unreadable: 1 });
    const after = await stored();
    expect(after.SECRET_KEY_BASE).toBe(before);
    expect(decrypt(KEY, after.DB_PASSWORD!)).toBe("already");
    expect(after.EMPTY).toBeNull();
  });

  it("re-encrypts with a replacement data key, reading values with the previous one", async () => {
    await appWith({ SECRET_KEY_BASE: encrypt(KEY, "kept-secret") });
    expect(await moveSettingsToDataKey(t.db, { dataKey: NEXT, previousDataKey: KEY })).toEqual({ moved: 1, current: 0, unreadable: 0 });
    const value = (await stored()).SECRET_KEY_BASE!;
    expect(decrypt(NEXT, value)).toBe("kept-secret");
    expect(() => decrypt(KEY, value)).toThrow();
  });

  it("counts and leaves a value no key here can read", async () => {
    await appWith({ SECRET_KEY_BASE: encrypt("a-key-that-is-gone-0123456789abcdefghij", "lost") });
    const before = await stored();
    expect(await moveSettingsToDataKey(t.db, { dataKey: KEY })).toEqual({ moved: 0, current: 0, unreadable: 1 });
    expect(await stored()).toEqual(before);
  });
});
