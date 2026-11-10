// Reads whether the owner exists (T015, research R10). "No owner" is reported only when the
// database positively says so; a failed read or a missing row is a storage problem (FR-013).
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { installation } from "../db/schema.ts";

export class StorageUnavailable extends Error {
  override name = "StorageUnavailable";
}

export type InstallationState = "claimed" | "unclaimed";

export interface Installation {
  state: InstallationState;
  workspaceId: string | null;
}

export async function readInstallation(db: Db): Promise<Installation> {
  let rows: Array<{ state: InstallationState; workspaceId: string | null }>;
  try {
    rows = await db
      .select({ state: installation.state, workspaceId: installation.workspaceId })
      .from(installation)
      .where(eq(installation.id, 1));
  } catch (error) {
    throw new StorageUnavailable("The database could not be read.", { cause: error });
  }
  const row = rows[0];
  if (!row) throw new StorageUnavailable("The installation record is missing.");
  if (row.state !== "claimed" && row.state !== "unclaimed") {
    throw new StorageUnavailable("The installation record is unreadable.");
  }
  return row;
}

export async function readInstallationState(db: Db): Promise<InstallationState> {
  return (await readInstallation(db)).state;
}
