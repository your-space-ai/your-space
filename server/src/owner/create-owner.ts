// Creates the owner from the server (T027; data-model.md "Creating the Owner"; research R5, R6).
// Each step reuses what an interrupted earlier run created, so rerunning finishes the job. The
// installation is marked as having an owner only in the last step's transaction, after the
// set-password link exists, so any failure leaves it unclaimed and a rerun finishes the job.
import { randomBytes } from "node:crypto";
import { and, eq, sql, TransactionRollbackError } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { createCommandAuth, type AuthDeps, type IssuedLink } from "../auth.ts";
import { ensureHumanActor, operatorActorId, recordEvent } from "../actors.ts";
import { isStorageError } from "../db/client.ts";
import { member, organization, user } from "../db/auth-schema.ts";
import { installation } from "../db/schema.ts";
import { readInstallation, StorageUnavailable } from "./installation.ts";
import { validateOwnerInput, type FieldErrors, type OwnerInput } from "./rules.ts";

export type CreateOwnerResult =
  | { ok: true; name: string; email: string; url: string; token: string; expiresAt: Date }
  | { ok: false; error: "invalid_input"; fields: FieldErrors }
  | { ok: false; error: "owner_exists" }
  | { ok: false; error: "storage_unavailable" };

// Any fixed number works; it only has to be the same in every create-owner process.
const CREATE_OWNER_LOCK_KEY = 7_959_002;

export async function createOwner(deps: AuthDeps, input: Partial<OwnerInput>): Promise<CreateOwnerResult> {
  const valid = validateOwnerInput(input);
  if (!valid.ok) return { ok: false, error: "invalid_input", fields: valid.fields };
  const { db } = deps;

  // Runs one at a time, so two runs started together can't each create an account and workspace;
  // the second waits, then finds the owner.
  let lock;
  try {
    lock = await db.$client.connect();
    await lock.query("select pg_advisory_lock($1)", [CREATE_OWNER_LOCK_KEY]);
  } catch (error) {
    lock?.release(true);
    if (isStorageError(error)) return { ok: false, error: "storage_unavailable" };
    throw error;
  }
  try {
    return await createOwnerLocked(deps, valid.value);
  } finally {
    await lock.query("select pg_advisory_unlock($1)", [CREATE_OWNER_LOCK_KEY]).then(
      () => lock.release(),
      (error: Error) => lock.release(error),
    );
  }
}

async function createOwnerLocked(deps: AuthDeps, { name, email }: OwnerInput): Promise<CreateOwnerResult> {
  const { db } = deps;

  let link: IssuedLink | undefined;
  const auth = createCommandAuth(deps, (issued) => {
    link = issued;
  });

  try {
    // 1. Stop if the owner already exists.
    if ((await readInstallation(db)).state === "claimed") return { ok: false, error: "owner_exists" };

    // 2. The account, with a random password that is never shown. The set-password link is the way in.
    const existing = await db.select().from(user).where(eq(user.email, email)).limit(1);
    let owner = existing[0];
    if (!owner) {
      const others = await db.select({ email: user.email }).from(user).limit(1);
      if (others[0]) {
        // Only create-owner creates accounts, so this is an earlier run that stopped partway.
        return {
          ok: false,
          error: "invalid_input",
          fields: {
            email: `An earlier create-owner run that didn't finish used ${others[0].email}. Run it again with that email.`,
          },
        };
      }
      const password = randomBytes(64).toString("base64url");
      try {
        owner = (await auth.api.signUpEmail({ body: { name, email, password } })).user as typeof user.$inferSelect;
      } catch (error) {
        if (error instanceof APIError && (error.body as { code?: string } | undefined)?.code === "INVALID_EMAIL") {
          return { ok: false, error: "invalid_input", fields: { email: "Not a valid email address." } };
        }
        throw error;
      }
    }

    // 3. The workspace and the owner membership. The plugin makes the creator its `owner`.
    const workspaceId = await ensureWorkspace(deps, auth, owner.id, `${owner.name}'s space`);

    // 4. The set-password link, through Better Auth's reset flow. It is printed only if the claim
    // below succeeds; otherwise nobody holds it and it expires unused.
    await auth.api.requestPasswordReset({ body: { email: owner.email } });
    if (!link) throw new Error("Better Auth did not issue a set-password link.");
    const issued: IssuedLink = link;

    // 5. In one transaction: the owner's actor, the event, and the claim.
    const claimed = await db
      .transaction(async (tx) => {
        await ensureHumanActor(tx, owner.id);
        await recordEvent(tx, "owner.created", await operatorActorId(tx), owner.id);
        const updated = await tx
          .update(installation)
          .set({ state: "claimed", workspaceId, claimedAt: sql`now()` })
          .where(and(eq(installation.id, 1), eq(installation.state, "unclaimed")))
          .returning({ id: installation.id });
        if (updated.length === 0) tx.rollback();
        return true;
      })
      .catch((error: unknown) => {
        // The claim found the installation already claimed: report the owner, not an error.
        if (error instanceof TransactionRollbackError) return false;
        throw error;
      });
    if (!claimed) return { ok: false, error: "owner_exists" };

    return { ok: true, name: owner.name, email: owner.email, url: issued.url, token: issued.token, expiresAt: issued.expiresAt };
  } catch (error) {
    if (error instanceof StorageUnavailable || isStorageError(error)) return { ok: false, error: "storage_unavailable" };
    throw error;
  }
}

async function ensureWorkspace(
  deps: AuthDeps,
  auth: ReturnType<typeof createCommandAuth>,
  userId: string,
  workspaceName: string,
): Promise<string> {
  const { db } = deps;
  const owned = await db
    .select({ id: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, "owner")))
    .limit(1);
  if (owned[0]) return owned[0].id;

  // The slug is the owner's account ID, so a rerun can find a workspace whose membership was
  // never added and finish it.
  const slug = userId;
  const orphan = await db.select({ id: organization.id }).from(organization).where(eq(organization.slug, slug)).limit(1);
  if (orphan[0]) {
    await auth.api.addMember({ body: { userId, organizationId: orphan[0].id, role: "owner" } });
    return orphan[0].id;
  }

  const created = await auth.api.createOrganization({ body: { name: workspaceName, slug, userId } });
  if (!created) throw new Error("The workspace was not created.");
  return created.id;
}
