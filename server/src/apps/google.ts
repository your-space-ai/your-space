// Google sign-in for synced knowledge bases (journey 014, decision 2026-11-25): the operator's own
// OAuth client, since rclone's shared client stops working during 2026. Your Space's server runs the
// authorization-code flow itself, with a state and PKCE, and gives rclone only the resulting token,
// for one run at a time. The Drive scope is the full one: a knowledge base syncs a folder the owner
// already has, which the narrower drive.file scope can't see.
import { createHash, randomBytes } from "node:crypto";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export interface GoogleEndpoints {
  /** Where the browser signs in: Google's authorization endpoint, or a stand-in in tests. */
  auth: string;
  /** Where the server exchanges the code: Google's token endpoint, or a stand-in in tests. */
  token: string;
}

export function googleEndpoints(env: NodeJS.ProcessEnv = process.env): GoogleEndpoints {
  return {
    auth: env.YS_E2E_GOOGLE_AUTH || "https://accounts.google.com/o/oauth2/v2/auth",
    token: env.YS_E2E_GOOGLE_TOKEN || "https://oauth2.googleapis.com/token",
  };
}

/** The address Google sends the owner back to, which the operator registers with their client. */
export function redirectUri(publicUrl: string): string {
  return `${publicUrl}/api/google-drive/callback`;
}

export class GoogleError extends Error {
  /** Google's error code, such as invalid_grant, or Your Space's own. */
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GoogleError";
    this.code = code;
  }
}

interface Pending {
  verifier: string;
  sessionId: string;
  expiresAt: number;
}

const SIGN_IN_MS = 10 * 60_000;

/**
 * Sign-ins under way: the state Google returns names one, which only the session that started it can
 * finish, once, within ten minutes, with the PKCE verifier kept here.
 */
export class SignIns {
  private readonly pending = new Map<string, Pending>();

  start(sessionId: string, now = Date.now()): { state: string; challenge: string } {
    for (const [state, entry] of this.pending) if (entry.expiresAt <= now) this.pending.delete(state);
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    this.pending.set(state, { verifier, sessionId, expiresAt: now + SIGN_IN_MS });
    return { state, challenge: challengeOf(verifier) };
  }

  /** The verifier of the sign-in the state names, if this session started it and it hasn't expired. */
  finish(state: string, sessionId: string, now = Date.now()): string | undefined {
    const entry = this.pending.get(state);
    if (!entry || entry.sessionId !== sessionId) return undefined;
    this.pending.delete(state);
    return entry.expiresAt > now ? entry.verifier : undefined;
  }
}

/** PKCE's S256 challenge of a verifier (RFC 7636). */
export function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Google's sign-in page for the client: offline access, so Google gives a refresh token, and the
 * consent screen every time, so it gives one again on a reconnection.
 */
export function authorizationUrl(endpoints: GoogleEndpoints, input: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(endpoints.auth);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

interface TokenAnswer {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

/**
 * Exchanges the code for a token, and returns it as rclone reads one: the JSON of Go's oauth2.Token,
 * with an `expiry` time rather than Google's `expires_in`, so rclone knows when to refresh it.
 */
export async function exchangeCode(
  endpoints: GoogleEndpoints,
  input: { code: string; verifier: string; clientId: string; clientSecret: string; redirectUri: string },
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(endpoints.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        code_verifier: input.verifier,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new GoogleError("unreachable", "Google's sign-in can't be reached from Your Space's server right now. Try again.");
  }
  const answer = (await response.json().catch(() => ({}))) as TokenAnswer;
  if (!response.ok) {
    const code = typeof answer.error === "string" ? answer.error : "refused";
    // Google's own description names the problem, such as a wrong client secret; it holds no secret.
    const detail = typeof answer.error_description === "string" ? ` (${answer.error_description.slice(0, 200)})` : "";
    throw new GoogleError(code, `Google refused the sign-in: ${code}${detail}.`);
  }
  return rcloneToken(answer, now);
}

/** Google's token answer as rclone's token: a refresh token is required, and access to Drive. */
export function rcloneToken(answer: TokenAnswer, now = Date.now()): string {
  if (typeof answer.access_token !== "string" || !answer.access_token) throw new GoogleError("no_token", "Google's answer had no access token.");
  if (typeof answer.refresh_token !== "string" || !answer.refresh_token) {
    throw new GoogleError("no_refresh_token", "Google gave no refresh token, so the sync would stop within an hour. Sign in again.");
  }
  // With granular consent the owner can leave Drive unticked on Google's screen.
  if (typeof answer.scope === "string" && !answer.scope.split(" ").includes(DRIVE_SCOPE)) {
    throw new GoogleError("no_drive", "Google didn't give access to Drive. Sign in again and allow Your Space to see, edit, create and delete your Drive files.");
  }
  const seconds = typeof answer.expires_in === "number" && answer.expires_in > 0 ? answer.expires_in : 3600;
  return JSON.stringify({
    access_token: answer.access_token,
    token_type: typeof answer.token_type === "string" ? answer.token_type : "Bearer",
    refresh_token: answer.refresh_token,
    expiry: new Date(now + seconds * 1000).toISOString(),
  });
}

const FOLDER_ID = /^[A-Za-z0-9_-]{10,200}$/;

/**
 * The folder ID in a Drive folder's link, as Drive's address bar or Share shows it, or a folder ID on
 * its own. Anything else, such as a file's link or My Drive's, is refused: a sync covers one folder.
 */
export function folderIdOf(input: string): string | undefined {
  const text = input.trim();
  if (FOLDER_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname !== "drive.google.com") return undefined;
  const folder = /^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
  const opened = url.pathname === "/open" ? url.searchParams.get("id") : undefined;
  const id = folder ?? opened ?? undefined;
  return id && FOLDER_ID.test(id) ? id : undefined;
}
