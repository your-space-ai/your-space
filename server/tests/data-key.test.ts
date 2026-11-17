// Spec 009: apps' settings are encrypted with the data key, not the auth secret, and the server moves
// existing values onto it when it starts (FR-003), including after the data key is replaced (FR-005).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { operatorActorId } from "../src/actors.ts";
import { moveSettingsToDataKey } from "../src/apps/keys.ts";
import { decrypt, encrypt, encryptLegacy } from "../src/apps/settings.ts";
import { app, appSetting } from "../src/db/schema.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";

const AUTH = "auth-secret-for-these-tests-only-0123456789";
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
  it("moves values written with the auth secret, and leaves values already on the data key", async () => {
    await appWith({ SECRET_KEY_BASE: encryptLegacy(AUTH, "kept-secret"), DB_PASSWORD: encrypt(KEY, "already"), EMPTY: null });
    expect(await moveSettingsToDataKey(t.db, { authSecret: AUTH, dataKey: KEY })).toEqual({ moved: 1, current: 1, unreadable: 0 });
    const after = await stored();
    expect(after.SECRET_KEY_BASE!.startsWith("v2.")).toBe(true);
    expect(decrypt(KEY, after.SECRET_KEY_BASE!)).toBe("kept-secret");
    expect(decrypt(KEY, after.DB_PASSWORD!)).toBe("already");
    expect(after.EMPTY).toBeNull();
    // Nothing is left to move on the next start.
    expect(await moveSettingsToDataKey(t.db, { authSecret: AUTH, dataKey: KEY })).toEqual({ moved: 0, current: 2, unreadable: 0 });
  });

  it("makes replacing the auth secret harmless once values are on the data key", async () => {
    await appWith({ SECRET_KEY_BASE: encryptLegacy(AUTH, "kept-secret") });
    await moveSettingsToDataKey(t.db, { authSecret: AUTH, dataKey: KEY });
    const result = await moveSettingsToDataKey(t.db, { authSecret: "a-brand-new-auth-secret-0123456789abcdef", dataKey: KEY });
    expect(result).toEqual({ moved: 0, current: 1, unreadable: 0 });
    expect(decrypt(KEY, (await stored()).SECRET_KEY_BASE!)).toBe("kept-secret");
  });

  it("re-encrypts with a replacement data key, reading values with the previous one", async () => {
    await appWith({ SECRET_KEY_BASE: encrypt(KEY, "kept-secret") });
    expect(await moveSettingsToDataKey(t.db, { authSecret: AUTH, dataKey: NEXT, previousDataKey: KEY })).toEqual({ moved: 1, current: 0, unreadable: 0 });
    const value = (await stored()).SECRET_KEY_BASE!;
    expect(decrypt(NEXT, value)).toBe("kept-secret");
    expect(() => decrypt(KEY, value)).toThrow();
  });

  it("counts and leaves a value no key here can read", async () => {
    await appWith({ SECRET_KEY_BASE: encrypt("a-key-that-is-gone-0123456789abcdefghij", "lost") });
    const before = await stored();
    expect(await moveSettingsToDataKey(t.db, { authSecret: AUTH, dataKey: KEY })).toEqual({ moved: 0, current: 0, unreadable: 1 });
    expect(await stored()).toEqual(before);
  });
});
