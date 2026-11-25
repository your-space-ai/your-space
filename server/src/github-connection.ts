// The GitHub connection (journey 015): the workspace's source credential, a fine-grained token the
// owner pastes, with Contents read on the repositories they choose, and its optional registry
// credential, the image token, a classic token with only read:packages for private images on GHCR
// (decision 4). The GitHub page and the `github` server command call these same actions (decision
// 6). The tokens are encrypted under the data key and never returned, logged or given to an app or an
// agent (R5). They are used only while the owner reviews or installs a kit GitHub doesn't show
// anonymously, or an image GHCR doesn't, or connects or looks at the connection, never in the
// background (R7).
import { and, eq, sql } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Auth } from "./auth.ts";
import type { Db } from "./db/client.ts";
import { registryCredential, sourceCredential } from "./db/schema.ts";
import { ownerFor } from "./apps/routes.ts";
import {
  githubAccount,
  githubEndpoints,
  githubRegistry,
  IMAGE_SCOPE,
  isClassicToken,
  isFineGrainedToken,
  SourceError,
  TokenRefusedError,
  type GithubEndpoints,
} from "./apps/github.ts";
import type { RegistryCredentials, SourceCredentials } from "./apps/service.ts";
import { decrypt, encrypt } from "./apps/settings.ts";
import { readInstallation } from "./owner/installation.ts";

/** Where the owner deletes a token at GitHub: Your Space can't revoke one for them (decision 5). */
export const GITHUB_TOKENS_URL = "https://github.com/settings/personal-access-tokens";
/** Where the owner deletes a classic token, as the image token is. */
export const GITHUB_CLASSIC_TOKENS_URL = "https://github.com/settings/tokens";

/** What the API and `github status` say about a token: never the token itself (R5). */
export type TokenStatus =
  | { set: false }
  | {
      set: true;
      login: string;
      /** When GitHub last accepted it. */
      lastWorkedAt: string;
      /** Whether GitHub still accepts it; null when GitHub couldn't be asked just now. */
      accepted: boolean | null;
      /** Why it isn't known to work: GitHub refused it, no data key here reads it, or GitHub can't be reached. */
      problem?: "refused" | "unreadable" | "unreachable";
    };

export interface ConnectionStatus {
  /** The contents token: kits and the Compose files they name. */
  contents: TokenStatus;
  /** The image token: private images on GHCR (decision 4). */
  images: TokenStatus;
}

/** The connection's two slots, each added, replaced and removed on its own. */
type Slot = keyof ConnectionStatus;

export class ConnectionError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ConnectionError";
    this.status = status;
    this.code = code;
  }
}

// GitHub's tokens are short runs of visible ASCII; anything else was pasted by mistake.
const TOKEN = /^[\x21-\x7e]{1,1024}$/;

export interface GithubConnectionOptions {
  endpoints?: GithubEndpoints;
  /** The registry the image token signs in to; a stand-in for ghcr.io in tests. */
  registry?: string;
  /** Stands in for GitHub in tests. */
  fetch?: typeof fetch;
}

type Row = typeof sourceCredential.$inferSelect;

// Each slot's table: the source credential holds the contents token, the registry credential the
// image token. They have the same columns, so one set of queries serves both.
const TABLES = { contents: sourceCredential, images: registryCredential as unknown as typeof sourceCredential } satisfies Record<Slot, unknown>;

export class GithubConnection implements SourceCredentials, RegistryCredentials {
  private readonly db: Db;
  private readonly dataKey: string;
  private readonly endpoints: GithubEndpoints;
  private readonly fetcher: typeof fetch;
  readonly registry: string;

  constructor(db: Db, dataKey: string, options: GithubConnectionOptions = {}) {
    this.db = db;
    this.dataKey = dataKey;
    this.endpoints = options.endpoints ?? githubEndpoints();
    this.registry = options.registry ?? githubRegistry();
    this.fetcher = options.fetch ?? fetch;
  }

  /** The connection belongs to the owner's workspace, so there is none before the owner exists. */
  private async workspace(): Promise<string> {
    const found = await readInstallation(this.db);
    if (found.state !== "claimed" || !found.workspaceId) {
      throw new ConnectionError(409, "no_owner", "This installation has no owner yet. Create the owner first: the GitHub connection belongs to their workspace.");
    }
    return found.workspaceId;
  }

  private async row(slot: Slot, workspaceId: string): Promise<Row | undefined> {
    const table = TABLES[slot];
    const [row] = await this.db.select().from(table).where(eq(table.workspaceId, workspaceId));
    return row;
  }

  /**
   * Marks that the token worked in a use that began at `started`. A refusal GitHub gave since then,
   * to a use that finished first, stands.
   */
  private async worked(slot: Slot, row: Row, started: Date): Promise<void> {
    const table = TABLES[slot];
    await this.db
      .update(table)
      .set({ workedAt: new Date(), refusedAt: sql`case when ${table.refusedAt} >= ${started.toISOString()}::timestamptz then ${table.refusedAt} end` })
      .where(and(eq(table.id, row.id), eq(table.token, row.token)));
  }

  /** Marks what GitHub said, only if the token is still the one asked about. */
  private async mark(slot: Slot, row: Row, change: Partial<Pick<Row, "account" | "workedAt" | "refusedAt">>): Promise<void> {
    const table = TABLES[slot];
    await this.db.update(table).set(change).where(and(eq(table.id, row.id), eq(table.token, row.token)));
  }

  /** Whether each token is set, for which account, and whether GitHub still accepts it, which it asks now. */
  async status(): Promise<ConnectionStatus> {
    const workspaceId = await this.workspace();
    const [contents, images] = await Promise.all([this.tokenStatus("contents", workspaceId), this.tokenStatus("images", workspaceId)]);
    return { contents, images };
  }

  private async tokenStatus(slot: Slot, workspaceId: string): Promise<TokenStatus> {
    const row = await this.row(slot, workspaceId);
    if (!row) return { set: false };
    const known = { set: true as const, login: row.account, lastWorkedAt: row.workedAt.toISOString() };
    let token: string;
    try {
      token = decrypt(this.dataKey, row.token);
    } catch {
      // Encrypted under a data key that is gone: only connecting again helps (decision 3).
      return { ...known, accepted: false, problem: "unreadable" };
    }
    try {
      const { login } = await githubAccount(token, this.endpoints, this.fetcher);
      const now = new Date();
      await this.mark(slot, row, { account: login, workedAt: now, refusedAt: null });
      return { set: true, login, lastWorkedAt: now.toISOString(), accepted: true };
    } catch (error) {
      if (error instanceof TokenRefusedError) {
        await this.mark(slot, row, { refusedAt: new Date() });
        return { ...known, accepted: false, problem: "refused" };
      }
      if (error instanceof SourceError) {
        // GitHub couldn't be asked; a refusal it gave before still stands.
        return row.refusedAt ? { ...known, accepted: false, problem: "refused" } : { ...known, accepted: null, problem: "unreachable" };
      }
      throw error;
    }
  }

  /**
   * The token for reading a kit Your Space can't read anonymously (R1, R2), or why there is none to
   * use. GitHub isn't asked here: the read itself says whether GitHub still accepts the token, and
   * marks it so the GitHub page and `github status` show it (decision 5).
   */
  async reading(): ReturnType<SourceCredentials["reading"]> {
    const started = new Date();
    const found = await readInstallation(this.db);
    if (found.state !== "claimed" || !found.workspaceId) return { state: "none" };
    const row = await this.row("contents", found.workspaceId);
    if (!row) return { state: "none" };
    let token: string;
    try {
      token = decrypt(this.dataKey, row.token);
    } catch {
      return { state: "unreadable", login: row.account };
    }
    return {
      state: "ready",
      credential: { login: row.account, token },
      worked: () => this.worked("contents", row, started),
      refused: () => this.mark("contents", row, { refusedAt: new Date() }),
    };
  }

  /**
   * The image token, to sign the engine in to GHCR for an image it doesn't show anonymously (R9), or
   * why there is none to use. GitHub isn't asked here; a registry that gives an image with it marks
   * that it worked.
   */
  async signingIn(): ReturnType<RegistryCredentials["signingIn"]> {
    const started = new Date();
    const found = await readInstallation(this.db);
    if (found.state !== "claimed" || !found.workspaceId) return { state: "none" };
    const row = await this.row("images", found.workspaceId);
    if (!row) return { state: "none" };
    let token: string;
    try {
      token = decrypt(this.dataKey, row.token);
    } catch {
      return { state: "unreadable", login: row.account };
    }
    return {
      state: "ready",
      login: row.account,
      // GHCR takes the account's login with a classic token as its password.
      credential: { registry: this.registry, username: row.account, secret: token },
      worked: () => this.worked("images", row, started),
    };
  }

  /** Stores the contents token once GitHub says which account it belongs to, replacing any before it. */
  async connect(input: unknown): Promise<Pick<ConnectionStatus, "contents">> {
    const token = pasted(input);
    // A classic or app token could reach more than the repositories the owner chooses, so it isn't
    // sent to GitHub or stored.
    if (!isFineGrainedToken(token)) {
      throw new ConnectionError(
        400,
        "token_not_fine_grained",
        "Your Space takes only a fine-grained token, which starts with github_pat_ and reads only the repositories you choose. Create one with Contents read, from Create a token on GitHub on Your Space's GitHub page, and paste it.",
      );
    }
    const workspaceId = await this.workspace();
    const { login } = await this.account(token);
    return { contents: await this.store("contents", workspaceId, token, login) };
  }

  /**
   * Stores the image token, replacing any before it, once GitHub says which account it belongs to and
   * that its scopes are `read:packages` and nothing more (R2); any other token is refused before it is
   * stored. GHCR takes only a classic token (decision 4).
   */
  async addImageToken(input: unknown): Promise<Pick<ConnectionStatus, "images">> {
    const token = pasted(input);
    if (!isClassicToken(token)) {
      throw new ConnectionError(
        400,
        "token_not_classic",
        isFineGrainedToken(token)
          ? "That's a fine-grained token, which can't read packages. GitHub's container registry takes only a classic token: create one with only read:packages, from Create an image token on GitHub on Your Space's GitHub page, and paste it."
          : "The image token is a personal access token (classic), which starts with ghp_, with only read:packages. Create one from Create an image token on GitHub on Your Space's GitHub page, and paste it.",
      );
    }
    const workspaceId = await this.workspace();
    const { login, scopes } = await this.account(token);
    if (!(scopes?.length === 1 && scopes[0] === IMAGE_SCOPE)) {
      const has = scopes?.length ? `the scopes ${scopes.join(", ")}` : "no scopes";
      throw new ConnectionError(
        400,
        "token_scopes",
        `This token has ${has}. The image token must have only read:packages, so Your Space didn't keep it. Create a classic token with only read:packages, paste it, and delete this one at GitHub if you made it for Your Space.`,
      );
    }
    return { images: await this.store("images", workspaceId, token, login) };
  }

  /** The account GitHub says a token belongs to, and its scopes, or why it can't be stored. */
  private async account(token: string): Promise<{ login: string; scopes: string[] | null }> {
    try {
      return await githubAccount(token, this.endpoints, this.fetcher);
    } catch (error) {
      if (error instanceof TokenRefusedError) {
        throw new ConnectionError(400, "token_refused", "GitHub doesn't accept this token. Check that you copied all of it, or create a new one.");
      }
      if (error instanceof SourceError) throw new ConnectionError(503, "github_unavailable", error.message);
      throw error;
    }
  }

  private async store(slot: Slot, workspaceId: string, token: string, login: string): Promise<TokenStatus> {
    const table = TABLES[slot];
    const now = new Date();
    const stored = { token: encrypt(this.dataKey, token), account: login, workedAt: now, refusedAt: null, createdAt: now };
    await this.db.insert(table).values({ workspaceId, ...stored }).onConflictDoUpdate({ target: table.workspaceId, set: stored });
    return { set: true, login, lastWorkedAt: now.toISOString(), accepted: true };
  }

  /** Forgets both tokens here. The owner deletes them at GitHub; installed apps keep running (decision 5). */
  async disconnect(): Promise<{ removed: boolean }> {
    const workspaceId = await this.workspace();
    const removed = await this.db.transaction(async (tx) => {
      const removed = [];
      for (const table of Object.values(TABLES)) {
        removed.push(...(await tx.delete(table).where(eq(table.workspaceId, workspaceId)).returning({ id: table.id })));
      }
      return removed;
    });
    return { removed: removed.length > 0 };
  }

  /** Forgets the image token alone; the contents token stays (decision 5). */
  async removeImageToken(): Promise<{ removed: boolean }> {
    const table = TABLES.images;
    const removed = await this.db.delete(table).where(eq(table.workspaceId, await this.workspace())).returning({ id: table.id });
    return { removed: removed.length > 0 };
  }
}

/** A pasted token, trimmed, or why it isn't one. */
function pasted(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new ConnectionError(400, "token_required", "Paste the token GitHub showed you when you created it.");
  }
  const token = input.trim();
  if (!TOKEN.test(token)) {
    throw new ConnectionError(400, "token_invalid", "That isn't a GitHub token. Copy the whole token GitHub showed you and paste it again.");
  }
  return token;
}

/**
 * GET, PUT and DELETE /api/github: the GitHub page's status, connect and disconnect, and PUT and
 * DELETE /api/github/image-token, the image token's add or replace and remove, for the owner only.
 */
export function githubRoutes(auth: Auth, db: Db, connection: GithubConnection): Router {
  const router = Router();
  const publicOrigin = new URL(auth.options.baseURL as string).origin;
  const route = (work: (req: Request) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", "no-store");
    try {
      const owner = await ownerFor(auth, db, req);
      if (owner === "signed_out") throw new ConnectionError(401, "signed_out", "Sign in to Your Space first.");
      if (owner === "forbidden") throw new ConnectionError(403, "forbidden", "Only the owner can manage the GitHub connection.");
      // A change counts only from Your Space's own pages, which browsers name in the Origin header.
      if (req.method !== "GET" && req.get("origin") !== publicOrigin) {
        throw new ConnectionError(403, "forbidden", "Manage the GitHub connection from Your Space itself.");
      }
      res.json(await work(req));
    } catch (error) {
      if (error instanceof ConnectionError) res.status(error.status).json({ error: error.code, message: error.message });
      else next(error);
    }
  };
  const token = (req: Request): unknown => {
    const body: unknown = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "token")) {
      throw new ConnectionError(400, "token_required", "Paste the token GitHub showed you when you created it.");
    }
    return (body as { token?: unknown }).token;
  };
  router.get("/", route(() => connection.status()));
  router.put("/", route((req) => connection.connect(token(req))));
  router.delete(
    "/",
    route(async () => ({ ...(await connection.disconnect()), contents: { set: false }, images: { set: false } })),
  );
  router.put("/image-token", route((req) => connection.addImageToken(token(req))));
  router.delete("/image-token", route(async () => ({ ...(await connection.removeImageToken()), images: { set: false } })));
  return router;
}
