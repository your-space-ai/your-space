// The Express app (T014): Better Auth first, then JSON routes, then a safe error handler.
import express, { type ErrorRequestHandler } from "express";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import type { Auth } from "./auth.ts";
import { isStorageError, type Db } from "./db/client.ts";
import { errorFields, log } from "./log.ts";
import { ownerRoutes } from "./owner/routes.ts";
import { appRoutes } from "./apps/routes.ts";
import type { Handoffs } from "./apps/gate.ts";
import type { AppsService } from "./apps/service.ts";

import { agentRoutes } from "./agents/routes.ts";

export interface AppDeps {
  dataKey?: string;
  auth: Auth;
  db: Db;
  /** Apps (journey 002). Left out by tests that don't need a runtime. */
  apps?: { service: AppsService; handoffs: Handoffs };
}

export function createApp({ auth, db, apps, dataKey }: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  // Caddy is the one proxy in front of the server.
  app.set("trust proxy", 1);

  // Every API request must name the address Your Space is set up for. Browsers always send it. A
  // proxy that rewrites the Host header (nginx's default) doesn't, and neither does a page that
  // re-points its own name at this machine (DNS rebinding), so those stop here with a message
  // that says what to fix. Docker's health check calls the server directly, so /api/health is exempt.
  const publicUrl = new URL(auth.options.baseURL as string);
  const publicOrigin = publicUrl.origin;
  app.use("/api", (req, res, next) => {
    if (req.path === "/health" || req.headers.host?.toLowerCase() === publicUrl.host) return next();
    res.status(421).json({
      error: "wrong_host",
      message: `Your Space is set up for ${publicOrigin}, and this request named a different address. If you use your own proxy, set it to pass the original Host header (nginx: proxy_set_header Host $http_host).`,
    });
  });

  // Better Auth reports sign-out as done even when deleting the session failed, which would leave
  // the session valid (FR-009). For requests from Your Space's own pages (the only origin Better
  // Auth accepts), delete the session first and report a failure as one (FR-016); Better Auth then
  // signs out as usual. Requests from anywhere else are left for Better Auth to refuse.
  app.post("/api/auth/sign-out", async (req, res, next) => {
    if (req.headers.origin !== publicOrigin) return next();
    try {
      const current = await auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableRefresh: true } });
      if (current) await (await auth.$context).internalAdapter.deleteSession(current.session.token);
      next();
    } catch (error) {
      if (!isStorageError(error)) return next(error);
      res.status(503).json({ error: "storage_unavailable", message: "Your Space can't update its storage, so you are still signed in." });
    }
  });

  // Better Auth reads the raw body itself, so it is mounted before express.json().
  app.all("/api/auth/*splat", toNodeHandler(auth));

  // The largest body is an app's settings.
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", ownerRoutes(db));
  if (dataKey) app.use("/api", agentRoutes(auth, db, dataKey));
  if (apps) app.use("/api", appRoutes(auth, db, apps.service, apps.handoffs));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not_found", message: "There is nothing at this address." });
  });

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) return;
    if (isStorageError(error)) {
      log("warn", "http.storage_unavailable", errorFields(error));
      res.status(503).json({ error: "storage_unavailable", message: "Your Space can't read its storage right now." });
      return;
    }
    const status = typeof error?.status === "number" && error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status === 500) log("error", "http.unhandled_error", errorFields(error));
    res.status(status).json(
      status === 500
        ? { error: "internal_error", message: "Something went wrong on the server." }
        : { error: "bad_request", message: "The request could not be read." },
    );
  };
  app.use(onError);

  return app;
}
