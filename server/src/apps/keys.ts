// Moves apps' settings, and the other values encrypted under the data key, onto the current data key
// when the server starts (spec 009, FR-003, FR-005): values encrypted with the data key a replacement
// left behind. The Google connection of synced knowledge bases moves with them (journey 014), so
// replacing the data key doesn't stop a sync. No release wrote values before the data key, so none is
// read with the auth secret (decision 2026-11-23, Alpha scope). It runs before the server serves
// anything, in one transaction, so a value is never half moved. A value no key can read is left as
// it is, and the app reports it when it next needs its settings.
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { appSetting, googleConnection } from "../db/schema.ts";
import { decrypt, encrypt } from "./settings.ts";

export interface Keys {
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
    // The Google connection's client secret and token (journey 014).
    for (const row of await tx.select().from(googleConnection).for("update")) {
      const moved: { clientSecret?: string; token?: string } = {};
      for (const column of ["clientSecret", "token"] as const) {
        const stored = row[column];
        if (!stored) continue;
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
        moved[column] = encrypt(keys.dataKey, value);
        result.moved++;
      }
      if (Object.keys(moved).length > 0) await tx.update(googleConnection).set(moved).where(eq(googleConnection.id, row.id));
    }
    // Agent credentials, approval previews and receipts, and the GitHub connection's tokens, its
    // contents token and its image token (journey 015, decision 3), use the same installation data
    // key. Leaving the token out is what broke the removed connection. Batch migration avoids loading
    // all historical results into memory during rotation.
    if (keys.previousDataKey) {
      for (const [table, pk, column] of [
        ["agent_binding", "app_id", "credential"],
        ["agent_credential", "id", "credential"],
        ["agent_request", "id", "input"],
        ["agent_request", "id", "result"],
        ["source_credential", "id", "token"],
        ["registry_credential", "id", "token"],
      ] as const) {
        let cursor = "00000000-0000-0000-0000-000000000000";
        for (;;) {
          const page = await tx.execute<{id:string; value:string}>(sql`select ${sql.identifier(pk)} as id,
            ${sql.identifier(column)} as value from ${sql.identifier(table)} where ${sql.identifier(column)} is not null
            and ${sql.identifier(pk)} > ${cursor} order by ${sql.identifier(pk)} limit 128 for update`);
          for (const record of page.rows) {
            cursor = record.id;
            try {
              decrypt(keys.dataKey, record.value);
              result.current++;
            } catch {
              const value = readable(keys, record.value);
              if (value === undefined) { result.unreadable++; continue; }
              await tx.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(column)}=${encrypt(keys.dataKey, value)}
                where ${sql.identifier(pk)}=${record.id}`);
              result.moved++;
            }
          }
          if (page.rows.length < 128) break;
        }
      }
    }
    return result;
  });
}
