// Moves apps' settings onto the current data key when the server starts (spec 009, FR-003, FR-005):
// values written before the data key existed (v1, encrypted with a key from the auth secret), and
// values encrypted with the data key a replacement left behind. It runs before the server serves
// anything, in one transaction, so a value is never half moved. A value no key can read is left as
// it is, and the app reports it when it next needs its settings.
import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { appSetting } from "../db/schema.ts";
import { decrypt, decryptLegacy, encrypt } from "./settings.ts";

export interface Keys {
  authSecret: string;
  dataKey: string;
  previousDataKey?: string;
}

export interface Moved {
  /** Values re-encrypted with the current data key. */
  moved: number;
  /** Values already on the current data key. */
  current: number;
  /** Values no key here can read. */
  unreadable: number;
}

function readable(keys: Keys, stored: string): string | undefined {
  const attempts = [
    () => decrypt(keys.dataKey, stored),
    () => (keys.previousDataKey ? decrypt(keys.previousDataKey, stored) : undefined),
    () => decryptLegacy(keys.authSecret, stored),
  ];
  for (const attempt of attempts) {
    try {
      const value = attempt();
      if (value !== undefined) return value;
    } catch {
      // Not this key.
    }
  }
  return undefined;
}

export async function moveSettingsToDataKey(db: Db, keys: Keys): Promise<Moved> {
  return db.transaction(async (tx) => {
    const rows = await tx.select({ appId: appSetting.appId, name: appSetting.name, value: appSetting.value }).from(appSetting).where(isNotNull(appSetting.value));
    const result: Moved = { moved: 0, current: 0, unreadable: 0 };
    for (const row of rows) {
      const stored = row.value!;
      try {
        decrypt(keys.dataKey, stored);
        result.current++;
        continue;
      } catch {
        // Not on the current key yet.
      }
      const value = readable(keys, stored);
      if (value === undefined) {
        result.unreadable++;
        continue;
      }
      await tx.update(appSetting).set({ value: encrypt(keys.dataKey, value) }).where(and(eq(appSetting.appId, row.appId), eq(appSetting.name, row.name)));
      result.moved++;
    }
    return result;
  });
}
