// The GitHub connection (journey 015): the workspace's source credential, a fine-grained token the
// owner pastes, with Contents read on the repositories they choose. The GitHub page and the `github`
// server command call these same actions (decision 6). The token is encrypted under the data key and
// never returned, logged or given to an app or an agent (R5). GitHub is asked about it only when the
// owner connects or looks at the connection, never in the background (R7).
import { and, eq } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Auth } from "./auth.ts";
import type { Db } from "./db/client.ts";
import { sourceCredential } from "./db/schema.ts";
import { ownerFor } from "./apps/routes.ts";
import { githubAccount, githubEndpoints, SourceError, TokenRefusedError, type GithubEndpoints } from "./apps/github.ts";
import { decrypt, encrypt } from "./apps/settings.ts";
import { readInstallation } from "./owner/installation.ts";

/** Where the owner deletes a token at GitHub: Your Space can't revoke one for them (decision 5). */
export const GITHUB_TOKENS_URL = "https://github.com/settings/personal-access-tokens";

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
}

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
  /** Stands in for GitHub in tests. */
  fetch?: typeof fetch;
}

type Row = typeof sourceCredential.$inferSelect;

export class GithubConnection {
  private readonly db: Db;
  private readonly dataKey: string;
  private readonly endpoints: GithubEndpoints;
  private readonly fetcher: typeof fetch;

  constructor(db: Db, dataKey: string, options: GithubConnectionOptions = {}) {
    this.db = db;
    this.dataKey = dataKey;
    this.endpoints = options.endpoints ?? githubEndpoints();
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

  private async row(workspaceId: string): Promise<Row | undefined> {
    const [row] = await this.db.select().from(sourceCredential).where(eq(sourceCredential.workspaceId, workspaceId));
    return row;
  }

  /** Marks what GitHub said, only if the token is still the one asked about. */
  private async mark(row: Row, change: Partial<Pick<Row, "account" | "workedAt" | "refusedAt">>): Promise<void> {
    await this.db.update(sourceCredential).set(change).where(and(eq(sourceCredential.id, row.id), eq(sourceCredential.token, row.token)));
  }

  /** Whether a token is set, for which account, and whether GitHub still accepts it, which it asks now. */
  async status(): Promise<ConnectionStatus> {
    const row = await this.row(await this.workspace());
    if (!row) return { contents: { set: false } };
    const known = { set: true as const, login: row.account, lastWorkedAt: row.workedAt.toISOString() };
    let token: string;
    try {
      token = decrypt(this.dataKey, row.token);
    } catch {
      // Encrypted under a data key that is gone: only connecting again helps (decision 3).
      return { contents: { ...known, accepted: false, problem: "unreadable" } };
    }
    try {
      const { login } = await githubAccount(token, this.endpoints, this.fetcher);
      const now = new Date();
      await this.mark(row, { account: login, workedAt: now, refusedAt: null });
      return { contents: { set: true, login, lastWorkedAt: now.toISOString(), accepted: true } };
    } catch (error) {
      if (error instanceof TokenRefusedError) {
        await this.mark(row, { refusedAt: new Date() });
        return { contents: { ...known, accepted: false, problem: "refused" } };
      }
      if (error instanceof SourceError) {
        // GitHub couldn't be asked; a refusal it gave before still stands.
        return { contents: row.refusedAt ? { ...known, accepted: false, problem: "refused" } : { ...known, accepted: null, problem: "unreachable" } };
      }
      throw error;
    }
  }

  /** Stores the contents token once GitHub says which account it belongs to, replacing any before it. */
  async connect(input: unknown): Promise<ConnectionStatus> {
    if (typeof input !== "string" || !input.trim()) {
      throw new ConnectionError(400, "token_required", "Paste the token GitHub showed you when you created it.");
    }
    const token = input.trim();
    if (!TOKEN.test(token)) {
      throw new ConnectionError(400, "token_invalid", "That isn't a GitHub token. Copy the whole token GitHub showed you and paste it again.");
    }
    const workspaceId = await this.workspace();
    let login: string;
    try {
      ({ login } = await githubAccount(token, this.endpoints, this.fetcher));
    } catch (error) {
      if (error instanceof TokenRefusedError) {
        throw new ConnectionError(400, "token_refused", "GitHub doesn't accept this token. Check that you copied all of it, or create a new one.");
      }
      if (error instanceof SourceError) throw new ConnectionError(503, "github_unavailable", error.message);
      throw error;
    }
    const now = new Date();
    const stored = { token: encrypt(this.dataKey, token), account: login, workedAt: now, refusedAt: null, createdAt: now };
    await this.db
      .insert(sourceCredential)
      .values({ workspaceId, ...stored })
      .onConflictDoUpdate({ target: sourceCredential.workspaceId, set: stored });
    return { contents: { set: true, login, lastWorkedAt: now.toISOString(), accepted: true } };
  }

  /** Forgets the token here. The owner deletes it at GitHub; installed apps keep running (decision 5). */
  async disconnect(): Promise<{ removed: boolean }> {
    const removed = await this.db
      .delete(sourceCredential)
      .where(eq(sourceCredential.workspaceId, await this.workspace()))
      .returning({ id: sourceCredential.id });
    return { removed: removed.length > 0 };
  }
}

/** GET, PUT and DELETE /api/github: the GitHub page's status, connect and disconnect, for the owner only. */
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
  router.get("/", route(() => connection.status()));
  router.put(
    "/",
    route((req) => {
      const body: unknown = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "token")) {
        throw new ConnectionError(400, "token_required", "Paste the token GitHub showed you when you created it.");
      }
      return connection.connect((body as { token?: unknown }).token);
    }),
  );
  router.delete(
    "/",
    route(async () => ({ ...(await connection.disconnect()), contents: { set: false } })),
  );
  return router;
}
