// Better Auth configuration (T009, research R3 and R4).
//
// One builder makes both instances, so they cannot drift apart:
// - `createAuth` is the public instance mounted at /api/auth. Sign-up is off and it has no
//   `sendResetPassword`, so the network can neither create accounts nor request reset links.
// - `createCommandAuth` exists only inside the create-owner and reset-link processes. Sign-up is on
//   and `sendResetPassword` hands the link to the command, which prints it. It is never mounted.
import { createHash } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { betterAuth, type User } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import type { Config } from "./config.ts";
import type { Db } from "./db/client.ts";
import * as authSchema from "./db/auth-schema.ts";
import { log } from "./log.ts";
import { recordPasswordReset } from "./actors.ts";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
/** Set-password and reset links work for 30 minutes. */
export const LINK_LIFETIME_SECONDS = 30 * 60;

/**
 * How Better Auth stores a verification identifier such as `reset-password:<token>`: the type
 * prefix, then a SHA-256 hash of the whole identifier. A copy of the database can't open a link
 * that is still valid, and the prefix still finds a user's links. Better Auth's own "hashed"
 * option would hash the prefix too.
 */
export function storedIdentifier(identifier: string): string {
  const prefix = identifier.slice(0, identifier.indexOf(":") + 1);
  return prefix + createHash("sha256").update(identifier).digest("base64url");
}

/**
 * Cancels the account's set-password and reset links issued before the one with this token, so
 * only the newest works. "Before" means created earlier, with the row ID breaking ties. So when two
 * links are stored before either command cancels the other (two reset-link commands at once), the
 * newer one survives, as if the commands had run one after the other.
 */
export async function cancelEarlierLinks(db: Db, userId: string, token: string): Promise<void> {
  const links = authSchema.verification;
  const own = storedIdentifier(`reset-password:${token}`);
  await db
    .delete(links)
    .where(
      and(
        like(links.identifier, "reset-password:%"),
        eq(links.value, userId),
        sql`(${links.createdAt}, ${links.id}) < (select own.created_at, own.id from verification own where own.identifier = ${own})`,
      ),
    );
}

export interface AuthDeps {
  config: Pick<Config, "publicUrl" | "authSecret">;
  db: Db;
}

export interface IssuedLink {
  user: User;
  token: string;
  url: string;
  expiresAt: Date;
}

export type OnLink = (link: IssuedLink) => void | Promise<void>;

// Organization routes the web client doesn't use. Only `/organization/list` stays on HTTP: in this
// feature nobody can be invited, added, removed, or given a different role, and the workspace can't
// be changed or deleted over the network (FR-005, FR-014). Server-side calls are not affected.
const DISABLED_ORGANIZATION_PATHS = [
  "accept-invitation",
  "cancel-invitation",
  "check-slug",
  "create",
  "delete",
  "get-active-member",
  "get-active-member-role",
  "get-full-organization",
  "get-invitation",
  "get-organization",
  "has-permission",
  "invite-member",
  "leave",
  "list-invitations",
  "list-members",
  "list-user-invitations",
  "reject-invitation",
  "remove-member",
  "set-active",
  "update",
  "update-member-role",
].map((name) => `/organization/${name}`);

/** The set-password or reset link. The token is in the fragment, which browsers never send to a server. */
export function linkFor(publicUrl: string, token: string): string {
  return `${publicUrl}/reset-password#token=${encodeURIComponent(token)}`;
}

function buildAuth(deps: AuthDeps, onLink?: OnLink) {
  const { config, db } = deps;
  return betterAuth({
    appName: "Your Space",
    baseURL: config.publicUrl,
    basePath: "/api/auth",
    secret: config.authSecret,
    // `transaction: true` makes a password reset (consume the token, revoke sessions, replace the
    // hash) one database transaction.
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema, transaction: true }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: onLink === undefined,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: LINK_LIFETIME_SECONDS,
      sendResetPassword: onLink
        ? async ({ user, token }) => {
            await cancelEarlierLinks(db, user.id, token);
            const expiresAt = new Date(Date.now() + LINK_LIFETIME_SECONDS * 1000);
            expiresAt.setMilliseconds(0);
            await onLink({ user, token, url: linkFor(config.publicUrl, token), expiresAt });
          }
        : undefined,
      onPasswordReset: async ({ user }) => {
        await recordPasswordReset(db, user.id);
      },
    },
    verification: {
      storeIdentifier: { hash: async (identifier) => storedIdentifier(identifier) },
    },
    session: {
      // Library defaults, stated so they are visible: 7 days, extended daily while used.
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Off, so a revoked session stops working everywhere at once.
      cookieCache: { enabled: false },
    },
    advanced: {
      database: { generateId: "uuid" },
    },
    telemetry: { enabled: false },
    disabledPaths: DISABLED_ORGANIZATION_PATHS,
    // Unexpected errors (a lost database, for example) are thrown to the Express error handler,
    // which logs only their name and code. Otherwise Better Auth's router prints the raw error,
    // whose text can include query parameters such as a reset token (FR-010).
    onAPIError: { throw: true },
    logger: {
      // Better Auth's messages go through the JSON log helper. Extra arguments can carry request
      // details, so only the message text is kept.
      log: (level, message) => {
        log(level, "auth.message", { message });
      },
    },
    plugins: [organization({ allowUserToCreateOrganization: false })],
  });
}

export function createAuth(deps: AuthDeps) {
  return buildAuth(deps);
}

export function createCommandAuth(deps: AuthDeps, onLink: OnLink) {
  return buildAuth(deps, onLink);
}

export type Auth = ReturnType<typeof buildAuth>;
