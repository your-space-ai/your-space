import { randomUUID } from "node:crypto";
import { fromNodeHeaders } from "better-auth/node";
import { and, eq } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import { builtInThemes, defaultThemeId, themeModes, validateTheme, type Theme, type ThemeMode } from "../../shared/appearance/theme.mjs";
import type { Auth } from "./auth.ts";
import { member } from "./db/auth-schema.ts";
import type { Db } from "./db/client.ts";
import { installation, workspaceAppearance } from "./db/schema.ts";

interface Catalog {
  revision: number;
  activeId: string;
  mode: ThemeMode;
  themes: { id: string; theme: Theme }[];
}
const defaults = (): Catalog => ({ revision: 0, activeId: defaultThemeId, mode: "system", themes: [] });
const preset = (id: string) => builtInThemes.find(entry => entry.id === id)?.theme;
const MAX_THEMES = 32;

class AppearanceError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function invalid(message = "The theme request is invalid."): never {
  throw new AppearanceError(400, "invalid_theme", message);
}

function unknownTheme(): never {
  throw new AppearanceError(404, "theme_not_found", "The saved theme could not be found.");
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
async function catalog(db: Db | Tx, workspaceId: string): Promise<Catalog> {
  const [row] = await db.select({
    revision: workspaceAppearance.revision, activeId: workspaceAppearance.activeId, mode: workspaceAppearance.mode,
    themes: workspaceAppearance.themes,
  }).from(workspaceAppearance).where(eq(workspaceAppearance.workspaceId, workspaceId));
  if (!row) return defaults();
  // Every saved theme was validated when it was written. A version 1 theme reads as version 2, and
  // is stored that way with the catalog's next change.
  return { ...row, themes: row.themes.map(({ id, theme }) => ({ id, theme: validateTheme(theme) })) };
}

type Change = (current: Catalog, body: Record<string, unknown>, req: Request) => void;

export function appearanceRoutes(auth: Auth, db: Db) {
  const router = Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  router.get("/active", async (_req, res) => {
    const [workspace] = await db.select({ id: installation.workspaceId }).from(installation)
      .where(and(eq(installation.id, 1), eq(installation.state, "claimed")));
    const current = workspace?.id ? await catalog(db, workspace.id) : defaults();
    const entry = current.themes.find(item => item.id === current.activeId)?.theme ?? preset(current.activeId);
    // Select only portable appearance values and the mode. Names and the custom catalog belong to the owner.
    const { style, fonts, light, dark } = validateTheme(entry ?? preset(defaultThemeId));
    res.json({ mode: current.mode, style, fonts, light, dark });
  });

  const manage = (fields: string[], change?: Change) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) throw new AppearanceError(401, "signed_out", "Sign in to Your Space first.");
      if (change && (req.get("origin") !== new URL(auth.options.baseURL as string).origin || !req.is("application/json"))) {
        throw new AppearanceError(403, "forbidden", "Use the owner’s signed-in workspace to change its appearance.");
      }
      const result = await db.transaction(async tx => {
        // Lock the installation across the first insert too. Two editors with the same revision
        // cannot both replace its catalog, even when no appearance row has been written yet.
        const access = tx.select({ id: installation.workspaceId }).from(installation)
          .innerJoin(member, eq(member.organizationId, installation.workspaceId))
          .where(and(eq(installation.id, 1), eq(installation.state, "claimed"),
            eq(member.userId, session.user.id), eq(member.role, "owner")));
        const [workspace] = await (change ? access.for("update") : access);
        if (!workspace?.id) throw new AppearanceError(403, "forbidden", "Only the workspace owner can manage appearance.");
        const current = await catalog(tx, workspace.id);
        if (!change) return current;
        const body: unknown = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body) ||
            Object.keys(body).some(key => key !== "revision" && !fields.includes(key))) invalid();
        const data = body as Record<string, unknown>;
        if (!Number.isSafeInteger(data.revision) || (data.revision as number) < 0) invalid();
        if (data.revision !== current.revision) throw new AppearanceError(409, "conflict", "Appearance changed. Refresh and try again.");
        change(current, data, req);
        current.revision++;
        await tx.insert(workspaceAppearance).values({ workspaceId: workspace.id, ...current })
          .onConflictDoUpdate({ target: workspaceAppearance.workspaceId, set: current });
        return current;
      });
      res.json(result);
    } catch (error) {
      if (error instanceof AppearanceError) { res.status(error.status).json({ error: error.code, message: error.message }); return; }
      next(error);
    }
  };

  router.get("/", manage([]));
  router.put("/selection", manage(["id"], (current, body) => {
    if (typeof body.id !== "string") invalid();
    if (!preset(body.id) && !current.themes.some(item => item.id === body.id)) unknownTheme();
    current.activeId = body.id;
  }));
  router.put("/mode", manage(["mode"], (current, body) => {
    if (!themeModes.includes(body.mode as ThemeMode)) invalid("Choose Match my device, Light or Dark.");
    current.mode = body.mode as ThemeMode;
  }));

  const save = manage(["theme", "activate"], (current, body, req) => {
    if (body.activate !== undefined && typeof body.activate !== "boolean") invalid();
    let theme: Theme;
    try { theme = validateTheme(body.theme); } catch (error) { invalid(error instanceof Error ? error.message : undefined); }
    let id: string;
    if (req.method === "POST") {
      if (current.themes.length >= MAX_THEMES) throw new AppearanceError(400, "theme_limit", "You can save up to 32 custom themes.");
      id = "custom-" + randomUUID();
      current.themes.push({ id, theme });
    } else {
      const saved = current.themes.find(item => item.id === req.params.id);
      if (!saved) unknownTheme();
      id = saved.id;
      saved.theme = theme;
    }
    if (body.activate === true) current.activeId = id;
  });
  router.post("/themes", save);
  router.put("/themes/:id", save);
  router.delete("/themes/:id", manage([], (current, _body, req) => {
    const index = current.themes.findIndex(item => item.id === req.params.id);
    if (index < 0) unknownTheme();
    if (current.themes[index]!.id === current.activeId) {
      throw new AppearanceError(409, "theme_in_use", "Select another theme before deleting this one.");
    }
    current.themes.splice(index, 1);
  }));
  return router;
}
