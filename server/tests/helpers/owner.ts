// Creates the owner in-process and sets a known password through the set-password link.
import { createOwner } from "../../src/owner/create-owner.ts";
import { createAuth } from "../../src/auth.ts";
import type { Db } from "../../src/db/client.ts";
import { PUBLIC_URL, TEST_SECRET } from "./env.ts";

// No email, like an owner who gives none; create-owner.test.ts covers one given with --email.
export const OWNER = { name: "Sam Rivera", username: "sam", password: "correct horse battery staple" };

export async function createOwnerWithPassword(db: Db, owner = OWNER, publicUrl = PUBLIC_URL) {
  const config = { publicUrl, authSecret: TEST_SECRET };
  const result = await createOwner({ config, db }, { name: owner.name, username: owner.username });
  if (!result.ok) throw new Error(`create-owner failed: ${result.error}`);
  const auth = createAuth({ config, db });
  await auth.api.resetPassword({ body: { newPassword: owner.password, token: result.token } });
  return result;
}
