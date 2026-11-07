// The Express app (T014): Better Auth first, then JSON routes, then a safe error handler.
import { sql } from "drizzle-orm";
import express, { type ErrorRequestHandler } from "express";
import { toNodeHandler } from "better-auth/node";
import type { Auth } from "./auth.ts";
import { isStorageError, type Db } from "./db/client.ts";
import { errorFields, log } from "./log.ts";
import { ownerRoutes } from "./owner/routes.ts";

export interface AppDeps {
  auth: Auth;
  db: Db;
}

export function createApp({ auth, db }: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  // Caddy is the one proxy in front of the server.
  app.set("trust proxy", 1);

  // Better Auth reports sign-out as done even when it could not delete the session because the
  // database is down, which would leave the session valid (FR-009). Check storage first, so a
  // sign-out during an outage is reported as failed instead (FR-016).
  app.post("/api/auth/sign-out", async (_req, res, next) => {
    try {
      await db.execute(sql`select 1`);
      next();
    } catch {
      res.status(503).json({ error: "storage_unavailable", message: "Your Space can't read its storage, so you are still signed in." });
    }
  });

  // Better Auth reads the raw body itself, so it is mounted before express.json().
  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.use(express.json({ limit: "16kb" }));
  app.use("/api", ownerRoutes(db));

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
