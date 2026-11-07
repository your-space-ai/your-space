// T051 (server half): after setup, sign-in, failures, and recovery, the server's logs and the
// commands' stderr hold no passwords, tokens, links, or session values (cross-cutting scenario 2,
// FR-010). The commands' stdout delivers the link to the operator on purpose and is not a log.
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand, type CommandResult } from "./helpers/commands.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_SECRET } from "./helpers/env.ts";
import { OWNER } from "./helpers/owner.ts";

const SERVER = fileURLToPath(new URL("../src/index.ts", import.meta.url));

// Synthetic passwords, each distinct so a leak names the step that caused it.
const PASSWORDS = {
  first: OWNER.password,
  wrong: "wrong horse battery staple 7",
  short: "Tiny9pass",
  recovered: "a brand new passphrase 2026",
  signUp: "visitor passphrase 48151623",
  malformed: "malformed body passphrase 42",
};

// Documentation addresses (RFC 5737), one per step so the sign-in limit only trips where intended.
const IP = {
  first: "198.51.100.11",
  second: "198.51.100.12",
  recovered: "198.51.100.13",
  limit: "198.51.100.14",
  malformed: "198.51.100.15",
  other: "198.51.100.16",
};

let t: TestDatabase;
let child: ChildProcess | undefined;
let baseUrl: string;
let publicUrl: string;
const serverOut = { stdout: "", stderr: "" };
const commandStderr: Record<string, string> = {};
const jsonRuns: CommandResult[] = [];
const publicErrors: string[] = [];
let responses = 0;
/** label -> value that must not appear in logs. */
const secrets = new Map<string, string>();

function secret(label: string, value: string | undefined): void {
  if (!value) return;
  secrets.set(label, value);
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {}
  if (decoded !== value) secrets.set(`${label} (decoded)`, decoded);
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

beforeAll(async () => {
  // The server applies the migrations itself, so its migration logs are covered too.
  t = await createTestDatabase({ migrate: false });
  const db = new URL(t.url);
  secret("database password", db.password);
  secret("database URL", t.url);
  secret("BETTER_AUTH_SECRET", TEST_SECRET);

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  publicUrl = `http://localhost:${port}`;
  child = spawn(process.execPath, [SERVER], {
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "production",
      PORT: String(port),
      DATABASE_URL: t.url,
      YS_PUBLIC_URL: publicUrl,
      BETTER_AUTH_SECRET: TEST_SECRET,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (chunk) => (serverOut.stdout += chunk));
  child.stderr!.on("data", (chunk) => (serverOut.stderr += chunk));

  const deadline = Date.now() + 30_000;
  while (!serverOut.stdout.includes('"event":"server.listening"')) {
    if (child.exitCode !== null) throw new Error(`The server exited early:\n${serverOut.stderr}`);
    if (Date.now() > deadline) throw new Error(`The server did not start:\n${serverOut.stdout}\n${serverOut.stderr}`);
    await sleep(50);
  }
});

afterAll(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
  await t?.destroy();
});

interface Reply {
  status: number;
  body: any;
  cookie: string;
}

/** A request as a browser on the public URL behind Caddy would send it. Error bodies are kept for the scan. */
async function call(
  path: string,
  options: { method?: string; body?: unknown; raw?: string; cookie?: string; ip?: string } = {},
): Promise<Reply> {
  const headers = new Headers({ origin: publicUrl, "x-forwarded-for": options.ip ?? IP.other });
  const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body,
    redirect: "manual",
  });
  const text = await response.text();
  const n = ++responses;
  if (response.status >= 400) publicErrors.push(`${response.status} ${path}: ${text}`);

  const pairs: string[] = [];
  for (const setCookie of response.headers.getSetCookie()) {
    const pair = setCookie.split(";")[0]!;
    const name = pair.slice(0, pair.indexOf("="));
    const value = pair.slice(pair.indexOf("=") + 1);
    if (!value) continue;
    pairs.push(pair);
    secret(`cookie ${name} from response ${n} (${path})`, value);
    // A signed cookie is `<session token>.<signature>`; the token alone also authenticates.
    if (name.endsWith("session_token")) {
      secret(`session token from response ${n} (${path})`, decodeURIComponent(value).split(".")[0]);
    }
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { status: response.status, body: parsed, cookie: pairs.join("; ") };
}

async function command(label: string, name: "create-owner" | "reset-link", args: string[]): Promise<CommandResult> {
  const result = await runCommand(name, args, { databaseUrl: t.url, publicUrl });
  commandStderr[label] = result.stderr;
  if (args.includes("--json")) jsonRuns.push(result);
  return result;
}

/** Every value that must stay out of logs and public errors, by label. */
const forbidden = () =>
  new Map<string, string>([...Object.entries(PASSWORDS).map(([k, v]) => [`password ${k}`, v] as const), ...secrets]);

const signIn = (password: string, ip: string) =>
  call("/api/auth/sign-in/email", { body: { email: OWNER.email, password }, ip });

const resetPassword = (token: string, newPassword: string) =>
  call("/api/auth/reset-password", { body: { token, newPassword } });

describe("logs (cross-cutting scenario 2)", () => {
  it("exercises setup, sign-in, failures, and recovery against the real server", async () => {
    expect((await call("/api/status")).body).toEqual({ owner: false });

    // Setup: create-owner prints a set-password link; the token sets the first password.
    const created = await command("create-owner --json", "create-owner", [
      "--email",
      OWNER.email,
      "--name",
      OWNER.name,
      "--json",
    ]);
    expect(created.code).toBe(0);
    secret("create-owner token", created.json.token);
    secret("create-owner link", created.json.url);

    const again = await command("create-owner (owner exists)", "create-owner", ["--email", OWNER.email, "--name", OWNER.name]);
    expect(again.code).toBe(2);

    expect((await resetPassword(created.json.token, PASSWORDS.short)).status).toBe(400);
    expect((await resetPassword(created.json.token, PASSWORDS.first)).status).toBe(200);
    expect((await call("/api/status")).body).toEqual({ owner: true });

    // Sign-in: a wrong password, then the right one.
    expect((await signIn(PASSWORDS.wrong, IP.first)).status).toBe(401);
    const first = await signIn(PASSWORDS.first, IP.first);
    expect(first.status).toBe(200);
    expect(first.cookie).not.toBe("");
    secret("sign-in response token", first.body.token);

    const current = await call("/api/auth/get-session", { cookie: first.cookie });
    expect(current.status).toBe(200);
    expect(current.body.user.email).toBe(OWNER.email);
    secret("get-session token", current.body.session.token);
    expect((await call("/api/auth/organization/list", { cookie: first.cookie })).status).toBe(200);

    // Sign-out, then the old cookie is replayed.
    expect((await call("/api/auth/sign-out", { body: {}, cookie: first.cookie })).status).toBe(200);
    expect((await call("/api/auth/get-session", { cookie: first.cookie })).body).toBeNull();
    expect((await call("/api/auth/organization/list", { cookie: first.cookie })).status).toBe(401);

    // Refused requests: asking for a reset link and signing up over HTTP.
    const reset = await call("/api/auth/request-password-reset", {
      body: { email: OWNER.email, redirectTo: "/reset-password" },
    });
    expect(reset.status).toBeGreaterThanOrEqual(400);
    const signUp = await call("/api/auth/sign-up/email", {
      body: { email: "visitor@example.com", name: "Visitor", password: PASSWORDS.signUp },
    });
    expect(signUp.status).toBe(400);

    // A second session, which recovery signs out.
    const second = await signIn(PASSWORDS.first, IP.second);
    expect(second.status).toBe(200);
    secret("second sign-in response token", second.body.token);

    // Recovery: one link printed for a person, one as JSON; the JSON one is used.
    const human = await command("reset-link", "reset-link", []);
    expect(human.code).toBe(0);
    const humanLink = human.stdout.split("\n").find((line) => line.includes("/reset-password#token="));
    secret("reset-link link (human output)", humanLink?.trim());
    secret("reset-link token (human output)", humanLink?.split("#token=")[1]?.trim());

    const recovery = await command("reset-link --json", "reset-link", ["--json"]);
    expect(recovery.code).toBe(0);
    secret("reset-link token", recovery.json.token);
    secret("reset-link link", recovery.json.url);

    expect((await resetPassword(recovery.json.token, PASSWORDS.recovered)).status).toBe(200);
    expect((await resetPassword(recovery.json.token, PASSWORDS.recovered)).status).toBe(400);
    // The callback route carries the token in the URL path; a used token is redirected with an error.
    const callback = await call(`/api/auth/reset-password/${recovery.json.token}?callbackURL=%2Freset-password`);
    expect(callback.status).toBeGreaterThanOrEqual(300);

    expect((await call("/api/auth/get-session", { cookie: second.cookie })).body).toBeNull();
    const recovered = await signIn(PASSWORDS.recovered, IP.recovered);
    expect(recovered.status).toBe(200);
    secret("recovered sign-in response token", recovered.body.token);
    expect((await signIn(PASSWORDS.first, IP.recovered)).status).toBe(401);

    // Repeated failures reach the sign-in limit.
    let limited = 0;
    for (let attempt = 0; attempt < 6 && limited === 0; attempt++) {
      if ((await signIn(PASSWORDS.wrong, IP.limit)).status === 429) limited++;
    }
    expect(limited).toBe(1);

    // Malformed JSON, to Better Auth and to the app's own routes.
    const truncated = `{"email":"${OWNER.email}","password":"${PASSWORDS.malformed}"`;
    const malformedAuth = await call("/api/auth/sign-in/email", { raw: truncated, ip: IP.malformed });
    expect(malformedAuth.status).toBeGreaterThanOrEqual(400);
    expect(malformedAuth.status).toBeLessThan(500);
    const malformedApp = await call("/api/status", { method: "POST", raw: truncated });
    expect(malformedApp).toMatchObject({ status: 400, body: { error: "bad_request" } });

    child!.kill("SIGTERM");
    const [code] = await once(child!, "exit");
    expect(code).toBe(0);
  });

  it("keeps passwords, tokens, links, session values, and configured secrets out of every log", () => {
    const sources: Record<string, string> = {
      "server stdout": serverOut.stdout,
      "server stderr": serverOut.stderr,
      ...Object.fromEntries(Object.entries(commandStderr).map(([label, text]) => [`${label} stderr`, text])),
    };
    const all = forbidden();
    // Every step above ran, so every kind of value is on the list.
    expect([...all.keys()].filter((label) => label.startsWith("session token from"))).toHaveLength(3);
    expect(all.has("reset-link token") && all.has("create-owner token")).toBe(true);
    expect(serverOut.stdout).toContain('"event":"server.stopping"');

    const leaks: string[] = [];
    for (const [source, text] of Object.entries(sources)) {
      for (const line of text.split("\n")) {
        for (const [label, value] of all) {
          if (line.includes(value)) leaks.push(`${label} in ${source}: ${line}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it("writes JSON log lines with time, level, and event", () => {
    const text = [serverOut.stdout, serverOut.stderr, ...Object.values(commandStderr)].join("\n");
    const lines = text.split("\n").filter((line) => line.trim().startsWith("{"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      let entry: any;
      expect(() => (entry = JSON.parse(line)), line).not.toThrow();
      expect(typeof entry.time, line).toBe("string");
      expect(Number.isNaN(Date.parse(entry.time)), line).toBe(false);
      expect(["debug", "info", "warn", "error"], line).toContain(entry.level);
      expect(typeof entry.event === "string" && entry.event.length > 0, line).toBe(true);
    }
  });

  it("prints only the one JSON object on stdout with --json", () => {
    expect(jsonRuns.length).toBe(2);
    for (const run of jsonRuns) {
      const lines = run.stdout.split("\n").filter((line) => line.trim() !== "");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toEqual(run.json);
      expect(run.stderr).toBe("");
    }
  });

  it("keeps passwords, tokens, and session values out of public error responses", () => {
    expect(publicErrors.length).toBeGreaterThan(5);
    const values = [...forbidden()];
    const leaks = publicErrors.flatMap((error) =>
      values.filter(([, value]) => error.includes(value)).map(([label]) => `${label} in ${error}`),
    );
    expect(leaks).toEqual([]);
  });
});
