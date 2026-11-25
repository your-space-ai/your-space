// Spec 009: apps' settings are encrypted with the data key, not the auth secret, and the server moves
// values onto a replacement data key when it starts (FR-005).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { operatorActorId } from "../src/actors.ts";
import { moveSettingsToDataKey } from "../src/apps/keys.ts";
import { decrypt, encrypt } from "../src/apps/settings.ts";
import { app, appSetting, sourceCredential } from "../src/db/schema.ts";
import { GithubConnection } from "../src/github-connection.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { createOwnerWithPassword } from "./helpers/owner.ts";
import { fakeGithubAccounts } from "./helpers/runtime.ts";

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

describe("moving the GitHub connection onto the data key (journey 015, decision 3)", () => {
  const TOKEN = "github_pat_ys_fixture_contents_0001";
  const github = fakeGithubAccounts(new Map([[TOKEN, "ys-fixture-owner"]]));
  const endpoints = { api: "https://api.github.test", raw: "https://raw.github.test" };
  const connection = (dataKey: string) => new GithubConnection(t.db, dataKey, { endpoints, fetch: github.fetch });

  it("moves the token to a replacement data key with everything else, so the connection keeps working", async () => {
    await createOwnerWithPassword(t.db);
    await appWith({ SECRET_KEY_BASE: encrypt(KEY, "kept-secret") });
    await connection(KEY).connect(TOKEN);
    // The server starting after the rotation, with the replacement and the key it replaced.
    expect(await moveSettingsToDataKey(t.db, { dataKey: NEXT, previousDataKey: KEY })).toEqual({ moved: 2, current: 0, unreadable: 0 });
    const [row] = await t.db.select({ token: sourceCredential.token }).from(sourceCredential);
    expect(decrypt(NEXT, row!.token)).toBe(TOKEN);
    expect(() => decrypt(KEY, row!.token)).toThrow();
    // Restarted with only the new key, the connection still works.
    expect(await moveSettingsToDataKey(t.db, { dataKey: NEXT })).toEqual({ moved: 0, current: 1, unreadable: 0 });
    expect((await connection(NEXT).status()).contents).toMatchObject({ set: true, login: "ys-fixture-owner", accepted: true });
  });

  it("leaves a token no key here can read, which shows Reconnect", async () => {
    await createOwnerWithPassword(t.db);
    await connection("a-data-key-that-is-gone-0123456789abcdefgh").connect(TOKEN);
    expect(await moveSettingsToDataKey(t.db, { dataKey: NEXT, previousDataKey: KEY })).toEqual({ moved: 0, current: 0, unreadable: 1 });
    expect((await connection(NEXT).status()).contents).toMatchObject({ set: true, accepted: false, problem: "unreadable" });
  });
});
