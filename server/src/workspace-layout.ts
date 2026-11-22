import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  validateComposition,
  type SavedView,
  type ViewComposition,
  type WorkspaceLayout,
} from "../../shared/workspace-layout/model.mjs";
import type { Auth } from "./auth.ts";
import { ownerFor } from "./apps/routes.ts";
import { AppError } from "./apps/service.ts";
import type { Db } from "./db/client.ts";
import { member } from "./db/auth-schema.ts";
import { actor, app, installation, ownerLayout } from "./db/schema.ts";

function invalid(message = "Check the saved view or sidebar order."): never {
  throw new AppError(400, "invalid_layout", message);
}
function conflict(): never {
  throw new AppError(409, "layout_changed", "The saved workspace layout changed. Refresh it and try again.");
}
function nameFor(value: unknown, views: SavedView[], except?: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80 || /[\p{C}]/u.test(value))
    invalid("Use a name of 1–80 characters.");
  const name = value.trim();
  if (views.some((view) => view.id !== except && view.name.toLowerCase() === name.toLowerCase())) {
    throw new AppError(409, "view_name_taken", "A saved view already has that name.");
  }
  return name;
}
function compositionFor(value: unknown, apps: string[]): ViewComposition {
  let composition;
  try {
    composition = validateComposition(value);
  } catch (err) {
    invalid(err instanceof Error ? err.message : undefined);
  }
  if (composition.apps.some((name) => !apps.includes(name)))
    throw new AppError(409, "apps_changed", "An app is unavailable. Refresh the open apps before saving.");
  return composition;
}

type Change = (current: WorkspaceLayout, input: Record<string, unknown>, id: string) => unknown;

export function workspaceLayoutRoutes(auth: Auth, db: Db) {
  const router = Router();
  const handle = (fields: string[], change?: Change) => async (req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", "no-store");
    try {
      const owner = await ownerFor(auth, db, req);
      if (typeof owner === "string")
        throw new AppError(owner === "signed_out" ? 401 : 403, owner, "Sign in as the workspace owner.");
      let input: Record<string, unknown> = {};
      if (change) {
        if (req.get("origin") !== new URL(auth.options.baseURL as string).origin || !req.is("application/json")) {
          throw new AppError(403, "forbidden", "Use the signed-in workspace to change its layout.");
        }
        if (
          !req.body ||
          typeof req.body !== "object" ||
          Array.isArray(req.body) ||
          Object.keys(req.body).some((key) => !fields.includes(key))
        )
          invalid();
        input = req.body;
      }
      const result = await db.transaction(async (tx) => {
        const access = tx
          .select({ id: installation.workspaceId })
          .from(installation)
          .innerJoin(member, and(eq(member.organizationId, installation.workspaceId), eq(member.role, "owner")))
          .innerJoin(actor, eq(actor.userId, member.userId))
          .where(and(eq(installation.id, 1), eq(installation.state, "claimed"), eq(actor.id, owner.actorId)));
        // Lock the workspace before its first settings row exists. Changes to
        // different saved views merge while same-view revision conflicts fail.
        const [workspace] = await (change ? access.for("update", { of: installation }) : access);
        if (!workspace?.id) throw new AppError(403, "forbidden", "This account cannot manage the workspace layout.");
        const [settings] = await tx
          .select()
          .from(ownerLayout)
          .where(and(eq(ownerLayout.workspaceId, workspace.id), eq(ownerLayout.ownerId, owner.actorId)));
        const apps = await tx
          .select({ name: app.name })
          .from(app)
          .where(and(ne(app.state, "removed"), isNotNull(app.interface)))
          .orderBy(asc(app.createdAt), asc(app.name));
        const names = new Set(apps.map((row) => row.name));
        const order = (settings?.appOrder ?? []).filter((name) => names.delete(name));
        const current: WorkspaceLayout = {
          revision: settings?.revision ?? 0,
          appOrder: [...order, ...names],
          views: settings?.views ?? [],
        };
        if (!change) return current;
        const result = change(current, input, String(req.params.id ?? ""));
        await tx
          .insert(ownerLayout)
          .values({ workspaceId: workspace.id, ownerId: owner.actorId, ...current })
          .onConflictDoUpdate({ target: [ownerLayout.workspaceId, ownerLayout.ownerId], set: current });
        return result;
      });
      res.json(result);
    } catch (error) {
      if (error instanceof AppError) res.status(error.status).json({ error: error.code, message: error.message });
      else next(error);
    }
  };

  router.get("/", handle([]));
  router.put(
    "/app-order",
    handle(["revision", "appOrder"], (current, body) => {
      if (body.revision !== current.revision) conflict();
      const names = body.appOrder;
      if (
        !Array.isArray(names) ||
        names.length !== current.appOrder.length ||
        !names.every((name) => typeof name === "string")
      )
        invalid("Include every available sidebar app once.");
      if (new Set(names).size !== names.length || names.some((name) => !current.appOrder.includes(name))) {
        throw new AppError(409, "apps_changed", "The list of apps changed. Refresh it before reordering.");
      }
      current.appOrder = names;
      current.revision++;
      return current;
    }),
  );
  router.post(
    "/views",
    handle(["name", "composition"], (current, body) => {
      if (current.views.length >= 64)
        throw new AppError(409, "view_limit", "Remove a saved view before adding another.");
      const view = {
        id: randomUUID(),
        revision: 1,
        name: nameFor(body.name, current.views),
        composition: compositionFor(body.composition, current.appOrder),
      };
      current.views.push(view);
      return view;
    }),
  );
  function matched(current: WorkspaceLayout, body: Record<string, unknown>, id: string) {
    const view = current.views.find((item) => item.id === id);
    if (!view) throw new AppError(404, "view_not_found", "This saved view no longer exists.");
    if (body.revision !== view.revision) conflict();
    return view;
  }
  router.put(
    "/views/:id",
    handle(["revision", "name", "composition"], (current, body, id) => {
      const view = matched(current, body, id);
      if (!Object.hasOwn(body, "name") && !Object.hasOwn(body, "composition")) invalid();
      if (Object.hasOwn(body, "name")) view.name = nameFor(body.name, current.views, id);
      if (Object.hasOwn(body, "composition")) view.composition = compositionFor(body.composition, current.appOrder);
      view.revision++;
      return view;
    }),
  );
  router.delete(
    "/views/:id",
    handle(["revision"], (current, body, id) => {
      matched(current, body, id);
      current.views = current.views.filter((view) => view.id !== id);
      return { ok: true };
    }),
  );
  return router;
}
