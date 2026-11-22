// The access gate (components K and L, FR-014, FR-014a). Caddy asks it about every request to an
// app's address, on a listener only Caddy reaches (port 3001). A request passes with a short-lived
// pass cookie on the app's own host, which Your Space issues to its signed-in owner through a
// one-time code; Caddy removes the pass before the request reaches the app.
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, ne } from "drizzle-orm";
import express from "express";
import { rateLimit } from "express-rate-limit";
import type { Db } from "../db/client.ts";
import { member, session } from "../db/auth-schema.ts";
import { app } from "../db/schema.ts";
import { errorFields, log } from "../log.ts";
import { appAddress, appNameFromHost } from "./service.ts";

export const PASS_LIFETIME_SECONDS = 12 * 60 * 60;
const CODE_LIFETIME_MS = 60_000;

/** `__Host-` over HTTPS; host-only without the prefix on plain HTTP, where WebKit refuses it (plan). */
export function passCookieName(publicUrl: string): string {
  return publicUrl.startsWith("https://") ? "__Host-ys-pass" : "ys-pass";
}

function passKey(authSecret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", authSecret, "your-space", "app-pass", 32));
}

export function signPass(authSecret: string, appName: string, sessionId: string, expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ a: appName, s: sessionId, e: expiresAt })).toString("base64url");
  const mac = createHmac("sha256", passKey(authSecret)).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyPass(authSecret: string, value: string, appName: string, nowSeconds = Math.floor(Date.now() / 1000)): string | undefined {
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return undefined;
  const expected = createHmac("sha256", passKey(authSecret)).update(payload).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  try {
    const { a, s, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { a: string; s: string; e: number };
    if (a !== appName || typeof s !== "string" || typeof e !== "number" || e < nowSeconds) return undefined;
    return s;
  } catch {
    return undefined;
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

/** Only a path on the same origin, never `//host` or a full address. */
export function safeReturn(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  const origin = "https://return.invalid";
  const target = URL.parse(value, origin);
  if (!target || target.origin !== origin || target.pathname.startsWith("//")) return "/";
  return target.pathname + target.search + target.hash;
}

const LOOP_WINDOW_MS = 15_000;
const LOOP_LIMIT = 3;

/** One-time codes that carry a signed-in session from Your Space's origin to an app's. */
export class Handoffs {
  private readonly codes = new Map<string, { app: string; sessionId: string; expiresAt: number }>();
  private readonly recent = new Map<string, number[]>();

  /**
   * Whether the browser keeps asking for the same app without keeping its pass, which happens when
   * it blocks the app's cookies in a pane (WebKit does on the plain-HTTP local setup, where it
   * treats each *.localhost name as its own site). The app then has to open in its own tab.
   */
  looping(appName: string, sessionId: string): boolean {
    const key = `${sessionId}:${appName}`;
    const now = Date.now();
    const times = (this.recent.get(key) ?? []).filter((t) => now - t < LOOP_WINDOW_MS);
    times.push(now);
    this.recent.set(key, times);
    for (const [k, v] of this.recent) if (v.every((t) => now - t >= LOOP_WINDOW_MS)) this.recent.delete(k);
    return times.length > LOOP_LIMIT;
  }

  issue(appName: string, sessionId: string): string {
    const now = Date.now();
    for (const [code, entry] of this.codes) if (entry.expiresAt < now) this.codes.delete(code);
    const code = randomBytes(24).toString("base64url");
    this.codes.set(code, { app: appName, sessionId, expiresAt: now + CODE_LIFETIME_MS });
    return code;
  }

  consume(code: string, appName: string): string | undefined {
    const entry = this.codes.get(code);
    this.codes.delete(code);
    if (!entry || entry.expiresAt < Date.now() || entry.app !== appName) return undefined;
    return entry.sessionId;
  }
}

/** Whether a session still exists and belongs to the owner (FR-010). */
export async function ownerSessionValid(db: Db, sessionId: string): Promise<boolean> {
  const rows = await db
    .select({ id: session.id })
    .from(session)
    .innerJoin(member, and(eq(member.userId, session.userId), eq(member.role, "owner")))
    .where(and(eq(session.id, sessionId), gt(session.expiresAt, new Date())))
    .limit(1);
  return rows.length > 0;
}

export interface GateDeps {
  db: Db;
  publicUrl: string;
  authSecret: string;
  handoffs: Handoffs;
}

export function createGate({ db, publicUrl, authSecret, handoffs }: GateDeps): express.Express {
  const gate = express();
  gate.disable("x-powered-by");
  const cookieName = passCookieName(publicUrl);
  const ownHost = new URL(publicUrl).hostname;

  async function liveApp(name: string) {
    return (await db.select().from(app).where(and(eq(app.name, name), ne(app.state, "removed"))))[0];
  }

  // Caddy replaces the forwarding header with the resolved client IP on this private listener.
  gate.set("trust proxy", 1);
  const limitGate = rateLimit({
    windowMs: 60_000,
    limit: 1200, // Every app asset also passes through this check.
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  gate.get("/gate", limitGate, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const name = appNameFromHost(publicUrl, req.get("x-forwarded-host"));
    try {
      const row = name ? await liveApp(name) : undefined;
      if (!name || !row || !row.interface) {
        res.status(404).type("text").send("There is no app at this address.");
        return;
      }
      const pass = readCookie(req.get("cookie"), cookieName);
      const sessionId = pass ? verifyPass(authSecret, pass, name) : undefined;
      if (sessionId && (await ownerSessionValid(db, sessionId))) {
        res.set("X-YS-Upstream", `ys-${name}-ui:${row.interface.port}`);
        res.status(200).end();
        return;
      }
      const back = safeReturn(req.get("x-forwarded-uri"));
      res.redirect(302, `${publicUrl}/api/apps/${name}/open?return=${encodeURIComponent(back)}`);
    } catch (error) {
      log("warn", "gate.failed", errorFields(error));
      res.status(503).type("text").send("Your Space can't check access right now.");
    }
  });

  gate.get("/handoff", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const name = appNameFromHost(publicUrl, req.get("x-forwarded-host"));
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const sessionId = name ? handoffs.consume(code, name) : undefined;
    if (!name || !sessionId) {
      res.status(403).type("text").send("This link has expired. Open the app from Your Space again.");
      return;
    }
    const expiresAt = Math.floor(Date.now() / 1000) + PASS_LIFETIME_SECONDS;
    const secure = publicUrl.startsWith("https://") ? "; Secure" : "";
    res.set(
      "Set-Cookie",
      `${cookieName}=${signPass(authSecret, name, sessionId, expiresAt)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PASS_LIFETIME_SECONDS}${secure}`,
    );
    // The code is in this address; it isn't passed on as a referrer.
    res.set("Referrer-Policy", "no-referrer");
    res.redirect(302, safeReturn(req.query.return));
  });

  // Caddy asks before getting a certificate for a name (own-domain setup), so only Your Space's
  // own name and its installed apps' names get one.
  gate.get("/tls-ask", async (req, res) => {
    const domain = String(req.query.domain ?? "").toLowerCase();
    if (domain === ownHost) return void res.status(200).end();
    const name = appNameFromHost(publicUrl, domain);
    const row = name ? await liveApp(name).catch(() => undefined) : undefined;
    res.status(row && appAddress(publicUrl, row.name).host === domain ? 200 : 404).end();
  });

  return gate;
}
