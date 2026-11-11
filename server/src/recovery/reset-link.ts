// Issues a single-use password reset link for the existing owner (T047; research R8). Issuing it
// changes nothing until it is used (FR-018): Better Auth only stores a short-lived token.
import { and, eq } from "drizzle-orm";
import { createCommandAuth, type AuthDeps, type IssuedLink } from "../auth.ts";
import { operatorActorId, recordEvent } from "../actors.ts";
import { isStorageError } from "../db/client.ts";
import { member, user } from "../db/auth-schema.ts";
import { readInstallation, StorageUnavailable } from "../owner/installation.ts";

export type ResetLinkResult =
  | { ok: true; username: string; url: string; token: string; expiresAt: Date }
  | { ok: false; error: "no_owner" }
  | { ok: false; error: "storage_unavailable" };

export async function issueResetLink(deps: AuthDeps): Promise<ResetLinkResult> {
  const { db } = deps;
  let link: IssuedLink | undefined;
  const auth = createCommandAuth(deps, (issued) => {
    link = issued;
  });

  try {
    const claim = await readInstallation(db);
    if (claim.state !== "claimed" || !claim.workspaceId) return { ok: false, error: "no_owner" };

    // The owner is found through the ownership role, not a hard-coded account (FR-014).
    const owners = await db
      .select({ id: user.id, email: user.email, username: user.username })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, claim.workspaceId), eq(member.role, "owner")))
      .limit(1);
    const owner = owners[0];
    if (!owner) throw new StorageUnavailable("The installation is claimed but its owner record is missing.");

    // The reset flow looks the account up by its stored email, the placeholder included; it sends nothing.
    await auth.api.requestPasswordReset({ body: { email: owner.email } });
    if (!link) throw new Error("Better Auth did not issue a reset link.");

    // If this fails the link is not printed, so nobody holds it and it expires unused.
    await recordEvent(db, "recovery.link_issued", await operatorActorId(db), owner.id);

    return { ok: true, username: owner.username ?? "", url: link.url, token: link.token, expiresAt: link.expiresAt };
  } catch (error) {
    if (error instanceof StorageUnavailable || isStorageError(error)) return { ok: false, error: "storage_unavailable" };
    throw error;
  }
}
